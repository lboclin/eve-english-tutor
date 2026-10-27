// Owned by the review module — see CLAUDE.md "Server".
// Post-talk review: evaluate a session's transcript once, show the top mistakes, turn one into cards.
import { db } from "../db.ts";
import { HttpError, type Route } from "../http.ts";
import { insertCards, type Category } from "../lib/cards-repo.ts";
import {
  getMistake,
  getSession,
  getTranscript,
  mistakeRef,
  recurringRules,
  saveEvaluation,
  sessionMistakes,
  type MistakeRow,
} from "../lib/review-repo.ts";
import { evaluateTranscript } from "../llm/evaluator.ts";
import { generateCardsForMistake } from "../llm/engine.ts";

const sessionId = (raw: string) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Bad session id");
  return id;
};

// One evaluation per session at a time (React dev mode mounts twice; a reload mid-evaluation joins it).
const running = new Map<number, Promise<void>>();
const carding = new Set<number>(); // mistakes whose cards are being written

async function evaluate(id: number) {
  const s = getSession(id);
  if (!s) throw new HttpError(404, "No such session");
  if (s.status === "evaluated") return;
  if (s.status === "live") throw new HttpError(409, "The session is still live");
  const found = await evaluateTranscript(getTranscript(id), recurringRules(30, id));
  saveEvaluation(id, found);
}

// Starts (or joins) the evaluation of a session. Talk's End calls it in the background so the review is
// usually ready by the time Lucas opens it (a 15-min talk takes ~1 min to evaluate).
export function startEvaluation(id: number): Promise<void> {
  let p = running.get(id);
  if (!p) {
    p = evaluate(id).finally(() => running.delete(id));
    running.set(id, p);
  }
  return p;
}

function stats(id: number) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS found, COALESCE(SUM(shown), 0) AS shown,
              (SELECT COUNT(*) FROM cards WHERE source_ref IN (SELECT 'mistake:' || id FROM mistakes WHERE session_id = ?)) AS cardsAdded
       FROM mistakes WHERE session_id = ?`,
    )
    .get(id, id) as { found: number; shown: number; cardsAdded: number };
  // Repeats: mistakes of this session whose rule already appeared in an earlier session.
  const { n: repeats } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mistakes m WHERE m.session_id = ?
       AND EXISTS (SELECT 1 FROM mistakes p WHERE p.rule = m.rule AND p.id < m.id AND p.session_id IS NOT m.session_id)`,
    )
    .get(id) as { n: number };
  return { ...r, repeats };
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/review/:sessionId/evaluate",
    handler: async ({ params }) => {
      const id = sessionId(params.sessionId);
      try {
        await startEvaluation(id);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.error(e);
        throw new HttpError(502, "Eve couldn't review this talk right now. Try again in a moment.");
      }
      return { status: getSession(id)?.status, ...stats(id) };
    },
  },
  {
    method: "GET",
    path: "/api/review/recurring",
    handler: ({ query }) => ({ rules: recurringRules(Math.min(50, Number(query.get("limit") ?? 10) || 10)) }),
  },
  {
    method: "GET",
    path: "/api/review/:sessionId",
    handler: ({ params }) => {
      const id = sessionId(params.sessionId);
      const s = getSession(id);
      if (!s) throw new HttpError(404, "No such session");
      // Carousel order: most important first (same score as the ranking).
      const mistakes = sessionMistakes(id, true).sort(
        (a, b) => b.severity * (1 + b.timesBefore) - a.severity * (1 + a.timesBefore) || a.id - b.id,
      );
      return {
        session: { id: s.id, mode: s.mode, seconds: s.seconds, started_at: s.started_at, status: s.status },
        transcript: getTranscript(id).map((t) => ({ who: t.speaker, text: t.text })),
        mistakes,
        stats: stats(id),
      };
    },
  },
  {
    method: "POST",
    path: "/api/review/mistakes/:id/cards",
    handler: async ({ params }) => {
      const m = getMistake(Number(params.id));
      if (!m) throw new HttpError(404, "No such mistake");
      if (m.added_to_cards || carding.has(m.id)) return { added: 0, already: true, category: m.category };
      carding.add(m.id);
      try {
        return await addCards(m);
      } finally {
        carding.delete(m.id);
      }
    },
  },
];

// A mistake → cards for its deck, linked to it by source_ref.
async function addCards(m: MistakeRow) {
  const item = await generateCardsForMistake({
    category: m.category as Category,
    rule: m.rule,
    title: m.title,
    description: m.description,
    said: m.said,
    correct: JSON.parse(m.correct) as string[],
  }).catch((e) => {
    console.error(e);
    throw new HttpError(502, "Eve couldn't write cards right now. Try again in a moment.");
  });
  if (!item.drafts.length) throw new HttpError(502, "Eve couldn't write cards for this mistake");
  const { inserted, duplicates } = insertCards(
    item.drafts.map((d) => ({ ...d, source: "talk" as const, sourceRef: mistakeRef(m.id) })),
  );
  db.prepare("UPDATE mistakes SET added_to_cards = 1 WHERE id = ?").run(m.id);
  return { added: inserted.length, duplicates, category: item.category };
}
