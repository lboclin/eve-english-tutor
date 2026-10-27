// GPT-Live (gpt-live-1): full duplex over WebRTC. Docs: developers.openai.com/api/docs/guides/voice-webrtc?api=live
import { connectWebRTC, postJson } from "./webrtc.js";

export async function start({ style, audioEl, onTranscript, onStatus, onUsage, onLog }) {
  let closing = null;
  const conn = await connectWebRTC({
    audioEl,
    exchange: async (sdp) => (await postJson("/api/openai-live/session", { sdp, style })).transport.sdp,
    onEvent(event) {
      switch (event.type) {
        case "session.started":
          onStatus("Connected — start talking");
          break;
        case "session.input_transcript.delta":
          onTranscript("you", event.delta);
          break;
        case "session.output_transcript.delta":
          onTranscript("tutor", event.delta);
          break;
        case "session.usage.updated":
          onUsage(event);
          break;
        case "session.delegation.created":
          // The prompt says never to delegate; if it does, nothing answers it. Logged so the test notes it.
          onLog("⚠ GPT-Live tried to delegate to a backend (ignored)", event);
          break;
        case "session.closed":
          onUsage(event);
          closing?.();
          break;
        case "error":
          onLog(`Error: ${event.error?.message ?? "unknown"}`, event);
          break;
      }
    },
  });

  return {
    mic: conn.mic,
    output: await conn.output,
    async stop() {
      // Graceful close returns final usage in session.closed; give it 15 s.
      await new Promise((resolve) => {
        closing = resolve;
        if (!conn.send({ type: "session.close" })) resolve();
        setTimeout(resolve, 15_000);
      });
      conn.close();
    },
  };
}
