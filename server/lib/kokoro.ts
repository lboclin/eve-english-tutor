// Eve's local voice for 🔊 Listen: Kokoro-82M on MLX (tts/kokoro_server.py), a Python process on 127.0.0.1:8791.
// Free and fast (~0.1–0.4 s per phrase on an M4) — no per-use cost, so nothing is fetched ahead of a tap.
// The API server starts it if it isn't answering and leaves it running (detached) across its own restarts, since
// loading the model takes a while. Clips are cached in data/speech/ like the OpenAI ones (lib/speech.ts).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const PORT = Number(process.env.EVE_TTS_PORT ?? 8791);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const UV = process.env.EVE_UV ?? "/opt/homebrew/bin/uv";
const DIR = join(ROOT, "data/speech");
export const LISTEN_VOICE = "af_sarah"; // af_heart sounded rushed to Lucas, af_bella too breathy
export const LISTEN_SPEED = 0.85; // a bit slower than normal speech, for a learner

let starting: Promise<void> | null = null;

const healthy = () => fetch(`${URL_BASE}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false);

// Starts the voice service unless it's already up; resolves once it answers (the first start downloads/loads the
// model: allow a few minutes).
export function ensureKokoro(): Promise<void> {
  starting ??= (async () => {
    if (await healthy()) return;
    const log = openSync(join(ROOT, "data/tts.log"), "a");
    const child = spawn(UV, ["run", "--project", "tts", "--frozen", "python", "-I", "tts/kokoro_server.py"], {
      cwd: ROOT,
      env: { ...process.env, HOME: process.env.HOME ?? homedir(), EVE_TTS_PORT: String(PORT) },
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.unref();
    for (let i = 0; i < 300; i++) {
      if (await healthy()) return;
      if (child.exitCode !== null) throw new Error(`the voice service exited (${child.exitCode}); see data/tts.log`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("the voice service didn't start in time; see data/tts.log");
  })().finally(() => (starting = null));
  return starting;
}

export async function kokoroSpeech(text: string): Promise<Buffer> {
  const key = createHash("sha256").update(JSON.stringify(["kokoro-82m", LISTEN_VOICE, LISTEN_SPEED, text])).digest("hex");
  const file = join(DIR, `${key}.wav`);
  if (existsSync(file)) return readFileSync(file);
  const post = () => fetch(`${URL_BASE}/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: LISTEN_VOICE, speed: LISTEN_SPEED }),
    signal: AbortSignal.timeout(15_000),
  });
  let r = await post().catch(() => null);
  if (!r) {
    await ensureKokoro(); // not running (e.g. after a reboot): start it and retry once
    r = await post();
  }
  if (!r.ok) throw new Error(`voice service: HTTP ${r.status}`);
  const audio = Buffer.from(await r.arrayBuffer());
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, audio);
  return audio;
}
