import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DisclosureProvider } from "./disclosures";
import { Pm25Map } from "./pm25-map-view";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { classifyPm25 } from "./classifiers";
import { coordinateSchema, pm25Schema, REGIONS } from "./domain";
import { estimatePm25 } from "./location-estimator";
import { buildHeatmapCells, mapCoordinate, projectMapPoint } from "./pm25-map";

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
    expect(field[0]).toEqual({ x: 0, y: 0, band: classifyPm25(estimate.estimate.value).level });
    for (const level of [1, 2, 3, 4]) expect(field.some((cell) => cell.band === level)).toBe(true);
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
    expect(field.length).toBeGreaterThan(0);
    expect(field.every((cell) => cell.band === 2)).toBe(true);
  });

  it("builds lazily and exposes exact-point weights, cached status, and limitations", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <DisclosureProvider>
            <Pm25Map
              reading={{ ...reading, stale: true }}
              location={references[0]?.coordinate ?? null}
              source="cached"
            />
          </DisclosureProvider>,
        ),
      );
      const disclosure = container.querySelector<HTMLDetailsElement>("details");
      if (!disclosure) throw new Error("Missing disclosure");
      expect(container.querySelector("svg")).toBeNull();
      await act(async () => {
        disclosure.open = true;
        disclosure.dispatchEvent(new Event("toggle"));
      });
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.querySelector(".heatmap-point")?.textContent).toContain(
        "Your location estimate: 20.00 µg/m³",
      );
      expect(container.querySelector(".heatmap-point")?.textContent).toContain(
        "Cached source data · Stale",
      );
      expect(container.querySelector("tbody tr")?.textContent).toContain("100.00%");
      expect(container.textContent).toContain("Modelled estimates—not measured coverage");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
