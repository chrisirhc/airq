import { describe, expect, it, vi } from "vitest";
import { createOneMapClient, handleLocation } from "../worker/onemap";
import { coordinateSchema } from "./domain";

const coordinate = coordinateSchema.parse({ latitude: 1.3254295, longitude: 103.9005321 });
const credentials = { ONEMAP_EMAIL: "test@example.com", ONEMAP_PASSWORD: "test-password" };
const authResponse = () =>
  Response.json({ access_token: "test-token", expiry_timestamp: Date.now() / 1000 + 259200 });
const addresses = {
  GeocodeInfo: [
    { BUILDINGNAME: "FARTHER BUILDING", LATITUDE: "1.326", LONGITUDE: "103.901" },
    {
      BUILDINGNAME: "null",
      BLOCK: "351",
      ROAD: "UBI AVENUE 1",
      LATITUDE: "1.325486284730739",
      LONGITUDE: "103.90072773995409",
    },
  ],
};

describe("OneMap location lookup", () => {
  it("returns the nearest usable label and reuses authentication", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(Response.json(addresses))
      .mockResolvedValueOnce(Response.json(addresses));
    const lookup = createOneMapClient(credentials, request);
    expect(await lookup(coordinate)).toBe("351 UBI AVENUE 1");
    expect(await lookup(coordinate)).toBe("351 UBI AVENUE 1");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        email: "test@example.com",
        password: "test-password",
      }),
    );
    const lookupUrl = new URL(String(request.mock.calls[1]?.[0]));
    expect(lookupUrl.searchParams.get("location")).toBe("1.3254295,103.9005321");
    expect(request.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: "Bearer test-token" });
  });

  it("renews an expiring token", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: "old", expiry_timestamp: Date.now() / 1000 + 10 }),
      )
      .mockResolvedValueOnce(Response.json(addresses))
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(Response.json(addresses));
    const lookup = createOneMapClient(credentials, request);
    await lookup(coordinate);
    expect(await lookup(coordinate)).toBe("351 UBI AVENUE 1");
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[3]?.[1]?.headers).toEqual({ Authorization: "Bearer test-token" });
  });

  it("shares token acquisition between simultaneous lookups", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("getToken") ? authResponse() : Response.json(addresses),
      );
    const lookup = createOneMapClient(credentials, request);
    expect(await Promise.all([lookup(coordinate), lookup(coordinate)])).toEqual([
      "351 UBI AVENUE 1",
      "351 UBI AVENUE 1",
    ]);
    expect(request.mock.calls.filter(([url]) => String(url).endsWith("getToken"))).toHaveLength(1);
  });

  it("returns no label for no nearby address or unnamed results", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(Response.json({ GeocodeInfo: [] }))
      .mockResolvedValueOnce(
        Response.json({
          GeocodeInfo: [
            { BUILDINGNAME: "NIL", ROAD: "NIL", LATITUDE: "1.325", LONGITUDE: "103.9" },
          ],
        }),
      );
    const lookup = createOneMapClient(credentials, request);
    expect(await lookup(coordinate)).toBeNull();
    expect(await lookup(coordinate)).toBeNull();
  });

  it("does not repeatedly retry rate-limited requests", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(createOneMapClient(credentials, request)(coordinate)).rejects.toThrow(
      "OneMap lookup unavailable",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-origin and out-of-coverage requests before calling OneMap", async () => {
    const request = (origin: string, body = coordinate) =>
      new Request("https://airq.test/api/location", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await handleLocation(request("https://evil.test"), {})).status).toBe(403);
    const outside = coordinateSchema.parse({ latitude: 40, longitude: 100 });
    expect((await handleLocation(request("https://airq.test", outside), {})).status).toBe(400);
    const unavailable = await handleLocation(request("https://airq.test"), {});
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("Cache-Control")).toBe("no-store");
  });
});
