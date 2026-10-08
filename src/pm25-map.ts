import { classifyPm25 } from "./classifiers";
import {
  type Coordinate,
  coordinateSchema,
  type MetricReading,
  type Pm25,
  REGION_LABELS,
  type ReadingSource,
  type RegionReference,
} from "./domain";
import { estimatePm25, type Pm25Estimate, SINGAPORE_COVERAGE } from "./location-estimator";
import { SINGAPORE_OUTLINE } from "./singapore-outline";

type MapReading = MetricReading<Pm25> & { readonly references: readonly RegionReference[] };
const WIDTH = 760;
const HEIGHT = 550;
const CELL = 10;
const BOUNDS = SINGAPORE_COVERAGE;

export function projectMapPoint(point: Coordinate): readonly [number, number] {
  return [
    ((point.longitude - BOUNDS.minLongitude) / (BOUNDS.maxLongitude - BOUNDS.minLongitude)) * WIDTH,
    ((BOUNDS.maxLatitude - point.latitude) / (BOUNDS.maxLatitude - BOUNDS.minLatitude)) * HEIGHT,
  ];
}

export function mapCoordinate(x: number, y: number): Coordinate {
  return coordinateSchema.parse({
    longitude:
      BOUNDS.minLongitude +
      (Math.max(0, Math.min(WIDTH, x)) / WIDTH) * (BOUNDS.maxLongitude - BOUNDS.minLongitude),
    latitude:
      BOUNDS.maxLatitude -
      (Math.max(0, Math.min(HEIGHT, y)) / HEIGHT) * (BOUNDS.maxLatitude - BOUNDS.minLatitude),
  });
}

export function buildHeatmapCells(reading: MapReading): string {
  let cells = "";
  for (let y = 0; y < HEIGHT; y += CELL) {
    for (let x = 0; x < WIDTH; x += CELL) {
      const result = estimatePm25({
        coordinate: mapCoordinate(x + CELL / 2, y + CELL / 2),
        references: reading.references,
        values: reading.values,
      });
      if (result.kind !== "estimated") continue;
      const band = classifyPm25(result.estimate.value).level;
      cells += `<rect class="heatmap-cell pm25-tone-${band}" x="${x}" y="${y}" width="${CELL}" height="${CELL}"/>`;
    }
  }
  return cells;
}

export function renderPm25Map(): string {
  return `<details class="pm25-map" id="pm25-map">
    <summary>Explore the PM2.5 estimate map</summary>
    <p>Modelled estimates—not measured coverage. Every cell uses the same inverse-square distance weighting as the PM2.5 card. This is not a pollution forecast or a health advisory.</p>
    <p id="map-instructions">Tap the map to inspect a point, or focus it and use the arrow keys. The neutral dots are regional reference points, not individual monitoring stations. Inspecting the map does not change your selected location.</p>
    <div class="heatmap-chart"></div>
    <ul class="heatmap-legend" aria-label="PM2.5 estimate bands">
      ${(["Normal · 0–55", "Elevated · >55–150", "High · >150–250", "Very High · >250"] as const).map((label, index) => `<li class="pm25-tone-${index + 1}"><span class="severity-marker" aria-hidden="true"></span>${label} µg/m³</li>`).join("")}
    </ul>
    <p>Cells are colored by band, not by weight. A single-color map means the estimates share a band; inspect points to see differences within that band. Values are classified before rounding.</p>
    <div class="heatmap-point" aria-live="polite" aria-atomic="true"></div>
    <p class="map-attribution">Simplified land outline: <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">Natural Earth (public domain)</a>, via <a href="https://github.com/datasets/geo-countries" target="_blank" rel="noreferrer">geo-countries</a>. Offshore islands and recent reclamation may be omitted. The model ignores wind, local sources, and street-level variation.</p>
  </details>`;
}

// Cache the coarse field across UI renders; location and inspection overlays are independent.
let cachedKey = "";
let cachedCells = "";

export function bindPm25Map(
  root: HTMLElement,
  reading: MapReading,
  location: Coordinate | null,
  source: ReadingSource,
): void {
  const disclosure = root.querySelector<HTMLDetailsElement>("#pm25-map");
  if (!disclosure) return;
  let initialized = false;
  let inspected = location ?? coordinateSchema.parse({ latitude: 1.35, longitude: 103.82 });

  function inspect(point: Coordinate, label: string): void {
    const result = estimatePm25({
      coordinate: point,
      references: reading.references,
      values: reading.values,
    });
    if (result.kind !== "estimated") return;
    inspected = point;
    const overlay = disclosure?.querySelector(".map-inspection");
    if (overlay) overlay.innerHTML = inspectionOverlay(point, result.estimate, reading.references);
    const output = disclosure?.querySelector(".heatmap-point");
    if (!output) return;
    const band = classifyPm25(result.estimate.value);
    const rows = result.estimate.contributions
      .map(
        (item) =>
          `<tr><th scope="row">${REGION_LABELS[item.region]}</th><td>${item.value}</td><td>${(item.weight * 100).toFixed(2)}%</td></tr>`,
      )
      .join("");
    output.innerHTML = `<h3>${label}: ${result.estimate.value.toFixed(2)} µg/m³</h3>
      <p>Band ${band.level} · ${band.label}. Source range: ${Math.min(...Object.values(reading.values))}–${Math.max(...Object.values(reading.values))} µg/m³. Source reading: ${reading.timestamp.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} (Singapore time) · ${source === "cached" ? "Cached source data" : "Live source data"}${reading.stale ? " · Stale" : ""}.</p>
      <p>Closer reference points have more influence. Line thickness represents their weight. An exact reference point receives 100% weight.</p>
      <table><caption>Regional readings and weights at this point</caption><thead><tr><th scope="col">Region</th><th scope="col">PM2.5 µg/m³</th><th scope="col">Weight</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function initialize(): void {
    if (!disclosure?.open || initialized) return;
    initialized = true;
    const key = JSON.stringify([reading.values, reading.references]);
    if (key !== cachedKey) {
      cachedCells = buildHeatmapCells(reading);
      cachedKey = key;
    }
    const path = `${SINGAPORE_OUTLINE.map(([longitude, latitude], index) => {
      const [x, y] = projectMapPoint(coordinateSchema.parse({ latitude, longitude }));
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ")} Z`;
    const markers = reading.references
      .map(({ name, coordinate }) => {
        const [x, y] = projectMapPoint(coordinate);
        return `<g data-region="${name}"><circle cx="${x}" cy="${y}" r="5"/><text x="${x}" y="${y - 12}" text-anchor="middle">${REGION_LABELS[name]} · ${reading.values[name]}</text></g>`;
      })
      .join("");
    const chart = disclosure.querySelector(".heatmap-chart");
    if (!chart) return;
    chart.innerHTML = `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" tabindex="0" role="group" aria-label="Interactive modelled PM2.5 heatmap" aria-describedby="map-instructions">
      <defs><clipPath id="singapore-land"><path d="${path}"/></clipPath></defs>
      <g clip-path="url(#singapore-land)" aria-hidden="true">${cachedCells}</g>
      <path class="map-coast" d="${path}"/>
      <g class="map-inspection" aria-hidden="true"></g>
      <g class="map-references" aria-hidden="true">${markers}</g>
      ${location ? locationMarker(location) : ""}
      <text x="${WIDTH - 25}" y="30" text-anchor="end">N ↑</text>
    </svg>`;
    const svg = chart.querySelector("svg");
    svg?.addEventListener("click", (event) => {
      const region =
        event.target instanceof Element
          ? event.target.closest("[data-region]")?.getAttribute("data-region")
          : null;
      const reference = reading.references.find(({ name }) => name === region);
      if (reference) {
        inspect(reference.coordinate, "Inspected estimate");
        return;
      }
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      inspect(mapCoordinate(point.x, point.y), "Inspected estimate");
    });
    svg?.addEventListener("keydown", (event) => {
      const movement: Record<string, readonly [number, number]> = {
        ArrowLeft: [-CELL, 0],
        ArrowRight: [CELL, 0],
        ArrowUp: [0, -CELL],
        ArrowDown: [0, CELL],
      };
      const delta = movement[event.key];
      if (!delta) return;
      event.preventDefault();
      const [x, y] = projectMapPoint(inspected);
      inspect(mapCoordinate(x + delta[0], y + delta[1]), "Inspected estimate");
    });
    inspect(inspected, location ? "Your location estimate" : "Example point estimate");
  }

  disclosure.addEventListener("toggle", initialize);
  initialize();
}

function locationMarker(point: Coordinate): string {
  const [x, y] = projectMapPoint(point);
  return `<g class="map-location" aria-hidden="true"><circle cx="${x}" cy="${y}" r="10"/><text x="${x + 14}" y="${y + 24}">Your location</text></g>`;
}

function inspectionOverlay(
  point: Coordinate,
  estimate: Pm25Estimate,
  references: readonly RegionReference[],
): string {
  const [x, y] = projectMapPoint(point);
  const lines = estimate.contributions
    .map((item) => {
      const reference = references.find(({ name }) => name === item.region);
      if (!reference || item.weight === 0) return "";
      const [toX, toY] = projectMapPoint(reference.coordinate);
      return `<line x1="${x}" y1="${y}" x2="${toX}" y2="${toY}" stroke-width="${1 + item.weight * 5}"/>`;
    })
    .join("");
  return `${lines}<path d="M${x - 8},${y}h16 M${x},${y - 8}v16" stroke-width="2"/>`;
}
