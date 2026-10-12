import { useEffect, useState } from "react";

type ThemePreference = "system" | "light" | "dark";
const THEME_KEY = "airq:theme";
const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const LABELS = { system: "System", light: "Light", dark: "Dark" };

function parsePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function ThemeControl() {
  const [preference, setPreference] = useState(() =>
    parsePreference(document.documentElement.dataset.theme),
  );
  const next = THEMES[(THEMES.indexOf(preference) + 1) % THEMES.length] ?? "system";
  useEffect(() => {
    const appearance = window.matchMedia("(prefers-color-scheme: dark)");
    function applyTheme() {
      const root = document.documentElement;
      if (preference === "system") delete root.dataset.theme;
      else root.dataset.theme = preference;
      root.style.colorScheme = preference === "system" ? "light dark" : preference;
      const dark = preference === "dark" || (preference === "system" && appearance.matches);
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#161616" : "#f5f5f5");
    }
    applyTheme();
    appearance.addEventListener("change", applyTheme);
    return () => appearance.removeEventListener("change", applyTheme);
  }, [preference]);
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === THEME_KEY || event.key === null)
        setPreference(parsePreference(event.newValue));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  function cycle() {
    setPreference(next);
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Appearance can still be changed when storage is unavailable.
    }
  }
  return (
    <button
      id="theme-button"
      className="theme-button"
      type="button"
      onClick={cycle}
      aria-label={`Appearance: ${LABELS[preference]}. Switch to ${LABELS[next]}`}
    >
      Theme: {LABELS[preference]}
    </button>
  );
}
