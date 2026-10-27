import { useEffect, useState } from "react";
import { api } from "../data/api";
import { CATEGORIES } from "../data/categories";
import { useEve } from "../data/store";
import { navigate } from "../router";
import { DeckMix } from "../components/Widgets";

export function Cards() {
  const { state, due, newCount } = useEve();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row">
        <h1>Cards</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>⚙️ Settings</button>
        <button className="btn cards" onClick={() => navigate("/cards/add")}>+ Add cards</button>
      </div>
      {settingsOpen && <CardSettingsPanel onClose={() => setSettingsOpen(false)} />}

      <section className="panel" style={{ background: "linear-gradient(160deg, var(--surface) 40%, var(--cards-soft))" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>All decks</h2>
            <span className="small"><b style={{ color: "var(--talk-ink)" }}>new: {newCount}</b> · <b style={{ color: "var(--streak-ink)" }}>due: {due}</b></span>
          </div>
          <div className="spacer" />
          <button className="btn cards big" disabled={due + newCount === 0} onClick={() => navigate("/cards/review/all")}>Review all</button>
        </div>
        <DeckMix decks={state.decks} showLegend />
        {state.loaded && state.totalCards === 0 ? (
          <p className="small muted" style={{ marginBottom: 0 }}>No cards yet: import your Anki deck or add cards, and they'll be sorted into the decks below.</p>
        ) : null}
      </section>

      <div className="grid">
        {CATEGORIES.map((c) => {
          const d = state.decks[c.id];
          return (
            <section key={c.id} className="panel span-4" style={{ borderTop: `6px solid var(--cat-${c.id})` }}>
              <h2>{c.emoji} {c.name}</h2>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{d.total}</div>
              <p className="small muted" style={{ marginTop: 0 }}>cards · <b>new {d.newCount}</b> · <b>due {d.due}</b></p>
              <button className="btn" style={{ background: `var(--cat-${c.id})` }} disabled={d.due + d.newCount === 0}
                onClick={() => navigate(`/cards/review/${c.id}`)}>
                {d.total === 0 ? "No cards yet" : d.due + d.newCount === 0 ? "Nothing due" : "Review"}
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface CardSettings { newPerDay: number; reviewsPerDay: number }
const LIMITS = { newPerDay: 200, reviewsPerDay: 2000 }; // same limits as server/lib/cards-settings.ts

// The daily limits (like Anki's deck options, across all decks) and the Anki import.
function CardSettingsPanel({ onClose }: { onClose: () => void }) {
  const { state, actions } = useEve();
  const [settings, setSettings] = useState<Record<keyof CardSettings, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<CardSettings>("/cards/settings").then(
      (s) => setSettings({ newPerDay: String(s.newPerDay), reviewsPerDay: String(s.reviewsPerDay) }),
      (e: Error) => setError(e.message),
    );
  }, []);
  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api("/cards/settings", { body: { newPerDay: Number(settings.newPerDay), reviewsPerDay: Number(settings.reviewsPerDay) } });
      await actions.refresh();
      actions.notify("Card settings saved.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  const field = (key: keyof CardSettings, label: string) => (
    <label className="stack" style={{ gap: 8 }}>
      <span className="small muted">{label}</span>
      <input className="text-input" type="number" inputMode="numeric" min={0} max={LIMITS[key]} step={1} style={{ maxWidth: 120 }}
        value={settings![key]} onChange={(e) => setSettings({ ...settings!, [key]: e.target.value })} />
    </label>
  );
  return (
    <section className="panel fade-in">
      <h2 style={{ marginTop: 0 }}>Cards</h2>
      {!settings ? (
        <p className="small muted">{error ?? "Loading…"}</p>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
            {field("newPerDay", "New cards per day")}
            {field("reviewsPerDay", "Reviews per day")}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            For all decks together. Cards you're still learning (a new card you just saw, a review you missed) always
            come back the same day, outside these limits.
          </p>
          {error && <p className="small" role="alert" style={{ color: "var(--mistake-ink)", margin: 0 }}>{error}</p>}
          <div className="row" style={{ gap: 10 }}>
            <button className="btn cards" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
          <div className="row" style={{ gap: 10, borderTop: "1px solid var(--line)", paddingTop: 16, flexWrap: "wrap" }}>
            <span className="small muted">Anki</span>
            <button className="btn" onClick={() => navigate("/cards/import")}>{state.ankiImported ? "✓ Imported from Anki" : "Import from Anki"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
