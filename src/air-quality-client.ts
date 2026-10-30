import { clientValueRoot, createClient } from "@nkzw/fate";
import { type AirQualityClientOptions, createAirQualityTransport } from "./air-quality-transport";
import type { AirQualitySnapshot } from "./domain";

export { parsePm25, parsePsi } from "./public-readings";

const readingsRequest = {
  pm25: { value: true },
  psi: { value: true },
} as const;

export function createAirQualityClient(options: AirQualityClientOptions = {}) {
  const client = createClient({
    roots: {
      pm25: clientValueRoot<AirQualitySnapshot["pm25"]>(),
      psi: clientValueRoot<AirQualitySnapshot["psi"]>(),
    },
    transport: createAirQualityTransport(options),
    types: [],
  });

  return {
    load: (): Promise<AirQualitySnapshot> =>
      client.request(readingsRequest, { mode: "network-only" }),
  };
}
