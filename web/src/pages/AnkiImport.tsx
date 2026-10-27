import { useState } from "react";
import { api } from "../data/api";
import { CATEGORIES, type Category } from "../data/categories";
import { useEve } from "../data/store";
import { navigate } from "../router";

// The server reads AnkiConnect: the anki-add tags decide each note's deck; untagged notes go to Vocabulary.
interface Scan {
  reachable: boolean;
  deck: string;
  deckFound: boolean;
  total: number;
  groups: { tag: string; category: Category; notes: number }[];
  alreadyImported: number; // notes already in Eve (imported before, or same front/back)
  toImport: number;
  skipped: number; // notes without a front or back
}
interface Result { imported: number; withSchedule: number; alreadyImported: number; duplicates: number; skipped: number }

type Step = "connect" | "searching" | "unreachable" | "map" | "importing" | "done";

export function AnkiImport() {
  const { state, actions } = useEve();
  const [step, setStep] = useState<Step>("connect");
  const [scan, setScan] = useState<Scan | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setStep("searching");
    setError(null);
    try {
      const s = await api<Scan>("/cards/import/anki/scan");
      setScan(s);
      setStep(s.reachable ? "map" : "unreachable");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("connect");
    }
  }

  async function run() {
    setStep("importing");
    setError(null);
    try {
      setResult(await api<Result>("/cards/import/anki", { body: {} }));
      setStep("done");
      await actions.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("map");
    }
  }

  const groups = scan?.groups.filter((g) => g.notes > 0) ?? [];

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720, margin: "0 auto" }}>
      <div className="row">
        <button className="btn round" onClick={() => navigate("/cards")} aria-label="Back">←</button>
        <h1>Import from Anki</h1>
      </div>

      <section className="panel">
        {(step === "connect" || step === "unreachable") && (
          <div className="stack">
            {step === "unreachable" ? (
              <p style={{ margin: 0, color: "var(--mistake-ink)" }}>
                Eve can't reach Anki on 127.0.0.1:8765. Open Anki on this Mac and check that the <b>AnkiConnect</b> add-on is installed
                (Tools → Add-ons, code <code>2055492159</code>), then try again.
              </p>
            ) : (
              <p style={{ margin: 0 }}>Open Anki on this Mac (with the AnkiConnect add-on), then connect. Eve reads your <b>English</b> deck and
                sorts each card into its deck by the tags <code>anki-add</code> already put on it.</p>
            )}
            {state.ankiImported && step === "connect" && (
              <p className="small muted" style={{ margin: 0 }}>You've imported before; importing again only brings in notes that aren't in Eve yet.</p>
            )}
            {error && <p className="small" style={{ margin: 0, color: "var(--mistake-ink)" }}>{error}</p>}
            <div><button className="btn cards big" onClick={connect}>{step === "unreachable" ? "Try again" : "Connect to Anki"}</button></div>
          </div>
        )}
        {step === "searching" && <p className="muted" style={{ margin: 0 }}>Looking for Anki on localhost:8765…</p>}
        {(step === "map" || step === "importing") && scan && (
          !scan.deckFound ? (
            <div className="stack">
              <p style={{ margin: 0 }}>Anki is open, but there's no deck called <b>{scan.deck}</b>. Eve imports the deck <code>anki-add</code> writes to.</p>
              <div><button className="btn" onClick={connect}>Check again</button></div>
            </div>
          ) : scan.total === 0 ? (
            <p style={{ margin: 0 }}>The <b>{scan.deck}</b> deck is empty: nothing to import.</p>
          ) : (
            <div className="stack">
              <p style={{ margin: 0 }}>Found <b>{scan.total} notes</b> in deck <b>{scan.deck}</b>. They'll go here:</p>
              {groups.map((f) => {
                const c = CATEGORIES.find((x) => x.id === f.category)!;
                return (
                  <div key={f.tag} className="row" style={{ background: "var(--surface-soft)", borderRadius: 12, padding: "10px 14px" }}>
                    <code>{f.tag}</code>
                    <span className="muted">→</span>
                    <span className="chip" style={{ background: `var(--cat-${f.category})` }}>{c.emoji} {c.name}</span>
                    <span className="spacer" />
                    <b>{f.notes}</b>
                  </div>
                );
              })}
              {scan.alreadyImported > 0 && (
                <p className="small muted" style={{ margin: 0 }}>{scan.alreadyImported} of them are already in Eve and will be skipped.</p>
              )}
              {scan.skipped > 0 && <p className="small muted" style={{ margin: 0 }}>{scan.skipped} notes with an empty side are left out.</p>}
              <p className="small muted" style={{ margin: 0 }}>Review history comes along: cards you've studied keep their interval and due date.</p>
              {error && <p className="small" style={{ margin: 0, color: "var(--mistake-ink)" }}>{error}</p>}
              <div>
                <button className="btn cards big" disabled={step === "importing" || scan.toImport === 0} onClick={run}>
                  {step === "importing" ? "Importing…" : scan.toImport === 0 ? "Everything is already in Eve" : `Import ${scan.toImport} notes`}
                </button>
              </div>
            </div>
          )
        )}
        {step === "done" && result && (
          <div className="stack" style={{ alignItems: "flex-start" }}>
            <p style={{ margin: 0 }}>✓ {result.imported} Anki card{result.imported === 1 ? "" : "s"} now in Eve
              {result.withSchedule > 0 ? `, ${result.withSchedule} with their review schedule` : ""}.</p>
            {result.duplicates > 0 && <p className="small muted" style={{ margin: 0 }}>{result.duplicates} were exact duplicates of cards already in Eve.</p>}
            <button className="btn streak" onClick={() => navigate("/cards")}>See my decks</button>
          </div>
        )}
      </section>
    </div>
  );
}
