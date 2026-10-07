import { type Psi, REGIONS, type RegionalValues } from "./domain";
import type { Contribution } from "./location-estimator";

export interface ExperimentalPsiEstimate {
  readonly value: number;
  readonly contributions: readonly (Omit<Contribution, "value"> & { readonly value: Psi })[];
}

/**
 * Blend regional PSI indices using the location's existing PM2.5 distance weights.
 * This does not reconstruct local pollutant sub-indices or an official PSI.
 * Returns null rather than silently dropping regions or renormalizing incomplete data.
 * See ADR-004 for the scientific limitations of this experimental display.
 */
export function estimateExperimentalPsi(
  weights: readonly Omit<Contribution, "value">[],
  values: RegionalValues<Psi>,
): ExperimentalPsiEstimate | null {
  if (
    weights.length !== REGIONS.length ||
    new Set(weights.map(({ region }) => region)).size !== REGIONS.length ||
    weights.some(
      ({ region, weight, distanceMeters }) =>
        !REGIONS.includes(region) ||
        !Number.isFinite(weight) ||
        weight < 0 ||
        weight > 1 ||
        !Number.isFinite(distanceMeters) ||
        distanceMeters < 0 ||
        !Number.isFinite(values[region]) ||
        values[region] < 0,
    ) ||
    Math.abs(weights.reduce((sum, { weight }) => sum + weight, 0) - 1) > 1e-9
  ) {
    return null;
  }

  const contributions = weights.map((contribution) => ({
    ...contribution,
    value: values[contribution.region],
  }));
  const value = contributions.reduce((sum, item) => sum + item.weight * item.value, 0);
  return Number.isFinite(value) ? { value, contributions } : null;
}
