import { memo, useMemo, useState } from "react";
import { classifyPm25 } from "./classifiers";
import { type Coordinate, coordinateSchema, REGION_LABELS, type ReadingSource } from "./domain";
import { estimatePm25 } from "./location-estimator";
import {
  buildHeatmapCells,
  CELL,
  HEIGHT,
  type MapReading,
  mapCoordinate,
  projectMapPoint,
  WIDTH,
} from "./pm25-map";
import { SINGAPORE_OUTLINE } from "./singapore-outline";

const OUTLINE = `${SINGAPORE_OUTLINE.map(([longitude, latitude], index) => {
  const [x, y] = projectMapPoint(coordinateSchema.parse({ latitude, longitude }));
  return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
}).join(" ")} Z`;
const EXAMPLE_POINT = coordinateSchema.parse({ latitude: 1.35, longitude: 103.82 });
const MOVEMENT: Record<string, readonly [number, number]> = {
  ArrowLeft: [-CELL, 0],
  ArrowRight: [CELL, 0],
  ArrowUp: [0, -CELL],
  ArrowDown: [0, CELL],
};

function MapLegend() {
  return (
    <>
      <ul className="heatmap-legend" aria-label="PM2.5 estimate bands">
        {(
          ["Normal · 0–55", "Elevated · >55–150", "High · >150–250", "Very High · >250"] as const
        ).map((label, index) => (
          <li key={label} className={`pm25-tone-${index + 1}`}>
            <span className="severity-marker" aria-hidden="true" />
            {label} µg/m³
          </li>
        ))}
      </ul>
      <p>
        Cells are colored by band, not by weight. A single-color map means the estimates share a
        band; inspect points to see differences within that band. Values are classified before
        rounding.
      </p>
    </>
  );
}

// A bounded cache retains the coarse field across disclosure and location remounts.
let cachedKey = "";
let cachedCells: ReturnType<typeof buildHeatmapCells> = [];
function heatmapCells(reading: MapReading) {
  const key = JSON.stringify([reading.values, reading.references]);
  if (key !== cachedKey) {
    cachedCells = buildHeatmapCells(reading);
    cachedKey = key;
  }
  return cachedCells;
}

const HeatmapField = memo(function HeatmapField({ reading }: { reading: MapReading }) {
  const cells = useMemo(() => heatmapCells(reading), [reading]);
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: This decorative SVG group has no focusable descendants.
    <g clipPath="url(#singapore-land)" aria-hidden="true" focusable="false">
      {cells.map(({ x, y, band }) => (
        <rect
          key={`${x},${y}`}
          className={`heatmap-cell pm25-tone-${band}`}
          x={x}
          y={y}
          width={CELL}
          height={CELL}
        />
      ))}
    </g>
  );
});

export default memo(function MapInspection({
  reading,
  location,
  source,
}: {
  reading: MapReading;
  location: Coordinate | null;
  source: ReadingSource;
}) {
  const [inspection, setInspection] = useState(() => ({
    point: location ?? EXAMPLE_POINT,
    label: location ? "Your location estimate" : "Example point estimate",
  }));
  const result = estimatePm25({
    coordinate: inspection.point,
    references: reading.references,
    values: reading.values,
  });
  if (result.kind !== "estimated") return null;
  const { estimate } = result;
  const band = classifyPm25(estimate.value);
  const [x, y] = projectMapPoint(inspection.point);
  const [locationX, locationY] = location ? projectMapPoint(location) : [0, 0];
  function inspect(point: Coordinate) {
    setInspection({ point, label: "Inspected estimate" });
  }
  return (
    <>
      <div className="heatmap-chart">
        {/* biome-ignore lint/a11y/useSemanticElements: A fieldset cannot replace an interactive SVG coordinate surface. */}
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Arrow-key inspection requires a single focus target.
          tabIndex={0}
          role="group"
          aria-label="Interactive modelled PM2.5 heatmap"
          aria-describedby="map-instructions"
          onClick={(event) => {
            const region =
              event.target instanceof Element
                ? event.target.closest("[data-region]")?.getAttribute("data-region")
                : null;
            const reference = reading.references.find(({ name }) => name === region);
            if (reference) {
              inspect(reference.coordinate);
              return;
            }
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
              matrix.inverse(),
            );
            inspect(mapCoordinate(point.x, point.y));
          }}
          onKeyDown={(event) => {
            const delta = MOVEMENT[event.key];
            if (!delta) return;
            event.preventDefault();
            inspect(mapCoordinate(x + delta[0], y + delta[1]));
          }}
        >
          <title>Interactive modelled PM2.5 heatmap</title>
          <defs>
            <clipPath id="singapore-land">
              <path d={OUTLINE} />
            </clipPath>
          </defs>
          <HeatmapField reading={reading} />
          <path className="map-coast" d={OUTLINE} />
          {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: Decorative SVG lines and paths are not keyboard targets. */}
          <g className="map-inspection" aria-hidden="true" focusable="false">
            {estimate.contributions.map((item) => {
              const reference = reading.references.find(({ name }) => name === item.region);
              if (!reference || item.weight === 0) return null;
              const [toX, toY] = projectMapPoint(reference.coordinate);
              return (
                <line
                  key={item.region}
                  x1={x}
                  y1={y}
                  x2={toX}
                  y2={toY}
                  strokeWidth={1 + item.weight * 5}
                />
              );
            })}
            <path d={`M${x - 8},${y}h16 M${x},${y - 8}v16`} strokeWidth={2} />
          </g>
          {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: Reference dots are not focusable; keyboard users explore the parent SVG and read the table. */}
          <g className="map-references" aria-hidden="true" focusable="false">
            {reading.references.map(({ name, coordinate }) => {
              const [refX, refY] = projectMapPoint(coordinate);
              return (
                <g key={name} data-region={name}>
                  <circle cx={refX} cy={refY} r={5} />
                  <text x={refX} y={refY - 12} textAnchor="middle">
                    {REGION_LABELS[name]} · {reading.values[name]}
                  </text>
                </g>
              );
            })}
          </g>
          {location && (
            // biome-ignore lint/a11y/noAriaHiddenOnFocusable: This decorative SVG location marker is not focusable.
            <g className="map-location" aria-hidden="true" focusable="false">
              <circle cx={locationX} cy={locationY} r={10} />
              <text x={locationX + 14} y={locationY + 24}>
                Your location
              </text>
            </g>
          )}
          <text x={WIDTH - 25} y={30} textAnchor="end">
            N ↑
          </text>
        </svg>
      </div>
      <MapLegend />
      <div className="heatmap-point" aria-live="polite" aria-atomic="true">
        <h3>
          {inspection.label}: {estimate.value.toFixed(2)} µg/m³
        </h3>
        <p>
          Band {band.level} · {band.label}. Source range:{" "}
          {Math.min(...Object.values(reading.values))}–{Math.max(...Object.values(reading.values))}{" "}
          µg/m³. Source reading:{" "}
          {reading.timestamp.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })} (Singapore
          time) · {source === "cached" ? "Cached source data" : "Live source data"}
          {reading.stale ? " · Stale" : ""}.
        </p>
        <p>
          Closer reference points have more influence. Line thickness represents their weight. An
          exact reference point receives 100% weight.
        </p>
        <table>
          <caption>Regional readings and weights at this point</caption>
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col">PM2.5 µg/m³</th>
              <th scope="col">Weight</th>
            </tr>
          </thead>
          <tbody>
            {estimate.contributions.map((item) => (
              <tr key={item.region}>
                <th scope="row">{REGION_LABELS[item.region]}</th>
                <td>{item.value}</td>
                <td>{(item.weight * 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
});
