// Owned by the news module. Editions: every day at EDITION_HOUR (local time) Eve publishes at most 5 articles
// about the most important stories of the previous 24 hours, on the topics Lucas picked (settings table).
// An edition is named after the day it was published; before EDITION_HOUR the current edition is still
// yesterday's. The server makes it on schedule, or as soon as it runs after that (the Mac may have been asleep).
// The News tab shows the last EDITIONS_SHOWN editions; older articles stay in the database, hidden.
import { db } from "../db.ts";
import { MAX_ARTICLES, pickStories, writeArticle, type GeneratedArticle } from "./news-llm.ts";
import { DEFAULT_TOPICS, gatherCandidates, shortlist, TOPICS, topicLabel, type Candidate, type TopicId } from "./news-sources.ts";

export const EDITION_HOUR = 7;
export const EDITIONS_SHOWN = 3; // today, yesterday, the day before: ≤ 15 articles on the tab
const RETRY_AFTER_MS = 15 * 60_000; // after a failed edition, try again this much later

export interface Article {
  id: string;
  date: string; // edition, YYYY-MM-DD
  topic: string;
  title: string;
  body: string[];
  questions: { q: string; options: string[]; answer: number }[];
  sourceTitle: string;
  sourceUrl: string;
  level: string;
  minutes: number;
  read: boolean;
}

interface Row {
  id: string; date: string; topic: string; title: string; body: string; questions: string;
  source_title: string; source_url: string; level: string; minutes: number; read: number;
}

const LEVEL = "B2-C1";
const WORDS_PER_MINUTE = 120; // a careful learner's reading pace, not a native's

export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The edition on screen at `now`: today's from EDITION_HOUR on, yesterday's before it.
export function currentEdition(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < EDITION_HOUR) d.setDate(d.getDate() - 1);
  return localDay(d);
}
// An edition covers the 24 hours before its publication time.
const publishedAt = (edition: string) => new Date(`${edition}T${String(EDITION_HOUR).padStart(2, "0")}:00:00`);

// ---------- Settings ----------

export function getTopics(): TopicId[] {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'news.topics'").get() as { value: string } | undefined;
  const ids = r ? (JSON.parse(r.value) as string[]) : DEFAULT_TOPICS;
  const valid = ids.filter((id): id is TopicId => TOPICS.some((t) => t.id === id));
  return valid.length ? valid : DEFAULT_TOPICS;
}

export function setTopics(ids: string[]): TopicId[] {
  const valid = [...new Set(ids)].filter((id): id is TopicId => TOPICS.some((t) => t.id === id));
  if (!valid.length) throw new Error("Pick at least one topic");
  db.prepare("INSERT INTO settings (key, value) VALUES ('news.topics', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(valid));
  return valid;
}

export function newsSettings() {
  const selected = getTopics();
  return { topics: TOPICS.map((t) => ({ id: t.id, label: t.label, selected: selected.includes(t.id) })), editionHour: EDITION_HOUR, maxArticles: MAX_ARTICLES };
}

// ---------- Reading ----------

const SELECT = "SELECT a.*, EXISTS (SELECT 1 FROM reads r WHERE r.article_id = a.id) AS read FROM news_articles a";
const toArticle = (r: Row): Article => ({
  id: r.id, date: r.date, topic: r.topic, title: r.title, body: JSON.parse(r.body), questions: JSON.parse(r.questions),
  sourceTitle: r.source_title, sourceUrl: r.source_url, level: r.level, minutes: r.minutes, read: !!r.read,
});

export function articlesFor(edition: string): Article[] {
  return (db.prepare(`${SELECT} WHERE a.date = ? ORDER BY a.rowid`).all(edition) as unknown as Row[]).map(toArticle);
}

export function articleById(id: string): Article | null {
  const r = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as unknown as Row | undefined;
  return r ? toArticle(r) : null;
}

// The current edition plus the previous ones that have articles, newest first.
export function recentEditions(current = currentEdition()): { date: string; articles: Article[] }[] {
  const dates = (db.prepare("SELECT DISTINCT date FROM news_articles WHERE date < ? ORDER BY date DESC LIMIT ?").all(current, EDITIONS_SHOWN - 1) as { date: string }[]).map((r) => r.date);
  return [current, ...dates].map((date) => ({ date, articles: articlesFor(date) })).filter((e, k) => k === 0 || e.articles.length);
}

// ---------- Making an edition ----------

// Small deterministic hash, so the correct option's position is spread out but stable for an article.
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");

function cleanUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}
const host = (u: URL) => u.hostname.replace(/^www\./, "").toLowerCase();

type Stored = Omit<Article, "date" | "read">;

// Web-search answers may carry inline citations ("([bbc.com](https://…))", "[text](url)"): the article
// shows its source once at the end instead.
const stripCitations = (p: string) =>
  p.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s{2,}/g, " ").trim();

// Turns one written article into a stored one, or null (logged) if it's malformed or its source isn't a page
// the search actually returned (so a made-up URL never reaches Lucas).
export function validate(edition: string, topic: string, g: GeneratedArticle, retrievedUrls: string[], taken: Set<string>): Stored | null {
  const why = (msg: string) => (console.warn(`news: dropped "${g.title}": ${msg}`), null);
  const body = (g.paragraphs ?? []).map(stripCitations).filter(Boolean);
  const words = body.join(" ").split(/\s+/).length;
  if (!g.title?.trim() || body.length < 2 || words < 100) return why(`too short (${words} words)`);
  const url = cleanUrl(g.source_url ?? "");
  if (!url) return why(`bad source URL ${g.source_url}`);
  const retrievedHosts = new Set(retrievedUrls.map(cleanUrl).filter((u): u is URL => !!u).map(host));
  if (retrievedHosts.size > 0 && !retrievedHosts.has(host(url))) return why(`source ${url.href} wasn't in the search results`);
  let id = `${edition}-${slug(g.title) || "article"}`;
  while (taken.has(id)) id += "-2";
  const questions = (g.questions ?? [])
    .filter((q) => q.question?.trim() && q.options?.length >= 2 && q.options.length <= 5 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .map((q, k) => {
      // Move the correct option to a spread-out position (models favour the first two slots).
      const options = q.options.map((o) => o.trim());
      const target = hash(`${id}:${k}`) % options.length;
      [options[q.answer], options[target]] = [options[target], options[q.answer]];
      return { q: q.question.trim(), options, answer: target };
    });
  if (questions.length === 0) return why("no usable questions");
  taken.add(id);
  return {
    id, topic, title: g.title.trim(), body, questions,
    sourceTitle: g.source_title?.trim() || host(url), sourceUrl: url.href, level: LEVEL,
    minutes: Math.max(2, Math.round(words / WORDS_PER_MINUTE)),
  };
}

const inflight = new Map<string, Promise<Article[]>>();
let lastFailure: { edition: string; at: number; error: string } | null = null;

// The current edition's articles; makes the edition if it doesn't exist yet. Concurrent callers share one run.
export function editionArticles(edition = currentEdition()): Promise<Article[]> {
  const existing = articlesFor(edition);
  if (existing.length) return Promise.resolve(existing);
  let p = inflight.get(edition);
  if (!p) {
    p = makeEdition(edition)
      .catch((e) => {
        lastFailure = { edition, at: Date.now(), error: e instanceof Error ? e.message : String(e) };
        throw e;
      })
      .finally(() => inflight.delete(edition));
    inflight.set(edition, p);
  }
  return p;
}

async function makeEdition(edition: string): Promise<Article[]> {
  const started = Date.now();
  const topics = getTopics();
  const until = publishedAt(edition);
  const { candidates, failures } = await gatherCandidates(topics, until);
  if (failures.length) console.warn(`news: ${failures.length} feed(s) failed: ${failures.join("; ")}`);
  const list = shortlist(candidates);
  if (!list.length) throw new Error("no stories in the feeds for the last 24 hours");

  const since = new Date(until);
  since.setDate(since.getDate() - 7);
  const recentTitles = (db.prepare("SELECT title, source_title FROM news_articles WHERE date >= ? ORDER BY date DESC").all(localDay(since)) as { title: string; source_title: string }[])
    .map((r) => `${r.title} (${r.source_title})`);
  const picks = await pickStories(list, { topics: topics.map(topicLabel), recentTitles });
  if (!picks.length) throw new Error("the editor didn't pick any story");

  // One writer per story, in parallel; a story that fails or can't be found is skipped.
  let cost = 0;
  const written = await Promise.all(picks.map((story: Candidate) =>
    writeArticle(story, edition).then(
      (r) => {
        cost += r.costUsd;
        if (!r.article) console.warn(`news: story not found by the writer: "${story.title}"`);
        return { story, ...r };
      },
      (e: Error) => {
        console.warn(`news: writing "${story.title}" failed: ${e.message}`);
        return null;
      },
    ),
  ));
  const taken = new Set<string>();
  const valid: Stored[] = [];
  for (const w of written) {
    if (!w?.article) continue;
    const a = validate(edition, topicLabel(w.story.topic), w.article, w.retrievedUrls, taken);
    if (a) valid.push(a);
  }
  console.log(`news: edition ${edition} → ${valid.length}/${picks.length} articles from ${candidates.length} stories, $${cost.toFixed(4)}, ${Math.round((Date.now() - started) / 1000)} s`);
  if (valid.length === 0) throw new Error("none of the picked stories could be written");

  const insert = db.prepare(
    "INSERT OR IGNORE INTO news_articles (id, date, topic, title, body, questions, source_title, source_url, level, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.exec("BEGIN");
  try {
    // Another process (e.g. a second server on the same DB) may have stored the edition meanwhile: keep theirs.
    if (articlesFor(edition).length === 0) {
      for (const a of valid) insert.run(a.id, edition, a.topic, a.title, JSON.stringify(a.body), JSON.stringify(a.questions), a.sourceTitle, a.sourceUrl, a.level, a.minutes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return articlesFor(edition);
}

// Checks every minute and makes the current edition when it's missing (at EDITION_HOUR, or right after the
// server starts). After a failure it waits RETRY_AFTER_MS before trying again; a page request can retry sooner.
export function startNewsSchedule() {
  const tick = () => {
    const edition = currentEdition();
    if (inflight.has(edition) || articlesFor(edition).length) return;
    if (lastFailure?.edition === edition && Date.now() - lastFailure.at < RETRY_AFTER_MS) return;
    editionArticles(edition).catch((e) => console.error(`news: edition ${edition} failed:`, e instanceof Error ? e.message : e));
  };
  setTimeout(tick, 5_000);
  setInterval(tick, 60_000).unref();
}
