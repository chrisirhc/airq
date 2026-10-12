import { AirqTheme } from "../theme";
import { AirqApp } from "./app";
import { AirqBadge } from "./badge";
import { AirqControls } from "./controls";
import { AirqPm25Map } from "./pm25-map";
import { AirqReadings } from "./readings";

// Define children before the app so their connection hooks run when it mounts its shell.
export function registerComponents(): void {
  for (const [name, element] of [
    ["airq-theme", AirqTheme],
    ["airq-controls", AirqControls],
    ["airq-readings", AirqReadings],
    ["airq-pm25-map", AirqPm25Map],
    ["airq-badge", AirqBadge],
    ["airq-app", AirqApp],
  ] as const) {
    if (!customElements.get(name)) customElements.define(name, element);
  }
}
