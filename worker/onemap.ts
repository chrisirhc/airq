import { z } from "zod";
import { type Coordinate, coordinateSchema } from "../src/domain";
import { haversineDistance, isWithinSingaporeCoverage } from "../src/location-estimator";

export interface OneMapEnv {
  ONEMAP_EMAIL?: string;
  ONEMAP_PASSWORD?: string;
}

type OneMapStage = "authentication" | "reverse-geocoding";
type FailureDetails =
  | { stage: "configuration"; reason: "not-configured" }
  | {
      stage: OneMapStage;
      reason: "http-error" | "invalid-response";
      upstreamStatus: number;
      durationMs: number;
    }
  | {
      stage: OneMapStage;
      reason: "timeout" | "network-error";
      durationMs: number;
    };

class OneMapError extends Error {
  constructor(readonly details: FailureDetails) {
    super(
      details.stage === "authentication"
        ? "OneMap authentication unavailable"
        : "OneMap lookup unavailable",
    );
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expiry_timestamp: z.coerce.number().finite().positive(),
});
const addressSchema = z.object({
  BUILDINGNAME: z.string().nullable().optional(),
  BLOCK: z.string().nullable().optional(),
  ROAD: z.string().nullable().optional(),
  LATITUDE: z.coerce.number().finite(),
  LONGITUDE: z.coerce.number().finite(),
});
const addressesSchema = z.object({ GeocodeInfo: z.array(addressSchema) });

function named(value: string | null | undefined): string | null {
  const name = value?.trim();
  return name && !/^(NIL|NULL|NA|N\/A)$/i.test(name) ? name : null;
}

export function createOneMapClient(env: OneMapEnv, request: typeof fetch = fetch) {
  let token: z.infer<typeof tokenSchema> | undefined;
  let pendingToken: Promise<z.infer<typeof tokenSchema>> | undefined;

  async function readResponse<T>(
    stage: OneMapStage,
    url: string | URL,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(3_000);
    let upstreamStatus: number | undefined;
    try {
      const response = await request(url, { ...init, signal });
      upstreamStatus = response.status;
      if (!response.ok)
        throw new OneMapError({
          stage,
          reason: "http-error",
          upstreamStatus: response.status,
          durationMs: Date.now() - startedAt,
        });
      const result = schema.safeParse(await response.json());
      if (!result.success)
        throw new OneMapError({
          stage,
          reason: "invalid-response",
          upstreamStatus,
          durationMs: Date.now() - startedAt,
        });
      return result.data;
    } catch (error) {
      if (error instanceof OneMapError) throw error;
      if (error instanceof SyntaxError && upstreamStatus !== undefined)
        throw new OneMapError({
          stage,
          reason: "invalid-response",
          upstreamStatus,
          durationMs: Date.now() - startedAt,
        });
      const reason =
        signal.aborted ||
        ((error instanceof Error || error instanceof DOMException) && error.name === "TimeoutError")
          ? "timeout"
          : "network-error";
      throw new OneMapError({ stage, reason, durationMs: Date.now() - startedAt });
    }
  }

  async function accessToken(): Promise<string> {
    if (token && token.expiry_timestamp * 1000 > Date.now() + 60_000) return token.access_token;
    pendingToken ??= readResponse(
      "authentication",
      "https://www.onemap.gov.sg/api/auth/post/getToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }),
      },
      tokenSchema,
    );
    try {
      token = await pendingToken;
      return token.access_token;
    } finally {
      pendingToken = undefined;
    }
  }

  return async (coordinate: Coordinate): Promise<string | null> => {
    if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD)
      throw new OneMapError({ stage: "configuration", reason: "not-configured" });
    const url = new URL("https://www.onemap.gov.sg/api/public/revgeocode");
    url.searchParams.set("location", `${coordinate.latitude},${coordinate.longitude}`);
    url.searchParams.set("buffer", "100");
    url.searchParams.set("addressType", "All");
    const authorization = await accessToken();
    let addresses: z.infer<typeof addressSchema>[];
    try {
      addresses = (
        await readResponse(
          "reverse-geocoding",
          url,
          {
            headers: { Authorization: `Bearer ${authorization}` },
          },
          addressesSchema,
        )
      ).GeocodeInfo;
    } catch (error) {
      if (
        error instanceof OneMapError &&
        error.details.reason === "http-error" &&
        error.details.upstreamStatus === 401
      )
        token = undefined;
      throw error;
    }
    const candidates = addresses.flatMap((address) => {
      const position = coordinateSchema.safeParse({
        latitude: address.LATITUDE,
        longitude: address.LONGITUDE,
      });
      const building = named(address.BUILDINGNAME);
      const road = named(address.ROAD);
      const block = named(address.BLOCK);
      const label = building ?? (road ? [block, road].filter(Boolean).join(" ") : null);
      if (!position.success || !label || label.length > 200) return [];
      return [{ label, distance: haversineDistance(coordinate, position.data) }];
    });
    candidates.sort((a, b) => a.distance - b.distance);
    return candidates[0]?.label ?? null;
  };
}

const clients = new WeakMap<OneMapEnv, ReturnType<typeof createOneMapClient>>();

export async function handleLocation(request: Request, env: OneMapEnv): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    return json({ error: "Same-origin request required" }, 403);
  if (request.headers.get("Content-Type") !== "application/json")
    return json({ error: "JSON required" }, 415);
  const body = await request.text();
  if (body.length > 256) return json({ error: "Request too large" }, 413);
  let coordinate: Coordinate;
  try {
    coordinate = coordinateSchema.parse(JSON.parse(body));
  } catch {
    return json({ error: "Invalid coordinates" }, 400);
  }
  if (!isWithinSingaporeCoverage(coordinate))
    return json({ error: "Outside Singapore coverage" }, 400);
  let client = clients.get(env);
  if (!client) {
    client = createOneMapClient(env);
    clients.set(env, client);
  }
  const startedAt = Date.now();
  try {
    return json({ label: await client(coordinate) });
  } catch (error) {
    console.error({
      event: "onemap_lookup_failed",
      status: 503,
      ...(error instanceof OneMapError
        ? error.details
        : { stage: "internal", reason: "unexpected" }),
      totalDurationMs: Date.now() - startedAt,
    });
    return json({ error: "Location name unavailable" }, 503);
  }
}
