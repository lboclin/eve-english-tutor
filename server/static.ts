// Production mode: the API server also serves the built web app (web/dist, from `npm run build`), so one process
// is all Eve needs (npm start). In dev, Vite serves the app on :5173 and this stays unused unless dist exists.
// Unknown paths fall back to index.html: the app routes on the client (router.tsx).
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const DIST = resolve(import.meta.dirname, "../web/dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export const hasWebBuild = () => existsSync(join(DIST, "index.html"));

// Sends a file from web/dist for a GET/HEAD outside /api; returns false when it isn't one.
export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if ((req.method !== "GET" && req.method !== "HEAD") || pathname.startsWith("/api/") || !hasWebBuild()) return false;
  let file: string;
  try {
    file = normalize(join(DIST, decodeURIComponent(pathname)));
  } catch {
    return false; // malformed %-encoding
  }
  if (file !== DIST && !file.startsWith(DIST + sep)) return false; // no "../" out of dist
  const isFile = existsSync(file) && statSync(file).isFile();
  if (!isFile) {
    if (extname(pathname)) return false; // a missing asset is a 404, not the app
    file = join(DIST, "index.html");
  }
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    // Vite fingerprints everything under /assets; the rest (index.html, manifest, icons) must stay fresh.
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  return true;
}
