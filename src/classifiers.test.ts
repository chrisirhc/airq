import { describe, expect, it } from "vitest";
import { classifyPm25, classifyPsi } from "./classifiers";

describe("air-quality classifications", () => {
  it.each([
    [55, { level: 1, label: "Normal" }],
    [56, { level: 2, label: "Elevated" }],
    [150, { level: 2, label: "Elevated" }],
    [151, { level: 3, label: "High" }],
    [250, { level: 3, label: "High" }],
    [251, { level: 4, label: "Very high" }],
  ] as const)("classifies PM2.5 value %s", (value, expected) => {
    expect(classifyPm25(value)).toEqual(expected);
  });

  it.each([
    [50, "Good"],
    [51, "Moderate"],
    [100, "Moderate"],
    [101, "Unhealthy"],
    [200, "Unhealthy"],
    [201, "Very unhealthy"],
    [300, "Very unhealthy"],
    [301, "Hazardous"],
  ] as const)("classifies PSI value %s", (value, expected) => {
    expect(classifyPsi(value)).toBe(expected);
  });
});
