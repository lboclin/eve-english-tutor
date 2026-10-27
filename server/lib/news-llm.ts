// Owned by the news module. Two model steps per edition:
//   1. pickStories — one small call (no web search) chooses at most 5 stories from the ranked shortlist
//      (news-sources.ts), following the selection rules below.
//   2. writeArticle — one call per pick with the hosted web_search tool: find that story at a reliable,
//      open outlet and rewrite it as an original B2→C1 reading text with comprehension questions.
// Costs: tokens via recordUsage(), search calls as their own api_usage row (billed per call, not per token).
import { db } from "../db.ts";
import { jsonCall, openaiFetch, recordUsage } from "../openai.ts";
import type { Candidate } from "./news-sources.ts";

export const MAX_ARTICLES = 5;

// gpt-6-luna: cheapest model with hosted web_search + structured outputs (developers.openai.com/api/docs/
// models/gpt-6-luna, read 2026-10-17). Its token prices are in ../openai.ts PRICES.
export const NEWS_MODEL = { model: "gpt-6-luna", reasoning: "low" as const };
// developers.openai.com/api/docs/pricing ("Built-in tools", read 2026-10-17): web_search $10 / 1k calls;
// search content tokens are billed at the model's token rates (already in the response usage).
export const WEB_SEARCH_PER_CALL = 10 / 1000;
const TIMEOUT_MS = 180_000;

// ---------- 1. Selection ----------

const PICK_INSTRUCTIONS = `You are the front-page editor of Eve, a daily English-reading app for Lucas, a Brazilian software developer (English B2 → C1).
You get a ranked shortlist of today's news (the last 24 hours) on the topics he follows. Each line has an id, topic, a Google-based
importance score (higher = more prominent today), how many feeds carry it, how many outlets cover it, Hacker News points if any, and the headline.

Choose AT MOST ${MAX_ARTICLES} stories for today's edition, most important first. Rules:
- Importance first: stories with real consequences for many people (decisions, discoveries, launches, conflicts, economy, policy).
  Use the score and coverage as strong signals, but use your judgement.
- Diversity: cover as many of the given topics as possible; at most 2 stories per topic; never two stories about the same event,
  company or product (e.g. not two iPhone stories).
- Leave out: celebrity gossip, clickbait, shopping deals and product reviews, game patches, live scores, horoscopes, opinion columns,
  "what to know"/listicle explainers when a straight news story on the same event exists, and stories already in the
  "recently covered" list.
- Prefer stories a learner can read with interest: concrete, with people, causes and consequences. Avoid graphic violence when an
  equally important alternative exists.
- Portuguese headlines (Brazil) are fine: Eve rewrites everything in English.
- Fewer than ${MAX_ARTICLES} is fine if the rest is weak. Never invent ids.`;

const PICK_SCHEMA = {
  name: "news_picks",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["picks"],
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "reason"],
          properties: { id: { type: "string" }, reason: { type: "string", description: "One short sentence: why it matters today." } },
        },
      },
    },
  },
};

export async function pickStories(shortlist: Candidate[], o: { topics: string[]; recentTitles: string[] }): Promise<Candidate[]> {
  const lines = shortlist.map((c) =>
    `${c.key} | ${c.topic} | score ${c.score.toFixed(1)} | feeds ${c.feeds} | outlets ${c.outlets.length}${c.hnPoints ? ` | HN ${c.hnPoints}` : ""} | ${c.title} (${c.outlet})`,
  );
  const input = [
    `Topics Lucas follows: ${o.topics.join(", ")}.`,
    `Shortlist:\n${lines.join("\n")}`,
    o.recentTitles.length ? `Recently covered (skip these stories):\n${o.recentTitles.map((t) => `- ${t}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  const out = await jsonCall<{ picks: { id: string; reason: string }[] }>({
    purpose: "news-pick",
    model: NEWS_MODEL.model,
    reasoning: NEWS_MODEL.reasoning,
    instructions: PICK_INSTRUCTIONS,
    input,
    schema: PICK_SCHEMA,
    maxOutputTokens: 3000,
  });
  const byKey = new Map(shortlist.map((c) => [c.key, c]));
  const seen = new Set<string>();
  const perTopic = new Map<string, number>();
  const picks: Candidate[] = [];
  for (const p of out.picks) {
    const c = byKey.get(p.id);
    if (!c || seen.has(c.key) || (perTopic.get(c.topic) ?? 0) >= 2) continue; // the rules hold even if the model slips
    seen.add(c.key);
    perTopic.set(c.topic, (perTopic.get(c.topic) ?? 0) + 1);
    picks.push(c);
    if (picks.length >= MAX_ARTICLES) break;
  }
  return picks;
}

// ---------- 2. Writing ----------

export interface GeneratedArticle {
  title: string;
  paragraphs: string[];
  questions: { question: string; options: string[]; answer: number }[];
  source_title: string;
  source_url: string;
  published: string; // YYYY-MM-DD as reported by the model (logs only)
}

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "title", "paragraphs", "questions", "source_title", "source_url", "published"],
  properties: {
    found: { type: "boolean", description: "false if web search didn't find this story from the last few days; then leave the rest empty." },
    title: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "options", "answer"],
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer", description: "0-based index of the one correct option." },
        },
      },
    },
    source_title: { type: "string", description: "Headline of the real source article you used, plus the outlet, e.g. 'Headline — Reuters'." },
    source_url: { type: "string", description: "The exact URL of that article, from the search results." },
    published: { type: "string", description: "Publication date of the source, YYYY-MM-DD." },
  },
};

const WRITE_INSTRUCTIONS = `You are Eve's news writer. Eve is an English-practice app for Lucas, a Brazilian software developer whose English is B2 (EF SET 54) and who is working toward C1.
Write in American English only: American spelling (data center, color, organize, traveled), vocabulary (apartment, truck, cell phone) and usage (on the weekend, in the hospital). Never British forms (no "data centre", "colour", "organise", "lorry"), even when the source outlet is British.

You get ONE news story from today's front page (headline, outlets that covered it, related headlines). Steps:
1. Use web search to find this exact story, published in the last 2 days. Prefer an open, reputable outlet from the list or of similar
   standing (AP, Reuters, BBC, The Guardian, NPR, Al Jazeera, Ars Technica, The Verge, Nature, Agência Brasil, G1, Folha…) over paywalled ones.
   Read one or two sources so the article is a fresh synthesis, not a paraphrase. If you can't find the story, set found = false.
2. Rewrite it as an ORIGINAL article in your own words — never copy sentences from a source. Stick to the facts reported; do not invent
   quotes, numbers or details. Tell the story directly as a news feature (not a summary of a report): name an outlet at most once, no
   generic padding.

The article:
- 130–180 words in 2–3 paragraphs. Short is the point: Lucas skips long texts, so every sentence must earn its place.
  Open with what happened and why it matters; then add only the context a non-expert foreign reader needs (who a Brazilian
  politician is, what a company does). Cut everything else: method details (hours observed, sample sizes), hedges and caveats
  that aren't the story, restating a point, background the reader doesn't need, and "what's next" or "time will tell" closers.
- Clear and natural English at B2→C1 level: mostly B2 vocabulary and grammar, plus 2–3 useful C1 collocations or phrasal verbs
  that fit naturally (e.g. "raise concerns", "roll out", "fall short of") — never add a sentence just to fit one in.
  No slang, no headline-ese, no bullet points, no citations or links in the text (the source goes in source_url).
- A clear, engaging title (not the source headline).
- Exactly 3 multiple-choice comprehension questions with 3 or 4 options each and exactly ONE correct option. Test understanding (main idea,
  cause and effect, what a phrase means in context, an inference the text supports) — not trivia like exact numbers or dates. Every question
  must be answerable from the article alone; wrong options plausible but clearly wrong for someone who understood. Options similar in length
  and style. Vary the position of the correct option.
- source_title and source_url: the real article you relied on most, with its exact URL from the search results.`;

interface ResponseBody {
  error?: { message: string };
  status?: string;
  incomplete_details?: { reason?: string };
  output?: {
    type: string;
    action?: { type?: string; sources?: { url?: string }[] };
    content?: { type: string; text: string; annotations?: { type: string; url?: string }[] }[];
  }[];
  usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } };
}

export interface WriteResult {
  article: GeneratedArticle | null; // null = the story wasn't found
  retrievedUrls: string[]; // every URL the search returned or cited, to check source_url against
  costUsd: number;
}

export async function writeArticle(story: Candidate, date: string): Promise<WriteResult> {
  const input = [
    `Today is ${date}.`,
    `Headline: ${story.title}`,
    `First reported by: ${story.outlet} (${story.published.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
    story.outlets.length > 1 ? `Also covered by: ${story.outlets.slice(1).join(", ")}` : "",
    story.related.length ? `Related headlines:\n${story.related.map((t) => `- ${t}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const r = await openaiFetch("/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: NEWS_MODEL.model,
      instructions: WRITE_INSTRUCTIONS,
      input,
      store: false,
      reasoning: { effort: NEWS_MODEL.reasoning },
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 8000,
      text: { format: { type: "json_schema", name: "news_article", schema: ARTICLE_SCHEMA, strict: true } },
    }),
  });
  const body = (await r.json().catch(() => ({}))) as ResponseBody;
  if (!r.ok || body.error) throw new Error(`OpenAI ${r.status} ${body.error?.message ?? ""}`.trim());

  // Spend first, so a response we can't parse is still counted.
  const searches = (body.output ?? []).filter((i) => i.type === "web_search_call" && (i.action?.type ?? "search") === "search").length;
  let costUsd = recordUsage({
    purpose: "news",
    model: NEWS_MODEL.model,
    input: body.usage?.input_tokens,
    cached: body.usage?.input_tokens_details?.cached_tokens,
    output: body.usage?.output_tokens,
  });
  if (searches > 0) {
    const fee = searches * WEB_SEARCH_PER_CALL;
    db.prepare("INSERT INTO api_usage (purpose, model, seconds, cost_usd) VALUES (?, ?, 0, ?)").run("news-web-search", "web_search", fee); // calls = cost / WEB_SEARCH_PER_CALL
    costUsd += fee;
  }

  if (body.status === "incomplete") throw new Error(`the model stopped early (${body.incomplete_details?.reason ?? "incomplete"})`);
  const retrievedUrls: string[] = [];
  for (const item of body.output ?? []) {
    for (const s of item.action?.sources ?? []) if (s.url) retrievedUrls.push(s.url);
    for (const c of item.content ?? []) for (const a of c.annotations ?? []) if (a.url) retrievedUrls.push(a.url);
  }
  const text = body.output?.flatMap((i) => i.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text).join("");
  if (!text) throw new Error("the model returned no text");
  let parsed: GeneratedArticle & { found: boolean };
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/); // belt and braces: the outermost JSON object if anything wraps it
    if (!m) throw new Error("the model's answer wasn't JSON");
    parsed = JSON.parse(m[0]);
  }
  return { article: parsed.found ? parsed : null, retrievedUrls, costUsd };
}
