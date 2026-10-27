import { useEffect, useState } from "react";
import { CATEGORIES, type Category } from "../data/categories";
import { api } from "../data/api";
import { useEve } from "../data/store";
import { navigate } from "../router";
import { talkMode } from "../data/talk";

// Post-talk review (server/routes/review.ts): the evaluator's top mistakes, + → flashcards, summary, transcript.
interface ReviewMistake {
  id: number;
  category: Category;
  rule: string;
  title: string;
  description: string;
  said: string;
  correct: string[];
  severity: number;
  timesBefore: number;
  addedToCards: boolean;
  cards: number;
}
interface Review {
  session: { id: number; mode: string; seconds: number; started_at: string; status: string };
  transcript: { who: "you" | "eve"; text: string }[];
  mistakes: ReviewMistake[];
  stats: { found: number; shown: number; repeats: number; cardsAdded: number };
}

type Phase = "loading" | "reviewing" | "ready" | "error";

export function TalkReview({ sessionId }: { sessionId?: number }) {
  const { actions, tutorName } = useEve();
  const [i, setI] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [phase, setPhase] = useState<Phase>(sessionId ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    (async () => {
      try {
        setPhase("loading");
        let r = await api<Review>(`/review/${sessionId}`);
        if (r.session.status !== "evaluated" && r.transcript.length) {
          if (!live) return;
          setPhase("reviewing");
          await api(`/review/${sessionId}/evaluate`, { method: "POST" });
          r = await api<Review>(`/review/${sessionId}`);
        }
        if (!live) return;
        setReview(r);
        setI(0);
        setPhase("ready");
      } catch (e) {
        if (!live) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId, attempt]);

  function conclude() {
    actions.notify("Nice talk! See you tomorrow 👋");
    navigate("/");
  }

  if (phase === "loading" || phase === "reviewing") {
    return (
      <div className="stack" style={{ alignItems: "center", gap: 16, paddingTop: 60 }}>
        <section className="panel fade-in" style={{ width: "min(560px, 100%)", textAlign: "center", padding: 32 }}>
          <h2 style={{ justifyContent: "center" }}>{phase === "reviewing" ? "Eve is reviewing your talk…" : "Loading your review…"}</h2>
          {phase === "reviewing" && <p className="muted">She's reading the transcript and picking the mistakes worth your time. This takes about a minute.</p>}
        </section>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="stack" style={{ alignItems: "center", gap: 16, paddingTop: 60 }}>
        <section className="panel fade-in" style={{ width: "min(560px, 100%)", textAlign: "center", padding: 32 }}>
          <h2 style={{ justifyContent: "center" }}>The review didn't load</h2>
          <p className="muted">{error}</p>
          <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
            <button className="btn" onClick={() => navigate("/")}>Home</button>
            <button className="btn cards" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </div>
        </section>
      </div>
    );
  }

  const mistakes = review?.mistakes ?? [];
  const transcript = review?.transcript ?? [];
  const recorded = transcript.some((t) => t.who === "you");
  const atSummary = i >= mistakes.length;
  const minutes = Math.max(1, Math.round((review?.session.seconds ?? 0) / 60));
  const title = review ? talkMode(review.session.mode).title : "Talk";

  if (!review || !recorded) {
    return (
      <div className="stack" style={{ alignItems: "center", gap: 16, paddingTop: 60 }}>
        <section className="panel fade-in" style={{ width: "min(560px, 100%)", textAlign: "center", padding: 32 }}>
          <h2 style={{ justifyContent: "center" }}>Nothing was recorded</h2>
          <p className="muted">Eve has no transcript of you speaking in this talk, so there's nothing to review.</p>
          <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
            <button className="btn streak big" onClick={() => navigate("/")}>Back home</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack" style={{ alignItems: "center", gap: 20 }}>
      <div className="row" style={{ width: "100%" }}>
        <h1>{title} · review</h1>
      </div>

      {/* progress dots: one per mistake + the summary */}
      {mistakes.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {[...mistakes, null].map((_, k) => (
            <span key={k} className="dot" onClick={() => setI(k)} style={{ cursor: "pointer", width: k === i ? 26 : 10, borderRadius: 99,
              background: k === i ? "var(--mistake-ink)" : k < i ? "var(--mistake)" : "var(--line)", transition: "width .2s" }} />
          ))}
        </div>
      )}

      {!atSummary ? mistakeCard(i) : (
        <section className="panel fade-in" style={{ width: "min(640px, 100%)" }}>
          <h2>{mistakes.length ? "Talk summary" : "No mistakes found — nice! 🎉"}</h2>
          <div className="grid" style={{ gap: 12, marginBottom: 16 }}>
            {[
              ["Duration", `${minutes} min`],
              ["Mistakes found", `${review.stats.found}`],
              ["Shown to you", `${review.stats.shown}${review.stats.shown ? " (top)" : ""}`],
              ["Repeats", `${review.stats.repeats}${review.stats.repeats ? " ⚠" : ""}`],
              ["Cards added", `${review.stats.cardsAdded}`],
            ].map(([k, v]) => (
              <div key={k} className="span-4" style={{ background: "var(--surface-soft)", borderRadius: 12, padding: "10px 14px" }}>
                <div className="small muted">{k}</div>
                <b style={{ fontSize: 20 }}>{v}</b>
              </div>
            ))}
          </div>
          <button className="btn ghost" onClick={() => setShowTranscript((s) => !s)}>{showTranscript ? "▾ Hide transcript" : "▸ See transcript"}</button>
          {showTranscript && (
            <div className="stack fade-in" style={{ gap: 8, marginTop: 10, maxHeight: "42vh", overflowY: "auto", paddingRight: 6 }}>
              {transcript.map((t, k) => (
                <div key={k} style={{ alignSelf: t.who === "you" ? "flex-end" : "flex-start", maxWidth: "85%", padding: "8px 12px", borderRadius: 12,
                  background: t.who === "you" ? "var(--bad-soft)" : "var(--talk-soft)" }}>
                  <div className="small muted"><b>{t.who === "you" ? "You" : tutorName}</b></div>
                  {t.text}
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 20 }}>
            {mistakes.length > 0 && <button className="btn" onClick={() => setI(i - 1)}>‹ Back to mistakes</button>}
            <div className="spacer" />
            <button className="btn streak big" onClick={conclude}>Conclude</button>
          </div>
        </section>
      )}

      {!atSummary && (
        <div className="row" style={{ gap: 18 }}>
          <button className="btn round" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous">‹</button>
          {addButton(i)}
          <button className="btn round" onClick={() => setI(i + 1)} aria-label="Next">›</button>
        </div>
      )}
    </div>
  );

  function mistakeCard(index: number) {
    const m = mistakes[index];
    const cat = CATEGORIES.find((c) => c.id === m.category) ?? CATEGORIES[3];
    return (
      <section key={index} className="panel fade-in" style={{ width: "min(560px, 100%)", textAlign: "center", padding: 32 }}>
        <div className="small muted">Mistake {index + 1} of {mistakes.length}</div>
        <h2 style={{ justifyContent: "center", fontSize: 22, margin: "8px 0 4px" }}>{m.title}</h2>
        <div className="row" style={{ justifyContent: "center", marginBottom: 14 }}>
          <span className="chip" style={{ background: `var(--cat-${m.category})` }}>{cat.emoji} {cat.name}</span>
          {m.timesBefore > 0 && <span className="chip" style={{ background: "var(--mistake)", color: "var(--mistake-ink)" }}>⚠ {ordinal(m.timesBefore + 1)} time</span>}
        </div>
        <p className="muted">{emphasis(m.description)}</p>
        <div style={{ background: "var(--bad-soft)", borderRadius: 12, padding: 14, margin: "14px 0" }}>
          <div className="small muted">You said</div>
          <div style={{ fontSize: 18 }}>{m.said}</div>
        </div>
        <div style={{ background: "var(--good-soft)", borderRadius: 12, padding: 14 }}>
          <div className="small muted">Say instead</div>
          {m.correct.map((c) => <div key={c} style={{ fontSize: 18, fontWeight: 700, color: "var(--streak-ink)" }}>{c}</div>)}
        </div>
      </section>
    );
  }

  function addButton(index: number) {
    const m = mistakes[index];
    const busy = adding === m.id;
    return (
      <button className={`btn ${m.addedToCards ? "streak" : "cards"}`} style={{ height: 46, padding: "0 22px" }} disabled={m.addedToCards || adding !== null}
        onClick={() => addCards(m)}>
        {m.addedToCards ? `✓ Added${m.cards ? ` (${m.cards})` : ""}` : busy ? "Eve is writing…" : "+ Flashcards"}
      </button>
    );
  }

  async function addCards(m: ReviewMistake) {
    setAdding(m.id);
    try {
      const r = await api<{ added: number; category: Category; already?: boolean }>(`/review/mistakes/${m.id}/cards`, { method: "POST" });
      const deck = CATEGORIES.find((c) => c.id === r.category)?.name ?? r.category;
      actions.notify(r.already ? "Already in your cards" : `+${r.added} card${r.added === 1 ? "" : "s"} in ${deck}`);
      setReview((rv) =>
        rv && {
          ...rv,
          mistakes: rv.mistakes.map((x) => (x.id === m.id ? { ...x, addedToCards: true, cards: x.cards + r.added } : x)),
          stats: { ...rv.stats, cardsAdded: rv.stats.cardsAdded + r.added },
        },
      );
      void actions.refresh();
    } catch (e) {
      actions.notify(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(null);
    }
  }
}

function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

// "*word*" → <em>word</em> (mistake descriptions use it for the key word).
function emphasis(text: string) {
  return text.split(/\*([^*]+)\*/).map((part, k) => (k % 2 ? <em key={k} style={{ color: "var(--ink)" }}>{part}</em> : part));
}
