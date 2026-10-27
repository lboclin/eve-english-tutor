// Owned by the today module — see CLAUDE.md "Server".
// Today's to-do state and the streak calendar. A day has three tasks (same as the Home to-do):
//   1. talk   — a session (status ≠ failed) of at least 60 s started that day;
//   2. cards  — past days: at least one card graded. Today: at least one card graded AND none left due,
//               so the to-do tick means "reviews done", not "touched one card" (a past day can't be
//               re-checked for what was left due, so it keeps the simpler rule);
//   3. read   — an article marked read.
// Days are bucketed in local time (the Mac's timezone), via SQLite's 'localtime' modifier.
import { db, now } from "../db.ts";
import { HttpError, type Route } from "../http.ts";
import { localDayStart } from "../lib/cards-fsrs.ts";
import { deckCounts } from "./cards.ts";
import { talkSettings } from "../lib/talk-settings.ts";

const HISTORY_DAYS = 52 * 7;
const TALK_MIN_SECONDS = 60;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const days = (sql: string) => new Set((db.prepare(sql).all() as { d: string }[]).map((r) => r.d));

// Consecutive active days ending today (or yesterday, while nothing is done yet today).
export function currentStreak(levels: number[]) {
  let n = 0;
  for (let i = levels.length - (levels[levels.length - 1] > 0 ? 1 : 2); i >= 0 && levels[i] > 0; i--) n++;
  return n;
}

// Longest run of consecutive local days in a set of "YYYY-MM-DD" keys.
function longestRun(keys: Set<string>) {
  let best = 0;
  for (const k of keys) {
    const d = new Date(`${k}T12:00:00`); // noon: DST-safe day stepping
    d.setDate(d.getDate() - 1);
    if (keys.has(dayKey(d))) continue; // not the start of a run
    let run = 0;
    for (const c = new Date(`${k}T12:00:00`); keys.has(dayKey(c)); c.setDate(c.getDate() + 1)) run++;
    best = Math.max(best, run);
  }
  return best;
}

export function today() {
  const start = localDayStart();
  const todayKey = dayKey(new Date());
  const talkDays = days(`SELECT DISTINCT date(started_at, 'localtime') AS d FROM sessions WHERE status <> 'failed' AND seconds >= ${TALK_MIN_SECONDS}`);
  const reviewDays = days("SELECT DISTINCT date(reviewed_at, 'localtime') AS d FROM review_log");
  const readDays = days("SELECT DISTINCT date(read_at, 'localtime') AS d FROM reads");

  const { seconds } = db.prepare("SELECT COALESCE(SUM(seconds), 0) AS seconds FROM sessions WHERE status <> 'failed' AND started_at >= ?").get(start) as { seconds: number };
  const { reviewed } = db.prepare("SELECT COUNT(*) AS reviewed FROM review_log WHERE reviewed_at >= ?").get(start) as { reviewed: number };
  const readIds = (db.prepare("SELECT DISTINCT article_id FROM reads WHERE read_at >= ?").all(start) as { article_id: string }[]).map((r) => r.article_id);
  const cards = deckCounts();

  const tasks = { talk: talkDays.has(todayKey), cards: reviewed > 0 && cards.due === 0, read: readIds.length > 0 };
  const level = (k: string) =>
    k === todayKey ? Number(tasks.talk) + Number(tasks.cards) + Number(tasks.read) : Number(talkDays.has(k)) + Number(reviewDays.has(k)) + Number(readDays.has(k));

  // Oldest first, ending today.
  const history: number[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    history.push(level(dayKey(d)));
  }
  const active = new Set([...talkDays, ...reviewDays, ...readDays].filter((k) => level(k) > 0));

  return {
    date: todayKey,
    talkedMinutes: Math.round(seconds / 60),
    talkedToday: tasks.talk,
    reviewedToday: reviewed,
    readIds,
    due: cards.due,
    newCount: cards.newCount,
    tasks,
    days: history,
    streak: currentStreak(history),
    longest: longestRun(active),
    interviewDays: talkSettings().interviewDays, // which talk is "today's" (web/src/data/talk.ts)
    tutorName: talkSettings().tutorName, // Eve or Wally, after the talk voice
  };
}

export const routes: Route[] = [
  { method: "GET", path: "/api/today", handler: () => today() },
  {
    method: "POST",
    path: "/api/reads",
    handler: ({ body }) => {
      const { articleId, score } = body ?? {};
      if (typeof articleId !== "string" || !articleId || articleId.length > 200) throw new HttpError(400, "articleId is required");
      if (score != null && !Number.isInteger(score)) throw new HttpError(400, "score must be an integer");
      db.prepare("INSERT OR IGNORE INTO reads (article_id, read_at, score) VALUES (?, ?, ?)").run(articleId, now(), score ?? null);
      return { ok: true };
    },
  },
];
