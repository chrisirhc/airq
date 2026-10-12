import type { AppState } from "../app-state";
import { bindPm25Map, renderPm25Map } from "../pm25-map";
import { AirqElement, replaceContent } from "./element";

export class AirqPm25Map extends AirqElement {
  private readonly disclosures = new Set<string>();
  private binding = new AbortController();
  private renderedKey = "";

  override connectedCallback(): void {
    super.connectedCallback();
    this.renderedKey = "";
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.binding.abort();
  }

  update(state: AppState): void {
    const pm25 = state.data.kind === "loaded" ? state.data.snapshot.pm25 : null;
    const location = state.display.kind === "estimated" ? state.display.coordinate : null;
    const key = pm25?.kind === "available" ? JSON.stringify([pm25, location]) : "unavailable";
    if (key === this.renderedKey) return;
    this.binding.abort();
    this.binding = new AbortController();
    replaceContent(this, pm25?.kind === "available" ? renderPm25Map() : "", this.disclosures);
    this.renderedKey = key;
    if (pm25?.kind === "available")
      bindPm25Map(this, pm25.reading, location, pm25.source, this.binding.signal);
  }
}
