// FSRS scheduling for the cards table (ts-fsrs, default parameters, fuzz on) plus the date helpers the
// cards and today modules share. Dates in SQLite are UTC "YYYY-MM-DD HH:MM:SS" strings (see db.ts).
import { fsrs, GenSeedStrategyWithCardId, Rating, StrategyMode, type Card, type Grade } from "ts-fsrs";

// Seeding the fuzz with card id + reps makes the preview shown on the grade buttons match what the
// review then applies (the default seed uses the review time, which differs by a few seconds).
export const scheduler = fsrs({ enable_fuzz: true }).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId("card_id"));

export const LEARN_AHEAD_MIN = 20; // like Anki: learning cards due within 20 min are shown when the queue runs dry

export const toSql = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);
export const fromSql = (s: string) => new Date(s.replace(" ", "T") + "Z");

// Local midnight (the Mac's timezone) as a UTC SQL string: days are bucketed in local time.
export function localDayStart(d = new Date()): string {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return toSql(m);
}

export interface CardRow {
  id: number;
  category: string;
  front: string;
  back: string;
  source: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

export function toFsrs(r: CardRow): Card & { card_id: number } {
  return {
    card_id: r.id,
    due: fromSql(r.due),
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: r.elapsed_days,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state,
    last_review: r.last_review ? fromSql(r.last_review) : undefined,
  };
}

// Anki-style short label: 1m, 10m, 3h, 4d, 2.5mo, 1.2y.
export function intervalLabel(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${+(d / 30).toFixed(1)}mo`;
  return `${+(d / 365).toFixed(1)}y`;
}

const GRADES: [keyof Preview, Grade][] = [["again", Rating.Again], ["hard", Rating.Hard], ["good", Rating.Good], ["easy", Rating.Easy]];
export interface Preview { again: string; hard: string; good: string; easy: string }

export function preview(r: CardRow, now = new Date()): Preview {
  const log = scheduler.repeat(toFsrs(r), now);
  const out = {} as Preview;
  for (const [name, g] of GRADES) out[name] = intervalLabel(log[g].card.due.getTime() - now.getTime());
  return out;
}

export function review(r: CardRow, rating: Grade, now = new Date()): Card {
  return scheduler.next(toFsrs(r), now, rating).card;
}
