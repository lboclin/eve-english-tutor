// Card engine: anki-add's router + card designs, native in Eve. One structured call turns a batch of items
// (typed lines, or a mistake from a talk) into card drafts filed in the right deck.
// Spec: skills/eve-add/ (SKILL.md + references/*.md; formerly anki-add).
import { db } from "../db.ts";
import { jsonCall } from "../openai.ts";
import type { Category } from "../lib/cards-repo.ts";
import { CARD_ENGINE, type ModelChoice } from "./models.ts";

export const KINDS = ["word", "collocation", "phrasal", "fix", "pronunciation"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_CATEGORY: Record<Kind, Category> = {
  word: "vocabulary",
  collocation: "collocations",
  phrasal: "phrasal",
  fix: "grammar",
  pronunciation: "pronunciation",
};
export const CATEGORY_KIND: Record<Category, Kind> = {
  vocabulary: "word",
  collocations: "collocation",
  phrasal: "phrasal",
  grammar: "fix",
  pronunciation: "pronunciation",
};
// Cards per event, as in anki-add (phrasal: 2 per sense, up to 2 senses).
const EVENT_SIZE: Record<Kind, number[]> = { word: [1], collocation: [1], phrasal: [2, 4], fix: [3], pronunciation: [2] };
const PREFIXES: Record<string, Kind> = { "word:": "word", "col:": "collocation", "pv:": "phrasal", "fix:": "fix", "pron:": "pronunciation" };

export interface Draft {
  category: Category;
  front: string;
  back: string;
  eventKey?: string;
  tags: string[];
}

export interface DraftItem {
  input: string;
  kind: Kind;
  category: Category;
  slug: string; // fix rule / phrasal pv / pronunciation rule; "" for word and collocation
  drafts: Draft[];
  warning?: string;
}

export interface EngineItem {
  text: string;
  kind?: Kind; // forced kind (prefix or mistake category)
  context?: string; // extra facts for the model (e.g. the mistake's rule and Eve's explanation)
}

const INSTRUCTIONS = `
You are the card engine of Eve, an English-practice app for Lucas: a Brazilian software developer,
B2 level, aiming for C1. You turn each input item into flashcards, following the designs below exactly.
Cards are HTML: join pieces with <br>, highlight with <b>, use <i> sparingly. No other tags, no Markdown.
Cards are in English except the PT hints, which are natural Brazilian Portuguese, written the way Lucas
would think the idea.
All English on the cards is American English only: American spelling (data center, color, organize, traveled), vocabulary (apartment, truck, cell phone) and usage (on the weekend, in the hospital); IPA and respellings follow General American. If the item
itself is British (e.g. "data centre", "flat"), card the American form and say so in the warning.

## 1. Classify each item (one item = one input line)
A forced kind is given when Lucas used a prefix; obey it. Otherwise:
- word: a single unknown word (+ optional PT context). Difficulty = its meaning.
- collocation: words that go together (make a mistake, raise concerns about, depend on). Difficulty =
  which words pair up; meaning intact.
- phrasal: verb + particle whose meaning is not the sum of its parts (pull off, put off, come up with).
  Transparent ones (sit down, go back) are not phrasal.
- fix: a wrong → right correction of Lucas's own English ("→" or "->" marks a correction).
- pronunciation: a sound or stress problem (th in "think", stress in "comfortable", silent letters).
An item that only gives context in Portuguese is still classified by its English part.

## 2. Card designs

### word → exactly 1 card
front: the word/phrase exactly.
back, pieces joined with <br>: a concise monolingual English definition of the sense Lucas met
(Cambridge/Longman style); optionally (PT: gloss) ONLY for concrete physical nouns; one natural example
sentence in quotes, in the domain of the context when given; optionally a usage note in parens;
optionally a ⚠ line for a false friend or near-miss contrast. Never print the PT context on the card.

### collocation → exactly 1 produce card
front: a natural sentence with ___ where the collocation goes (gap the part a calque would get wrong,
usually the verb + preposition; never a single article), then <br>(PT: hint). The PT hint is mandatory and
must make the answer unambiguous.
back: the full sentence with the collocation in <b>, <br> the pattern with sth/sb placeholders, and
optionally <br>⚠ PT "<source>" → <right word>, only when a real Portuguese trap exists.
Example: front "She ___ concerns about the budget in the meeting.<br>(PT: levantou preocupações)"
back "She <b>raised concerns about</b> the budget in the meeting.<br>raise concerns about sth"

### phrasal → 2 cards per sense, meet card FIRST, then produce card (max 2 senses, usually 1)
card 1 (meet): a sentence with the phrasal verb visible in <b>, then <br>What does "<pv>" mean here?
  back: the meaning (e.g. "to succeed at sth difficult"); a separability line (pull it off, never
  "pull off it") ONLY when the verb is transitive and commonly split and you are sure.
card 2 (produce): a DIFFERENT sentence (other subject, tense or domain) with one ___ per word of the
  phrasal verb (___ ___ for "pull off", ___ ___ ___ for "come up with"), then <br>(PT: hint) that forces it.
  back: the sentence with the verb in <b>, <br> pattern = meaning.
No exact frequency percentages. No blanket "informal" label; register only when that sense is bound to it.
slug = the verb in kebab-case (pull-off, come-up-with).

### fix → exactly 3 cards around one rule
card 1 (fix-it): "✏️ Fix: " + a sentence in Lucas's domain that contains ONLY this one error. It must NOT
  be his sentence (change the subject, object or situation).
  Every fix-it front contains the error exactly once, made the way Lucas makes it, and nothing else wrong.
card 2 (fix-it): "✏️ Fix: " + a NEW sentence, different context and structure, same error.
card 3 (produce): a new sentence with ___ where the right form goes, then <br>(PT: hint) that forces it.
backs (all three): the corrected sentence with the fix in <b>, then <br> a one-line rule, then optionally
<br>⚠ calque of PT "<word>". The back never repeats the wrong form, not even as "not X" (the only
exception is the PT source word inside ⚠).
Fix-it fronts are plain text: no <b>/<i> around the error (that gives the answer away). Each fix-it front
is natural English except for the single deliberate error; backs are fully grammatical and idiomatic.
slug = rule key in kebab-case: reuse an existing rule from the list below when it is the same error;
families: calque-<pt-word> (calque-cometer-erros), prep-<case> (prep-depend-on), plain grammar names
(was-were-agreement, present-perfect-since, age-with-be, embedded-question-order).
Don't card pure typos.

### pronunciation → exactly 2 cards around one sound or stress rule
card 1 (recognise): "🗣️ Say it out loud: " + a short new sentence with the target word in <b>.
  back: the word with a simple respelling where CAPITALS mark the stressed syllable, plus IPA between
  slashes (e.g. COMF-tə-bəl /ˈkʌmftəbəl/), <br> one physical tip (where the tongue/lips go, or which
  syllable is loud, how many syllables), and optionally <br>⚠ the typical Brazilian slip (e.g. "tink" or
  "fink" for think; com-for-TA-ble).
card 2 (transfer): "🗣️ Say it out loud: " + a DIFFERENT word (in a short sentence, in <b>) with the same
  sound or stress pattern, so Lucas learns the pattern, not one word. Or a minimal pair
  ("<b>think</b> · <b>sink</b> — make them different") when the contrast is the point.
  back: respelling + IPA, <br> the shared rule in one line.
slug = pron-<sound or word> (pron-th-voiceless, pron-stress-comfortable, pron-silent-l).

## 3. Rules for every card
- Never reuse Lucas's example sentence verbatim on a card. Write a new one that fits the sense, in the
  same domain when possible (his world: software development, startups, AI, football, daily life).
- Vary examples; avoid textbook blandness. Keep every card short and clean.
- Read each front and back as a whole sentence before answering: natural, idiomatic, correct.
- If an item's meaning is unclear, still produce your best cards and say why in "warning"; otherwise "".
`;

const SCHEMA = {
  name: "card_drafts",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "kind", "slug", "cards", "warning"],
          properties: {
            index: { type: "integer", description: "the input item's number" },
            kind: { type: "string", enum: [...KINDS] },
            slug: { type: "string", description: "kebab-case rule / pv / pron key; empty for word and collocation" },
            cards: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["front", "back"],
                properties: { front: { type: "string" }, back: { type: "string" } },
              },
            },
            warning: { type: "string" },
          },
        },
      },
    },
  },
};

// Lines → items. A prefix (word: col: pv: fix: pron:) forces the kind.
export function parseLines(text: string): EngineItem[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const lower = line.toLowerCase();
      for (const [p, kind] of Object.entries(PREFIXES)) {
        if (lower.startsWith(p)) return { text: line.slice(p.length).trim(), kind };
      }
      return { text: line };
    })
    .filter((i) => i.text);
}

// Existing rule keys (mistakes + carded fixes/pronunciation), so the engine reuses them and recurrence counts stay true.
function knownSlugs(): string[] {
  const fromMistakes = db
    .prepare("SELECT rule, COUNT(*) AS n FROM mistakes GROUP BY rule ORDER BY n DESC LIMIT 60")
    .all() as { rule: string }[];
  const fromCards = db
    .prepare(
      `SELECT DISTINCT j.value AS rule FROM cards, json_each(cards.tags) AS j
       WHERE j.value LIKE 'err::%' OR j.value LIKE 'pron::%' LIMIT 100`,
    )
    .all() as { rule: string }[];
  return [...new Set([...fromMistakes, ...fromCards].map((r) => r.rule.replace(/^(err|pron)::/, "")))];
}

const ALLOWED_TAG = /^<\/?(b|i)>$|^<br\s*\/?>$/i;
// Card HTML allowlist: <b> <i> <br> only (attributes dropped, everything else stripped).
export function cleanHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, "")
    .replace(/<[^>]*>/g, (tag) => {
      const t = tag.replace(/\s+[^>]*?(\/?)>$/, "$1>");
      return ALLOWED_TAG.test(t) ? t.toLowerCase().replace(/<br\s*\/?>/, "<br>") : "";
    })
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .trim();
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export async function draftCards(items: EngineItem[], choice: ModelChoice = CARD_ENGINE): Promise<DraftItem[]> {
  if (!items.length) return [];
  const slugs = knownSlugs();
  const input = [
    `Existing rule keys (reuse when it is the same error): ${slugs.length ? slugs.join(", ") : "(none yet)"}`,
    "",
    "Items:",
    ...items.map(
      (it, k) =>
        `${k + 1}. ${it.kind ? `[forced kind: ${it.kind}] ` : ""}${it.text}${it.context ? `\n   context: ${it.context}` : ""}`,
    ),
  ].join("\n");
  const out = await jsonCall<{ items: { index: number; kind: Kind; slug: string; cards: { front: string; back: string }[]; warning: string }[] }>({
    purpose: "card-engine",
    model: choice.model,
    reasoning: choice.reasoning,
    instructions: INSTRUCTIONS,
    input,
    schema: SCHEMA,
    maxOutputTokens: 6000 + 1500 * items.length,
  });

  const stamp = Date.now().toString(36);
  return items.map((it, k) => {
    const got = out.items.find((o) => o.index === k + 1) ?? out.items[k];
    const kind: Kind = it.kind ?? (got && KINDS.includes(got.kind) ? got.kind : "word");
    const category = KIND_CATEGORY[kind];
    if (!got) return { input: it.text, kind, category, slug: "", drafts: [], warning: "The engine returned no cards for this item." };
    const slug = kind === "word" || kind === "collocation" ? "" : slugify(got.slug) || slugify(it.text).slice(0, 40);
    const tags = [`mode::${kind}`, ...(kind === "fix" ? [`err::${slug}`] : kind === "phrasal" ? [`pv::${slug}`] : kind === "pronunciation" ? [`pron::${slug}`] : [])];
    const cards = got.cards.map((c) => ({ front: cleanHtml(c.front), back: cleanHtml(c.back) })).filter((c) => c.front && c.back);
    const drafts: Draft[] = cards.map((c, n) => ({
      category,
      front: c.front,
      back: c.back,
      // One event per fix / pronunciation item, one per phrasal sense (2 cards each).
      eventKey: slug ? `${slug}#${stamp}${k}${kind === "phrasal" ? `-${Math.floor(n / 2)}` : ""}` : undefined,
      tags,
    }));
    const sizeOk = EVENT_SIZE[kind].includes(drafts.length);
    const warning = [got.warning, sizeOk ? "" : `Expected ${EVENT_SIZE[kind].join(" or ")} card(s) for ${kind}, got ${drafts.length}.`]
      .filter(Boolean)
      .join(" ");
    return { input: it.text, kind, category, slug, drafts, ...(warning ? { warning } : {}) };
  });
}

// A mistake found by the evaluator → the cards for its deck (fix 3, pronunciation 2, phrasal 2, word/collocation 1).
export interface MistakeLike {
  category: Category;
  rule: string;
  title: string;
  description: string;
  said: string;
  correct: string[];
}

export async function generateCardsForMistake(m: MistakeLike, choice: ModelChoice = CARD_ENGINE): Promise<DraftItem> {
  const kind = CATEGORY_KIND[m.category] ?? "fix";
  const right = m.correct[0] ?? "";
  const text = kind === "pronunciation" ? right || m.said : `${m.said} → ${right}`;
  const context = [
    `Mistake from a spoken talk. Rule key: ${m.rule} (use it as the slug for fix/pronunciation).`,
    `Title: ${m.title}. Explanation: ${m.description.replace(/\*/g, "")}`,
    kind === "word" ? "Card the RIGHT word Lucas should have used, with a ⚠ line contrasting it with the word he used." : "",
    kind === "collocation" ? "Card the RIGHT collocation; add the ⚠ calque line if his version came from Portuguese." : "",
    kind === "phrasal" ? "Card the phrasal verb Lucas should have used (or misused)." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const [item] = await draftCards([{ text, kind, context }], choice);
  if (kind === "fix" || kind === "pronunciation") {
    // Keep the evaluator's rule key so cards and mistakes count the same rule.
    const slug = slugify(m.rule);
    if (slug && slug !== item.slug) {
      item.slug = slug;
      for (const d of item.drafts) {
        d.tags = [`mode::${kind}`, kind === "fix" ? `err::${slug}` : `pron::${slug}`];
        d.eventKey = d.eventKey?.replace(/^[^#]*/, slug);
      }
    }
  }
  return item;
}
