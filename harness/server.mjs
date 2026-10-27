// Local test harness server. Holds the API keys; the browser only gets SDP answers or short-lived tokens.
// Run from the repo root: npm run harness  →  http://localhost:3000
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { tutorPrompt, STYLE_NAMES } from "./prompts.mjs";

const PORT = 3000;
const ORIGIN = `http://localhost:${PORT}`;
const ROOT = resolve(import.meta.dirname);
const PUBLIC = join(ROOT, "public");
const RESULTS = join(ROOT, "results");

const MODELS = {
  "openai-live": "gpt-live-1",
  "openai-realtime-mini": "gpt-realtime-2.1-mini",
  gemini: "gemini-3.8-live",
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req, limit = 2_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function promptFrom(body, provider) {
  const style = STYLE_NAMES.includes(body.style) ? body.style : "after-turn";
  return tutorPrompt({ style, provider });
}

function requireKey(name) {
  if (!process.env[name]) throw Object.assign(new Error(`Set ${name} in .env and restart`), { status: 503 });
  return process.env[name];
}

// Upstream error bodies can be long; keep the message, never the request headers.
async function upstreamError(r, label) {
  const text = await r.text();
  console.error(`${label} failed: HTTP ${r.status} ${text.slice(0, 500)}`);
  return Object.assign(new Error(`${label} failed (HTTP ${r.status}): ${text.slice(0, 300)}`), { status: 502 });
}

const routes = {
  "GET /api/config": async () => ({
    models: MODELS,
    styles: STYLE_NAMES,
    keys: { openai: Boolean(process.env.OPENAI_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY) },
  }),

  // GPT-Live: JSON {session, transport} to /v1/live/sessions; returns {session:{id}, transport:{sdp}}.
  "POST /api/openai-live/session": async (body) => {
    const key = requireKey("OPENAI_API_KEY");
    const r = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { model: MODELS["openai-live"], instructions: promptFrom(body, "openai-live") },
        transport: { type: "webrtc", sdp: body.sdp },
      }),
    });
    if (!r.ok) throw await upstreamError(r, "GPT-Live session");
    return r.json();
  },

  // Realtime unified interface: multipart {sdp, session} to /v1/realtime/calls; returns the SDP answer as text.
  "POST /api/openai-realtime/session": async (body) => {
    const key = requireKey("OPENAI_API_KEY");
    const fd = new FormData();
    fd.set("sdp", body.sdp);
    fd.set(
      "session",
      JSON.stringify({
        type: "realtime",
        model: MODELS["openai-realtime-mini"],
        instructions: promptFrom(body, "openai-realtime-mini"),
        audio: {
          input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad" } },
          output: { voice: "marin" },
        },
      }),
    );
    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    if (!r.ok) throw await upstreamError(r, "Realtime session");
    return { sdp: await r.text() };
  },

  // Gemini: single-use ephemeral token; the browser opens the WebSocket itself.
  "POST /api/gemini/token": async (body) => {
    const ai = new GoogleGenAI({ apiKey: requireKey("GEMINI_API_KEY") });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        httpOptions: { apiVersion: "v1beta" },
      },
    });
    return { token: token.name, model: MODELS.gemini, instructions: promptFrom(body, "gemini") };
  },

  "POST /api/results": async (body) => {
    const provider = Object.keys(MODELS).includes(body.provider) ? body.provider : "unknown";
    const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-${provider}.json`;
    await writeFile(join(RESULTS, file), JSON.stringify(body, null, 2));
    return { saved: `harness/results/${file}` };
  },
};

async function serveStatic(req, res) {
  const path = new URL(req.url, ORIGIN).pathname;
  const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC)) return send(res, 400, { error: "Bad path" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, { error: "Not found" });
  }
}

createServer(async (req, res) => {
  const route = routes[`${req.method} ${new URL(req.url, ORIGIN).pathname}`];
  if (!route) return req.method === "GET" ? serveStatic(req, res) : send(res, 404, { error: "Not found" });
  // Local-only harness: reject requests from other origins so no other page can spend the keys.
  if (req.method === "POST" && req.headers.origin !== ORIGIN) return send(res, 403, { error: "Unexpected origin" });
  try {
    const body = req.method === "POST" ? await readJson(req) : {};
    send(res, 200, await route(body));
  } catch (error) {
    send(res, error.status ?? 500, { error: error.message });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`english-coach harness → ${ORIGIN}`);
  console.log(`keys: OPENAI_API_KEY ${process.env.OPENAI_API_KEY ? "set" : "missing"}, GEMINI_API_KEY ${process.env.GEMINI_API_KEY ? "set" : "missing"}`);
});
