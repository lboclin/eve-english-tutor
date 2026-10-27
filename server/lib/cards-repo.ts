// Shared card insertion, used by the flashcards module (Anki import) and the card engine (typed input,
// talk mistakes). New cards start in FSRS state New, due now (column defaults in db.ts).
import { db } from "../db.ts";

export const CATEGORIES = ["vocabulary", "collocations", "phrasal", "grammar", "pronunciation"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface NewCard {
  category: Category;
  front: string; // HTML allowed: <b>, <br>, <i>
  back: string;
  source: "manual" | "engine" | "talk" | "anki" | "claude"; // claude = sent to /api/inbox/cards
  sourceRef?: string;
  eventKey?: string; // shared by the cards of one fix / phrasal event
  tags?: string[];
}

// Inserts in order (order matters: anki-add's "meet" card comes before its "produce" card).
// Exact front+back duplicates are skipped. Returns the ids of the inserted cards.
export function insertCards(cards: NewCard[]): { inserted: number[]; duplicates: number } {
  const stmt = db.prepare(
    `INSERT INTO cards (category, front, back, source, source_ref, event_key, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (front, back) DO NOTHING RETURNING id`,
  );
  const inserted: number[] = [];
  let duplicates = 0;
  db.exec("BEGIN");
  try {
    for (const c of cards) {
      if (!CATEGORIES.includes(c.category)) throw new Error(`Unknown category: ${c.category}`);
      const row = stmt.get(c.category, c.front, c.back, c.source, c.sourceRef ?? null, c.eventKey ?? null, JSON.stringify(c.tags ?? [])) as
        | { id: number }
        | undefined;
      if (row) inserted.push(row.id);
      else duplicates++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { inserted, duplicates };
}
