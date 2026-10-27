// GPT-Live over WebRTC from the browser (developers.openai.com/api/docs/guides/voice-webrtc?api=live).
// Mic track out, Eve's audio track in, JSON events on the "oai-events" data channel. Eve's server exchanges the
// SDP offer with OpenAI (the key never reaches the browser). One LiveConnection = one GPT-Live session; Pause
// closes it and Resume opens a new one (see Talk.tsx).
import { api } from "../data/api";

export interface CreateResult {
  id: number;
  sdp: string;
  liveSessionId: string;
  opener: string; // sent with session.instructions.append so Eve speaks first
}

export interface CloseResult {
  liveSessionId: string;
  seconds: number; // usage.seconds: final when confirmed, else the latest update
  reason: string;
  confirmed: boolean; // session.closed arrived
}

export interface LiveHandlers {
  onTranscript(speaker: "you" | "eve", delta: string, startMs: number, endMs: number): void;
  onError(message: string): void;
  // The session ended without us asking (connection lost, expired, safety filter).
  onDropped(result: CloseResult): void;
}

export interface LiveConnection {
  id: number;
  liveSessionId: string;
  remote: MediaStream;
  usage(): CloseResult; // running usage, for a last-chance report if the page goes away
  close(): Promise<CloseResult>;
}

const START_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 15_000;

export async function openLive(opts: {
  mic: MediaStream;
  audioEl: HTMLAudioElement;
  create: (sdp: string) => Promise<CreateResult>;
  handlers: LiveHandlers;
  onStep?: (step: string) => void; // shown while connecting, so a hang says where it is
}): Promise<LiveConnection> {
  const { mic, audioEl, handlers } = opts;
  const pc = new RTCPeerConnection();
  let liveSessionId = "";
  let usageSeconds = 0;
  let closing: ((r: CloseResult) => void) | null = null;
  let finished = false;
  let resolveStarted: () => void = () => {};
  let rejectStarted: (e: Error) => void = () => {};
  const started = new Promise<void>((res, rej) => {
    resolveStarted = res;
    rejectStarted = rej;
  });
  let resolveRemote: (s: MediaStream) => void = () => {};
  const remote = new Promise<MediaStream>((res) => (resolveRemote = res));

  pc.addEventListener("track", (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    audioEl.srcObject = stream;
    audioEl.play().catch((err: unknown) => {
      // Only a real autoplay block (not e.g. the AbortError from teardown clearing srcObject).
      if ((err as { name?: string })?.name !== "NotAllowedError") return;
      handlers.onError("The browser blocked Eve's audio. Click anywhere on the page to hear her.");
      addEventListener("pointerdown", () => void audioEl.play().then(() => handlers.onError(""), () => {}), { once: true });
    });
    resolveRemote(stream);
  });
  for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

  // The data channel must exist before the offer is created.
  const dc = pc.createDataChannel("oai-events");
  const send = (event: Record<string, unknown>) => {
    if (dc.readyState !== "open") return false;
    dc.send(JSON.stringify(event));
    return true;
  };
  const result = (reason: string, confirmed: boolean): CloseResult => ({ liveSessionId, seconds: usageSeconds, reason, confirmed });

  function teardown() {
    finished = true;
    dc.close();
    pc.close();
    audioEl.srcObject = null;
  }

  let opener = "";
  dc.addEventListener("message", ({ data }) => {
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    switch (ev.type) {
      case "session.started":
        if (opener) send({ type: "session.instructions.append", event_id: "eve_opener", delegation_id: null, content: opener });
        resolveStarted();
        break;
      case "session.input_transcript.delta":
        handlers.onTranscript("you", ev.delta ?? "", ev.start_ms ?? 0, ev.end_ms ?? 0);
        break;
      case "session.output_transcript.delta":
        handlers.onTranscript("eve", ev.delta ?? "", ev.start_ms ?? 0, ev.end_ms ?? 0);
        break;
      case "session.usage.updated":
        usageSeconds = ev.usage?.seconds ?? usageSeconds;
        break;
      case "session.delegation.created":
        // The prompt says never to delegate (no backend exists). If it happens anyway, tell GPT-Live to carry on.
        send({
          type: "session.thinking.append",
          delegation_id: ev.delegation?.id ?? null,
          content: "There is no backend. Answer from your own knowledge and keep the conversation going.",
        });
        break;
      case "session.closed": {
        usageSeconds = ev.usage?.seconds ?? usageSeconds;
        const r = result(ev.reason ?? "unknown", true);
        teardown();
        if (closing) closing(r);
        else handlers.onDropped(r);
        break;
      }
      case "error":
        console.warn("GPT-Live error", ev.error);
        if (!ev.error?.client_event_id) handlers.onError(ev.error?.message ?? "GPT-Live error");
        break;
    }
  });
  dc.addEventListener("close", () => {
    if (finished) return;
    const r = result("connection_lost", false);
    teardown();
    if (closing) closing(r);
    else handlers.onDropped(r);
  });

  try {
    opts.onStep?.("preparing the connection");
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    opts.onStep?.("asking OpenAI for a session");
    const created = await opts.create(pc.localDescription!.sdp);
    liveSessionId = created.liveSessionId;
    opener = created.opener;
    await pc.setRemoteDescription({ type: "answer", sdp: created.sdp });
    opts.onStep?.("waiting for Eve");
    const timeout = setTimeout(() => rejectStarted(new Error("GPT-Live didn't start within 15 s")), START_TIMEOUT_MS);
    await started;
    clearTimeout(timeout);
    const stream = await Promise.race([remote, new Promise<MediaStream>((r) => setTimeout(() => r(new MediaStream()), 5000))]);
    return {
      id: created.id,
      liveSessionId,
      remote: stream,
      usage: () => result("page_closed", false),
      close: () =>
        new Promise<CloseResult>((resolve) => {
          if (finished) return resolve(result("already_closed", false));
          closing = resolve;
          // Keep media and the data channel alive until session.closed (final usage), up to 15 s.
          if (!send({ type: "session.close" })) {
            teardown();
            return resolve(result("connection_lost", false));
          }
          setTimeout(() => {
            if (finished) return;
            teardown();
            resolve(result("close_timeout", false));
          }, CLOSE_TIMEOUT_MS);
        }),
    };
  } catch (e) {
    // Started on OpenAI's side but failed here: still try to close it so it stops billing.
    if (dc.readyState === "open") send({ type: "session.close" });
    setTimeout(teardown, 1000);
    throw e;
  }
}

function waitForIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out gathering network candidates")), 10_000);
    const onState = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      pc.removeEventListener("icegatheringstatechange", onState);
      resolve();
    };
    pc.addEventListener("icegatheringstatechange", onState);
  });
}

// Server calls of the talk API.
export const talkApi = {
  create: (body: { mode: string; style: string; sdp: string } | { resumeId: number; sdp: string }) =>
    api<CreateResult>("/talk/sessions", { body }),
  // review: false skips the evaluator (Back: "It won't be reviewed"). items: utterances not posted yet.
  end: (id: number, seconds: number, segments: CloseResult[], opts: { review?: boolean; items?: unknown[] } = {}) =>
    api<{ id: number }>(`/talk/sessions/${id}/end`, { body: { seconds, usage: { segments }, ...opts } }),
  // Last chance when the tab is closed mid-talk: ONE beacon carries the unsaved transcript and the end, so the
  // server stores the utterances before it starts the review (two beacons can arrive in any order).
  beacon(id: number, seconds: number, segments: CloseResult[], items: unknown[]) {
    navigator.sendBeacon(`/api/talk/sessions/${id}/end`, JSON.stringify({ seconds, usage: { segments }, items, review: true }));
  },
};
