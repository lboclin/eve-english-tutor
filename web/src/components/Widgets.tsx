import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, type Category, type Deck } from "../data/categories";

// Tasks done that day (0–3) → shade. Light = 1 task, mid = 2, deep = all three.
const LEVEL_COLORS = ["var(--surface-soft)", "var(--lvl-1)", "var(--lvl-2)", "var(--lvl-3)"];
const LEVEL_NAMES = ["", "1 task", "2 tasks", "All tasks"];
const DAY_MS = 86_400_000;
const WEEKDAYS = ["", "Mon", "", "Wed", "", "Fri", ""]; // labelled like GitHub: every other row
// Squares stay small (13–18px): they grow only to fill the card's height (on the Mac the row's height comes from
// the News card), and the card shows as many weeks as fit its width instead of stretching them.
const CELL = 13;
const MAX_CELL = 18;
const CHROME_H = 60; // month row + legend + gaps around the 7 rows of squares
const GAP = 4;
const LABEL_COL = 26;
const ARROW_COL = 16;

// Calendar after Wispr Flow's streak box: weeks as columns (Sun–Sat), month labels, current streak outlined,
// arrows to page back through the history. `days` ends today; days[days.length - 1] is today.
export function StreakCalendar({ days }: { days: number[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 480, height: 0 });
  const [page, setPage] = useState(0); // 0 = the latest weeks
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastSaturday = today.getTime() + (6 - today.getDay()) * DAY_MS;
  const totalWeeks = Math.ceil((days.length + 6 - today.getDay()) / 7);
  const { width, height } = size;
  const target = Math.min(MAX_CELL, Math.max(CELL, Math.floor((height - CHROME_H) / 7) - GAP));
  const visible = Math.max(8, Math.min(totalWeeks, Math.floor((width - LABEL_COL - ARROW_COL - GAP) / (target + GAP))));
  // Exact pixel size so the grid can never be wider than the card (fractional tracks overflowed it).
  const cellPx = Math.max(8, Math.min(target, Math.floor((width - LABEL_COL - ARROW_COL - GAP * (visible + 1)) / visible)));
  const pages = Math.ceil(totalWeeks / visible);
  const shown = Math.min(page, pages - 1);
  const firstWeek = Math.max(0, totalWeeks - visible * (shown + 1));

  const current = currentStreak(days);
  const currentFrom = days[days.length - 1] > 0 ? 0 : 1; // today counts only once something is done

  const weeks = Array.from({ length: visible }, (_, c) => {
    const week = firstWeek + c;
    return Array.from({ length: 7 }, (_, r) => {
      const date = new Date(lastSaturday - ((totalWeeks - 1 - week) * 7 + (6 - r)) * DAY_MS);
      const offset = Math.round((today.getTime() - date.getTime()) / DAY_MS); // days ago
      const level = offset < 0 || offset >= days.length ? null : days[days.length - 1 - offset];
      return { date, level, offset, inStreak: offset >= currentFrom && offset < currentFrom + current };
    });
  });
  const months = weeks.map((w, c) => {
    const m = w[0].date.getMonth();
    const changed = c === 0 ? weeks.slice(1, 3).every((x) => x[0].date.getMonth() === m) : weeks[c - 1][0].date.getMonth() !== m;
    return changed ? w[0].date.toLocaleDateString("en-US", { month: "short" }) : "";
  });

  const columns = `${LABEL_COL}px repeat(${visible}, ${cellPx}px) ${ARROW_COL}px`;
  const label = { fontSize: 11, color: "var(--ink-soft)", whiteSpace: "nowrap" } as const;
  const arrow = (dir: 1 | -1, disabled: boolean) => (
    <button className="btn ghost" disabled={disabled} onClick={() => setPage(shown + dir)} aria-label={dir > 0 ? "Earlier" : "Later"}
      style={{ padding: 0, fontSize: 15, lineHeight: 1, color: "var(--ink-soft)" }}>{dir > 0 ? "‹" : "›"}</button>
  );

  return (
    <div ref={box} className="stack streak-calendar" style={{ gap: 4, minWidth: 0, overflow: "hidden", padding: 2 }}>
      <div style={{ display: "grid", gridTemplateColumns: columns, columnGap: GAP, alignItems: "center" }}>
        {arrow(1, shown >= pages - 1)}
        {months.map((m, k) => <span key={k} style={label}>{m}</span>)}
        {arrow(-1, shown === 0)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: columns, gridTemplateRows: "repeat(7, auto)", gridAutoFlow: "column", gap: GAP }}>
        {WEEKDAYS.map((d, k) => <span key={k} style={{ ...label, alignSelf: "center" }}>{d}</span>)}
        {weeks.flat().map((cell) => (
          <div key={cell.date.getTime()} title={cell.level === null ? "" : `${cell.date.toDateString()} · ${cell.level ? LEVEL_NAMES[cell.level] : "no tasks"}`}
            style={{ width: cellPx, height: cellPx, borderRadius: "30%", background: cell.level === null ? "transparent" : LEVEL_COLORS[cell.level],
              outline: cell.inStreak ? "1.5px solid var(--streak-ring)" : cell.offset === 0 ? "1.5px dashed var(--streak-ring)" : undefined,
              outlineOffset: 1 }} />
        ))}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 12, fontSize: 12, color: "var(--ink-soft)" }}>
        {[1, 2, 3].map((l) => (
          <span key={l} className="row" style={{ gap: 5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 4, background: LEVEL_COLORS[l] }} />{LEVEL_NAMES[l]}
          </span>
        ))}
        <span className="spacer" />
        <span className="row" style={{ gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 4, outline: "1.5px solid var(--streak-ring)", outlineOffset: 1 }} />Current streak
        </span>
      </div>
    </div>
  );
}

// Consecutive active days ending today (or yesterday, while nothing is done yet today).
export function currentStreak(days: number[]) {
  let n = 0;
  for (let i = days.length - (days[days.length - 1] > 0 ? 1 : 2); i >= 0 && days[i] > 0; i--) n++;
  return n;
}

// Share of cards per category — the bar that makes "lots of vocabulary, almost no grammar" visible.
export function DeckMix({ decks, showLegend = false }: { decks: Record<Category, Deck>; showLegend?: boolean }) {
  const sum = Object.values(decks).reduce((n, d) => n + d.total, 0);
  const total = sum || 1;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="mix" style={sum ? undefined : { background: "var(--surface-soft)" }}>
        {sum > 0 && CATEGORIES.map((c) => (
          <div key={c.id} title={`${c.name}: ${decks[c.id].total}`}
            style={{ width: `${(decks[c.id].total / total) * 100}%`, minWidth: 6, background: `var(--cat-${c.id})` }} />
        ))}
      </div>
      {showLegend && (
        <div className="row small muted" style={{ gap: 14 }}>
          {CATEGORIES.map((c) => (
            <span key={c.id} className="row" style={{ gap: 6 }}>
              <span className="dot" style={{ background: `var(--cat-${c.id})` }} />
              {c.name} {Math.round((decks[c.id].total / total) * 100)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Soft pastel flame (replaces the 🔥 emoji, which was too saturated for the theme).
// The system 🔥 (Apple's emoji on the Mac and iPhone), sized like an icon and centered on the line.
// A parent can resize it with the --flame CSS variable (the top bar does on phones).
export function Flame({ size = 22 }: { size?: number }) {
  const px = `var(--flame, ${size}px)`;
  return (
    <span aria-hidden style={{ flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", width: px, height: px, fontSize: `calc(${px} * 0.85)`, lineHeight: 1 }}>
      🔥
    </span>
  );
}

// Longest run of active days in the history.
export function bestStreak(days: number[]) {
  let best = 0;
  let run = 0;
  for (const m of days) {
    run = m > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

// Card fronts/backs are HTML from the card engine or from Anki, and Anki content can carry anything
// (<script>, <img onerror>, styles). Keep a small formatting allowlist, drop every attribute, unwrap
// other tags to their text, and remove dangerous elements with their content. DOMParser documents are
// inert: nothing in them runs or loads while we walk them.
const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "BR", "DIV", "P", "SPAN", "SUB", "SUP", "SMALL", "UL", "OL", "LI", "CODE", "HR"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "LINK", "META", "TITLE", "HEAD", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT"]);

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Node, into: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        into.appendChild(document.createTextNode((child.textContent ?? "").replace(/\[sound:[^\]]*\]/g, "")));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName;
        if (DROP.has(tag)) continue;
        if (ALLOWED.has(tag)) {
          const el = document.createElement(tag.toLowerCase());
          clean(child, el);
          into.appendChild(el);
        } else clean(child, into); // unknown tag: keep its text
      }
    }
  };
  const out = document.createElement("div");
  clean(doc.body, out);
  return out.innerHTML;
}

// A card side rendered through the sanitizer. Plain-text newlines become line breaks.
export function CardHtml({ html, className }: { html: string; className?: string }) {
  const safe = useMemo(() => sanitizeHtml(html.replace(/\n/g, "<br>")), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: safe }} />;
}
