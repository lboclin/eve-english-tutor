// The two "alive creatures" of the talk screen. `level` (0–1) is the speaker's audio level: it drives
// size, glow and Eve's eyes, so each orb visibly reacts to its own voice.
import "./orb.css";

export function EveOrb({ level, speaking }: { level: number; speaking: boolean }) {
  const eye = speaking ? 0.55 + level * 0.6 : 1; // eyes squint/pulse while talking, open while listening
  return (
    <div className={`orb eve ${speaking ? "on" : ""}`} style={{ "--lvl": level } as React.CSSProperties}>
      <div className="halo" />
      <svg viewBox="0 0 200 200" className="eve-body" aria-label="Eve">
        <defs>
          <radialGradient id="shell" cx="40%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#e6eef7" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <ellipse cx="100" cy="104" rx="66" ry="74" fill="url(#shell)" />
        <rect x="52" y="70" width="96" height="56" rx="28" fill="#2c3049" />
        <g filter="url(#glow)" className="eyes">
          <ellipse cx="80" cy="98" rx="13" ry={13 * eye} fill="#8fd4ff" />
          <ellipse cx="120" cy="98" rx="13" ry={13 * eye} fill="#8fd4ff" />
        </g>
      </svg>
    </div>
  );
}

export function YouOrb({ level, speaking }: { level: number; speaking: boolean }) {
  return (
    <div className={`orb you ${speaking ? "on" : ""}`} style={{ "--lvl": level } as React.CSSProperties}>
      <div className="blob" />
      <div className="blob inner" />
    </div>
  );
}

export function EveMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 40 40" aria-hidden>
      <ellipse cx="20" cy="21" rx="16" ry="17" fill="#fff" stroke="var(--line)" />
      <rect x="9" y="14" width="22" height="13" rx="6.5" fill="#2c3049" />
      <ellipse cx="15.5" cy="20.5" rx="3" ry="3" fill="#8fd4ff" />
      <ellipse cx="24.5" cy="20.5" rx="3" ry="3" fill="#8fd4ff" />
    </svg>
  );
}
