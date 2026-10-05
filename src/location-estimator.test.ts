import { describe, expect, it } from "vitest";
import {
  coordinateSchema,
  pm25Schema,
  type Region,
  type RegionalValues,
  type RegionReference,
} from "./domain";
import { estimatePm25 } from "./location-estimator";

const references: readonly RegionReference[] = [
  { name: "north", coordinate: coordinateSchema.parse({ latitude: 1.41803, longitude: 103.82 }) },
  { name: "south", coordinate: coordinateSchema.parse({ latitude: 1.29587, longitude: 103.82 }) },
  { name: "east", coordinate: coordinateSchema.parse({ latitude: 1.35735, longitude: 103.94 }) },
  { name: "west", coordinate: coordinateSchema.parse({ latitude: 1.35735, longitude: 103.7 }) },
  { name: "central", coordinate: coordinateSchema.parse({ latitude: 1.35735, longitude: 103.82 }) },
];

const values: RegionalValues<ReturnType<typeof pm25Schema.parse>> = {
  north: pm25Schema.parse(20),
  south: pm25Schema.parse(30),
  east: pm25Schema.parse(40),
  west: pm25Schema.parse(50),
  central: pm25Schema.parse(60),
};

describe("PM2.5 estimation", () => {
  it("reproduces a reading at its reference coordinate", () => {
    const result = estimatePm25({
      coordinate: coordinateSchema.parse({ latitude: 1.35735, longitude: 103.94 }),
      references,
      values,
    });

    expect(result).toMatchObject({
      kind: "estimated",
      estimate: { value: 40, closestRegion: "east" },
    });
    if (result.kind !== "estimated") return;
    expect(result.estimate.contributions.find(({ region }) => region === "east")?.weight).toBe(1);
  });

  it("gives equal weights to equidistant points", () => {
    const symmetricReferences: readonly RegionReference[] = [
      ...references.slice(0, 3),
      { name: "west", coordinate: coordinateSchema.parse({ latitude: 1.35, longitude: 103.8 }) },
      {
        name: "central",
        coordinate: coordinateSchema.parse({ latitude: 1.35, longitude: 103.84 }),
      },
    ];
    const symmetricValues = {
      ...values,
      west: pm25Schema.parse(20),
      central: pm25Schema.parse(60),
    };
    const result = estimatePm25({
      coordinate: coordinateSchema.parse({ latitude: 1.35, longitude: 103.82 }),
      references: symmetricReferences,
      values: symmetricValues,
    });

    expect(result.kind).toBe("estimated");
    if (result.kind !== "estimated") return;
    const west = contributionWeight(result.estimate.contributions, "west");
    const central = contributionWeight(result.estimate.contributions, "central");
    expect(west).toBeCloseTo(central, 8);
  });

  it("normalizes weights and keeps the estimate inside the source range", () => {
    const result = estimatePm25({
      coordinate: coordinateSchema.parse({ latitude: 1.32, longitude: 103.88 }),
      references,
      values,
    });

    expect(result.kind).toBe("estimated");
    if (result.kind !== "estimated") return;
    expect(result.estimate.contributions.reduce((sum, item) => sum + item.weight, 0)).toBeCloseTo(
      1,
      12,
    );
    expect(result.estimate.value).toBeGreaterThanOrEqual(20);
    expect(result.estimate.value).toBeLessThanOrEqual(60);
    expect(result.estimate.value).toBeCloseTo(40.5305, 3);
  });

  it("rejects a coordinate outside Singapore", () => {
    expect(
      estimatePm25({
        coordinate: coordinateSchema.parse({ latitude: 51.5072, longitude: -0.1276 }),
        references,
        values,
      }),
    ).toEqual({ kind: "outside-coverage" });
  });

  it("rejects an incomplete reference set", () => {
    expect(
      estimatePm25({
        coordinate: coordinateSchema.parse({ latitude: 1.35, longitude: 103.82 }),
        references: references.slice(0, 4),
        values,
      }),
    ).toEqual({
      kind: "invalid-input",
      message: "All five regional reference points are required.",
    });
  });
});

function contributionWeight(
  contributions: readonly { readonly region: Region; readonly weight: number }[],
  region: Region,
): number {
  const contribution = contributions.find((item) => item.region === region);
  if (!contribution) throw new Error(`Missing ${region} contribution.`);
  return contribution.weight;
}
