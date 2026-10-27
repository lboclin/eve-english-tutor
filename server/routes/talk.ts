// Owned by the talk module — see CLAUDE.md "Server".
// GPT-Live talk sessions: create (SDP exchange through the broker), append transcript utterances, end (usage).
// One `sessions` row per talk. Pause closes the GPT-Live session (it bills per second while open) and Resume
// opens a new one on the same row, seeded with the transcript so far; each GPT-Live session is a "segment".
import { db, now } from "../db.ts";
import { Binary, HttpError, type Route } from "../http.ts";
import { recordUsage } from "../openai.ts";
import { isMode, isStyle } from "../prompts/tutor.ts";
import { createWebRTCSession, LIVE_MODEL, openerFor, sessionConfig, WEBRTC_MIN_BILLED_SECONDS } from "../lib/talk-live.ts";
import { startEvaluation } from "./review.ts";
import { saveTalkSettings, TALK_VOICES, talkSettings, TUTOR_NAMES, type TalkVoice } from "../lib/talk-settings.ts";
import { speech } from "../lib/speech.ts";

interface SessionRow {
  id: number;
  mode: string;
  style: string;
  live_session_id: string | null;
  started_at: string;
  ended_at: string | null;
  seconds: number;
  status: string;
  usage: string | null;
}

interface Segment {
  liveSessionId?: string;
  seconds?: number; // final usage.seconds from session.closed, else the latest session.usage.updated
  reason?: string;
  confirmed?: boolean; // true when session.closed arrived
}

function getSession(id: number): SessionRow {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  if (!row) throw new HttpError(404, `No talk session ${id}`);
  return row;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);

// Appends browser-grouped utterances in one transaction (used by /transcript and by /end's tab-close beacon).
function insertUtterances(sessionId: number, items: any[]): number {
  const stmt = db.prepare("INSERT INTO transcript (session_id, speaker, text, start_ms, end_ms) VALUES (?, ?, ?, ?, ?)");
  let added = 0;
  db.exec("BEGIN");
  try {
    for (const it of items) {
      const text = typeof it?.text === "string" ? it.text.trim() : "";
      if (!text) continue;
      if (it.speaker !== "you" && it.speaker !== "eve") throw new HttpError(400, `Unknown speaker: ${it.speaker}`);
      stmt.run(sessionId, it.speaker, text, num(it.start_ms), num(it.end_ms));
      added++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return added;
}

// Talks left 'live' by a browser that went away before it could end them (crash, tab killed before the
// beacon). A talk can't stay open more than MAX_TALK_MIN (40) min, but pauses don't count, so the cut-off is
// generous: 3 h since start. They are ended with the 15 s WebRTC minimum and are NOT evaluated.
const STALE_AFTER = "-3 hours";
function endStaleTalks() {
  const stale = db
    .prepare("SELECT id FROM sessions WHERE status = 'live' AND started_at < datetime('now', ?)")
    .all(STALE_AFTER) as { id: number }[];
  for (const { id } of stale) {
    const usage = { billedSeconds: WEBRTC_MIN_BILLED_SECONDS, confirmed: false, segments: [], stale: true };
    db.prepare("UPDATE sessions SET status = 'ended', ended_at = ?, usage = ? WHERE id = ? AND status = 'live'").run(now(), JSON.stringify(usage), id);
    recordUsage({ purpose: "live", model: LIVE_MODEL, seconds: WEBRTC_MIN_BILLED_SECONDS });
  }
}
endStaleTalks();


export const routes: Route[] = [
  // Interview days, the job for the Interview prompt and Eve's voice (Talk tab → ⚙️ Settings).
  { method: "GET", path: "/api/talk/settings", handler: () => talkSettings() },
  {
    // A short sample of a talk voice (TTS, cached: each voice costs once).
    method: "POST",
    path: "/api/talk/voice-sample",
    handler: async ({ body }) => {
      const voice = body?.voice as TalkVoice;
      if (!TALK_VOICES.includes(voice)) throw new HttpError(400, "Unknown voice");
      try {
        return new Binary("audio/mpeg", await speech(`Hi Lucas! I'm ${TUTOR_NAMES[voice]}. Shall we talk for a bit today?`, voice, "voice-sample"));
      } catch (e) {
        console.error(e);
        throw new HttpError(502, "Couldn't play the sample right now.");
      }
    },
  },
  {
    method: "POST",
    path: "/api/talk/settings",
    handler: ({ body }) => {
      try {
        return saveTalkSettings(body ?? {});
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    // { mode, style, sdp } starts a talk; { resumeId, sdp } opens the next segment of a paused one.
    method: "POST",
    path: "/api/talk/sessions",
    handler: async ({ body }) => {
      const sdp = body?.sdp;
      if (typeof sdp !== "string" || !sdp.trim()) throw new HttpError(400, "An SDP offer is required");

      endStaleTalks();
      let row: SessionRow;
      const resuming = body.resumeId !== undefined && body.resumeId !== null;
      if (resuming) {
        row = getSession(Number(body.resumeId));
        if (row.status !== "live") throw new HttpError(409, `Talk ${row.id} is ${row.status}; it can't be resumed`);
      } else {
        if (!isMode(body.mode)) throw new HttpError(400, `Unknown talk mode: ${body.mode}`);
        if (!isStyle(body.style)) throw new HttpError(400, `Unknown correction style: ${body.style}`);
        const { id } = db.prepare("INSERT INTO sessions (mode, style) VALUES (?, ?) RETURNING id").get(body.mode, body.style) as { id: number };
        row = getSession(id);
      }
      if (!isMode(row.mode) || !isStyle(row.style)) throw new HttpError(500, `Talk ${row.id} has an invalid mode/style`);

      const prior = resuming
        ? (db.prepare("SELECT speaker, text FROM transcript WHERE session_id = ? ORDER BY id").all(row.id) as { speaker: string; text: string }[])
        : [];
      try {
        const live = await createWebRTCSession(sessionConfig(row.mode, row.style, prior), sdp);
        db.prepare("UPDATE sessions SET live_session_id = ? WHERE id = ?").run(live.liveSessionId, row.id);
        return { id: row.id, sdp: live.sdp, liveSessionId: live.liveSessionId, opener: openerFor(row.mode, prior.length > 0) };
      } catch (e) {
        // A failed resume keeps the talk (its transcript is still worth reviewing); a failed start is marked failed.
        if (!resuming) db.prepare("UPDATE sessions SET status = 'failed', ended_at = ? WHERE id = ?").run(now(), row.id);
        throw new HttpError(502, e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    // { items: [{ speaker: "you"|"eve", text, start_ms, end_ms }] } — utterances grouped by the browser.
    method: "POST",
    path: "/api/talk/sessions/:id/transcript",
    handler: ({ params, body }) => {
      const row = getSession(Number(params.id));
      if (row.status === "failed") throw new HttpError(409, `Talk ${row.id} failed`);
      const items = Array.isArray(body?.items) ? body.items : null;
      if (!items) throw new HttpError(400, "items must be an array");
      const added = insertUtterances(row.id, items);
      return { added };
    },
  },
  {
    // { seconds: talk time on the timer, usage: { segments: Segment[] }, items?: utterances not posted yet,
    //   review?: false to skip the evaluator } → status ended + GPT-Live spend (+ background evaluation).
    // `items` lets the tab-close beacon send transcript and end in ONE request, so the evaluator never runs
    // before the last utterances are stored.
    method: "POST",
    path: "/api/talk/sessions/:id/end",
    handler: ({ params, body }) => {
      const row = getSession(Number(params.id));
      if (row.status !== "live") return { id: row.id }; // already ended (e.g. pagehide beacon, then End) — idempotent
      if (Array.isArray(body?.items) && body.items.length) insertUtterances(row.id, body.items);
      const segments: Segment[] = Array.isArray(body?.usage?.segments) ? body.usage.segments : [];
      const talkSeconds = num(body?.seconds) ?? 0;
      // Billed GPT-Live duration: the confirmed/latest usage.seconds per segment, at least the 15 s WebRTC
      // initialization charge each. Without any usage report, fall back to the talk time.
      const billed = segments.length
        ? segments.reduce((sum, s) => sum + Math.max(WEBRTC_MIN_BILLED_SECONDS, num(s.seconds) ?? 0), 0)
        : Math.max(WEBRTC_MIN_BILLED_SECONDS, talkSeconds);
      const confirmed = segments.length > 0 && segments.every((s) => s.confirmed);
      const usage = { billedSeconds: billed, confirmed, segments };
      db.prepare("UPDATE sessions SET status = 'ended', ended_at = ?, seconds = ?, usage = ? WHERE id = ?").run(
        now(),
        talkSeconds,
        JSON.stringify(usage),
        row.id,
      );
      recordUsage({ purpose: "live", model: LIVE_MODEL, seconds: billed });
      // Review in the background; the review page joins this run (or retries it if it failed). Back ("It won't
      // be reviewed") sends review: false.
      if (body?.review !== false) startEvaluation(row.id).catch((e) => console.error(`Background evaluation of talk ${row.id} failed:`, e));
      return { id: row.id };
    },
  },
  {
    method: "GET",
    path: "/api/talk/sessions/:id",
    handler: ({ params }) => {
      const row = getSession(Number(params.id));
      const transcript = db
        .prepare("SELECT id, speaker, text, start_ms, end_ms FROM transcript WHERE session_id = ? ORDER BY id")
        .all(row.id);
      return { ...row, usage: row.usage ? JSON.parse(row.usage) : null, transcript };
    },
  },
];
