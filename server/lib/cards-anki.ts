// Anki import through AnkiConnect (the add-on's local JSON API on 127.0.0.1:8765). Reads the deck the
// anki-add skill writes to (`English`, Basic note type, fields Front/Back) and files each note by its
// anki-add tag. Scheduling comes along: reviewed cards keep their interval and due date.
import { db } from "../db.ts";
import { insertCards, type Category, type NewCard } from "./cards-repo.ts";
import { toSql } from "./cards-fsrs.ts";

const ANKI_URL = process.env.EVE_ANKI_URL ?? "http://127.0.0.1:8765";
if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(ANKI_URL)) throw new Error("EVE_ANKI_URL must be a loopback http URL");
export const ANKI_DECK = "English";
const CHUNK = 500;
const DAY_MS = 86_400_000;

// anki-add's mode tags → Eve decks. Notes without a mode tag (added by hand) go to Vocabulary.
export const TAG_MAP: { tag: string; category: Category }[] = [
  { tag: "mode::word", category: "vocabulary" },
  { tag: "mode::collocation", category: "collocations" },
  { tag: "mode::phrasal", category: "phrasal" },
  { tag: "mode::fix", category: "grammar" },
  { tag: "(no tag)", category: "vocabulary" },
];

export class AnkiUnreachable extends Error {}

async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  let body: { result: T; error: string | null };
  try {
    const r = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(action === "deckNames" ? 3000 : 30_000),
    });
    body = (await r.json()) as typeof body;
  } catch {
    throw new AnkiUnreachable(`Can't reach AnkiConnect at ${ANKI_URL}`);
  }
  if (body.error) throw new Error(`AnkiConnect ${action}: ${body.error}`);
  return body.result;
}

async function chunked<T>(ids: number[], run: (part: number[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await run(ids.slice(i, i + CHUNK))));
  return out;
}

interface NoteInfo { noteId: number; tags: string[]; fields: Record<string, { value: string; order: number }>; cards: number[] }
interface CardInfo { cardId: number; note: number; interval: number; type: number; queue: number; due: number; reps: number; lapses: number; factor: number }
interface AnkiReview { id: number; ease: number; ivl: number; type: number }

export interface AnkiNote {
  noteId: number;
  category: Category;
  tag: string;
  front: string;
  back: string;
  tags: string[];
  eventKey?: string;
  cardIds: number[];
}

function toNote(n: NoteInfo): AnkiNote | null {
  const byOrder = Object.values(n.fields).sort((a, b) => a.order - b.order);
  const front = (n.fields.Front ?? byOrder[0])?.value?.trim() ?? "";
  const back = (n.fields.Back ?? byOrder[1])?.value?.trim() ?? "";
  if (!front || !back) return null;
  const tags = n.tags.map((t) => t.toLowerCase()); // Anki tags are case-insensitive
  const hit = TAG_MAP.find((m) => tags.includes(m.tag)) ?? TAG_MAP[TAG_MAP.length - 1];
  const event = n.tags.find((t) => /^(err|pv)::/i.test(t));
  return { noteId: n.noteId, category: hit.category, tag: hit.tag, front, back, tags: n.tags, eventKey: event, cardIds: n.cards };
}

async function readNotes(): Promise<{ deckFound: boolean; notes: AnkiNote[]; skipped: number }> {
  const decks = await invoke<string[]>("deckNames");
  if (!decks.includes(ANKI_DECK)) return { deckFound: false, notes: [], skipped: 0 };
  const ids = await invoke<number[]>("findNotes", { query: `deck:"${ANKI_DECK}"` });
  const infos = await chunked(ids, (part) => invoke<NoteInfo[]>("notesInfo", { notes: part }));
  const notes = infos.map(toNote);
  return { deckFound: true, notes: notes.filter((n): n is AnkiNote => n !== null), skipped: notes.filter((n) => !n).length };
}

// Notes already in Eve: imported before (by Anki note id) or the same front/back added another way.
function inEve(): (n: AnkiNote) => boolean {
  const refs = new Set((db.prepare("SELECT source_ref FROM cards WHERE source = 'anki' AND source_ref IS NOT NULL").all() as { source_ref: string }[]).map((r) => r.source_ref));
  const pair = db.prepare("SELECT 1 FROM cards WHERE front = ? AND back = ?");
  return (n) => refs.has(String(n.noteId)) || pair.get(n.front, n.back) !== undefined;
}

export async function scan() {
  try {
    const { deckFound, notes, skipped } = await readNotes();
    const has = inEve();
    const groups = TAG_MAP.map((m) => ({ tag: m.tag, category: m.category, notes: notes.filter((n) => n.tag === m.tag).length }));
    const already = notes.filter(has).length;
    return { reachable: true, deck: ANKI_DECK, deckFound, total: notes.length, groups, alreadyImported: already, toImport: notes.length - already, skipped };
  } catch (e) {
    if (e instanceof AnkiUnreachable) return { reachable: false, deck: ANKI_DECK, deckFound: false, total: 0, groups: [], alreadyImported: 0, toImport: 0, skipped: 0 };
    throw e;
  }
}

export interface Schedule {
  state: number; // FSRS state
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: string | null;
  suspended: number;
}

// Anki card → FSRS columns. Anki's own (SM-2) state can't be converted exactly, so:
// - new (type 0) and still-learning (type 1) cards start fresh as New;
// - review cards (type 2) become Review with stability ≈ current interval and Anki's due date
//   (last review + interval; without review history the due date is spread over the interval and the
//   last review estimated as due − interval);
// - relearning cards (type 3, just lapsed) become Review due now, with stability ≈ their reduced interval.
// Difficulty comes from Anki's ease (2500 = 250% → FSRS 5 of 1–10). Suspended stays suspended.
export function mapSchedule(c: CardInfo, lastReview: number | undefined, at = Date.now()): Schedule {
  const suspended = c.queue === -1 ? 1 : 0;
  if (c.type !== 2 && c.type !== 3) {
    return { state: 0, due: toSql(new Date(at)), stability: 0, difficulty: 0, scheduled_days: 0, reps: 0, lapses: 0, last_review: null, suspended };
  }
  const ivl = Math.max(1, c.interval); // days (negative values are seconds, only for learning cards)
  const difficulty = Math.min(10, Math.max(1, 5 + (2500 - (c.factor || 2500)) / 200));
  let due: number;
  if (c.type === 3) due = at;
  else if (lastReview) due = lastReview + ivl * DAY_MS;
  else due = at + Math.floor(((Math.imul(c.cardId | 0, 2654435761) >>> 0) / 2 ** 32) * ivl) * DAY_MS; // stable pseudo-random spread
  // FSRS needs a last review for Review cards; estimate it from the interval when Anki gave no history.
  const last = lastReview ?? (c.type === 3 ? at : due - ivl * DAY_MS);
  return {
    state: 2,
    due: toSql(new Date(due)),
    stability: ivl,
    difficulty: Math.round(difficulty * 100) / 100,
    scheduled_days: ivl,
    reps: c.reps,
    lapses: c.lapses,
    last_review: toSql(new Date(last)),
    suspended,
  };
}

export async function runImport() {
  const { deckFound, notes, skipped } = await readNotes();
  if (!deckFound) return { deckFound, imported: 0, withSchedule: 0, alreadyImported: 0, duplicates: 0, skipped };
  const has = inEve();
  const fresh = notes.filter((n) => !has(n));

  // Scheduling of each note's first card (Basic notes have exactly one).
  const cardIds = fresh.map((n) => n.cardIds[0]).filter((id) => id !== undefined);
  const infos = await chunked(cardIds, (part) => invoke<CardInfo[]>("cardsInfo", { cards: part }));
  const byNote = new Map(infos.map((c) => [c.note, c]));
  const reviewed = infos.filter((c) => c.type === 2).map((c) => c.cardId);
  const last = new Map<number, number>();
  try {
    for (let i = 0; i < reviewed.length; i += CHUNK) {
      const logs = await invoke<Record<string, AnkiReview[]>>("getReviewsOfCards", { cards: reviewed.slice(i, i + CHUNK) });
      for (const [id, list] of Object.entries(logs)) if (list.length) last.set(Number(id), Math.max(...list.map((r) => r.id)));
    }
  } catch (e) {
    if (e instanceof AnkiUnreachable) throw e;
    // Older AnkiConnect without getReviewsOfCards: due dates fall back to the spread in mapSchedule.
  }

  const rows: NewCard[] = fresh.map((n) => ({
    category: n.category, front: n.front, back: n.back, source: "anki", sourceRef: String(n.noteId), eventKey: n.eventKey, tags: n.tags,
  }));
  const { inserted, duplicates } = insertCards(rows);

  // insertCards keeps its New defaults; apply Anki's scheduling to the rows it just inserted.
  const at = Date.now();
  const update = db.prepare(
    `UPDATE cards SET state = ?, due = ?, stability = ?, difficulty = ?, scheduled_days = ?, reps = ?, lapses = ?, last_review = ?, suspended = ?
     WHERE id = ?`,
  );
  const refs = db.prepare("SELECT id, source_ref FROM cards WHERE id = ?");
  let withSchedule = 0;
  db.exec("BEGIN");
  try {
    for (const id of inserted) {
      const ref = (refs.get(id) as { source_ref: string }).source_ref;
      const info = byNote.get(Number(ref));
      if (!info) continue;
      const s = mapSchedule(info, last.get(info.cardId), at);
      if (s.state === 0 && !s.suspended) continue;
      if (s.state !== 0) withSchedule++;
      update.run(s.state, s.due, s.stability, s.difficulty, s.scheduled_days, s.reps, s.lapses, s.last_review, s.suspended, id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { deckFound, imported: inserted.length, withSchedule, alreadyImported: notes.length - fresh.length, duplicates, skipped };
}
