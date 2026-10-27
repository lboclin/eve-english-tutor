// Mic → 512-sample Float32 chunks (32 ms at 16 kHz, Google's recommended 20–40 ms) posted to the main thread.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(512);
    this.index = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.index++] = channel[i];
        if (this.index === this.buffer.length) {
          this.port.postMessage(this.buffer.slice());
          this.index = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("capture", Capture);
