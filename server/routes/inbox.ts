// Inbox: cards sent to Eve from outside the app, e.g. by a Claude Code session through the eve-add skill (skills/eve-add/).
// Local only like every route (the server listens on 127.0.0.1; browser pages from other origins are refused).
//
// POST /api/inbox/cards accepts either
//   { cards: [...] } — finished cards in anki-add's JSON shape (see the skill's SKILL.md §2):
//       { word, back } | { kind: "collocation", front, back } | { kind: "phrasal", pv, front, back }
//       | { kind: "fix", rule, front, back } | { kind: "pronunciation", rule, front, back }, optional tags
//   { text: "fix: I were → I was\nword: auction" } — raw items; Eve's card engine writes the cards (paid call)
// Exact front+back duplicates are skipped, so sending the same batch twice is harmless. With cards, dryRun: true
// only validates. The reply's events say how many times each fix rule / phrasal verb / sound has been carded.
import { db } from "../db.ts";
import { HttpError, type Route } from "../http.ts";
import { insertCards, type NewCard } from "../lib/cards-repo.ts";
import { cleanHtml, draftCards, KIND_CATEGORY, KINDS, parseLines, type Kind } from "../llm/engine.ts";

const MAX_CARDS = 200;
const MAX_ITEMS = 20;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Slug field and tag prefix per kind; the tag doubles as event_key so siblings are spread over days (cards.ts).
const SLUGGED: Partial<Record<Kind, { field: "rule" | "pv"; prefix: string; size: number[] }>> = {
  fix: { field: "rule", prefix: "err", size: [3] },
  phrasal: { field: "pv", prefix: "pv", size: [2, 4] },
  pronunciation: { field: "rule", prefix: "pron", size: [2] },
};

function parseCards(raw: unknown[]): NewCard[] {
  const cards = raw.map((x, k) => {
    const c = (x ?? {}) as Record<string, unknown>;
    const at = `Card ${k + 1}`;
    const kind = (c.kind ?? "word") as Kind;
    if (!KINDS.includes(kind)) throw new HttpError(400, `${at}: unknown kind "${String(c.kind)}"`);
    const front = cleanHtml(String(c.front ?? c.word ?? ""));
    const back = cleanHtml(String(c.back ?? ""));
    if (!front || !back) throw new HttpError(400, `${at}: front (or word) and back are required`);
    const tags = Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
    const s = SLUGGED[kind];
    let eventKey: string | undefined;
    if (s) {
      const slug = String(c[s.field] ?? "");
      if (!SLUG.test(slug)) throw new HttpError(400, `${at}: ${kind} needs a kebab-case "${s.field}"`);
      eventKey = `${s.prefix}::${slug}`;
      tags.push(eventKey);
    }
    return { category: KIND_CATEGORY[kind], front, back, source: "claude", eventKey, tags: [`mode::${kind}`, ...tags] } satisfies NewCard;
  });
  // Same event boundaries as anki-add: consecutive runs of one rule / pv have the event's card count.
  for (let i = 0; i < cards.length; ) {
    const key = cards[i].eventKey;
    let j = i + 1;
    while (key && j < cards.length && cards[j].eventKey === key) j++;
    const kind = cards[i].tags[0].slice("mode::".length) as Kind;
    const size = SLUGGED[kind]?.size;
    if (size && !size.includes(j - i)) {
      throw new HttpError(400, `Cards ${i + 1}–${j}: a ${kind} event (${key}) must have ${size.join(" or ")} consecutive cards, got ${j - i}`);
    }
    i = j;
  }
  return cards;
}

// Recurrence per rule / pv in this batch: cards stored under its event_key ÷ cards per event.
function eventCounts(cards: NewCard[]) {
  const out: Record<string, number> = {};
  for (const c of cards) {
    if (!c.eventKey || c.eventKey in out) continue;
    const kind = c.tags![0].slice("mode::".length) as Kind;
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE event_key = ?").get(c.eventKey) as { n: number };
    out[c.eventKey] = Math.max(1, Math.round(n / SLUGGED[kind]!.size[0]));
  }
  return out;
}

export const routes: Route[] = [
  {
    method: "POST",
    path: "/api/inbox/cards",
    handler: async ({ body }) => {
      if (Array.isArray(body?.cards)) {
        if (!body.cards.length) throw new HttpError(400, "No cards");
        if (body.cards.length > MAX_CARDS) throw new HttpError(400, `At most ${MAX_CARDS} cards at a time`);
        const cards = parseCards(body.cards);
        if (body.dryRun === true) return { valid: cards.length, cards: cards.map((c) => ({ category: c.category, eventKey: c.eventKey, front: c.front, back: c.back })) };
        const { inserted, duplicates } = insertCards(cards);
        return { inserted: inserted.length, duplicates, ids: inserted, events: eventCounts(cards) };
      }
      if (typeof body?.text === "string") {
        const items = parseLines(body.text);
        if (!items.length) throw new HttpError(400, "Nothing to turn into cards");
        if (items.length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} items at a time`);
        const out = await draftCards(items);
        const cards = out.flatMap((i) => i.drafts).map((d) => ({ ...d, source: "claude" as const }));
        const { inserted, duplicates } = insertCards(cards);
        return {
          inserted: inserted.length,
          duplicates,
          ids: inserted,
          items: out.map((i) => ({ input: i.input, kind: i.kind, cards: i.drafts.map((d) => ({ front: d.front, back: d.back })), warning: i.warning })),
        };
      }
      throw new HttpError(400, 'Send { "cards": [...] } (finished anki-add cards) or { "text": "..." } (raw items for the card engine)');
    },
  },
];
