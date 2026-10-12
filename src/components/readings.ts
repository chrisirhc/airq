import type { AppState } from "../app-state";
import { renderReadings } from "../readings-view";
import { AirqElement, emit, replaceContent } from "./element";

export class AirqReadings extends AirqElement {
  private readonly disclosures = new Set<string>();
  private rendered = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.innerHTML = '<section class="readings" aria-live="polite"></section>';
    this.rendered = "";
    this.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest(".retry-button"))
          emit(this, "airq-retry");
      },
      { signal: this.connection.signal },
    );
  }

  update(state: AppState): void {
    const section = this.querySelector<HTMLElement>("section");
    if (!section) return;
    section.setAttribute("aria-busy", String(state.data.kind === "loading"));
    const html = renderReadings(state);
    if (html === this.rendered) return;
    replaceContent(section, html, this.disclosures);
    this.rendered = html;
  }
}
