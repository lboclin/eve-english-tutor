// Owned by the selection module — see CLAUDE.md "Server". Selecting text anywhere in the app
// (web/src/components/SelectionTools.tsx): POST /api/selection/translate = DeepL translation of the selection + its
// sentence (free plan); POST /api/selection/card = cards for it, written by the card engine with the sentence as
// context, and saved; POST /api/selection/speech = the selection spoken (Google Translate's voice, lib/google-tts.ts; mp3).
import { translate } from "../deepl.ts";
import { Binary, HttpError, type Route } from "../http.ts";
import { insertCards } from "../lib/cards-repo.ts";
import { draftCards } from "../llm/engine.ts";
import { googleSpeech } from "../lib/google-tts.ts";

const MAX_SELECTION = 120; // characters: a word or an expression, not a paragraph
const MAX_SENTENCE = 600;
const MAX_SPEECH = 1000;

function selection(body: any) {
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  const sentence = typeof body?.sentence === "string" ? body.sentence.replace(/\s+/g, " ").trim().slice(0, MAX_SENTENCE) : "";
  if (!text) throw new HttpError(400, "Select a word or an expression first");
  if (text.length > MAX_SELECTION) throw new HttpError(400, `Select at most ${MAX_SELECTION} characters`);
  return { text, sentence };
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/selection/speech",
    handler: async ({ body }) => {
      const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
      if (!text) throw new HttpError(400, "Select something to listen to first");
      if (text.length > MAX_SPEECH) throw new HttpError(400, `Select at most ${MAX_SPEECH} characters`);
      try {
        return new Binary("audio/mpeg", await googleSpeech(text));
      } catch (e) {
        console.error(e);
        throw new HttpError(502, "Couldn't get the audio right now.");
      }
    },
  },
  {
    method: "POST",
    path: "/api/selection/translate",
    handler: async ({ body }) => {
      const { text, sentence } = selection(body);
      const withSentence = sentence && sentence !== text;
      try {
        const [translation, sentenceTranslation] = await translate(withSentence ? [text, sentence] : [text], sentence || undefined);
        return { translation, sentenceTranslation: withSentence ? sentenceTranslation : null };
      } catch (e) {
        console.error("translate:", e);
        throw new HttpError(502, "Couldn't translate right now. Try again in a moment.");
      }
    },
  },
  {
    method: "POST",
    path: "/api/selection/card",
    handler: async ({ body }) => {
      const { text, sentence } = selection(body);
      const context = [
        "Lucas selected this while using Eve (a news article, a talk transcript or a card); card the sense it has there.",
        sentence ? `Sentence: "${sentence}"` : "",
        "If the selection is part of a larger collocation or phrasal verb in that sentence, card the larger expression and say so in the warning.",
        "Base the example on that sentence, but don't copy it word for word.",
      ].filter(Boolean).join(" ");
      try {
        const [item] = await draftCards([{ text, context }]);
        const { inserted, duplicates } = insertCards(item.drafts.map((d) => ({ ...d, source: "engine" as const })));
        return { inserted: inserted.length, duplicates, kind: item.kind, category: item.category, warning: item.warning };
      } catch (e) {
        console.error(e);
        throw new HttpError(502, "Eve couldn't write the card right now. Try again in a moment.");
      }
    },
  },
];
