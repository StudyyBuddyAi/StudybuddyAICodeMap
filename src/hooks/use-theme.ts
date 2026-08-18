import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/** Read the theme the bootstrap script in index.html already applied. */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Single source of truth for the colour theme.
 *
 * The `.dark` class is put on <html> synchronously by the bootstrap script in
 * index.html, so this hook seeds from the DOM rather than re-deriving it from
 * localStorage — that keeps the first render in step with what is already
 * painted and avoids a flash.
 *
 * A module-level subscriber set keeps every consumer (ThemeToggle in AppNav and
 * in DashboardSidebar, the landing page header, the Sonner toaster) in step, so
 * toggling in one place updates all of them.
 */
const subscribers = new Set<(t: Theme) => void>();

function applyTheme(next: Theme) {
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode / storage disabled — the class is still applied */
  }
  subscribers.forEach((fn) => fn(next));
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  useEffect(() => {
    subscribers.add(setThemeState);
    // Re-sync in case something changed the class between render and effect.
    setThemeState(currentTheme());
    return () => {
      subscribers.delete(setThemeState);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => applyTheme(next), []);
  const toggleTheme = useCallback(
    () => applyTheme(currentTheme() === "dark" ? "light" : "dark"),
    []
  );

  return { theme, isDark: theme === "dark", setTheme, toggleTheme };
}
