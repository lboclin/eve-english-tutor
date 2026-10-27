import { useLayoutEffect, useRef, useState } from "react";
import { useEve } from "../data/store";
import { TALK_MODES, todaysTalk } from "../data/talk";
import { navigate } from "../router";
import { DeckMix, Flame, StreakCalendar } from "../components/Widgets";
import { Chip, useTodaysNews } from "./News";

// Today's news shows this many rows; the rest scroll inside the card, so the News and Streak cards stay level.
const NEWS_VISIBLE = 3;

// Max height for a list so that only its first `rows` children show (they wrap, so it's measured).
function useRowsHeight(rows: number, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const last = el.children[rows - 1] as HTMLElement | undefined;
      setMax(el.children.length > rows && last ? last.offsetTop + last.offsetHeight : undefined);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, deps);
  return { ref, max };
}

export function Home() {
  const { state, due, newCount, days, streak, longest, tasks, interviewDays } = useEve();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  // Today's article: the one already read today, else the first unread (none until the day's set loads).
  const news = useTodaysNews();
  const articles = news.status === "ready" ? news.articles : [];
  const newsList = useRowsHeight(NEWS_VISIBLE, [articles.length, news.status]);
  const article = articles.find((a) => state.readIds.includes(a.id)) ?? articles.find((a) => !state.readIds.includes(a.id)) ?? articles[0];
  const talk = todaysTalk(interviewDays);
  const otherTalks = TALK_MODES.filter((m) => m.id !== talk.id);

  const noCards = state.loaded && state.totalCards === 0;

  // The day's plan; each item ticks itself off when its activity is done. Same rules as the streak
  // (server/routes/today.ts): talk ≥ 1 min; cards = reviewed today and nothing left due; an article read.
  const cardsLabel = tasks.cards ? "Cards reviewed"
    : due > 0 ? `Review ${due} due card${due === 1 ? "" : "s"}`
    : newCount > 0 ? `Learn ${newCount} new card${newCount === 1 ? "" : "s"}`
    : noCards ? "Add your first cards" : "No cards due today";
  const todos = [
    { label: `${talk.title} with Eve · ${talk.goalMin} min`, done: tasks.talk, to: `/talk/${talk.id}`, color: "var(--talk)" },
    { label: cardsLabel, done: tasks.cards, to: noCards ? "/cards" : "/cards/review/all", color: "var(--cards)" },
    { label: article ? `Read: ${article.title}` : "Read today's news", done: tasks.read, to: article ? `/news/${article.id}` : "/news", color: "var(--news)" },
  ];
  const doneCount = todos.filter((t) => t.done).length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 32 }}>{greeting}, Lucas</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>{date} · {doneCount === todos.length ? "All done for today 🎉" : `${doneCount} of ${todos.length} done today`}</p>
      </div>

      <div className="grid">
        <section className="panel span-4">
          <h2>To-do today</h2>
          <div className="stack" style={{ gap: 8 }}>
            {todos.map((t) => (
              <button key={t.label} className={`todo ${t.done ? "done" : ""}`} onClick={() => navigate(t.to)}>
                <span className="check" style={t.done ? undefined : { borderColor: t.color }}>{t.done ? "✓" : ""}</span>
                <span className="label">{t.label}</span>
              </button>
            ))}
          </div>
          {/* One segment per task, in the task's color once done — reads as "2 of 3" even when nothing is done. */}
          <div className="row small" style={{ marginTop: 16, gap: 10 }}>
            <div style={{ display: "flex", gap: 6, flex: 1 }}>
              {todos.map((t) => (
                <div key={t.label} style={{ flex: 1, height: 10, borderRadius: 99, transition: "background .3s",
                  background: t.done ? t.color : "transparent", border: `2px solid ${t.done ? t.color : "var(--line)"}` }} />
              ))}
            </div>
            <b className="muted">{doneCount}/{todos.length}</b>
          </div>
        </section>

        <section className="panel span-4" style={{ background: "linear-gradient(160deg, var(--surface) 40%, var(--talk-soft))" }}>
          <h2><span className="dot" style={{ background: "var(--talk)" }} />Talking</h2>
          <span className="small muted">Today's talk</span>
          <button className="btn talk big" style={{ width: "100%", margin: "6px 0 16px" }} onClick={() => navigate(`/talk/${talk.id}`)}>
            {talk.title} · {talk.goalMin} min
          </button>
          <span className="small muted">Other talks</span>
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            {otherTalks.map((m) => (
              <button key={m.id} className="btn" style={{ background: "var(--talk-soft)", color: "var(--talk-ink)" }} onClick={() => navigate(`/talk/${m.id}`)}>
                {m.title}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {state.talkedMinutes > 0 ? `${state.talkedMinutes} min talked today` : "You haven't talked today yet."}
          </p>
        </section>

        <section className="panel span-4" style={{ background: "linear-gradient(160deg, var(--surface) 40%, var(--cards-soft))" }}>
          <h2><span className="dot" style={{ background: "var(--cards)" }} />Flashcards</h2>
          <div className="row deck-start" style={{ marginBottom: 14 }}>
            <button className="btn cards big" disabled={due + newCount === 0} onClick={() => navigate("/cards/review/all")}>Start</button>
            <span className="small"><b style={{ color: "var(--talk-ink)" }}>new: {newCount}</b> · <b style={{ color: "var(--streak-ink)" }}>due: {due}</b></span>
          </div>
          <DeckMix decks={state.decks} showLegend />
          {noCards ? (
            <p className="small muted" style={{ marginBottom: 0 }}>
              No cards yet. <a href="/cards/import" onClick={(e) => { e.preventDefault(); navigate("/cards/import"); }}>Import from Anki</a> or{" "}
              <a href="/cards/add" onClick={(e) => { e.preventDefault(); navigate("/cards/add"); }}>add cards</a> to start.
            </p>
          ) : due + newCount === 0 && state.loaded ? (
            <p className="small muted" style={{ marginBottom: 0 }}>Nothing due right now. 🎉</p>
          ) : null}
        </section>

        <section className="panel span-6">
          <h2><span className="dot" style={{ background: "var(--news)" }} />News for you</h2>
          {news.status === "loading" ? (
            <p className="small muted" style={{ margin: 0 }}>Eve is picking today's news…</p>
          ) : news.status === "error" ? (
            <div className="row" style={{ gap: 10 }}>
              <span className="small muted">Couldn't fetch today's news.</span>
              <button className="btn news" onClick={news.retry}>Try again</button>
            </div>
          ) : articles.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>No articles today.</p>
          ) : (
            <div ref={newsList.ref} className="stack news-list" style={{ gap: 8, maxHeight: newsList.max }}>
              {articles.map((a) => (
                <button key={a.id} className={`todo news-item ${state.readIds.includes(a.id) ? "done" : ""}`} onClick={() => navigate(`/news/${a.id}`)}>
                  <Chip topic={a.topic} fixed />
                  <span className="label">{a.title}</span>
                  <span className="small muted minutes">{a.minutes} min</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel span-6 streak-card">
          <div className="row" style={{ marginBottom: 12, gap: 8 }}>
            <Flame size={30} />
            <h2 style={{ fontSize: 20, margin: 0 }}>{streak} day streak</h2>
            <span className="spacer" />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", color: "var(--ink-soft)" }}>
              LONGEST STREAK | {longest} DAY{longest === 1 ? "" : "S"}
            </span>
          </div>
          <StreakCalendar days={days} />
        </section>
      </div>
    </div>
  );
}
