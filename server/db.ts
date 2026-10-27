// SQLite (node:sqlite, built into Node 22) — one file, gitignored. The schema is shared by every module;
// change it only by appending a new entry to MIGRATIONS (never edit an applied one).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.EVE_DB ?? resolve(import.meta.dirname, "../data/eve.db");

const MIGRATIONS: string[] = [
  `
  -- Flashcards. category ∈ vocabulary | collocations | phrasal | grammar | pronunciation.
  -- FSRS fields mirror ts-fsrs's Card (state: 0 New, 1 Learning, 2 Review, 3 Relearning).
  CREATE TABLE cards (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',  -- manual | engine | talk | anki | claude
    source_ref TEXT,                        -- e.g. mistake id, anki note id
    event_key TEXT,                         -- groups the 2–3 cards of one fix/phrasal event (anki-add rule/pv)
    tags TEXT NOT NULL DEFAULT '[]',        -- JSON array
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    due TEXT NOT NULL DEFAULT (datetime('now')),
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    elapsed_days INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL DEFAULT 0,
    last_review TEXT,
    suspended INTEGER NOT NULL DEFAULT 0,
    UNIQUE (front, back)
  );
  CREATE INDEX cards_due ON cards (category, state, due);

  CREATE TABLE review_log (
    id INTEGER PRIMARY KEY,
    card_id INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,                -- 1 Again, 2 Hard, 3 Good, 4 Easy
    state INTEGER NOT NULL,                 -- state before the review
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    scheduled_days INTEGER NOT NULL DEFAULT 0
  );

  -- Talk sessions with GPT-Live and their transcript.
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    mode TEXT NOT NULL,                     -- daily | interview (see web/src/data/talk.ts)
    style TEXT NOT NULL DEFAULT 'after-turn',
    live_session_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    seconds INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'live',    -- live | ended | evaluated | failed
    usage TEXT                              -- JSON from session.closed
  );

  CREATE TABLE transcript (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    speaker TEXT NOT NULL,                  -- you | eve
    text TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER
  );
  CREATE INDEX transcript_session ON transcript (session_id, id);

  -- Mistakes found by the evaluator. rule = stable kebab-case key so repeats can be counted across sessions.
  CREATE TABLE mistakes (
    id INTEGER PRIMARY KEY,
    session_id INTEGER REFERENCES sessions (id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    rule TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    said TEXT NOT NULL,
    correct TEXT NOT NULL DEFAULT '[]',     -- JSON array of correct versions
    severity INTEGER NOT NULL DEFAULT 2,    -- 1 minor, 2 clear, 3 serious (meaning or very basic)
    shown INTEGER NOT NULL DEFAULT 0,       -- picked for the post-talk top N
    added_to_cards INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX mistakes_rule ON mistakes (rule);

  -- Articles read (News), for the to-do list and streak.
  CREATE TABLE reads (
    article_id TEXT NOT NULL,
    read_at TEXT NOT NULL DEFAULT (datetime('now')),
    score INTEGER,
    PRIMARY KEY (article_id, read_at)
  );

  -- Every paid API call, so spend stays visible.
  CREATE TABLE api_usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    purpose TEXT NOT NULL,                  -- evaluator | card-engine | live | ...
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    seconds REAL NOT NULL DEFAULT 0,        -- for per-minute models (gpt-live-1)
    cost_usd REAL NOT NULL DEFAULT 0
  );
  `,
  `
  -- News: the day's generated reading articles (3 per local day). id is what reads.article_id points to.
  CREATE TABLE news_articles (
    id TEXT PRIMARY KEY,                    -- "YYYY-MM-DD-slug"
    date TEXT NOT NULL,                     -- local day, YYYY-MM-DD
    topic TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,                     -- JSON array of paragraphs
    questions TEXT NOT NULL,                -- JSON array of { q, options, answer }
    source_title TEXT NOT NULL,
    source_url TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'B2-C1',
    minutes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX news_articles_date ON news_articles (date);
  `,
  `
  -- App settings as JSON values, e.g. news.topics = ["ai", "tech", ...] (see server/lib/news-repo.ts).
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
for (let v = version; v < MIGRATIONS.length; v++) {
  db.exec("BEGIN");
  db.exec(MIGRATIONS[v]);
  db.exec(`PRAGMA user_version = ${v + 1}`);
  db.exec("COMMIT");
}

// Dates are stored as SQLite "YYYY-MM-DD HH:MM:SS" UTC strings; days are bucketed in local time by callers.
export const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
