import { useEve } from "../data/store";
import { navigate } from "../router";
import { EveMark } from "./Orb";
import { useTheme } from "../data/theme";
import { Flame } from "./Widgets";

const TABS = [
  { to: "/", label: "Today" },
  { to: "/talk", label: "Talk" },
  { to: "/cards", label: "Cards" },
  { to: "/news", label: "News" },
];

export function TopBar({ path }: { path: string }) {
  const { streak, doneToday } = useEve();
  const { theme, toggle } = useTheme();
  const active = TABS.slice(1).find((t) => path.startsWith(t.to))?.to ?? "/";
  return (
    <header className="topbar">
      <div className="inner">
        <div className="logo" onClick={() => navigate("/")}>
          {/* Eve's icon is the light / night switch; the rest of the logo goes to Today */}
          <button className="theme-switch" onClick={(e) => { e.stopPropagation(); toggle(); }}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to night mode"} title={theme === "dark" ? "Light mode" : "Night mode"}>
            <EveMark />
          </button>
          <span className="name">Eve</span>
          {/* Phone: the streak lives here, "(Eve) | N", and the chip on the right is hidden (theme.css) */}
          <span className="logo-streak" title={doneToday ? "Done today" : "Practice today to keep it"}>{streak}</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.to} className={`tab ${active === t.to ? "active" : ""}`} onClick={() => navigate(t.to)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="chip streak-chip" style={{ background: "var(--streak)", color: "var(--streak-ink)" }} title={doneToday ? "Done today" : "Practice today to keep it"}>
          <Flame size={20} /> {streak} day{streak === 1 ? "" : "s"}
        </span>
      </div>
    </header>
  );
}
