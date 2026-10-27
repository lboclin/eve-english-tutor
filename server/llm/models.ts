// Text-model choice per role, measured on a labelled test set (2026-10-17).
// Prices live in ../openai.ts PRICES; every model used here must have an entry there.
import type { JsonCallOptions } from "../openai.ts";

export interface ModelChoice {
  model: string;
  reasoning: JsonCallOptions["reasoning"];
}

// Reads a talk transcript and extracts every mistake (one call per session).
export const EVALUATOR: ModelChoice = { model: "gpt-6-luna", reasoning: "medium" };

// Classifies typed items / mistakes and writes the anki-add style cards (one call per batch).
export const CARD_ENGINE: ModelChoice = { model: "gpt-6-luna", reasoning: "medium" };
