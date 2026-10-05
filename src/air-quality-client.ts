import { z } from "zod";
import {
  type AirQualitySnapshot,
  type MetricReading,
  type MetricResult,
  type Pm25,
  type Psi,
  pm25Schema,
  psiSchema,
  type RegionReference,
  regionSchema,
} from "./domain";

const PM25_URL = "https://api-open.data.gov.sg/v2/real-time/api/pm25";
const PSI_URL = "https://api-open.data.gov.sg/v2/real-time/api/psi";
const PM25_CACHE_KEY = "airq:pm25:v1";
const PSI_CACHE_KEY = "airq:psi:v1";
const DEFAULT_STALE_AFTER_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6_000;

const regionalPm25Schema = z.object({
  north: pm25Schema,
  south: pm25Schema,
  east: pm25Schema,
  west: pm25Schema,
  central: pm25Schema,
});

const regionalPsiSchema = z.object({
  north: psiSchema,
  south: psiSchema,
  east: psiSchema,
  west: psiSchema,
  central: psiSchema,
});

const timestampSchema = z.iso.datetime({ offset: true }).transform((value, context) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    context.addIssue({ code: "custom", message: "Invalid timestamp" });
    return z.NEVER;
  }
  return date;
});

const regionMetadataSchema = z
  .array(
    z.object({
      name: regionSchema,
      labelLocation: z.object({
        latitude: z.number().finite().min(-90).max(90).brand<"Latitude">(),
        longitude: z.number().finite().min(-180).max(180).brand<"Longitude">(),
      }),
    }),
  )
  .length(5)
  .superRefine((metadata, context) => {
    const names = new Set(metadata.map((entry) => entry.name));
    if (names.size !== 5)
      context.addIssue({ code: "custom", message: "Region metadata must be unique" });
  });

const pm25ResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    regionMetadata: regionMetadataSchema,
    items: z
      .array(
        z.object({
          timestamp: timestampSchema,
          updatedTimestamp: timestampSchema,
          readings: z.object({ pm25_one_hourly: regionalPm25Schema }),
        }),
      )
      .min(1),
  }),
});

const psiResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    items: z
      .array(
        z.object({
          timestamp: timestampSchema,
          updatedTimestamp: timestampSchema,
          readings: z.object({ psi_twenty_four_hourly: regionalPsiSchema }),
        }),
      )
      .min(1),
  }),
});

type Pm25Reading = MetricReading<Pm25> & { readonly references: readonly RegionReference[] };

export interface AirQualityClientOptions {
  readonly fetcher?: typeof fetch;
  readonly storage?: Storage;
  readonly now?: () => Date;
  readonly staleAfterMs?: number;
}

export async function loadAirQuality(
  options: AirQualityClientOptions = {},
): Promise<AirQualitySnapshot> {
  const fetcher = options.fetcher ?? fetch;
  const storage = options.storage ?? window.localStorage;
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  const [pm25, psi] = await Promise.all([
    loadMetric({
      url: PM25_URL,
      cacheKey: PM25_CACHE_KEY,
      fetcher,
      storage,
      parse: (value) => parsePm25(value, now(), staleAfterMs),
    }),
    loadMetric({
      url: PSI_URL,
      cacheKey: PSI_CACHE_KEY,
      fetcher,
      storage,
      parse: (value) => parsePsi(value, now(), staleAfterMs),
    }),
  ]);

  return { pm25, psi };
}

export function parsePm25(value: unknown, now: Date, staleAfterMs: number): Pm25Reading {
  const response = pm25ResponseSchema.parse(value);
  const item = response.data.items.at(-1);
  if (!item) throw new Error("PM2.5 response did not contain a reading.");

  return {
    values: item.readings.pm25_one_hourly,
    timestamp: item.timestamp,
    updatedAt: item.updatedTimestamp,
    stale: isStale(item.updatedTimestamp, now, staleAfterMs),
    references: response.data.regionMetadata.map((entry) => ({
      name: entry.name,
      coordinate: entry.labelLocation,
    })),
  };
}

export function parsePsi(value: unknown, now: Date, staleAfterMs: number): MetricReading<Psi> {
  const response = psiResponseSchema.parse(value);
  const item = response.data.items.at(-1);
  if (!item) throw new Error("PSI response did not contain a reading.");

  return {
    values: item.readings.psi_twenty_four_hourly,
    timestamp: item.timestamp,
    updatedAt: item.updatedTimestamp,
    stale: isStale(item.updatedTimestamp, now, staleAfterMs),
  };
}

function isStale(updatedAt: Date, now: Date, staleAfterMs: number): boolean {
  return now.getTime() - updatedAt.getTime() > staleAfterMs;
}

async function loadMetric<T>({
  url,
  cacheKey,
  fetcher,
  storage,
  parse,
}: {
  readonly url: string;
  readonly cacheKey: string;
  readonly fetcher: typeof fetch;
  readonly storage: Storage;
  readonly parse: (value: unknown) => T;
}): Promise<MetricResult<T>> {
  try {
    const raw = await fetchJsonWithRetry(url, fetcher);
    const reading = parse(raw);
    safelyWrite(storage, cacheKey, raw);
    return { kind: "available", source: "live", reading };
  } catch (error) {
    const cached = safelyRead(storage, cacheKey);
    if (cached !== undefined) {
      try {
        return { kind: "available", source: "cached", reading: parse(cached) };
      } catch {
        safelyRemove(storage, cacheKey);
      }
    }

    return { kind: "unavailable", message: errorMessage(error) };
  }
}

async function fetchJsonWithRetry(url: string, fetcher: typeof fetch): Promise<unknown> {
  let latestError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
      return await response.json();
    } catch (error) {
      latestError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw latestError;
}

function safelyWrite(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Reading live data remains useful when private browsing or storage limits block caching.
  }
}

function safelyRead(storage: Storage, key: string): unknown | undefined {
  try {
    const value = storage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
  } catch {
    return undefined;
  }
}

function safelyRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage errors do not change the current network result.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return "The data source returned an unexpected response.";
  if (error instanceof DOMException && error.name === "AbortError")
    return "The data request timed out.";
  if (error instanceof Error) return error.message;
  return "The air-quality data could not be loaded.";
}
