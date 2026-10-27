// Gemini Live (gemini-3.8-live) over a raw WebSocket with an ephemeral token.
// Docs: ai.google.dev/gemini-api/docs/live-api/get-started-websocket, /live-session (resumption, GoAway).
// Audio: 16 kHz PCM16 up, 24 kHz PCM16 down, base64 in JSON.
import { postJson } from "./webrtc.js";

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

export async function start({ style, onTranscript, onStatus, onUsage, onLog }) {
  const { token, model, instructions } = await postJson("/api/gemini/token", { style });

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const inCtx = new AudioContext({ sampleRate: 16000 });
  await inCtx.audioWorklet.addModule("worklets/capture.js");
  const capture = new AudioWorkletNode(inCtx, "capture");
  inCtx.createMediaStreamSource(mic).connect(capture);

  const outCtx = new AudioContext({ sampleRate: 24000 });
  await outCtx.audioWorklet.addModule("worklets/playback.js");
  const playback = new AudioWorkletNode(outCtx, "playback");
  playback.connect(outCtx.destination);

  let ws = null;
  let ready = false;
  let stopping = false;
  let handle = null; // session resumption handle; connections last ~10 min, the session survives reconnects
  let retries = 0; // consecutive reconnects without a setupComplete; stops a dead token from looping

  capture.port.onmessage = ({ data }) => {
    if (!ready || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(data), mimeType: "audio/pcm;rate=16000" } } }));
  };

  function connect() {
    ready = false;
    ws = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(token)}`);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${model}`,
            generationConfig: { responseModalities: ["AUDIO"] },
            systemInstruction: { parts: [{ text: instructions }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Without compression, audio sessions stop at 15 min.
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: handle ? { handle } : {},
          },
        }),
      );
    ws.onmessage = async ({ data }) => onMessage(JSON.parse(typeof data === "string" ? data : await data.text()));
    ws.onclose = (event) => {
      ready = false;
      if (stopping) return;
      if (handle && retries++ < 3) {
        onLog(`Connection closed (${event.code}); resuming session`);
        connect();
      } else {
        onStatus(`Disconnected (${event.code} ${event.reason || ""})`);
      }
    };
  }

  function onMessage(msg) {
    if (msg.setupComplete) {
      ready = true;
      retries = 0;
      onStatus("Connected — start talking");
    }
    const sc = msg.serverContent;
    if (sc?.interrupted) playback.port.postMessage("interrupt");
    for (const part of sc?.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) playback.port.postMessage(fromBase64(part.inlineData.data));
    }
    if (sc?.inputTranscription?.text) onTranscript("you", sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) onTranscript("tutor", sc.outputTranscription.text);
    if (msg.usageMetadata) onUsage(msg.usageMetadata);
    const upd = msg.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) handle = upd.newHandle;
    if (msg.goAway) {
      onLog(`GoAway (time left ${msg.goAway.timeLeft}); reconnecting with resumption handle`);
      const old = ws;
      old.onclose = null;
      connect();
      old.close();
    }
  }

  connect();

  return {
    mic,
    output: { node: playback, ctx: outCtx },
    async stop() {
      stopping = true;
      ws?.close();
      mic.getTracks().forEach((t) => t.stop());
      await Promise.all([inCtx.close(), outCtx.close()]);
    },
  };
}

function toBase64(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) pcm[i] = Math.max(-1, Math.min(1, float32[i])) * 0x7fff;
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}
