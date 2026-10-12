import { AirqElement } from "./components/element";

type ThemePreference = "system" | "light" | "dark";
const THEME_KEY = "airq:theme";
const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];
const LABELS = { system: "System", light: "Light", dark: "Dark" };

function parsePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export class AirqTheme extends AirqElement {
  private preference: ThemePreference = "system";
  private systemAppearance: MediaQueryList | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.preference = parsePreference(document.documentElement.dataset.theme);
    this.systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
    this.innerHTML = '<button id="theme-button" class="theme-button" type="button"></button>';
    const options = { signal: this.connection.signal };
    this.querySelector("button")?.addEventListener(
      "click",
      () => {
        this.preference = this.nextPreference();
        this.applyTheme();
        try {
          if (this.preference === "system") localStorage.removeItem(THEME_KEY);
          else localStorage.setItem(THEME_KEY, this.preference);
        } catch {
          // Appearance remains usable when storage is unavailable.
        }
      },
      options,
    );
    this.systemAppearance.addEventListener("change", () => this.applyTheme(), options);
    window.addEventListener(
      "storage",
      (event) => {
        if (event.key !== THEME_KEY && event.key !== null) return;
        this.preference = parsePreference(event.newValue);
        this.applyTheme();
      },
      options,
    );
    this.applyTheme();
  }

  private nextPreference(): ThemePreference {
    return THEMES[(THEMES.indexOf(this.preference) + 1) % THEMES.length] ?? "system";
  }

  private applyTheme(): void {
    const root = document.documentElement;
    if (this.preference === "system") delete root.dataset.theme;
    else root.dataset.theme = this.preference;
    root.style.colorScheme = this.preference === "system" ? "light dark" : this.preference;
    const dark =
      this.preference === "dark" ||
      (this.preference === "system" && this.systemAppearance?.matches);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#161616" : "#f5f5f5");
    const button = this.querySelector("button");
    if (button) {
      button.textContent = `Theme: ${LABELS[this.preference]}`;
      button.setAttribute(
        "aria-label",
        `Appearance: ${LABELS[this.preference]}. Switch to ${LABELS[this.nextPreference()]}`,
      );
    }
  }
}
