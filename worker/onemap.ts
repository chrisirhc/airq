import { z } from "zod";
import { type Coordinate, coordinateSchema } from "../src/domain";
import { haversineDistance, isWithinSingaporeCoverage } from "../src/location-estimator";

export interface OneMapEnv {
  ONEMAP_EMAIL?: string;
  ONEMAP_PASSWORD?: string;
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

  async function accessToken(): Promise<string> {
    if (token && token.expiry_timestamp * 1000 > Date.now() + 60_000) return token.access_token;
    pendingToken ??= (async () => {
      const response = await request("https://www.onemap.gov.sg/api/auth/post/getToken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }),
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) throw new Error("OneMap authentication unavailable");
      return tokenSchema.parse(await response.json());
    })();
    try {
      token = await pendingToken;
      return token.access_token;
    } finally {
      pendingToken = undefined;
    }
  }

  return async (coordinate: Coordinate): Promise<string | null> => {
    if (!env.ONEMAP_EMAIL || !env.ONEMAP_PASSWORD) throw new Error("OneMap is not configured");
    const url = new URL("https://www.onemap.gov.sg/api/public/revgeocode");
    url.searchParams.set("location", `${coordinate.latitude},${coordinate.longitude}`);
    url.searchParams.set("buffer", "100");
    url.searchParams.set("addressType", "All");
    const authorization = await accessToken();
    const response = await request(url, {
      headers: { Authorization: `Bearer ${authorization}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status === 401) token = undefined;
    if (!response.ok) throw new Error("OneMap lookup unavailable");
    const { GeocodeInfo: addresses } = addressesSchema.parse(await response.json());
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
  try {
    return json({ label: await client(coordinate) });
  } catch {
    return json({ error: "Location name unavailable" }, 503);
  }
}
