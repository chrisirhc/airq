import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pm25Response, psiResponse } from "../tests/browser/fixtures";
import { createAirQualityController } from "./air-quality-controller";
import type { AirQualitySnapshot } from "./domain";
import { lookupLocationName } from "./location-name";
import { parsePm25, parsePsi } from "./public-readings";

const { loadAirQuality } = vi.hoisted(() => ({ loadAirQuality: vi.fn() }));
vi.mock("./air-quality-client", () => ({
  createAirQualityClient: () => ({ load: loadAirQuality }),
}));
vi.mock("./location-name", () => ({ lookupLocationName: vi.fn() }));

function available(): AirQualitySnapshot {
  return {
    pm25: {
      kind: "available",
      source: "live",
      reading: parsePm25(pm25Response, new Date(), 45 * 60 * 1000),
    },
    psi: {
      kind: "available",
      source: "live",
      reading: parsePsi(psiResponse, new Date(), 45 * 60 * 1000),
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanup: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadAirQuality).mockReset();
  vi.mocked(lookupLocationName).mockReset().mockResolvedValue(null);
  vi.stubGlobal("navigator", {
    permissions: { query: vi.fn().mockResolvedValue({ state: "prompt" }) },
    geolocation: { getCurrentPosition: vi.fn() },
  });
});
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("React browser controller lifecycle", () => {
  it("has a pure factory and stable snapshots until an update is published", () => {
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const controller = createAirQualityController();
    expect(loadAirQuality).not.toHaveBeenCalled();
    expect(addDocumentListener).not.toHaveBeenCalled();
    expect(addWindowListener).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    const notify = vi.fn();
    cleanup.push(controller.subscribe(notify));
    controller.selectRegion("west");
    expect(controller.getSnapshot().state.display).toEqual({ kind: "manual", region: "west" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores a pre-cleanup data response after Strict Mode effect replay", async () => {
    const old = deferred<AirQualitySnapshot>();
    const current = deferred<AirQualitySnapshot>();
    vi.mocked(loadAirQuality).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const controller = createAirQualityController();
    controller.start()();
    cleanup.push(controller.start());
    current.resolve(available());
    await vi.waitFor(() => expect(controller.getSnapshot().state.data.kind).toBe("loaded"));
    const snapshot = controller.getSnapshot();
    old.resolve({
      pm25: { kind: "unavailable", message: "Old result" },
      psi: { kind: "unavailable", message: "Old result" },
    });
    await old.promise;
    await Promise.resolve();
    expect(controller.getSnapshot()).toBe(snapshot);
  });

  it("detaches browser listeners and does not publish late data after unmount", async () => {
    const result = deferred<AirQualitySnapshot>();
    vi.mocked(loadAirQuality).mockReturnValue(result.promise);
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const controller = createAirQualityController();
    const notify = vi.fn();
    cleanup.push(controller.subscribe(notify));
    const stop = controller.start();
    await Promise.resolve();
    stop();
    const calls = notify.mock.calls.length;
    result.resolve(available());
    await result.promise;
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(calls);
    expect(controller.getSnapshot().state.data.kind).toBe("loading");
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("focus", expect.any(Function));
  });

  it("ignores a late browser position after unmount", async () => {
    vi.mocked(loadAirQuality).mockResolvedValue(available());
    const controller = createAirQualityController();
    const stop = controller.start();
    await vi.waitFor(() => expect(controller.getSnapshot().state.data.kind).toBe("loaded"));
    controller.requestLocation();
    const success = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0]?.[0];
    if (!success) throw new Error("Missing position callback");
    stop();
    success({ coords: { latitude: 1.32, longitude: 103.88 } } as GeolocationPosition);
    expect(controller.getSnapshot().state.display.kind).toBe("manual");
    expect(lookupLocationName).not.toHaveBeenCalled();
  });

  it("rejects obsolete retries and late geocoding after a manual choice", async () => {
    vi.mocked(loadAirQuality).mockResolvedValue(available());
    const controller = createAirQualityController();
    cleanup.push(controller.start());
    await vi.waitFor(() => expect(controller.getSnapshot().state.data.kind).toBe("loaded"));
    const old = deferred<AirQualitySnapshot>();
    const current = deferred<AirQualitySnapshot>();
    vi.mocked(loadAirQuality).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    controller.retry();
    controller.retry();
    current.resolve(available());
    await vi.waitFor(() => expect(controller.getSnapshot().state.data.kind).toBe("loaded"));
    old.resolve({
      pm25: { kind: "unavailable", message: "Old retry" },
      psi: { kind: "unavailable", message: "Old retry" },
    });
    await old.promise;
    await Promise.resolve();
    expect(controller.getSnapshot().state.data.kind).toBe("loaded");
    const name = deferred<string | null>();
    vi.mocked(lookupLocationName).mockReturnValue(name.promise);
    controller.requestLocation();
    const success = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0]?.[0];
    if (!success) throw new Error("Missing position callback");
    success({ coords: { latitude: 1.32, longitude: 103.88 } } as GeolocationPosition);
    expect(controller.getSnapshot().state.display.kind).toBe("estimated");
    controller.selectRegion("west");
    name.resolve("Late name <img src=x>");
    await name.promise;
    await Promise.resolve();
    expect(controller.getSnapshot().state.display).toEqual({ kind: "manual", region: "west" });
  });
});
