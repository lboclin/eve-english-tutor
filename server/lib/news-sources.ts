// Owned by the news module. Candidate stories for an edition: Google News RSS feeds (already ranked by
// Google: feed order + a cluster of up to 5 outlets per story) for each selected topic, plus Hacker News
// front-page stories for AI & software. Free, no key. Research and trade-offs: progress.md (2026-10-17) —
// Google's terms allow "a personal feed reader for personal, non-commercial use", which is what Eve is.

export const TOPICS = [
  { id: "world", label: "World", feeds: [gn("headlines/section/topic/WORLD")] },
  { id: "brazil", label: "Brazil", feeds: [gnBR("")] }, // the en-US Brazil feed is empty; Eve writes in English anyway
  { id: "tech", label: "Tech", feeds: [gn("headlines/section/topic/TECHNOLOGY")] },
  { id: "ai", label: "AI & software", feeds: [gn("search?q=%22artificial%20intelligence%22%20OR%20%22AI%20model%22%20OR%20%22software%20engineering%22%20when%3A1d"), "hn"] },
  { id: "science", label: "Science", feeds: [gn("headlines/section/topic/SCIENCE")] },
  { id: "business", label: "Business", feeds: [gn("headlines/section/topic/BUSINESS")] },
  { id: "health", label: "Health", feeds: [gn("headlines/section/topic/HEALTH")] },
  { id: "sports", label: "Sports", feeds: [gn("headlines/section/topic/SPORTS")] },
  { id: "culture", label: "Culture", feeds: [gn("headlines/section/topic/ENTERTAINMENT")] },
] as const;
export type TopicId = (typeof TOPICS)[number]["id"];
export const DEFAULT_TOPICS: TopicId[] = ["ai", "tech", "science", "brazil", "world"];
export const topicLabel = (id: string) => TOPICS.find((t) => t.id === id)?.label ?? id;

// The day's top stories across all sections: a story that is also here gets an importance boost.
const TOP_STORIES = gn("");

function gn(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  return `https://news.google.com/rss${path ? `/${path}` : ""}${sep}hl=en-US&gl=US&ceid=US:en`;
}
function gnBR(path: string) {
  return `https://news.google.com/rss${path ? `/${path}` : ""}?hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

export interface Candidate {
  key: string; // stable within an edition, e.g. "tech-3"
  topic: TopicId;
  title: string;
  outlet: string;
  outlets: string[]; // outlets in Google's cluster for this story (the first is `outlet`)
  related: string[]; // the cluster's other headlines, which help the writer find the story
  published: Date;
  score: number;
  feeds: number; // how many feeds carry the story (incl. Top Stories)
  hnPoints?: number;
}

interface FeedItem { title: string; outlet: string; outlets: string[]; related: string[]; published: Date; rank: number; size: number; hnPoints?: number }

const FETCH_TIMEOUT_MS = 20_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Eve/1.0 (personal news reader)";

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

export function parseRss(xml: string): FeedItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.map((it, rank) => {
    const outlet = decode(tag(it, "source")).trim();
    let title = decode(tag(it, "title")).trim();
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3)).trim();
    // The description is an HTML list of the cluster: <li><a>headline</a>&nbsp;&nbsp;<font>outlet</font></li>
    const html = decode(tag(it, "description"));
    const cluster = [...html.matchAll(/<li>\s*<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<font[^>]*>([\s\S]*?)<\/font>/g)].map((m) => ({
      title: decode(m[1]).trim(),
      outlet: decode(m[2]).trim(),
    }));
    const outlets = [...new Set([outlet, ...cluster.map((c) => c.outlet)].filter(Boolean))];
    return {
      title,
      outlet,
      outlets,
      related: cluster.map((c) => c.title).filter((t) => t && t !== title).slice(0, 4),
      published: new Date(tag(it, "pubDate")),
      rank,
      size: items.length,
    };
  }).filter((i) => i.title && !Number.isNaN(i.published.getTime()));
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
  return r.text();
}

async function hackerNews(since: Date): Promise<FeedItem[]> {
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&numericFilters=created_at_i>${Math.floor(since.getTime() / 1000)},points>150&hitsPerPage=30`;
  const body = JSON.parse(await fetchText(url)) as { hits: { title: string; url?: string; points: number; created_at: string }[] };
  const hits = body.hits.filter((h) => h.url).sort((a, b) => b.points - a.points);
  return hits.map((h, rank) => ({
    title: h.title,
    outlet: new URL(h.url!).hostname.replace(/^www\./, ""),
    outlets: [new URL(h.url!).hostname.replace(/^www\./, "")],
    related: [],
    published: new Date(h.created_at),
    rank,
    size: hits.length,
    hnPoints: h.points,
  }));
}

// Words for comparing headlines across feeds (titles of one story differ in wording between outlets).
const STOP = new Set("a an the of to in on for and or with by at from as is are was be its it that this after over into new says say said will".split(" "));
const words = (t: string) => new Set(t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
function similarTitle(a: Set<string>, b: Set<string>) {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 3 && shared / Math.min(a.size, b.size) >= 0.5;
}
// Same story if any headline of one cluster matches any headline of the other.
const sameStory = (a: Set<string>[], b: Set<string>[]) => a.some((x) => b.some((y) => similarTitle(x, y)));

// Gathers, de-duplicates and scores the stories of the last 24 h (window ends at `until`) for the topics.
// A feed that fails is skipped (logged); throws only if every feed failed.
export async function gatherCandidates(topics: TopicId[], until = new Date()): Promise<{ candidates: Candidate[]; failures: string[] }> {
  const since = new Date(until.getTime() - 24 * 3600_000);
  const failures: string[] = [];
  const jobs = TOPICS.filter((t) => topics.includes(t.id)).flatMap((t) => t.feeds.map((f) => ({ topic: t.id as TopicId, feed: f as string })));
  const load = async (feed: string) => (feed === "hn" ? hackerNews(since) : parseRss(await fetchText(feed)));
  const [top, ...results] = await Promise.all([TOP_STORIES, ...jobs.map((j) => j.feed)].map((f) =>
    load(f).catch((e: Error) => {
      failures.push(`${f === "hn" ? "Hacker News" : f}: ${e.message}`);
      return [] as FeedItem[];
    }),
  ));
  if (jobs.length && results.every((r) => r.length === 0)) throw new Error(`no news feed could be read (${failures.join("; ")})`);

  const heads = (i: { title: string; related: string[] }) => [i.title, ...i.related].map(words);
  const topWords = top.filter((i) => i.published >= since).map((i) => ({ w: heads(i), rank: i.rank }));
  const merged: (Candidate & { w: Set<string>[] })[] = [];
  results.forEach((items, k) => {
    const { topic } = jobs[k];
    for (const it of items) {
      if (it.published < since || it.published > new Date(until.getTime() + 3600_000)) continue;
      // Importance: Google's position (0–3), cluster size (0–1.25), HN points (0–2.5).
      const score = 3 * (1 - it.rank / Math.max(1, it.size)) + 0.25 * Math.min(5, it.outlets.length) + (it.hnPoints ? Math.min(2.5, it.hnPoints / 400) : 0);
      const w = heads(it);
      const dup = merged.find((m) => sameStory(m.w, w));
      if (dup) {
        // Same story in another feed: keep the better-placed copy, count the extra feed.
        dup.feeds++;
        dup.score = Math.max(dup.score, score) + 0.75;
        dup.outlets = [...new Set([...dup.outlets, ...it.outlets])];
        continue;
      }
      merged.push({
        key: `${topic}-${merged.length}`, topic, title: it.title, outlet: it.outlet, outlets: it.outlets, related: it.related,
        published: it.published, score, feeds: 1, hnPoints: it.hnPoints, w,
      });
    }
  });
  for (const m of merged) {
    const t = topWords.find((x) => sameStory(x.w, m.w));
    if (t) {
      m.feeds++;
      m.score += 1.5 - t.rank / 40; // on the day's Top Stories: the strongest signal Google gives
    }
  }
  const candidates = merged.map(({ w: _w, ...c }) => c).sort((a, b) => b.score - a.score);
  return { candidates, failures };
}

// The filter before the model sees anything: widely covered (≥ 3 outlets), carried by ≥ 2 feeds, or big on
// HN. If that leaves too few, the best-scored rest fill in. At most `perTopic` per topic, `limit` in all.
export function shortlist(candidates: Candidate[], limit = 30, perTopic = 8): Candidate[] {
  const strong = (c: Candidate) => c.outlets.length >= 3 || c.feeds >= 2 || (c.hnPoints ?? 0) >= 300;
  const ordered = [...candidates.filter(strong), ...candidates.filter((c) => !strong(c))];
  const out: Candidate[] = [];
  const per = new Map<string, number>();
  for (const c of ordered) {
    if ((per.get(c.topic) ?? 0) >= perTopic) continue;
    per.set(c.topic, (per.get(c.topic) ?? 0) + 1);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}
