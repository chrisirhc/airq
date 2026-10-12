import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pm25Response, psiResponse } from "../../tests/browser/fixtures";
import { parsePm25, parsePsi } from "../air-quality-client";
import type { AppState } from "../app-state";
import { coordinateSchema } from "../domain";
import { estimatePm25 } from "../location-estimator";
import { AirqControls } from "./controls";
import { AirqPm25Map } from "./pm25-map";
import { AirqReadings } from "./readings";
import { registerComponents } from "./register";

const loaded: AppState = {
  data: {
    kind: "loaded",
    snapshot: {
      pm25: {
        kind: "available",
        source: "live",
        reading: parsePm25(pm25Response, new Date(), 2_700_000),
      },
      psi: {
        kind: "available",
        source: "live",
        reading: parsePsi(psiResponse, new Date(), 2_700_000),
      },
    },
  },
  display: { kind: "manual", region: "central" },
  location: { kind: "idle" },
};

beforeEach(() => {
  registerComponents();
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("custom-element lifecycle", () => {
  it("registers idempotently and uses native controls with typed region events", () => {
    registerComponents();
    const controls = document.createElement("airq-controls");
    expect(controls).toBeInstanceOf(AirqControls);
    document.body.append(controls);
    if (!(controls instanceof AirqControls)) throw new Error("Missing controls");
    controls.update(loaded);
    const listener = vi.fn();
    controls.addEventListener("airq-region-change", listener);
    const select = controls.querySelector("select");
    if (!select) throw new Error("Missing select");
    select.focus();
    select.value = "west";
    select.dispatchEvent(new Event("change"));
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0].detail).toBe("west");
    controls.update({ ...loaded, display: { kind: "manual", region: "west" } });
    expect(document.activeElement).toBe(select);
    expect(select.value).toBe("west");
  });

  it("removes old listeners and binds once when a control reconnects", () => {
    const controls = new AirqControls();
    document.body.append(controls);
    controls.update(loaded);
    const listener = vi.fn();
    controls.addEventListener("airq-location-request", listener);
    const oldButton = controls.querySelector("button");
    controls.remove();
    oldButton?.click();
    expect(listener).not.toHaveBeenCalled();
    document.body.append(controls);
    controls.update(loaded);
    controls.querySelector("button")?.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps readings and live-region markup when only location progress changes", () => {
    const readings = new AirqReadings();
    document.body.append(readings);
    readings.update(loaded);
    const card = readings.querySelector("article");
    const section = readings.querySelector("section");
    readings.update({ ...loaded, location: { kind: "requesting" } });
    expect(readings.querySelector("article")).toBe(card);
    expect(section?.getAttribute("aria-live")).toBe("polite");
    expect(section?.getAttribute("aria-busy")).toBe("false");
  });

  it("preserves open calculations and summary focus through a local readings update", () => {
    const coordinate = coordinateSchema.parse({ latitude: 1.35735, longitude: 103.94 });
    if (loaded.data.kind !== "loaded" || loaded.data.snapshot.pm25.kind !== "available")
      throw new Error("Missing fixture data");
    const reading = loaded.data.snapshot.pm25.reading;
    const result = estimatePm25({
      coordinate,
      references: reading.references,
      values: reading.values,
    });
    if (result.kind !== "estimated") throw new Error("Missing fixture estimate");
    const state: AppState = {
      ...loaded,
      display: {
        kind: "estimated",
        estimate: result.estimate,
        referenceFingerprint: "fixture",
        capturedAt: Date.now(),
        locationName: null,
        coordinate,
      },
    };
    if (state.display.kind !== "estimated") throw new Error("Missing estimated display");
    const readings = new AirqReadings();
    document.body.append(readings);
    readings.update(state);
    const details = readings.querySelector<HTMLDetailsElement>("#estimate-calculation");
    const summary = details?.querySelector("summary");
    if (!details || !summary) throw new Error("Missing calculation");
    details.open = true;
    summary.focus();
    readings.update({
      ...state,
      display: { ...state.display, estimate: { ...result.estimate, value: 35 } },
    });
    expect(readings.querySelector<HTMLDetailsElement>("#estimate-calculation")?.open).toBe(true);
    expect(document.activeElement).toBe(readings.querySelector("#estimate-calculation > summary"));
    readings.update({ ...state, data: { kind: "loading" } });
    readings.update(state);
    expect(readings.querySelector<HTMLDetailsElement>("#estimate-calculation")?.open).toBe(true);
  });

  it("aborts lazy map listeners on disconnect and reconnects without duplicate bindings", () => {
    const map = new AirqPm25Map();
    document.body.append(map);
    map.update(loaded);
    const oldDetails = map.querySelector("details");
    if (!oldDetails) throw new Error("Missing map");
    map.remove();
    oldDetails.open = true;
    oldDetails.dispatchEvent(new Event("toggle"));
    expect(map.querySelector("svg")).toBeNull();
    document.body.append(map);
    map.update(loaded);
    const details = map.querySelector("details");
    if (!details) throw new Error("Missing reconnected map");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    const svg = map.querySelector("svg");
    expect(svg).not.toBeNull();
    map.update({ ...loaded, location: { kind: "requesting" } });
    expect(map.querySelector("svg")).toBe(svg);
  });
});
