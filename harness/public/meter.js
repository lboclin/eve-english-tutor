// Measures, from audio levels alone (same method for every provider):
// - response latency: end of your speech → first model audio
// - interjections: model audio starting while you are still speaking (the "corrects me mid-sentence" signal)
// Use headphones, or the model's voice leaking into the mic will look like you speaking.
const MIC_THRESHOLD = 0.02;
const OUT_THRESHOLD = 0.01;
const SILENCE_BEFORE_UTTERANCE_MS = 400; // model output gap that counts as a new utterance
const MAX_LATENCY_MS = 5000; // longer gaps aren't a reply to what you said

export function startMeter({ mic, output }) {
  const ctx = output.ctx ?? new AudioContext();
  const micAnalyser = analyser(ctx, ctx.createMediaStreamSource(mic));
  const outAnalyser = analyser(ctx, output.node ?? ctx.createMediaStreamSource(output));

  const latencies = [];
  let interjections = 0;
  let lastUserVoice = 0;
  let lastModelVoice = 0;

  const timer = setInterval(() => {
    const now = performance.now();
    const userSpeaking = rms(micAnalyser) > MIC_THRESHOLD;
    const modelSpeaking = rms(outAnalyser) > OUT_THRESHOLD;
    if (userSpeaking) lastUserVoice = now;
    if (modelSpeaking) {
      const newUtterance = now - lastModelVoice > SILENCE_BEFORE_UTTERANCE_MS;
      if (newUtterance && userSpeaking) interjections++;
      else if (newUtterance && lastUserVoice && now - lastUserVoice < MAX_LATENCY_MS) latencies.push(now - lastUserVoice);
      lastModelVoice = now;
    }
  }, 20);

  return {
    stats() {
      const sorted = [...latencies].sort((a, b) => a - b);
      return {
        replies: sorted.length,
        medianLatencyMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null,
        p90LatencyMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.9)]) : null,
        interjections,
      };
    },
    stop() {
      clearInterval(timer);
      if (!output.ctx) ctx.close();
    },
  };
}

function analyser(ctx, source) {
  const node = ctx.createAnalyser();
  node.fftSize = 1024;
  source.connect(node);
  return { node, buffer: new Float32Array(node.fftSize) };
}

function rms({ node, buffer }) {
  node.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.sqrt(sum / buffer.length);
}
