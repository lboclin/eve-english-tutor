// Evaluator: reads a talk transcript and extracts every mistake in Lucas's turns (one structured call).
// Lucas's recurring past mistakes go into ITS context (not GPT-Live's), so repeats reuse their rule key.
// Limit: a text transcript can't show pronunciation. Pronunciation mistakes are only reported when one of
// Eve's own turns corrects a sound or stress (e.g. 'say "think", with the th sound').
import { jsonCall } from "../openai.ts";
import { CATEGORIES, type Category } from "../lib/cards-repo.ts";
import { EVALUATOR, type ModelChoice } from "./models.ts";

export interface TranscriptLine {
  speaker: "you" | "eve";
  text: string;
}

export interface PastRule {
  rule: string;
  category: string;
  title: string;
  count: number;
}

export interface FoundMistake {
  line: number; // index in the transcript array
  category: Category;
  rule: string;
  title: string;
  description: string;
  said: string;
  correct: string[];
  severity: 1 | 2 | 3;
}

const INSTRUCTIONS = `
You are the evaluator of Eve, an English-practice app. Lucas is a Brazilian software developer, B2 level,
aiming for C1. You get the transcript of a spoken conversation between Lucas (YOU) and Eve (EVE, an AI
tutor). Find EVERY real English mistake in Lucas's YOU lines, so he can study them afterwards.
Lucas is learning American English: every correct form you give is American (vocabulary, usage, General American
pronunciation).

## What counts
Report each distinct error separately (two errors in one sentence = two entries):
- grammar: tense/aspect (e.g. present continuous with "since"), agreement (people is), articles,
  word order (embedded questions), verb patterns (explain me → explain to me), countability, etc.
- collocations: wrong partner words or prepositions, often Portuguese calques (make a question →
  ask a question, depends of → depends on, I'm agree → I agree).
- vocabulary: wrong word choice or false friends (actually for "currently", pretend for "intend").
- phrasal: a wrong or misused phrasal verb.
- pronunciation: ONLY when an EVE line explicitly corrects Lucas's pronunciation of a sound or stress
  (e.g. EVE: '"think", with the th sound'). You cannot hear audio, so never guess pronunciation errors.

## What does NOT count (never report these)
- Fillers, hesitations, restarts, false starts, self-corrections Lucas already made (uh, um, "I go— I went").
- Natural spoken informality that a fluent speaker would also use: contractions, gonna/wanna, "yeah",
  sentence fragments as answers, "like" as a filler, starting with "So"/"And", "me too", "kind of".
- Punctuation, capitalization, spelling, sentence boundaries: the transcript comes from speech
  recognition, which keeps Lucas's words verbatim but may split one sentence over several consecutive
  YOU lines or drop final periods. Judge the words, reading consecutive YOU lines as one utterance;
  never flag a "fragment" or "run-on" that is only an artifact of that splitting.
- Probable speech-recognition noise (a homophone or a word that makes no sense in context).
- Style preferences when Lucas's sentence is already correct and natural. Do not invent mistakes:
  if a line is fine, report nothing for it. Precision matters as much as recall.

Eve corrects live, so EVE lines may contain "Quick fix: …" corrections. Use them as hints (each one
usually points at a real mistake in the YOU line before it), but still check the words yourself, and
report mistakes Eve did not mention too.

## Fields
- line: the [number] of the YOU line where the mistake is (where it starts, if it spans lines).
- category: grammar | collocations | vocabulary | phrasal | pronunciation.
- rule: a stable kebab-case key for the error TYPE (not the sentence), so repeats can be counted across
  sessions. If the error matches one of Lucas's past rules below, REUSE that exact key. Otherwise create
  one: plain grammar names (present-perfect-since, people-plural-agreement, age-with-be,
  embedded-question-order, explain-to-sb), prep-<case> (prep-depend-on), calque-<pt-word>
  (calque-fazer-pergunta), pron-<sound or word> (pron-th-voiceless, pron-stress-comfortable).
- title: 2–5 words naming the point ("Saying your age", "depend + preposition").
- description: ONE short sentence explaining the rule in plain English; wrap the key word(s) in *asterisks*.
- said: Lucas's exact words — the relevant clause, copied verbatim from the transcript.
- correct: 1–2 natural corrected versions of that clause (minimal change first; a more natural one second
  if it helps). Fix only this mistake.
  For pronunciation: said = the mispronounced word as Eve reported it (e.g. "tink"), correct = the word
  with a simple respelling or IPA (e.g. "think /θɪŋk/").
- severity: 1 minor slip (meaning clear, sounds slightly off), 2 clear error a listener notices,
  3 serious (very basic error, a calque that changes or obscures meaning, or a repeat of a past rule).
`;

const SCHEMA = {
  name: "talk_mistakes",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["mistakes"],
    properties: {
      mistakes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["line", "category", "rule", "title", "description", "said", "correct", "severity"],
          properties: {
            line: { type: "integer" },
            category: { type: "string", enum: [...CATEGORIES] },
            rule: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            said: { type: "string" },
            correct: { type: "array", items: { type: "string" } },
            severity: { type: "integer", enum: [1, 2, 3] },
          },
        },
      },
    },
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export async function evaluateTranscript(lines: TranscriptLine[], past: PastRule[], choice: ModelChoice = EVALUATOR): Promise<FoundMistake[]> {
  if (!lines.some((l) => l.speaker === "you" && l.text.trim())) return [];
  const input = [
    "Lucas's recurring past mistakes (rule key · category · times · example title):",
    ...(past.length ? past.map((p) => `- ${p.rule} · ${p.category} · ${p.count}× · ${p.title}`) : ["(none yet)"]),
    "",
    "Transcript:",
    ...lines.map((l, k) => `[${k}] ${l.speaker === "you" ? "YOU" : "EVE"}: ${l.text.trim()}`),
  ].join("\n");
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  const out = await jsonCall<{ mistakes: FoundMistake[] }>({
    purpose: "evaluator",
    model: choice.model,
    reasoning: choice.reasoning,
    instructions: INSTRUCTIONS,
    input,
    schema: SCHEMA,
    maxOutputTokens: Math.min(40000, 8000 + words * 4),
  });
  const seen = new Set<string>();
  return out.mistakes
    .filter((m) => lines[m.line]?.speaker === "you" && m.said.trim() && m.correct.length)
    // Drop no-op "corrections" (correct == said) and exact duplicates: both showed up in the model tests.
    .filter((m) => m.category === "pronunciation" || norm(m.correct[0]) !== norm(m.said))
    .filter((m) => {
      const key = `${m.line}|${norm(m.said)}|${norm(m.correct[0])}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .map((m) => ({
      ...m,
      rule: kebab(m.rule) || kebab(m.title) || "unnamed",
      correct: m.correct.slice(0, 2),
      severity: (Math.min(3, Math.max(1, m.severity)) as 1 | 2 | 3),
    }));
}
