import { clientValueRoot, createClient } from "@nkzw/fate";
import { type AirQualityClientOptions, createAirQualityTransport } from "./air-quality-transport";
import type { AirQualitySnapshot } from "./domain";

export { parsePm25, parsePsi } from "./public-readings";

export const readingsRequest = {
  pm25: { value: true },
  psi: { value: true },
} as const;

export const airQualityRoots = {
  pm25: clientValueRoot<AirQualitySnapshot["pm25"]>(),
  psi: clientValueRoot<AirQualitySnapshot["psi"]>(),
};

export function createAirQualityClient(options: AirQualityClientOptions = {}) {
  return createClient({
    roots: airQualityRoots,
    transport: createAirQualityTransport(options),
    types: [],
  });
}

export type AirQualityClient = ReturnType<typeof createAirQualityClient>;
