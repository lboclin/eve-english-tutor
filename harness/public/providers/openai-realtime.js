// gpt-realtime-2.1-mini over WebRTC (turn-based, semantic VAD). Docs: developers.openai.com/api/docs/guides/realtime-webrtc
import { connectWebRTC, postJson } from "./webrtc.js";

export async function start({ style, audioEl, onTranscript, onStatus, onUsage, onLog }) {
  const conn = await connectWebRTC({
    audioEl,
    exchange: async (sdp) => (await postJson("/api/openai-realtime/session", { sdp, style })).sdp,
    onEvent(event) {
      switch (event.type) {
        case "session.created":
          onStatus("Connected — start talking");
          break;
        case "conversation.item.input_audio_transcription.completed":
          onTranscript("you", event.transcript, { final: true });
          break;
        case "response.output_audio_transcript.done":
          onTranscript("tutor", event.transcript, { final: true });
          break;
        case "response.done":
          if (event.response?.usage) onUsage(event.response.usage);
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
      conn.close();
    },
  };
}
