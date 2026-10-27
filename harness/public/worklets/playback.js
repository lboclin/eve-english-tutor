// Queue of Float32 chunks played in order; "interrupt" drops everything queued (user barged in).
class Playback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data === "interrupt") {
        this.queue = [];
        this.offset = 0;
      } else {
        this.queue.push(data);
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const chunk = this.queue[0];
      const n = Math.min(out.length - i, chunk.length - this.offset);
      out.set(chunk.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    out.fill(0, i);
    return true;
  }
}

registerProcessor("playback", Playback);
