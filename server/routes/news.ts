// Owned by the news module — see CLAUDE.md "Server".
// Daily reading (lib/news-repo.ts): GET /api/news/today = the current edition (made at 7:00 for the last 24 h);
// GET /api/news = the last few editions for the News tab; GET/POST /api/news/settings = the topics;
// GET /api/news/:id = one article. Reads and scores go through POST /api/reads (today.ts).
import { HttpError, type Route } from "../http.ts";
import { articleById, currentEdition, editionArticles, newsSettings, recentEditions, setTopics } from "../lib/news-repo.ts";

async function current() {
  const edition = currentEdition();
  try {
    await editionArticles(edition);
  } catch (e) {
    console.error("news: generation failed:", e);
    const msg = !(e instanceof Error) ? String(e)
      : e.name === "TimeoutError" ? "the request timed out"
      : e.message === "fetch failed" ? "can't reach the news feeds or the OpenAI key broker" : e.message;
    throw new HttpError(502, `Couldn't fetch today's news (${msg})`);
  }
  return edition;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/api/news/today",
    handler: async () => {
      const edition = await current();
      return { date: edition, articles: recentEditions(edition)[0].articles };
    },
  },
  {
    method: "GET",
    path: "/api/news",
    handler: async () => {
      const edition = await current();
      return { current: edition, editions: recentEditions(edition) };
    },
  },
  { method: "GET", path: "/api/news/settings", handler: () => newsSettings() },
  {
    method: "POST",
    path: "/api/news/settings",
    handler: ({ body }) => {
      const ids = Array.isArray(body?.topics) ? body.topics.filter((t: unknown): t is string => typeof t === "string") : [];
      try {
        setTopics(ids);
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
      return newsSettings();
    },
  },
  {
    method: "GET",
    path: "/api/news/:id",
    handler: ({ params }) => {
      const a = articleById(params.id);
      if (!a) throw new HttpError(404, "Article not found");
      return a;
    },
  },
];
