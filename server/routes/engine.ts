// Owned by the engine module — see CLAUDE.md "Server".
// Card engine: typed lines → card drafts (one model call) → saved cards.
import { HttpError, type Route } from "../http.ts";
import { CATEGORIES, insertCards, type Category } from "../lib/cards-repo.ts";
import { cleanHtml, draftCards, parseLines } from "../llm/engine.ts";

const MAX_ITEMS = 20;

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/engine/draft",
    handler: async ({ body }) => {
      const text = typeof body?.text === "string" ? body.text : "";
      const items = parseLines(text);
      if (!items.length) throw new HttpError(400, "Nothing to turn into cards");
      if (items.length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} items at a time`);
      try {
        const out = await draftCards(items);
        return { items: out, drafts: out.flatMap((i) => i.drafts) };
      } catch (e) {
        console.error(e);
        throw new HttpError(502, "Eve couldn't write the cards right now. Try again in a moment.");
      }
    },
  },
  {
    method: "POST",
    path: "/api/engine/save",
    handler: ({ body }) => {
      const drafts = Array.isArray(body?.drafts) ? (body.drafts as unknown[]) : [];
      if (!drafts.length) throw new HttpError(400, "No drafts to save");
      const cards = drafts.map((raw, k) => {
        const d = raw as { category?: string; front?: string; back?: string; eventKey?: string; tags?: unknown };
        if (!CATEGORIES.includes(d.category as Category)) throw new HttpError(400, `Draft ${k + 1}: unknown category`);
        const front = cleanHtml(String(d.front ?? ""));
        const back = cleanHtml(String(d.back ?? ""));
        if (!front || !back) throw new HttpError(400, `Draft ${k + 1}: front and back are required`);
        const tags = Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
        return {
          category: d.category as Category,
          front,
          back,
          source: "engine" as const,
          eventKey: typeof d.eventKey === "string" && d.eventKey ? d.eventKey : undefined,
          tags,
        };
      });
      const { inserted, duplicates } = insertCards(cards);
      return { inserted: inserted.length, duplicates, ids: inserted };
    },
  },
];
