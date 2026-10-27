// Eve's voice for 🔊 Listen: Google Translate's own speaker (translate.google.com/translate_tts), the voice Lucas
// liked. Free and fast (~0.25 s per phrase), but unofficial: no key, no terms that allow it in a product, and it can
// change or be rate-limited at any time. Fine for Lucas's own use; not for production (see decisions.md).
// The endpoint takes at most ~200 characters, so longer text goes in pieces whose mp3s are joined (mp3 frames
// concatenate cleanly). Clips are cached in data/speech/ like the OpenAI ones (lib/speech.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIR = join(resolve(import.meta.dirname, "../.."), "data/speech");
const LANG = "en-US";
const MAX_PIECE = 200;

// Splits at sentence ends, then commas, then spaces, so each piece sounds natural on its own.
function pieces(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_PIECE) {
    const head = rest.slice(0, MAX_PIECE);
    const cut = [/[.!?;:]\s/g, /,\s/g, /\s/g].map((re) => Math.max(...[...head.matchAll(re)].map((m) => m.index + 1), 0)).find((i) => i > 0)
      ?? MAX_PIECE;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

async function fetchPiece(q: string): Promise<Buffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${LANG}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok || !r.headers.get("content-type")?.startsWith("audio/")) throw new Error(`google tts: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function googleSpeech(text: string): Promise<Buffer> {
  const key = createHash("sha256").update(JSON.stringify(["google-translate", LANG, text])).digest("hex");
  const file = join(DIR, `${key}.mp3`);
  if (existsSync(file)) return readFileSync(file);
  const audio = Buffer.concat(await Promise.all(pieces(text).map(fetchPiece)));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, audio);
  return audio;
}
