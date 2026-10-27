// Tiny routing layer shared by every route module. A module exports `routes: Route[]`; index.ts mounts them.
import type { IncomingMessage } from "node:http";

export interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any; // parsed JSON for POST/PUT/PATCH, {} otherwise
  req: IncomingMessage;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // "/api/cards/:id" — ":name" segments become ctx.params.name
  handler: (ctx: Ctx) => unknown | Promise<unknown>; // return value is sent as JSON, or as is when it's a Binary
}

// A non-JSON response (e.g. speech audio).
export class Binary {
  type: string;
  data: Buffer;
  constructor(type: string, data: Buffer) {
    this.type = type;
    this.data = data;
  }
}

// (No parameter properties: Node's type stripping only supports erasable TypeScript syntax.)
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/");
  const s = path.split("/");
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
