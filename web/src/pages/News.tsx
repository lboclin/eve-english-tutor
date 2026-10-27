import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../data/api";
import { useEve } from "../data/store";
import { navigate } from "../router";

// Editions come from the server (server/lib/news-repo.ts): every day at 7:00 Eve publishes at most 5 articles
// about the most important stories of the last 24 h, on the topics picked in the settings. Before 7:00 the
// current edition is still yesterday's. Reads and scores go through actions.markRead → POST /api/reads.
export interface Article {
  id: string;
  date: string; // edition, local YYYY-MM-DD
  topic: string;
  title: string;
  body: string[];
  questions: { q: string; options: string[]; answer: number }[];
  sourceTitle: string;
  sourceUrl: string;
  level: string; // "B2-C1"
  minutes: number;
  read: boolean; // ever read (the Today to-do uses today's reads from the store)
}
interface Edition { date: string; articles: Article[] }
interface Settings { topics: { id: string; label: string; selected: boolean }[]; editionHour: number; maxArticles: number }

const EDITION_HOUR = 7; // mirrors server/lib/news-repo.ts
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function currentEdition(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < EDITION_HOUR) d.setDate(d.getDate() - 1);
  return day(d);
}

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

// One fetch per edition, shared by Home and News (the first one of an edition may take ~30 s while Eve
// writes it). Pages poll the clock, so an open tab moves to the new edition at 7:00 without a reload.
let cache: { edition: string; editions: Edition[] } | null = null;
let inflight: Promise<Edition[]> | null = null;

function fetchEditions(force = false): Promise<Edition[]> {
  const edition = currentEdition();
  if (!force && cache?.edition === edition) return Promise.resolve(cache.editions);
  inflight ??= api<{ current: string; editions: Edition[] }>("/news")
    .then((r) => {
      cache = { edition, editions: r.editions };
      return r.editions;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

function useEditions() {
  const [state, setState] = useState<Load<Edition[]>>(() => (cache?.edition === currentEdition() ? { status: "ready", data: cache.editions } : { status: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const [edition, setEdition] = useState(currentEdition);
  useEffect(() => {
    const t = setInterval(() => setEdition(currentEdition()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let live = true;
    if (cache?.edition !== edition) setState({ status: "loading" });
    fetchEditions().then(
      (data) => live && setState({ status: "ready", data }),
      (e: Error) => live && setState({ status: "error", error: e.message }),
    );
    return () => { live = false; };
  }, [attempt, edition]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}

// The current edition only (the Today page).
export function useTodaysNews() {
  const e = useEditions();
  return e.status === "ready" ? { status: "ready" as const, articles: e.data[0]?.articles ?? [], retry: e.retry } : e;
}

const levelLabel = (level: string) => level.replace("-", "→");

// Short one-line labels; new articles already carry them, older ones (before the topic settings) had long names.
const SHORT_TOPIC: Record<string, string> = {
  "ai and software engineering": "AI & software",
  "technology industry": "Tech",
  "world news": "World",
};
export const topicLabel = (topic: string) => SHORT_TOPIC[topic.toLowerCase()] ?? topic;

// fixed = same width in lists, so the titles line up.
export function Chip({ topic, fixed }: { topic: string; fixed?: boolean }) {
  return <span className={`chip topic${fixed ? " fixed" : ""}`} title={topic}>{topicLabel(topic)}</span>;
}

function Centered({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="stack" style={{ alignItems: "center", gap: 16, paddingTop: 60 }}>
      <section className="panel fade-in" style={{ width: "min(560px, 100%)", textAlign: "center", padding: 32 }}>
        <h2 style={{ justifyContent: "center" }}>{title}</h2>
        {children}
      </section>
    </div>
  );
}

// "Today", "Yesterday", then the weekday — relative to the current edition.
function editionLabel(date: string, current: string) {
  const d = new Date(`${date}T12:00:00`);
  const diff = Math.round((new Date(`${current}T12:00:00`).getTime() - d.getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "long" });
}

export function News() {
  const { state } = useEve();
  const news = useEditions();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = currentEdition();
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row">
        <h1>News</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>⚙️ Topics</button>
      </div>
      {settingsOpen && <TopicSettings onClose={() => setSettingsOpen(false)} />}
      {news.status === "loading" ? (
        <Centered title="Eve is picking today's news…">
          <p className="muted">She's choosing the most important stories of the last 24 hours and writing them at your level. This takes about half a minute.</p>
        </Centered>
      ) : news.status === "error" ? (
        <Centered title="Couldn't fetch today's news">
          <p className="muted">{news.error}</p>
          <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
            <button className="btn news" onClick={news.retry}>Try again</button>
          </div>
        </Centered>
      ) : (
        news.data.map((e) => (
          <section key={e.date} className="stack" style={{ gap: 12 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>
              {editionLabel(e.date, current)}
            </h2>
            {e.articles.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>No articles in this edition.</p>
            ) : (
              <div className="grid">
                {e.articles.map((a, k) => {
                  const read = a.read || state.readIds.includes(a.id);
                  return (
                    <section key={a.id} className="panel span-4" style={{ borderTop: "6px solid var(--news)", cursor: "pointer", opacity: read ? 0.7 : 1 }} onClick={() => navigate(`/news/${a.id}`)}>
                      <div className="row" style={{ marginBottom: 10 }}>
                        <span className="small" style={{ fontWeight: 800, color: "var(--news-ink)" }}>#{k + 1}</span>
                        <Chip topic={a.topic} />
                        <span className="small muted">{a.minutes} min · {levelLabel(a.level)}</span>
                        <div className="spacer" />
                        {read && <span className="small" style={{ color: "var(--streak-ink)" }}>✓ read</span>}
                      </div>
                      <h2 style={{ fontSize: 19 }}>{a.title}</h2>
                      <p className="small muted" style={{ margin: 0 }}>{a.body[0].slice(0, 110)}…</p>
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}

// The topics Eve watches. Saved on the server; used from the next edition (7:00).
function TopicSettings({ onClose }: { onClose: () => void }) {
  const { actions } = useEve();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Settings>("/news/settings").then(
      (s) => {
        setSettings(s);
        setPicked(new Set(s.topics.filter((t) => t.selected).map((t) => t.id)));
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api("/news/settings", { body: { topics: [...picked] } });
      actions.notify("Topics saved. They'll shape tomorrow's 7:00 edition.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel fade-in">
      <h2 style={{ marginTop: 0 }}>Topics</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Every day at {settings?.editionHour ?? EDITION_HOUR}:00 Eve picks the {settings?.maxArticles ?? 5} most important stories of the last 24 hours from these topics. Changes apply from the next edition.
      </p>
      {!settings ? (
        <p className="small muted">{error ?? "Loading…"}</p>
      ) : (
        <>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {settings.topics.map((t) => (
              <button
                key={t.id}
                className="chip topic"
                aria-pressed={picked.has(t.id)}
                onClick={() => toggle(t.id)}
                style={{ cursor: "pointer", border: 0, padding: "8px 16px", opacity: picked.has(t.id) ? 1 : 0.45 }}
              >
                {picked.has(t.id) ? "✓ " : ""}{t.label}
              </button>
            ))}
          </div>
          {error && <p className="small" role="alert" style={{ color: "var(--mistake-ink)" }}>{error}</p>}
          <div className="row" style={{ marginTop: 16, gap: 10 }}>
            <button className="btn news" disabled={saving || picked.size === 0} onClick={save}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn" onClick={onClose}>Cancel</button>
            {picked.size === 0 && <span className="small muted">Pick at least one topic.</span>}
          </div>
        </>
      )}
    </section>
  );
}

export function ArticlePage({ id }: { id: string }) {
  const cached = () => cache?.editions.flatMap((e) => e.articles).find((a) => a.id === id);
  const [article, setArticle] = useState<Article | null>(() => cached() ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const hit = cached();
    if (hit) {
      setArticle(hit);
      return;
    }
    let live = true;
    setArticle(null);
    setError(null);
    api<Article>(`/news/${encodeURIComponent(id)}`).then(
      (a) => live && setArticle(a),
      (e: Error) => live && setError(e.message),
    );
    return () => { live = false; };
  }, [id, attempt]);

  if (error) {
    return (
      <Centered title="The article didn't load">
        <p className="muted">{error}</p>
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
          <button className="btn" onClick={() => navigate("/news")}>All news</button>
          <button className="btn news" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      </Centered>
    );
  }
  if (!article) return <p className="muted" style={{ textAlign: "center", marginTop: 60 }}>Loading the article…</p>;
  // Keyed so the answers reset when moving to another article.
  return <ArticleView key={article.id} article={article} />;
}

function ArticleView({ article }: { article: Article }) {
  const { actions } = useEve();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const score = article.questions.filter((q, k) => answers[k] === q.answer).length;

  function check() {
    setChecked(true);
    actions.markRead(article.id, score).catch((e: Error) => actions.notify(`Couldn't save the read: ${e.message}`));
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720, margin: "0 auto" }}>
      <div className="row">
        <button className="btn round" onClick={() => navigate("/news")} aria-label="Back">←</button>
        <Chip topic={article.topic} />
        <span className="small muted">{article.minutes} min read</span>
      </div>
      <h1 style={{ fontSize: 32 }}>{article.title}</h1>
      <section className="panel" style={{ fontSize: 18, lineHeight: 1.7 }}>
        {article.body.map((p, k) => <p key={k} style={{ marginTop: k ? undefined : 0 }}>{p}</p>)}
        <p className="small muted" style={{ marginBottom: 0, lineHeight: 1.4 }}>
          Based on: <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>{article.sourceTitle}</a>
        </p>
      </section>

      <section className="panel">
        <h2>Check your understanding</h2>
        <div className="stack" style={{ gap: 18 }}>
          {article.questions.map((q, k) => (
            <div key={k} className="stack" style={{ gap: 8 }}>
              <b>{k + 1}. {q.q}</b>
              {q.options.map((o, j) => {
                const picked = answers[k] === j;
                const bg = checked && j === q.answer ? "var(--good-soft)" : checked && picked ? "var(--bad-soft)" : picked ? "var(--news)" : "var(--surface-soft)";
                return (
                  <button key={j} className="todo" style={{ background: bg }} disabled={checked} onClick={() => setAnswers({ ...answers, [k]: j })}>
                    <span className="check" style={picked ? { borderColor: "var(--news-ink)" } : undefined}>{picked && <span className="pick" />}</span>
                    {o}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          {!checked ? (
            <button className="btn news big" disabled={Object.keys(answers).length < article.questions.length} onClick={check}>Check answers</button>
          ) : (
            <>
              <b>{score} / {article.questions.length} correct {score === article.questions.length ? "🎉" : ""}</b>
              <div className="spacer" />
              <button className="btn streak" onClick={() => navigate("/")}>Back to Today</button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
