// OpenAI access through the local sb-key broker: the key never lives in this process. The two values
// below are not secrets (see CLAUDE.md); .env can override them.
import { db } from "./db.ts";

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "http://127.0.0.1:8787/english-app/openai/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "via-sb-keys";

// USD per 1M tokens (developers.openai.com/api/docs/pricing, read 2026-10-17).
export const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2 },
  "gpt-5.6-terra": { input: 2, cached: 0.2, output: 12 },
};
export const GPT_LIVE_PER_MINUTE = 0.05;
// gpt-4o-mini-tts bills audio tokens ($12/1M); OpenAI estimated it at ≈ $0.015 per minute of speech.
export const TTS_PER_MINUTE = 0.015;

export function openaiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${OPENAI_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...(init.headers ?? {}) },
  });
}

export function recordUsage(u: { purpose: string; model: string; input?: number; cached?: number; output?: number; seconds?: number }) {
  const p = PRICES[u.model];
  const cost = u.model === "gpt-live-1"
    ? ((u.seconds ?? 0) / 60) * GPT_LIVE_PER_MINUTE
    : u.model === "gpt-4o-mini-tts"
    ? ((u.seconds ?? 0) / 60) * TTS_PER_MINUTE
    : p
      ? (((u.input ?? 0) - (u.cached ?? 0)) * p.input + (u.cached ?? 0) * p.cached + (u.output ?? 0) * p.output) / 1e6
      : 0;
  db.prepare(
    "INSERT INTO api_usage (purpose, model, input_tokens, cached_tokens, output_tokens, seconds, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(u.purpose, u.model, u.input ?? 0, u.cached ?? 0, u.output ?? 0, u.seconds ?? 0, cost);
  return cost;
}

export interface JsonCallOptions {
  purpose: string;
  model: string;
  instructions: string;
  input: string;
  schema: { name: string; schema: Record<string, unknown> }; // JSON Schema for structured output
  reasoning?: "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number;
}

// One Responses API call with strict structured output; returns the parsed JSON and records the cost.
export async function jsonCall<T>(o: JsonCallOptions): Promise<T> {
  const r = await openaiFetch("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: o.model,
      instructions: o.instructions,
      input: o.input,
      store: false,
      reasoning: o.reasoning ? { effort: o.reasoning } : undefined,
      max_output_tokens: o.maxOutputTokens ?? 4000,
      text: { format: { type: "json_schema", name: o.schema.name, schema: o.schema.schema, strict: true } },
    }),
  });
  const body = (await r.json()) as {
    error?: { message: string };
    output?: { type: string; content?: { type: string; text: string }[] }[];
    usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } };
  };
  if (!r.ok || body.error) throw new Error(`${o.purpose}: OpenAI ${r.status} ${body.error?.message ?? ""}`);
  recordUsage({
    purpose: o.purpose,
    model: o.model,
    input: body.usage?.input_tokens,
    cached: body.usage?.input_tokens_details?.cached_tokens,
    output: body.usage?.output_tokens,
  });
  const text = body.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text;
  if (!text) throw new Error(`${o.purpose}: no output text`);
  return JSON.parse(text) as T;
}
