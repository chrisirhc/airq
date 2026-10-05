import type { Coordinate, Pm25, Region, RegionalValues, RegionReference } from "./domain";

const EARTH_RADIUS_METERS = 6_371_000;
const EXACT_POINT_METERS = 1;

export const SINGAPORE_COVERAGE = {
  minLatitude: 1.13,
  maxLatitude: 1.5,
  minLongitude: 103.59,
  maxLongitude: 104.1,
};

export interface Contribution {
  readonly region: Region;
  readonly weight: number;
  readonly value: Pm25;
  readonly distanceMeters: number;
}

export interface Pm25Estimate {
  readonly value: number;
  readonly closestRegion: Region;
  readonly contributions: readonly Contribution[];
}

export type EstimateResult =
  | { readonly kind: "estimated"; readonly estimate: Pm25Estimate }
  | { readonly kind: "outside-coverage" }
  | { readonly kind: "invalid-input"; readonly message: string };

export function isWithinSingaporeCoverage(coordinate: Coordinate): boolean {
  return (
    coordinate.latitude >= SINGAPORE_COVERAGE.minLatitude &&
    coordinate.latitude <= SINGAPORE_COVERAGE.maxLatitude &&
    coordinate.longitude >= SINGAPORE_COVERAGE.minLongitude &&
    coordinate.longitude <= SINGAPORE_COVERAGE.maxLongitude
  );
}

export function estimatePm25({
  coordinate,
  references,
  values,
}: {
  readonly coordinate: Coordinate;
  readonly references: readonly RegionReference[];
  readonly values: RegionalValues<Pm25>;
}): EstimateResult {
  if (!isWithinSingaporeCoverage(coordinate)) return { kind: "outside-coverage" };
  if (references.length !== 5) {
    return { kind: "invalid-input", message: "All five regional reference points are required." };
  }

  const points = references.map((reference) => ({
    ...reference,
    value: values[reference.name],
    distanceMeters: haversineDistance(coordinate, reference.coordinate),
  }));

  const exact = points.find((point) => point.distanceMeters <= EXACT_POINT_METERS);
  if (exact) {
    return {
      kind: "estimated",
      estimate: {
        value: exact.value,
        closestRegion: exact.name,
        contributions: points.map((point) => ({
          region: point.name,
          value: point.value,
          distanceMeters: point.distanceMeters,
          weight: point.name === exact.name ? 1 : 0,
        })),
      },
    };
  }

  const closestRegion = points.reduce((closest, point) =>
    point.distanceMeters < closest.distanceMeters ? point : closest,
  );
  const minimumDistance = closestRegion.distanceMeters;
  const weighted = points.map((point) => ({
    ...point,
    rawWeight: (minimumDistance / point.distanceMeters) ** 2,
  }));
  const weightSum = weighted.reduce((sum, point) => sum + point.rawWeight, 0);

  if (!Number.isFinite(weightSum) || weightSum <= 0) {
    return { kind: "invalid-input", message: "The regional weights could not be calculated." };
  }

  const contributions = weighted.map((point) => ({
    region: point.name,
    value: point.value,
    distanceMeters: point.distanceMeters,
    weight: point.rawWeight / weightSum,
  }));
  const value = contributions.reduce(
    (sum, contribution) => sum + contribution.weight * contribution.value,
    0,
  );

  return {
    kind: "estimated",
    estimate: { value, closestRegion: closestRegion.name, contributions },
  };
}

export function haversineDistance(from: Coordinate, to: Coordinate): number {
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const halfLatitude = Math.sin(latitudeDelta / 2);
  const halfLongitude = Math.sin(longitudeDelta / 2);
  const a =
    halfLatitude * halfLatitude +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * halfLongitude * halfLongitude;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
