// Spoken audio from OpenAI TTS (gpt-4o-mini-tts) for the talk-voice samples (🔊 Listen uses Kokoro: kokoro.ts). Each clip is made once
// and kept in data/speech/ (keyed by model + voice + instructions + text), so replaying it costs nothing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openaiFetch, recordUsage } from "../openai.ts";

export const TTS_MODEL = "gpt-4o-mini-tts";
const DIR = resolve(import.meta.dirname, "../../data/speech");
const INSTRUCTIONS = "Speak in a clear, natural General American accent, at a relaxed conversational pace, like a friendly teacher saying it for a learner.";

export async function speech(text: string, voice: string, purpose: string): Promise<Buffer> {
  const key = createHash("sha256").update(JSON.stringify([TTS_MODEL, voice, INSTRUCTIONS, text])).digest("hex");
  const file = join(DIR, `${key}.mp3`);
  if (existsSync(file)) return readFileSync(file);
  const r = await openaiFetch("/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice, input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`${purpose}: OpenAI ${r.status} ${body.error?.message ?? ""}`);
  }
  const audio = Buffer.from(await r.arrayBuffer());
  const words = text.split(/\s+/).filter(Boolean).length;
  recordUsage({ purpose, model: TTS_MODEL, input: text.length, seconds: 0.5 + words / 2.5 }); // ≈ 150 words/min
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, audio);
  return audio;
}
