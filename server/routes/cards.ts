// Owned by the cards module — see CLAUDE.md "Server".
// Decks (= the 5 categories), the FSRS review queue, grading, the daily limits (lib/cards-settings.ts) and the Anki import.
import { db, now } from "../db.ts";
import { HttpError, type Route } from "../http.ts";
import { CATEGORIES, type Category } from "../lib/cards-repo.ts";
import { LEARN_AHEAD_MIN, localDayStart, preview, review, toSql, type CardRow } from "../lib/cards-fsrs.ts";
import { AnkiUnreachable, runImport, scan } from "../lib/cards-anki.ts";
import { cardSettings, saveCardSettings } from "../lib/cards-settings.ts";
import { cleanHtml } from "../llm/engine.ts";

const COLS = "id, category, front, back, source, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review";

// Cards of a state (0 = new, 2 = review) still allowed today: the daily limit minus the cards graded in that
// state since local midnight. Learning cards (states 1 and 3) have no limit.
function leftToday(state: 0 | 2, limit: number, at = new Date()): number {
  const { n } = db.prepare("SELECT COUNT(DISTINCT card_id) AS n FROM review_log WHERE state = ? AND reviewed_at >= ?").get(state, localDayStart(at)) as { n: number };
  return Math.max(0, limit - n);
}
export const newLeftToday = (at = new Date()) => leftToday(0, cardSettings().newPerDay, at);
export const reviewsLeftToday = (at = new Date()) => leftToday(2, cardSettings().reviewsPerDay, at);

export interface Deck { total: number; newCount: number; due: number }

// Sibling cards (the 2–3 cards of one fix / phrasal / pronunciation event share an event_key) never show on
// the same day, like Anki's "bury siblings": once one is reviewed today, or picked for today's queue, the
// others wait for another day. So a fix's 3 new cards are introduced over 3 days, and siblings that come due
// together are spread out. The card being learned itself always keeps coming back.
export function buildQueue(deck: string, at = new Date()): CardRow[] {
  const f = deckFilter(deck);
  const touched = new Map<string, Set<number>>(); // event_key → cards of it already reviewed today
  for (const r of db.prepare(
    "SELECT DISTINCT c.event_key AS k, c.id FROM review_log l JOIN cards c ON c.id = l.card_id WHERE c.event_key IS NOT NULL AND l.reviewed_at >= ?",
  ).all(localDayStart(at)) as { k: string; id: number }[]) {
    if (!touched.has(r.k)) touched.set(r.k, new Set());
    touched.get(r.k)!.add(r.id);
  }
  // A card may show unless a different card of its event was reviewed or picked today.
  const allowed = (r: CardRow & { event_key: string | null }) => {
    if (!r.event_key) return true;
    const ids = touched.get(r.event_key);
    if (ids && [...ids].some((id) => id !== r.id)) return false;
    touched.set(r.event_key, new Set([...(ids ?? []), r.id]));
    return true;
  };

  type Row = CardRow & { event_key: string | null };
  // Learning cards first in the candidate list, so a sibling being learned wins over one merely due. Review
  // cards stop at the daily review limit (oldest due first); learning cards always come back.
  let reviewsLeft = reviewsLeftToday(at);
  const due = (db.prepare(
    `SELECT ${COLS}, event_key FROM cards WHERE suspended = 0 ${f.sql}
       AND ((state = 2 AND due <= ?) OR (state IN (1, 3) AND due <= ?))
     ORDER BY state = 2, due, id`,
  ).all(...f.args, toSql(at), toSql(new Date(at.getTime() + LEARN_AHEAD_MIN * 60_000))) as unknown as Row[]).filter((r) => {
    if (r.state === 2 && reviewsLeft <= 0) return false;
    if (!allowed(r)) return false;
    if (r.state === 2) reviewsLeft--;
    return true;
  });
  due.sort((a, b) => a.due.localeCompare(b.due) || a.id - b.id);

  const fresh: Row[] = [];
  const limit = newLeftToday(at);
  if (limit > 0) {
    for (const r of db.prepare(`SELECT ${COLS}, event_key FROM cards WHERE suspended = 0 AND state = 0 ${f.sql} ORDER BY id`).iterate(...f.args) as Iterable<Row>) {
      if (allowed(r)) fresh.push(r);
      if (fresh.length >= limit) break;
    }
  }
  return interleave(due, fresh);
}

// New cards spread evenly between the due ones (Anki's "mix new cards and reviews") instead of all at the end.
function interleave<T>(due: T[], fresh: T[]): T[] {
  if (!due.length || !fresh.length) return [...due, ...fresh];
  const out: T[] = [];
  const step = (due.length + fresh.length) / fresh.length;
  let d = 0;
  for (let n = 0; n < fresh.length; n++) {
    const until = Math.round((n + 0.5) * step) - n; // due cards to place before this new one
    while (d < Math.min(until, due.length)) out.push(due[d++]);
    out.push(fresh[n]);
  }
  return [...out, ...due.slice(d)];
}

// Per-deck counts, from the same queue a review would show (so siblings held back for another day don't
// count as due today). newCount and due are capped by what's left of the shared daily limits, so per-deck values
// can add up to more than the total. Suspended cards count in total only.
export function deckCounts() {
  const at = new Date();
  const count = (deck: string) => {
    const q = buildQueue(deck, at);
    const fresh = q.filter((r) => r.state === 0).length;
    return { newCount: fresh, due: q.length - fresh };
  };
  const totals = db.prepare("SELECT category, COUNT(*) AS total FROM cards GROUP BY category").all() as { category: Category; total: number }[];
  const decks = Object.fromEntries(CATEGORIES.map((c) => [c, { total: 0, newCount: 0, due: 0 }])) as Record<Category, Deck>;
  for (const c of CATEGORIES) decks[c] = { total: totals.find((t) => t.category === c)?.total ?? 0, ...count(c) };
  const all = count("all");
  const anki = (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE source = 'anki'").get() as { n: number }).n;
  return {
    decks,
    total: Object.values(decks).reduce((n, d) => n + d.total, 0),
    due: all.due,
    newCount: all.newCount,
    ...cardSettings(),
    newLeftToday: newLeftToday(at),
    reviewsLeftToday: reviewsLeftToday(at),
    ankiCards: anki,
  };
}

// A side edited in the review screen (a contenteditable box): the browser marks lines with <div>/<p> and bold
// with <strong>; store them as the card allowlist (<b> <i> <br>).
function editedHtml(v: unknown): string {
  const html = String(v ?? "")
    .replace(/<\/?strong\b[^>]*>/gi, (t) => (t[1] === "/" ? "</b>" : "<b>"))
    .replace(/<\/?em\b[^>]*>/gi, (t) => (t[1] === "/" ? "</i>" : "<i>"))
    .replace(/<(div|p|li)\b[^>]*>/gi, "<br>")
    .replace(/&nbsp;/g, " ");
  return cleanHtml(html).replace(/(<br>\s*){3,}/g, "<br><br>").replace(/^(\s*<br>)+|(<br>\s*)+$/g, "").trim();
}

function view(r: CardRow) {
  return { id: r.id, category: r.category, front: r.front, back: r.back, source: r.source, state: r.state, due: r.due, reps: r.reps, lapses: r.lapses, isNew: r.state === 0 };
}

function deckFilter(deck: string): { sql: string; args: string[] } {
  if (deck === "all") return { sql: "", args: [] };
  if (!CATEGORIES.includes(deck as Category)) throw new HttpError(400, `Unknown deck: ${deck}`);
  return { sql: "AND category = ?", args: [deck] };
}

export const routes: Route[] = [
  { method: "GET", path: "/api/cards/decks", handler: () => deckCounts() },

  {
    // Due cards (oldest due first) with today's new cards mixed in; siblings spread over days (buildQueue).
    // Learning cards due within the learn-ahead window count as due, so a session can finish its steps.
    method: "GET",
    path: "/api/cards/queue",
    handler: ({ query }) => {
      const at = new Date();
      const cards = buildQueue(query.get("deck") ?? "all", at);
      return { cards: cards.map((r) => ({ ...view(r), preview: preview(r, at) })) };
    },
  },

  {
    method: "POST",
    path: "/api/cards/:id/review",
    handler: ({ params, body }) => {
      const rating = body?.rating;
      if (![1, 2, 3, 4].includes(rating)) throw new HttpError(400, "rating must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy)");
      const row = db.prepare(`SELECT ${COLS} FROM cards WHERE id = ?`).get(Number(params.id)) as CardRow | undefined;
      if (!row) throw new HttpError(404, "Card not found");
      const at = new Date();
      const c = review(row, rating, at);
      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
             reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
        ).run(toSql(c.due), c.stability, c.difficulty, c.elapsed_days, c.scheduled_days, c.learning_steps, c.reps, c.lapses, c.state,
          toSql(c.last_review ?? at), row.id);
        db.prepare("INSERT INTO review_log (card_id, rating, state, reviewed_at, scheduled_days) VALUES (?, ?, ?, ?, ?)")
          .run(row.id, rating, row.state, toSql(at), c.scheduled_days);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      const updated = db.prepare(`SELECT ${COLS} FROM cards WHERE id = ?`).get(row.id) as unknown as CardRow;
      return { card: { ...view(updated), stability: updated.stability, difficulty: updated.difficulty, scheduledDays: updated.scheduled_days } };
    },
  },

  {
    // { front, back }: fixes a card's text (pencil on the review screen). Its schedule is kept.
    method: "PATCH",
    path: "/api/cards/:id",
    handler: ({ params, body }) => {
      const front = editedHtml(body?.front);
      const back = editedHtml(body?.back);
      if (!front || !back) throw new HttpError(400, "Both sides need some text");
      try {
        const r = db.prepare("UPDATE cards SET front = ?, back = ? WHERE id = ?").run(front, back, Number(params.id));
        if (!r.changes) throw new HttpError(404, "Card not found");
      } catch (e) {
        if (e instanceof Error && /UNIQUE/.test(e.message)) throw new HttpError(409, "Another card already has exactly this text");
        throw e;
      }
      return { front, back };
    },
  },

  { method: "GET", path: "/api/cards/settings", handler: () => cardSettings() },
  {
    method: "POST",
    path: "/api/cards/settings",
    handler: ({ body }) => {
      try {
        return saveCardSettings(body ?? {});
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    },
  },

  { method: "GET", path: "/api/cards/import/anki/scan", handler: () => scan() },

  {
    method: "POST",
    path: "/api/cards/import/anki",
    handler: async () => {
      try {
        return await runImport();
      } catch (e) {
        if (e instanceof AnkiUnreachable) throw new HttpError(503, `${e.message}. Open Anki (with AnkiConnect) and try again.`);
        throw e;
      }
    },
  },
];
