import { classifyPm25 } from "./classifiers";
import {
  type Coordinate,
  coordinateSchema,
  type MetricReading,
  type Pm25,
  type RegionReference,
} from "./domain";
import { estimatePm25, SINGAPORE_COVERAGE } from "./location-estimator";

export type MapReading = MetricReading<Pm25> & { readonly references: readonly RegionReference[] };
export const WIDTH = 760;
export const HEIGHT = 550;
export const CELL = 10;
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
export function buildHeatmapCells(reading: MapReading) {
  const cells: { x: number; y: number; band: number }[] = [];
  for (let y = 0; y < HEIGHT; y += CELL) {
    for (let x = 0; x < WIDTH; x += CELL) {
      const result = estimatePm25({
        coordinate: mapCoordinate(x + CELL / 2, y + CELL / 2),
        references: reading.references,
        values: reading.values,
      });
      if (result.kind !== "estimated") continue;
      cells.push({ x, y, band: classifyPm25(result.estimate.value).level });
    }
  }
  return cells;
}
