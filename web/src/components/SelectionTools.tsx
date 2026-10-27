import { useEffect, useRef, useState } from "react";
import { api } from "../data/api";
import { CATEGORIES, type Category } from "../data/categories";
import { playAudio, speakLocally } from "../data/speech";
import { useEve } from "../data/store";

// Select a word or an expression anywhere in the app → two small buttons: Translate (DeepL, free plan) and 🔊
// (Google Translate's voice: data/speech.ts, server/lib/google-tts.ts). The translation panel has "+ Add card": it closes the panel at once,
// the card engine writes and saves the card in the background (the sentence goes along as context) and a toast
// says when it's in. Mounted once, in main.tsx. Server: POST /api/selection/{speech,translate,card}.
interface Picked { text: string; sentence: string; top: number; center: number }
interface Translation { translation: string; sentenceTranslation: string | null }
interface Added { inserted: number; duplicates: number; kind: string; category: Category; warning?: string }

const MAX_TRANSLATE = 120; // the server's limit: longer selections can only be listened to
const MAX_LISTEN = 1000;
const POP_WIDTH = 380;
const GUTTER = 16;
// The block whose text the sentence is taken from; any other element falls back to the selection's own element.
const BLOCKS = "p, li, blockquote, td, dd, h1, h2, h3, h4";

// The sentence of `full` that contains [start, end), joined if the selection spans several.
function sentenceAround(full: string, start: number, end: number) {
  const bounds = [0];
  for (const m of full.matchAll(/[.!?]+["'”’)]*\s+(?=["'“‘(]?[A-Z0-9])/g)) bounds.push(m.index + m[0].length);
  bounds.push(full.length);
  const from = Math.max(...bounds.filter((b) => b <= start));
  const to = Math.min(...bounds.filter((b) => b >= end));
  return full.slice(from, to).trim();
}

// Text fields keep the system's own selection menu; so do the bar and these popovers.
const ignored = (el: Element | null) =>
  !el || !!el.closest("input, textarea, select, [contenteditable], .topbar, .selection-tools")
  || ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "");

function SpeakerIcon({ playing }: { playing: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {playing ? <rect x="7" y="7" width="10" height="10" rx="2" /> : <>
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
        <path d="M15.5 9a4 4 0 0 1 0 6" />
        <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
      </>}
    </svg>
  );
}

export function SelectionTools() {
  const { actions } = useEve();
  const pop = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [res, setRes] = useState<Translation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const stopSpeech = useRef<(() => void) | null>(null);
  const close = () => {
    setPicked(null);
    setRes(null);
    setError(null);
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const s = window.getSelection();
      // A selection that goes away keeps the buttons (a tap on them can clear the selection on phones);
      // a tap outside, a scroll inside a box, or Escape closes them.
      if (!s || s.isCollapsed || !s.rangeCount) return;
      const range = s.getRangeAt(0);
      const start = range.startContainer;
      const startEl = start instanceof Element ? start : start.parentElement;
      if (!startEl || ignored(startEl)) return;
      const text = s.toString().replace(/\s+/g, " ").trim();
      if (!text || text.length > MAX_LISTEN) return;
      const block = startEl.closest(BLOCKS) ?? startEl;
      let sentence = "";
      if (block.contains(range.endContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(block);
        pre.setEnd(range.startContainer, range.startOffset);
        const from = pre.toString().length;
        sentence = sentenceAround(block.textContent ?? "", from, from + range.toString().length);
      }
      const r = range.getBoundingClientRect();
      setPicked({ text, sentence, top: r.bottom + scrollY + 8, center: r.left + scrollX + r.width / 2 });
      setRes(null);
      setError(null);
    };
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 250);
    };
    const onDown = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // The buttons sit on the page, so a page scroll carries them along; a box scrolling inside it doesn't.
    const onScroll = (e: Event) => e.target !== document && close();
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  function listen() {
    if (!picked) return;
    if (playing) {
      stopSpeech.current?.();
      setPlaying(false);
      return;
    }
    const { text } = picked;
    setPlaying(true);
    stopSpeech.current = playAudio("/selection/speech", { text }, {
      onEnd: () => setPlaying(false),
      onError: () => speakLocally(text, () => setPlaying(false)), // no server audio: the browser's voice
    });
  }

  async function translate() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      setRes(await api<Translation>("/selection/translate", { body: { text: picked.text, sentence: picked.sentence } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Fire and forget: the request outlives the popover (and the page), the toast reports the result.
  function addCard() {
    if (!picked) return;
    const { text, sentence } = picked;
    close();
    actions.notify(`Eve is writing a card for “${text}”…`);
    api<Added>("/selection/card", { body: { text, sentence } }).then(
      async (r) => {
        const deck = CATEGORIES.find((c) => c.id === r.category);
        actions.notify(r.inserted
          ? `+${r.inserted} card${r.inserted === 1 ? "" : "s"} for “${text}” in ${deck?.emoji ?? ""} ${deck?.name ?? r.category}`
          : `“${text}” is already in your cards`);
        await actions.refresh();
      },
      (e: Error) => actions.notify(`Couldn't add “${text}”: ${e.message}`),
    );
  }

  if (!picked) return null;
  const pageWidth = document.documentElement.clientWidth;
  const width = Math.min(POP_WIDTH, pageWidth - 2 * GUTTER);
  const panelLeft = Math.min(Math.max(picked.center - width / 2, scrollX + GUTTER), scrollX + pageWidth - GUTTER - width);
  const buttonsCenter = Math.min(Math.max(picked.center, scrollX + GUTTER + 90), scrollX + pageWidth - GUTTER - 90);
  const speaker = (
    <button className={`btn round${playing ? " streak" : ""}`} onClick={listen} aria-label={playing ? "Stop" : "Listen"} title={playing ? "Stop" : "Listen"}>
      <SpeakerIcon playing={playing} />
    </button>
  );

  // preventDefault keeps the text selected while the buttons are used.
  return res ? (
    <div ref={pop} className="popover selection-tools fade-in" style={{ top: picked.top, left: panelLeft, width }} onPointerDown={(e) => e.preventDefault()}>
      <div className="stack" style={{ gap: 8 }}>
        <div><b>{picked.text}</b> → {res.translation}</div>
        {res.sentenceTranslation && <div className="small muted">{res.sentenceTranslation}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn cards" onClick={addCard}>+ Add card</button>
          {speaker}
          <button className="btn ghost" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  ) : (
    <div ref={pop} className="popover-button selection-tools fade-in" style={{ top: picked.top, left: buttonsCenter }} onPointerDown={(e) => e.preventDefault()}>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        {picked.text.length <= MAX_TRANSLATE && (
          <button className="btn news" disabled={busy} onClick={translate}>{busy ? "Translating…" : "Translate"}</button>
        )}
        {speaker}
      </div>
      {error && <div className="popover small" role="alert" style={{ position: "static", marginTop: 6, color: "var(--mistake-ink)", width: 260 }}>{error}</div>}
    </div>
  );
}
