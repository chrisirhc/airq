import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pm25Response, psiResponse } from "../tests/browser/fixtures";
import { loadAirQuality, parsePm25, parsePsi } from "./air-quality-client";
import { createAppController } from "./app-state";
import type { AirQualitySnapshot } from "./domain";
import { lookupLocationName } from "./location-name";

vi.mock("./air-quality-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./air-quality-client")>()),
  loadAirQuality: vi.fn(),
}));
vi.mock("./location-name", () => ({ lookupLocationName: vi.fn() }));

const snapshot: AirQualitySnapshot = {
  pm25: {
    kind: "available",
    source: "live",
    reading: parsePm25(pm25Response, new Date(), 2_700_000),
  },
  psi: { kind: "available", source: "live", reading: parsePsi(psiResponse, new Date(), 2_700_000) },
};
const position = {
  coords: { latitude: 1.35735, longitude: 103.94 },
} as GeolocationPosition;
let success: PositionCallback | undefined;
const getPosition = vi.fn((callback: PositionCallback) => {
  success = callback;
});
const permission = vi.fn(async () => ({ state: "prompt" }));
const controllers: ReturnType<typeof createAppController>[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup() {
  const badge = { start: vi.fn(async () => {}), savedRegion: vi.fn(() => null), sync: vi.fn() };
  const onChange = vi.fn();
  const controller = createAppController(badge, onChange);
  controllers.push(controller);
  return { controller, badge, onChange };
}

beforeEach(() => {
  localStorage.clear();
  success = undefined;
  getPosition.mockClear();
  permission.mockReset().mockResolvedValue({ state: "prompt" });
  vi.mocked(loadAirQuality).mockReset().mockResolvedValue(snapshot);
  vi.mocked(lookupLocationName).mockReset().mockResolvedValue(null);
  vi.stubGlobal("navigator", {
    permissions: { query: permission },
    geolocation: { getCurrentPosition: getPosition },
  });
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllGlobals();
});

describe("connection-scoped app controller", () => {
  it("aborts requests and ignores late data and badge readiness after disconnect", async () => {
    const pendingData = deferred<AirQualitySnapshot>();
    const pendingBadge = deferred<void>();
    vi.mocked(loadAirQuality).mockReturnValue(pendingData.promise);
    const { controller, badge, onChange } = setup();
    badge.start.mockReturnValue(pendingBadge.promise);
    const initializing = controller.initialize();
    controller.dispose();
    const signal = vi.mocked(loadAirQuality).mock.calls[0]?.[0]?.signal;
    expect(signal?.aborted).toBe(true);
    const renders = onChange.mock.calls.length;
    pendingData.resolve(snapshot);
    pendingBadge.resolve();
    await initializing;
    expect(onChange).toHaveBeenCalledTimes(renders);
    expect(badge.sync).not.toHaveBeenCalled();
    expect(getPosition).not.toHaveBeenCalled();
    expect(controller.state.data.kind).toBe("loading");
  });

  it("ignores permission results after disconnect", async () => {
    const pendingPermission = deferred<{ state: string }>();
    permission.mockReturnValue(pendingPermission.promise);
    const { controller } = setup();
    const initializing = controller.initialize();
    await vi.waitFor(() => expect(permission).toHaveBeenCalled());
    controller.dispose();
    pendingPermission.resolve({ state: "granted" });
    await initializing;
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("does not let a late geolocation callback overwrite manual selection or a disposed app", async () => {
    const { controller, badge, onChange } = setup();
    await controller.initialize();
    controller.requestLocation();
    expect(controller.state.location.kind).toBe("requesting");
    controller.selectRegion("west");
    success?.(position);
    expect(controller.state.display).toEqual({ kind: "manual", region: "west" });
    expect(localStorage.getItem("airq:location-mode")).toBe("disabled");
    expect(lookupLocationName).not.toHaveBeenCalled();
    expect(badge.sync.mock.lastCall?.[1]).toBe(true);
    controller.requestLocation();
    controller.dispose();
    const renders = onChange.mock.calls.length;
    success?.(position);
    expect(onChange).toHaveBeenCalledTimes(renders);
    expect(controller.state.display).toEqual({ kind: "manual", region: "west" });
  });

  it("uses exact-point weights and drops a late name after manual selection", async () => {
    const pendingName = deferred<string | null>();
    vi.mocked(lookupLocationName).mockReturnValue(pendingName.promise);
    const { controller, badge } = setup();
    await controller.initialize();
    controller.requestLocation();
    success?.(position);
    expect(controller.state.display).toMatchObject({ kind: "estimated", estimate: { value: 30 } });
    expect(badge.sync.mock.lastCall?.[0]?.target).toMatchObject({
      kind: "estimate",
      weights: { east: 1, north: 0, south: 0, west: 0, central: 0 },
    });
    controller.selectRegion("central");
    pendingName.resolve("A late building name");
    await pendingName.promise;
    expect(controller.state.display).toEqual({ kind: "manual", region: "central" });
  });

  it("aborts OneMap lookup and ignores its late result on disconnect", async () => {
    const pendingName = deferred<string | null>();
    vi.mocked(lookupLocationName).mockReturnValue(pendingName.promise);
    const { controller, onChange } = setup();
    await controller.initialize();
    controller.requestLocation();
    success?.(position);
    const signal = vi.mocked(lookupLocationName).mock.lastCall?.[1];
    controller.dispose();
    expect(signal?.aborted).toBe(true);
    const renders = onChange.mock.calls.length;
    pendingName.resolve("Must not render");
    await pendingName.promise;
    expect(onChange).toHaveBeenCalledTimes(renders);
  });

  it("refreshes estimates and invalidates them when reference geometry changes", async () => {
    const { controller } = setup();
    await controller.initialize();
    controller.requestLocation();
    success?.(position);
    const response = structuredClone(pm25Response);
    const item = response.data.items[0];
    const reference = response.data.regionMetadata[2];
    if (!item || !reference) throw new Error("Missing fixture reading or reference");
    item.readings.pm25_one_hourly.east = 35;
    const refreshed = {
      ...snapshot,
      pm25: {
        kind: "available" as const,
        source: "live" as const,
        reading: parsePm25(response, new Date(), 2_700_000),
      },
    };
    vi.mocked(loadAirQuality).mockResolvedValue(refreshed);
    controller.retry();
    await vi.waitFor(() =>
      expect(controller.state.display).toMatchObject({ estimate: { value: 35 } }),
    );
    reference.labelLocation.longitude = 103.95;
    vi.mocked(loadAirQuality).mockResolvedValue({
      ...refreshed,
      pm25: {
        ...refreshed.pm25,
        reading: parsePm25(response, new Date(), 2_700_000),
      },
    });
    controller.retry();
    await vi.waitFor(() =>
      expect(controller.state.display).toEqual({ kind: "manual", region: "east" }),
    );
    expect(controller.state.location).toMatchObject({
      kind: "error",
      message: expect.stringContaining("reference points changed"),
    });
  });

  it("ignores an older data response when refreshes overlap", async () => {
    const { controller } = setup();
    await controller.initialize();
    const older = deferred<AirQualitySnapshot>();
    vi.mocked(loadAirQuality).mockReturnValueOnce(older.promise).mockResolvedValueOnce(snapshot);
    controller.retry();
    controller.retry();
    await vi.waitFor(() => expect(controller.state.data).toMatchObject({ kind: "loaded" }));
    older.resolve({ pm25: { kind: "unavailable", message: "Old failure" }, psi: snapshot.psi });
    await older.promise;
    expect(controller.state.data).toEqual({ kind: "loaded", snapshot });
  });

  it("resumes a remembered location when permission queries are unsupported", async () => {
    localStorage.setItem("airq:location-mode", "enabled");
    permission.mockRejectedValue(new TypeError("Unsupported permission"));
    const { controller } = setup();
    await controller.initialize();
    expect(getPosition).toHaveBeenCalledOnce();
    success?.(position);
    expect(controller.state.display.kind).toBe("estimated");
  });
});
