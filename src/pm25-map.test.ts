import { describe, expect, it } from "vitest";
import { classifyPm25 } from "./classifiers";
import { coordinateSchema, pm25Schema, REGIONS } from "./domain";
import { estimatePm25 } from "./location-estimator";
import {
  bindPm25Map,
  buildHeatmapCells,
  mapCoordinate,
  projectMapPoint,
  renderPm25Map,
} from "./pm25-map";

const coordinates = [
  [1.41803, 103.82],
  [1.29587, 103.82],
  [1.35735, 103.94],
  [1.35735, 103.7],
  [1.35735, 103.82],
] as const;
const references = REGIONS.map((name, index) => {
  const point = coordinates[index];
  if (!point) throw new Error("Missing test point");
  return { name, coordinate: coordinateSchema.parse({ latitude: point[0], longitude: point[1] }) };
});
const reading = {
  references,
  values: {
    north: pm25Schema.parse(20),
    south: pm25Schema.parse(80),
    east: pm25Schema.parse(180),
    west: pm25Schema.parse(300),
    central: pm25Schema.parse(40),
  },
  timestamp: new Date("2026-10-06T12:00:00Z"),
  updatedAt: new Date("2026-10-06T12:00:00Z"),
  stale: false,
};

describe("PM2.5 model map", () => {
  it("round-trips projected coordinates and clamps keyboard exploration to coverage", () => {
    const point = references[0]?.coordinate;
    if (!point) throw new Error("Missing test point");
    const [x, y] = projectMapPoint(point);
    expect(mapCoordinate(x, y).latitude).toBeCloseTo(point.latitude, 10);
    expect(mapCoordinate(x, y).longitude).toBeCloseTo(point.longitude, 10);
    expect(mapCoordinate(-100, -100)).toEqual({ latitude: 1.5, longitude: 103.59 });
    expect(mapCoordinate(900, 900)).toEqual({ latitude: 1.13, longitude: 104.1 });
  });

  it("samples the production estimator and encodes only its severity bands", () => {
    const field = buildHeatmapCells(reading);
    const estimate = estimatePm25({
      coordinate: mapCoordinate(5, 5),
      references,
      values: reading.values,
    });
    if (estimate.kind !== "estimated") throw new Error("Expected estimate");
    expect(field).toContain(
      `class="heatmap-cell pm25-tone-${classifyPm25(estimate.estimate.value).level}" x="0" y="0"`,
    );
    for (const level of [1, 2, 3, 4]) expect(field).toContain(`pm25-tone-${level}`);
  });

  it("generates a uniform band for identical regional readings", () => {
    const values = {
      north: pm25Schema.parse(80),
      south: pm25Schema.parse(80),
      east: pm25Schema.parse(80),
      west: pm25Schema.parse(80),
      central: pm25Schema.parse(80),
    };
    const field = buildHeatmapCells({ ...reading, values });
    expect(field).toContain("pm25-tone-2");
    expect(field).not.toMatch(/pm25-tone-[134]/);
  });

  it("builds lazily and exposes exact-point weights, cached status, and limitations", () => {
    const root = document.createElement("div");
    root.innerHTML = renderPm25Map();
    const disclosure = root.querySelector<HTMLDetailsElement>("details");
    if (!disclosure) throw new Error("Missing disclosure");
    bindPm25Map(root, { ...reading, stale: true }, references[0]?.coordinate ?? null, "cached");
    expect(root.querySelector("svg")).toBeNull();
    disclosure.open = true;
    disclosure.dispatchEvent(new Event("toggle"));
    expect(root.querySelector("svg")).not.toBeNull();
    expect(root.querySelector(".heatmap-point")?.textContent).toContain(
      "Your location estimate: 20.00 µg/m³",
    );
    expect(root.querySelector(".heatmap-point")?.textContent).toContain(
      "Cached source data · Stale",
    );
    expect(root.querySelector("tbody tr")?.textContent).toContain("100.00%");
    expect(root.textContent).toContain("Modelled estimates—not measured coverage");
  });
});
