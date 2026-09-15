import { useEffect, useState } from "react";

/**
 * Mermaid derives shades from the colors it's given, so it needs real color
 * values — `var(--accent)` means nothing to it. These read the resolved design
 * tokens at render time, which also picks up the dark-mode values.
 */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // Hex only: classDef styles are comma-separated, so an rgba() would split apart.
  return HEX_RE.test(value) ? value : fallback;
}

export interface VisualTheme {
  accent: string;
  fg: string;
  fgMuted: string;
  surface: string;
  panel: string;
  border: string;
  font: string;
}

export function readVisualTheme(): VisualTheme {
  const dark = document.documentElement.classList.contains("dark");
  const font =
    getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() ||
    "Inter Tight, Inter, system-ui, sans-serif";
  return {
    accent: readToken("--accent", dark ? "#2BA5A5" : "#0D6E6E"),
    fg: readToken("--fg", dark ? "#E9E4D7" : "#0E1116"),
    fgMuted: readToken("--fg-muted", dark ? "#A6A192" : "#545042"),
    surface: readToken("--bg-elevated", dark ? "#171C24" : "#FFFFFF"),
    panel: readToken("--bg-panel", dark ? "#141820" : "#EFEAD9"),
    border: readToken("--border-strong", dark ? "#323843" : "#CBC3AE"),
    font,
  };
}

/** Bumps whenever the app switches light/dark, so theme-baked SVG can re-render. */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return version;
}
