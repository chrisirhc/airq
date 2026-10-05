import { z } from "zod";
import type { AirQualitySnapshot, MetricResult } from "./domain";
import { parsePm25, parsePsi } from "./public-readings";

export { parsePm25, parsePsi } from "./public-readings";

const PM25_URL = "https://api-open.data.gov.sg/v2/real-time/api/pm25";
const PSI_URL = "https://api-open.data.gov.sg/v2/real-time/api/psi";
const PM25_CACHE_KEY = "airq:pm25:v1";
const PSI_CACHE_KEY = "airq:psi:v1";
const DEFAULT_STALE_AFTER_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6_000;

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
