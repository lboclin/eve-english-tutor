import { useEffect, useState } from "react";

// Light / night mode, switched by tapping Eve's icon in the top bar. Until Lucas picks one, Eve follows the system setting; his pick is remembered on this
// device (localStorage "eve.theme"). index.html applies it before the first paint, so there's no flash.
type Theme = "light" | "dark";
const KEY = "eve.theme";

const systemTheme = (): Theme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // The browser/iOS chrome around the page follows the page background.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#1d1c25" : "#fbf8f3");
}

// Light / night mode state; TopBar turns Eve's icon into the switch.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  useEffect(() => apply(theme), [theme]);
  useEffect(() => {
    // No pick yet: keep following the system (e.g. macOS switching to dark at sunset).
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => !storedTheme() && setTheme(systemTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the pick lasts until reload */
    }
    setTheme(next);
  }
  return { theme, toggle };
}
