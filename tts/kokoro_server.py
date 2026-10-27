"""Eve's local voice for 🔊 Listen: Kokoro-82M (Apache 2.0) on MLX, the Apple GPU.

Started by the API server (server/lib/kokoro.ts) and left running across its restarts. Listens on 127.0.0.1 only.
POST /speak {"text": "...", "voice": "af_sarah", "speed": 0.85} → audio/wav (24 kHz mono, 16-bit). GET /health → 200 once the
model is loaded and warmed up (the first generation is slow; later ones take ~0.1–0.4 s on an M4).
"""

import io
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model

PORT = int(os.environ.get("EVE_TTS_PORT", "8791"))
MODEL = "prince-canuma/Kokoro-82M"
VOICES = {"af_heart", "af_bella", "af_sarah"}
MAX_TEXT = 1000

t0 = time.time()
model = load_model(MODEL)


def speak(text: str, voice: str, speed: float = 1.0) -> bytes:
    parts = [np.array(r.audio).flatten() for r in model.generate(text=text, voice=voice, speed=speed, lang_code="a")]
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(parts) if parts else np.zeros(1, dtype=np.float32), 24000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


speak("Ready.", "af_sarah")  # warm-up: loads the voice and the English pipeline
print(f"eve-tts: ready on 127.0.0.1:{PORT} in {time.time() - t0:.1f}s", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, kind: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
        else:
            self._send(404, b"", "text/plain")

    def do_POST(self) -> None:
        if self.path != "/speak":
            return self._send(404, b"", "text/plain")
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            text = " ".join(str(body.get("text", "")).split())
            voice = str(body.get("voice", "af_sarah"))
            speed = float(body.get("speed", 1.0))
            if not text or len(text) > MAX_TEXT or voice not in VOICES or not 0.5 <= speed <= 1.5:
                return self._send(400, b'{"error":"bad request"}', "application/json")
            self._send(200, speak(text, voice, speed), "audio/wav")
        except Exception as e:  # one bad request must not take the voice down
            print(f"eve-tts: {e!r}", file=sys.stderr, flush=True)
            self._send(500, b'{"error":"tts failed"}', "application/json")

    def log_message(self, *args) -> None:  # quiet: the API server logs what matters
        pass


# Single-threaded on purpose: MLX generation runs one request at a time.
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
