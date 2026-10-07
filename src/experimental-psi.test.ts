import { describe, expect, it } from "vitest";
import { psiSchema, type Region, type RegionalValues } from "./domain";
import { estimateExperimentalPsi } from "./experimental-psi";

const values: RegionalValues<ReturnType<typeof psiSchema.parse>> = {
  north: psiSchema.parse(40),
  south: psiSchema.parse(50),
  east: psiSchema.parse(60),
  west: psiSchema.parse(70),
  central: psiSchema.parse(80),
};
const weights = (["north", "south", "east", "west", "central"] as Region[]).map((region) => ({
  region,
  weight: 0.2,
  distanceMeters: 100,
}));

describe("experimental PSI blend", () => {
  it("uses normalized location weights without changing regional readings", () => {
    const estimate = estimateExperimentalPsi(weights, values);
    expect(estimate?.value).toBe(60);
    expect(estimate?.contributions.map(({ value }) => value)).toEqual([40, 50, 60, 70, 80]);
    expect(values.east).toBe(60);
  });

  it("reproduces the regional PSI at an exact reference point", () => {
    const estimate = estimateExperimentalPsi(
      weights.map((item) => ({ ...item, weight: item.region === "east" ? 1 : 0 })),
      values,
    );
    expect(estimate?.value).toBe(60);
  });

  it("keeps fractional precision and reacts to refreshed PSI values", () => {
    const byRegion: Record<Region, number> = {
      north: 0.1,
      south: 0.2,
      east: 0.3,
      west: 0.15,
      central: 0.25,
    };
    const uneven = weights.map((item) => ({ ...item, weight: byRegion[item.region] }));
    expect(estimateExperimentalPsi(uneven, values)?.value).toBeCloseTo(62.5);
    expect(
      estimateExperimentalPsi(uneven, { ...values, east: psiSchema.parse(100) })?.value,
    ).toBeCloseTo(74.5);
  });

  it("rejects missing or duplicate regions rather than changing the method", () => {
    expect(estimateExperimentalPsi(weights.slice(1), values)).toBeNull();
    expect(
      estimateExperimentalPsi(
        weights.map((item) => ({
          ...item,
          region: item.region === "central" ? "south" : item.region,
        })),
        values,
      ),
    ).toBeNull();
  });

  it.each([NaN, Infinity, -1])("rejects invalid PSI %s even for a zero-weight region", (value) => {
    const exact = weights.map((item) => ({ ...item, weight: item.region === "east" ? 1 : 0 }));
    expect(
      estimateExperimentalPsi(exact, { ...values, north: value as typeof values.north }),
    ).toBeNull();
  });

  it.each([NaN, Infinity, -0.1, 2])("rejects invalid weight %s", (weight) => {
    expect(
      estimateExperimentalPsi(
        weights.map((item) => ({
          ...item,
          weight: item.region === "north" ? weight : item.weight,
        })),
        values,
      ),
    ).toBeNull();
  });

  it("rejects weights that do not sum to one", () => {
    expect(
      estimateExperimentalPsi(
        weights.map((item) => ({ ...item, weight: 0.1 })),
        values,
      ),
    ).toBeNull();
  });
});
