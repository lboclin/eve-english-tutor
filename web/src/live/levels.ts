// Audio level meter (0–1) for the orbs: an AnalyserNode on a MediaStream, read once per animation frame.
// For the remote GPT-Live stream, Chrome only feeds Web Audio when the same stream also plays in an <audio>
// element, so the client attaches it to one and analyses it here without connecting to the destination.
export interface LevelMeter {
  read(): number;
  dispose(): void;
}

export function levelMeter(ctx: AudioContext, stream: MediaStream, gain = 9): LevelMeter {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.min(1, Math.sqrt(sum / buf.length) * gain);
    },
    dispose() {
      source.disconnect();
    },
  };
}
