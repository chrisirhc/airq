import { APP_SHELL } from "../app-shell";
import { type AppState, createAppController } from "../app-state";
import { REGIONS } from "../domain";
import { AirqBadge } from "./badge";
import { AirqControls } from "./controls";
import { AirqElement } from "./element";
import { AirqPm25Map } from "./pm25-map";
import { AirqReadings } from "./readings";

export class AirqApp extends AirqElement {
  private controller: ReturnType<typeof createAppController> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.controller?.dispose();
    this.innerHTML = APP_SHELL;
    const badge = this.querySelector("airq-badge");
    if (!(badge instanceof AirqBadge)) throw new Error("Badge component is not registered.");
    const controller = createAppController(badge.controller, (state) => this.update(state));
    this.controller = controller;
    const options = { signal: this.connection.signal };
    this.addEventListener("airq-location-request", () => controller.requestLocation(), options);
    this.addEventListener("airq-retry", () => controller.retry(), options);
    this.addEventListener(
      "airq-region-change",
      (event) => {
        if (!(event instanceof CustomEvent)) return;
        const region = REGIONS.find((candidate) => candidate === event.detail);
        if (region) controller.selectRegion(region);
      },
      options,
    );
    void controller.initialize();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.controller?.dispose();
    this.controller = null;
  }

  private update(state: AppState): void {
    const controls = this.querySelector("airq-controls");
    const readings = this.querySelector("airq-readings");
    const map = this.querySelector("airq-pm25-map");
    if (controls instanceof AirqControls) controls.update(state);
    if (readings instanceof AirqReadings) readings.update(state);
    if (map instanceof AirqPm25Map) map.update(state);
  }
}
