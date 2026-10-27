// DeepL access through the local sb-key broker, like openai.ts: the key never lives in this process and the two
// values below are not secrets. Free API plan: 500k characters a month (Lucas's account had 1M for its first
// period), so only short selections + their sentence are sent. Usage is logged in api_usage (input_tokens =
// characters, cost 0).
import { recordUsage } from "./openai.ts";

export const DEEPL_BASE_URL = process.env.DEEPL_BASE_URL ?? "http://127.0.0.1:8787/english-app/deepl/v2";
const DEEPL_API_KEY = process.env.DEEPL_API_KEY ?? "via-sb-keys";

// Translates EN → PT-BR. `context` (e.g. the sentence around a selection) steers the translation and isn't billed.
export async function translate(texts: string[], context?: string): Promise<string[]> {
  const r = await fetch(`${DEEPL_BASE_URL}/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: texts, source_lang: "EN", target_lang: "PT-BR", ...(context ? { context } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await r.json().catch(() => ({}))) as { message?: string; translations?: { text: string }[] };
  if (!r.ok || !body.translations) throw new Error(`DeepL ${r.status} ${body.message ?? ""}`.trim());
  recordUsage({ purpose: "translate", model: "deepl", input: texts.reduce((n, t) => n + t.length, 0) });
  return body.translations.map((t) => t.text);
}
