// GPT-Live session creation for the talk module (docs: developers.openai.com/api/docs/guides/voice-webrtc?api=live).
// The browser sends its SDP offer to Eve's server; we POST {session, transport} to /v1/live/sessions through the
// sb-key broker and hand the SDP answer back. The key never reaches this process or the browser.
import { openaiFetch } from "../openai.ts";
import { talkSettings } from "./talk-settings.ts";
import { greeting, RESUME_NOTE, tutorInstructions, type CorrectionStyle, type TalkModeId } from "../prompts/tutor.ts";

export const LIVE_MODEL = "gpt-live-1";
// WebRTC creation bills 15 s up front; it is credited against the running duration (voice-latency-cost guide).
export const WEBRTC_MIN_BILLED_SECONDS = 15;

type InputMessage = {
  type: "message";
  role: "developer" | "user" | "assistant";
  content: { type: "input_text" | "output_text"; text: string }[];
};

export interface PriorUtterance {
  speaker: string; // you | eve
  text: string;
}

// Startup history: the prior transcript when resuming after a pause (empty for a new talk). GPT-Live accepts up
// to 128 messages / 8,192 tokens; we keep the most recent ~6k tokens (≈ 4 chars/token).
export function buildInput(prior: PriorUtterance[] = []): InputMessage[] {
  const merged: { role: "user" | "assistant"; text: string }[] = [];
  for (const u of prior) {
    const role = u.speaker === "eve" ? "assistant" : "user";
    const last = merged.at(-1);
    if (last && last.role === role) last.text += ` ${u.text}`;
    else merged.push({ role, text: u.text });
  }
  const kept: typeof merged = [];
  let chars = 0;
  for (let i = merged.length - 1; i >= 0 && kept.length < 120; i--) {
    chars += merged[i].text.length;
    if (chars > 24_000) break;
    kept.unshift(merged[i]);
  }
  return kept.map((m) => ({
    type: "message",
    role: m.role,
    content: [{ type: m.role === "user" ? "input_text" : "output_text", text: m.text }],
  }));
}

// What makes Eve speak first. Tested 2026-10-17: a developer message in `input` did NOT make GPT-Live greet,
// while a `session.instructions.append` sent right after session.started did. The browser sends this text.
export function openerFor(mode: TalkModeId, resuming: boolean): string {
  return resuming ? RESUME_NOTE : greeting(mode, talkSettings().tutorName);
}

export function sessionConfig(mode: TalkModeId, style: CorrectionStyle, prior: PriorUtterance[] = []) {
  const settings = talkSettings();
  return {
    model: LIVE_MODEL,
    instructions: tutorInstructions(mode, style, settings.interviewJob, settings.tutorName),
    input: buildInput(prior),
    audio: { output: { voice: settings.voice } }, // Talk → ⚙️ Settings → Voice
    delegation: { type: "client" as const }, // no backend; the prompt says never to delegate
  };
}

export async function createWebRTCSession(session: ReturnType<typeof sessionConfig>, sdp: string) {
  const r = await openaiFetch("/live/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session, transport: { type: "webrtc", sdp } }),
  });
  const body = (await r.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
    session?: { id?: string };
    transport?: { sdp?: string };
  };
  if (!r.ok || !body.session?.id || !body.transport?.sdp) {
    const why = body.error?.message ?? `HTTP ${r.status}`;
    throw new Error(`GPT-Live session failed: ${why}`);
  }
  return { liveSessionId: body.session.id, sdp: body.transport.sdp };
}
