// Eve's API server (127.0.0.1:8790). Dev: Vite proxies /api here (npm run server). Production: `npm run build`
// then `npm start`, and this server also serves the web app (static.ts).
// Plain TypeScript run by Node's type stripping: erasable syntax only, imports end in .ts.
import { watch } from "node:fs";
import { createServer } from "node:http";
import { db } from "./db.ts";
import { Binary, HttpError, match, type Route } from "./http.ts";
import { routes as cards } from "./routes/cards.ts";
import { routes as today } from "./routes/today.ts";
import { routes as talk } from "./routes/talk.ts";
import { routes as engine } from "./routes/engine.ts";
import { routes as review } from "./routes/review.ts";
import { routes as news } from "./routes/news.ts";
import { routes as inbox } from "./routes/inbox.ts";
import { routes as selection } from "./routes/selection.ts";
import { startNewsSchedule } from "./lib/news-repo.ts";
import { hasWebBuild, serveStatic } from "./static.ts";

const PORT = Number(process.env.EVE_PORT ?? 8790);
// Pages allowed to call the API: Eve on this machine, plus EVE_ORIGINS (comma-separated, e.g. the Tailscale
// URL https://eve.<tailnet>.ts.net when Eve runs on the server).
const ORIGINS = new Set([
  ...["127.0.0.1", "localhost"].flatMap((h) => [5173, PORT].map((p) => `http://${h}:${p}`)),
  ...(process.env.EVE_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean),
]);

const core: Route[] = [
  { method: "GET", path: "/api/health", handler: () => ({ ok: true }) },
  {
    method: "GET",
    path: "/api/usage",
    handler: () => ({
      total: db.prepare("SELECT ROUND(COALESCE(SUM(cost_usd), 0), 4) AS usd FROM api_usage").get(),
      byPurpose: db.prepare("SELECT purpose, model, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS usd FROM api_usage GROUP BY purpose, model").all(),
      thisMonth: db.prepare("SELECT ROUND(COALESCE(SUM(cost_usd), 0), 4) AS usd FROM api_usage WHERE at >= date('now', 'start of month')").get(),
    }),
  },
];

const ROUTES: Route[] = [...core, ...cards, ...today, ...talk, ...engine, ...review, ...news, ...selection, ...inbox];

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5_000_000) throw new HttpError(413, "Body too large");
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body ?? null));
  };
  // Refuse browser requests from any page that isn't Eve itself.
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) return send(403, { error: "Unexpected origin" });
  if (serveStatic(req, res, url.pathname)) return;
  for (const r of ROUTES) {
    if (r.method !== req.method) continue;
    const params = match(r.path, url.pathname);
    if (!params) continue;
    try {
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
      const out = await r.handler({ params, query: url.searchParams, body, req });
      if (out instanceof Binary) {
        res.writeHead(200, { "Content-Type": out.type, "Content-Length": out.data.length });
        return res.end(out.data);
      }
      return send(200, out);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return send(status, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  send(404, { error: `No route ${req.method} ${url.pathname}` });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Eve API → http://127.0.0.1:${PORT}${hasWebBuild() ? " (also serving web/dist)" : ""}`);
  if (process.env.EVE_NEWS_SCHEDULE !== "off") startNewsSchedule(); // daily 7:00 edition (news-repo.ts)
  // As the Mac service (deploy/mac): exit when the server code changes and let launchd start the new version.
  // Unlike node --watch, a crash also exits, so launchd restarts that too.
  if (process.env.EVE_RESTART_ON_CHANGE === "1") {
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(import.meta.dirname, { recursive: true }, (_event, file) => {
      if (!file?.endsWith(".ts")) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`server code changed (${file}): exiting so launchd restarts Eve`);
        process.exit(0);
      }, 1500); // an edit can touch several files: wait for it to settle
    });
  }
});
