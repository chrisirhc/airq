import { type AppState, manualRegion } from "../app-state";
import { REGION_LABELS, REGIONS } from "../domain";
import { locationMessage } from "../readings-view";
import { AirqElement, emit } from "./element";

export class AirqControls extends AirqElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.innerHTML = `<section class="controls" aria-label="Location and region controls">
      <button class="location-button" id="location-button" type="button">
        <span class="location-icon" aria-hidden="true">⌖</span><span class="location-label"></span>
      </button>
      <div class="divider" aria-hidden="true"><span>or</span></div>
      <label class="region-field"><span>Choose an official region</span>
        <select id="region-select">${REGIONS.map((region) => `<option value="${region}">${REGION_LABELS[region]}</option>`).join("")}</select>
      </label>
      <p class="privacy-note">To name your location, coordinates are sent through our server to OneMap. AirQ does not save them.</p>
      <div class="location-messages"></div>
    </section>`;
    const options = { signal: this.connection.signal };
    this.querySelector("button")?.addEventListener(
      "click",
      () => emit(this, "airq-location-request"),
      options,
    );
    this.querySelector("select")?.addEventListener(
      "change",
      (event) => {
        const target = event.currentTarget;
        if (!(target instanceof HTMLSelectElement)) return;
        const region = REGIONS.find((candidate) => candidate === target.value);
        if (region) emit(this, "airq-region-change", region);
      },
      options,
    );
  }

  update(state: AppState): void {
    const button = this.querySelector<HTMLButtonElement>("button");
    const select = this.querySelector<HTMLSelectElement>("select");
    if (!button || !select) return;
    const estimated = state.display.kind === "estimated";
    const requesting = state.location.kind === "requesting";
    const loading = state.data.kind === "loading";
    button.classList.toggle("is-active", estimated);
    button.setAttribute("aria-pressed", String(estimated));
    button.setAttribute("aria-busy", String(requesting));
    button.disabled = requesting || loading;
    const icon = button.querySelector(".location-icon");
    if (icon) icon.textContent = estimated && !requesting ? "✓" : "⌖";
    const label = button.querySelector(".location-label");
    if (label)
      label.textContent = loading
        ? "Loading readings…"
        : requesting
          ? "Finding your location…"
          : estimated
            ? "Using your location"
            : "Use my location";
    select.value = manualRegion(state);
    const messages = this.querySelector<HTMLElement>(".location-messages");
    const html = locationMessage(state);
    if (messages && messages.innerHTML !== html) messages.innerHTML = html;
  }
}
