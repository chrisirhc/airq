type ThemePreference = "system" | "light" | "dark";

const THEME_KEY = "airq:theme";
const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const LABELS = { system: "System", light: "Light", dark: "Dark" };
const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
let preference = parsePreference(document.documentElement.dataset.theme);

function parsePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function nextPreference(): ThemePreference {
  return THEMES[(THEMES.indexOf(preference) + 1) % THEMES.length] ?? "system";
}

function buttonLabel(): string {
  return `Appearance: ${LABELS[preference]}. Switch to ${LABELS[nextPreference()]}`;
}

function applyTheme(): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  root.style.colorScheme = preference === "system" ? "light dark" : preference;
  const dark = preference === "dark" || (preference === "system" && systemAppearance.matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#161616" : "#f5f5f5");
  const button = document.querySelector<HTMLButtonElement>("#theme-button");
  if (button) {
    button.textContent = `Theme: ${LABELS[preference]}`;
    button.setAttribute("aria-label", buttonLabel());
  }
}

export function renderThemeControl(): string {
  return `<button id="theme-button" class="theme-button" type="button" aria-label="${buttonLabel()}">Theme: ${LABELS[preference]}</button>`;
}

export function bindThemeControl(): void {
  document.querySelector("#theme-button")?.addEventListener("click", () => {
    preference = nextPreference();
    applyTheme();
    try {
      if (preference === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Appearance can still be changed when storage is unavailable.
    }
  });
}

systemAppearance.addEventListener("change", applyTheme);
window.addEventListener("storage", (event) => {
  if (event.key !== THEME_KEY && event.key !== null) return;
  preference = parsePreference(event.newValue);
  applyTheme();
});
applyTheme();
