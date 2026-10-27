import { useState } from "react";
import { CATEGORIES, type Category } from "../data/categories";
import { api } from "../data/api";
import { useEve } from "../data/store";
import { CardHtml } from "../components/Widgets";
import { navigate } from "../router";

// Card engine drafts (server/llm/engine.ts): anki-add's card designs, written by Eve.
interface Draft { category: Category; front: string; back: string; eventKey?: string; tags: string[] }
interface DraftItem { input: string; kind: string; category: Category; slug: string; drafts: Draft[]; warning?: string }

export function AddCards() {
  const { actions } = useEve();
  const [input, setInput] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drafts = items.flatMap((it) => it.drafts);

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const r = await api<{ items: DraftItem[] }>("/engine/draft", { body: { text: input } });
      setItems(r.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // Removing one card of a fix/phrasal event is allowed: Lucas decides what he studies.
  function remove(item: number, card: number) {
    setItems((its) => its.map((it, k) => (k === item ? { ...it, drafts: it.drafts.filter((_, n) => n !== card) } : it)).filter((it) => it.drafts.length));
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const r = await api<{ inserted: number; duplicates: number }>("/engine/save", { body: { drafts } });
      actions.notify(`+${r.inserted} cards added${r.duplicates ? ` · ${r.duplicates} already there` : ""}`);
      await actions.refresh();
      navigate("/cards");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 760, margin: "0 auto" }}>
      <div className="row">
        <button className="btn round" onClick={() => navigate("/cards")} aria-label="Back">←</button>
        <h1>Add cards</h1>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        One item per line: a word, a collocation, a phrasal verb, a correction like <i>I were → I was</i>, or a word you mispronounce.
        Eve picks the deck. Force it with <code>word:</code> <code>col:</code> <code>pv:</code> <code>fix:</code> <code>pron:</code>.
      </p>
      <textarea className="input" value={input} onChange={(e) => setInput(e.target.value)}
        placeholder={"cumbersome\nraise concerns about\npull off\nI'm agree → I agree\npron: comfortable"} />
      <div className="row">
        <button className="btn cards big" disabled={!input.trim() || busy !== null} onClick={generate}>
          {busy === "generate" ? "Eve is writing…" : "Generate"}
        </button>
        {drafts.length > 0 && (
          <button className="btn streak big" disabled={busy !== null} onClick={save}>
            {busy === "save" ? "Adding…" : `Add ${drafts.length} cards`}
          </button>
        )}
      </div>
      {error && <p className="small" style={{ color: "var(--mistake-ink)", margin: 0 }}>{error}</p>}

      {items.flatMap((it, k) =>
        it.drafts.map((d, n) => {
          const c = CATEGORIES.find((x) => x.id === d.category)!;
          return (
            <section key={`${k}-${d.front}`} className="panel fade-in" style={{ borderLeft: `6px solid var(--cat-${d.category})`, padding: 16 }}>
              <div className="row">
                <span className="chip" style={{ background: `var(--cat-${d.category})` }}>{c.emoji} {c.name}</span>
                {n === 0 && <span className="small muted">{it.input}{it.drafts.length > 1 ? ` · ${it.drafts.length} cards` : ""}</span>}
                <div className="spacer" />
                <button className="btn ghost" onClick={() => remove(k, n)} aria-label="Remove card" title="Remove this card">✕</button>
              </div>
              <div style={{ marginTop: 8 }}><CardHtml html={d.front} /></div>
              <div className="muted small" style={{ marginTop: 6, display: "flex", gap: 6 }}><span>→</span><CardHtml html={d.back} /></div>
              {n === 0 && it.warning && <div className="small" style={{ marginTop: 6, color: "var(--mistake-ink)" }}>⚠ {it.warning}</div>}
            </section>
          );
        }),
      )}
    </div>
  );
}
