import { describe, expect, it } from "vitest";
import { loadAirQuality, parsePm25, parsePsi } from "./air-quality-client";

const now = new Date("2026-10-05T10:00:00+08:00");

describe("air-quality API parsing", () => {
  it("parses a complete PM2.5 response into regional values", () => {
    const reading = parsePm25(pm25Response(), now, 45 * 60 * 1000);

    expect(reading.values).toEqual({ north: 10, south: 20, east: 30, west: 40, central: 50 });
    expect(reading.references[2]).toEqual({
      name: "east",
      coordinate: { latitude: 1.35735, longitude: 103.94 },
    });
    expect(reading.stale).toBe(false);
  });

  it("marks an old PSI response stale", () => {
    expect(parsePsi(psiResponse("2026-10-05T08:00:00+08:00"), now, 45 * 60 * 1000).stale).toBe(
      true,
    );
  });

  it("rejects a response with a missing regional value", () => {
    expect(() =>
      parsePm25(
        {
          ...pm25Response(),
          data: {
            ...pm25Response().data,
            items: [
              {
                timestamp: "2026-10-05T09:45:00+08:00",
                updatedTimestamp: "2026-10-05T09:46:00+08:00",
                readings: { pm25_one_hourly: { north: 10, south: 20, east: 30, central: 50 } },
              },
            ],
          },
        },
        now,
        45 * 60 * 1000,
      ),
    ).toThrow();
  });

  it("uses cached PSI only when the live PSI request fails", async () => {
    const storage = new MemoryStorage();
    const successfulFetcher = makeFetcher({ pm25: pm25Response(), psi: psiResponse() });
    await loadAirQuality({ fetcher: successfulFetcher, storage, now: () => now });

    const mixedFetcher = makeFetcher({ pm25: pm25Response(), psi: new Error("PSI is down") });
    const result = await loadAirQuality({ fetcher: mixedFetcher, storage, now: () => now });

    expect(result.pm25).toMatchObject({ kind: "available", source: "live" });
    expect(result.psi).toMatchObject({ kind: "available", source: "cached" });
  });
});

function pm25Response() {
  return {
    code: 0,
    data: {
      regionMetadata: [
        { name: "north", labelLocation: { latitude: 1.41803, longitude: 103.82 } },
        { name: "south", labelLocation: { latitude: 1.29587, longitude: 103.82 } },
        { name: "east", labelLocation: { latitude: 1.35735, longitude: 103.94 } },
        { name: "west", labelLocation: { latitude: 1.35735, longitude: 103.7 } },
        { name: "central", labelLocation: { latitude: 1.35735, longitude: 103.82 } },
      ],
      items: [
        {
          timestamp: "2026-10-05T09:45:00+08:00",
          updatedTimestamp: "2026-10-05T09:46:00+08:00",
          readings: {
            pm25_one_hourly: { north: 10, south: 20, east: 30, west: 40, central: 50 },
          },
        },
      ],
    },
  };
}

function psiResponse(updatedTimestamp = "2026-10-05T09:46:00+08:00") {
  return {
    code: 0,
    data: {
      items: [
        {
          timestamp: "2026-10-05T09:00:00+08:00",
          updatedTimestamp,
          readings: {
            psi_twenty_four_hourly: { north: 40, south: 50, east: 60, west: 70, central: 80 },
          },
        },
      ],
    },
  };
}

function makeFetcher({ pm25, psi }: { pm25: unknown; psi: unknown }): typeof fetch {
  return async (input) => {
    const value = String(input).endsWith("/pm25") ? pm25 : psi;
    if (value instanceof Error) throw value;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}
