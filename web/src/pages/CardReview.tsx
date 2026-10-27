import { useEffect, useRef, useState } from "react";
import { api } from "../data/api";
import { CATEGORIES, type Category } from "../data/categories";
import { useEve } from "../data/store";
import { navigate } from "../router";
import { CardHtml, sanitizeHtml } from "../components/Widgets";

interface Preview { again: string; hard: string; good: string; easy: string }
interface QueueCard { id: number; category: Category; front: string; back: string; isNew: boolean; preview: Preview }

// FSRS's next interval for each answer comes from the server with every card (`preview`).
const GRADES: { label: string; rating: 1 | 2 | 3 | 4; key: keyof Preview; color: string }[] = [
  { label: "Again", rating: 1, key: "again", color: "var(--mistake)" },
  { label: "Hard", rating: 2, key: "hard", color: "var(--news)" },
  { label: "Good", rating: 3, key: "good", color: "var(--streak)" },
  { label: "Easy", rating: 4, key: "easy", color: "var(--talk)" },
];

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

// One editable side: the card as it looks, typed into directly (⌘B / ⌘I for bold / italic). The server turns the
// browser's markup back into the card allowlist.
function EditableSide({ label, html, onChange }: { label: string; html: string; onChange: (html: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (el.current) el.current.innerHTML = sanitizeHtml(html.replace(/\n/g, "<br>"));
    // Set once: re-rendering the box while typing would move the caret.
  }, []);
  return (
    <div className="stack" style={{ gap: 6, width: "100%" }}>
      <span className="small muted" style={{ textAlign: "left" }}>{label}</span>
      <div ref={el} className="card-edit" contentEditable suppressContentEditableWarning role="textbox" aria-label={label}
        onInput={(e) => onChange(e.currentTarget.innerHTML)} />
    </div>
  );
}

export function CardReview({ deck }: { deck: string }) {
  const { state, actions } = useEve();
  const cat = CATEGORIES.find((c) => c.id === deck);
  // The queue is fetched on entry (due first, then new) and again when it runs out, so cards still in
  // their learning steps come back in the same session, as in Anki.
  const [queue, setQueue] = useState<QueueCard[] | null>(null);
  const [i, setI] = useState(0);
  const [done, setDone] = useState(0); // answers given this session
  // A card counts as finished only once it won't come back today; "Again" (or a short learning step) keeps it
  // pending, so the counter doesn't move.
  const [finished, setFinished] = useState(0);
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState<{ front: string; back: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ cards: QueueCard[] }>(`/cards/queue?deck=${encodeURIComponent(cat ? cat.id : "all")}`).then((r) => {
      setQueue(r.cards);
      setI(0);
    });

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
    // Fetched once per deck: grading mustn't rebuild the queue mid-review.
  }, [deck]);

  if (error) {
    return (
      <div className="stack" style={{ alignItems: "center", gap: 16, marginTop: 60 }}>
        <h1>Couldn't load the cards</h1>
        <p className="muted">{error}</p>
        <button className="btn" onClick={() => navigate("/cards")}>Back to cards</button>
      </div>
    );
  }
  if (!queue) return <p className="muted" style={{ textAlign: "center", marginTop: 60 }}>Loading cards…</p>;

  const card = queue[i];
  if (!card) {
    const empty = state.loaded && state.totalCards === 0;
    return (
      <div className="stack" style={{ alignItems: "center", gap: 16, marginTop: 60 }}>
        <div style={{ fontSize: 54 }}>{empty ? "🗂️" : "🎉"}</div>
        <h1>{done ? "Done for now!" : empty ? "No cards yet" : "Nothing to review"}</h1>
        <p className="muted">
          {done ? `You finished ${finished} card${finished === 1 ? "" : "s"}.${pending.size ? ` ${pending.size} will come back later today.` : ""}`
            : empty ? "Import your Anki deck or add cards to start."
            : "No cards are due in this deck."}
        </p>
        <div className="row">
          {empty ? (
            <>
              <button className="btn" onClick={() => navigate("/cards/import")}>Import from Anki</button>
              <button className="btn cards" onClick={() => navigate("/cards/add")}>+ Add cards</button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => navigate("/cards")}>Back to cards</button>
              <button className="btn streak" onClick={() => navigate("/")}>Today</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const c = CATEGORIES.find((x) => x.id === card.category)!;
  async function saveEdit() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const saved = await api<{ front: string; back: string }>(`/cards/${card.id}`, { method: "PATCH", body: editing });
      setQueue((q) => q && q.map((x) => (x.id === card.id ? { ...x, ...saved } : x)));
      setEditing(null);
      actions.notify("Card saved.");
    } catch (e) {
      actions.notify(`Couldn't save the card: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }
  async function grade(rating: 1 | 2 | 3 | 4) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ card: { due: string } }>(`/cards/${card.id}/review`, { body: { rating } });
      const nextDue = new Date(res.card.due.replace(" ", "T") + "Z");
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      const out = nextDue >= tomorrow;
      if (out) setFinished((n) => n + 1);
      setPending((p) => {
        const next = new Set(p);
        if (out) next.delete(card.id);
        else next.add(card.id);
        return next;
      });
      setDone((n) => n + 1);
      setShown(false);
      setEditing(null);
      if (i + 1 < queue!.length) setI(i + 1);
      else await load(); // learning cards that are due again, or an empty queue → done screen
      void actions.refresh();
    } catch (e) {
      actions.notify(`Couldn't save that answer: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  const left = new Set([...queue.slice(i).map((q) => q.id), ...pending]);
  const total = finished + left.size;
  return (
    <div className="stack" style={{ alignItems: "center", gap: 18 }}>
      <div className="row" style={{ width: "100%" }}>
        <button className="btn round" onClick={() => navigate("/cards")} aria-label="Back">←</button>
        <h1 style={{ fontSize: 22 }}>{cat ? `${cat.emoji} ${cat.name}` : "All decks"}</h1>
        <div className="spacer" />
        <span className="small muted">{Math.min(finished + 1, total)} / {total}</span>
      </div>
      <div className="bar" style={{ width: "100%" }}>
        <div style={{ width: `${(finished / total) * 100}%`, background: "var(--cards)" }} />
      </div>

      <section className="panel flash fade-in" key={`${card.id}-${done}`} style={{ position: "relative", width: "min(640px, 100%)", borderTop: `6px solid var(--cat-${card.category})` }}>
        {shown && !editing && (
          <button className="btn ghost round card-pencil" onClick={() => setEditing({ front: card.front, back: card.back })} aria-label="Edit card" title="Edit card">
            <PencilIcon />
          </button>
        )}
        {editing ? (
          <div className="stack" style={{ gap: 14, width: "100%" }}>
            <EditableSide label="Front" html={card.front} onChange={(front) => setEditing((e) => e && { ...e, front })} />
            <EditableSide label="Back" html={card.back} onChange={(back) => setEditing((e) => e && { ...e, back })} />
            <div className="row" style={{ gap: 10, justifyContent: "center" }}>
              <button className="btn cards" disabled={busy} onClick={saveEdit}>{busy ? "Saving…" : "Save"}</button>
              <button className="btn" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        ) : <div>
          <div className="row" style={{ justifyContent: "center", marginBottom: 14 }}>
            <span className="chip" style={{ background: `var(--cat-${card.category})` }}>{c.emoji} {c.name}</span>
            {card.isNew && <span className="chip" style={{ background: "var(--talk)", color: "var(--talk-ink)" }}>new</span>}
          </div>
          <CardHtml html={card.front} />
          {shown && <CardHtml className="back fade-in" html={card.back} />}
        </div>}
      </section>

      {editing ? null : !shown ? (
        <button className="btn cards big" onClick={() => setShown(true)}>Show answer</button>
      ) : (
        <div className="row grades" style={{ gap: 10 }}>
          {GRADES.map((g) => (
            <button key={g.label} className="btn big" style={{ background: g.color, minWidth: 110 }} disabled={busy} onClick={() => grade(g.rating)}>
              <div>{g.label}</div>
              <div className="small" style={{ fontWeight: 600, opacity: 0.7 }}>{card.preview[g.key]}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
