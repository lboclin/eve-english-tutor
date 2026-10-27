// Mistake memory: storing evaluator results, recurrence counts and the post-talk ranking.
import { db } from "../db.ts";
import type { FoundMistake, PastRule, TranscriptLine } from "../llm/evaluator.ts";

export interface SessionRow {
  id: number;
  mode: string;
  status: string;
  seconds: number;
  started_at: string;
  ended_at: string | null;
}

export interface MistakeRow {
  id: number;
  session_id: number;
  category: string;
  rule: string;
  title: string;
  description: string;
  said: string;
  correct: string;
  severity: number;
  shown: number;
  added_to_cards: number;
  created_at: string;
}

const MEMORY_DAYS = 60;
const SHOW_MAX = 5;
const SHOW_MIN = 3;

export const getSession = (id: number) =>
  db.prepare("SELECT id, mode, status, seconds, started_at, ended_at FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;

export const getTranscript = (sessionId: number) =>
  db.prepare("SELECT speaker, text FROM transcript WHERE session_id = ? ORDER BY id").all(sessionId) as unknown as TranscriptLine[];

// Lucas's top recurring rules from other sessions in the last ~60 days (the evaluator's memory).
export function recurringRules(limit = 30, excludeSession?: number): PastRule[] {
  return db
    .prepare(
      `SELECT rule, category, COUNT(*) AS count,
              (SELECT title FROM mistakes m2 WHERE m2.rule = m.rule ORDER BY id DESC LIMIT 1) AS title,
              MAX(created_at) AS last_seen
       FROM mistakes m
       WHERE created_at >= datetime('now', ?) AND session_id IS NOT ?
       GROUP BY rule ORDER BY count DESC, last_seen DESC LIMIT ?`,
    )
    .all(`-${MEMORY_DAYS} days`, excludeSession ?? null, limit) as unknown as PastRule[];
}

// Times this rule was made in earlier sessions (before this mistake), all time.
const timesBeforeStmt = () =>
  db.prepare("SELECT COUNT(*) AS n FROM mistakes WHERE rule = ? AND id < ? AND session_id IS NOT ?");
export const timesBefore = (m: Pick<MistakeRow, "id" | "rule" | "session_id">) =>
  (timesBeforeStmt().get(m.rule, m.id, m.session_id) as { n: number }).n;

// Store the session's mistakes, pick the carousel (top 3–5 by severity × (1 + past occurrences), one per
// rule) and mark the session evaluated — all in one transaction.
export function saveEvaluation(sessionId: number, found: FoundMistake[]) {
  const insert = db.prepare(
    `INSERT INTO mistakes (session_id, category, rule, title, description, said, correct, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM mistakes WHERE session_id = ?").run(sessionId);
    const rows = found.map((m, order) => {
      const { id } = insert.get(sessionId, m.category, m.rule, m.title, m.description, m.said, JSON.stringify(m.correct), m.severity) as { id: number };
      return { id, order, rule: m.rule, category: m.category, severity: m.severity, past: timesBefore({ id, rule: m.rule, session_id: sessionId }) };
    });
    // Greedy pick: best score first, one mistake per rule, and a small penalty per category already shown
    // so ties spread across decks. Beyond the first 3, minor slips (severity 1, never seen before) are skipped.
    const shown: number[] = [];
    const rules = new Set<string>();
    const perCategory = new Map<string, number>();
    let pool = rows.filter((r) => r.rule);
    while (shown.length < SHOW_MAX && pool.length) {
      pool = pool.filter((r) => !rules.has(r.rule) && !(shown.length >= SHOW_MIN && r.severity < 2 && r.past === 0));
      if (!pool.length) break;
      const score = (r: (typeof rows)[number]) => r.severity * (1 + r.past) - 0.5 * (perCategory.get(r.category) ?? 0);
      const best = pool.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && b.order < a.order) ? b : a));
      rules.add(best.rule);
      perCategory.set(best.category, (perCategory.get(best.category) ?? 0) + 1);
      shown.push(best.id);
    }
    const mark = db.prepare("UPDATE mistakes SET shown = 1 WHERE id = ?");
    for (const id of shown) mark.run(id);
    db.prepare("UPDATE sessions SET status = 'evaluated' WHERE id = ?").run(sessionId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const getMistake = (id: number) => db.prepare("SELECT * FROM mistakes WHERE id = ?").get(id) as MistakeRow | undefined;

export const mistakeRef = (id: number) => `mistake:${id}`;

export const cardsForMistake = (id: number) =>
  (db.prepare("SELECT COUNT(*) AS n FROM cards WHERE source_ref = ?").get(mistakeRef(id)) as { n: number }).n;

export function sessionMistakes(sessionId: number, shownOnly: boolean) {
  const rows = db
    .prepare(`SELECT * FROM mistakes WHERE session_id = ? ${shownOnly ? "AND shown = 1" : ""} ORDER BY id`)
    .all(sessionId) as unknown as MistakeRow[];
  return rows.map((m) => ({
    id: m.id,
    category: m.category,
    rule: m.rule,
    title: m.title,
    description: m.description,
    said: m.said,
    correct: JSON.parse(m.correct) as string[],
    severity: m.severity,
    timesBefore: timesBefore(m),
    addedToCards: m.added_to_cards === 1,
    cards: cardsForMistake(m.id),
  }));
}
