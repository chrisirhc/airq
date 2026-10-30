import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pm25Response, psiResponse } from "../tests/browser/fixtures";
import { createAirQualityController } from "./air-quality-controller";
import type { AirQualitySnapshot } from "./domain";
import { lookupLocationName } from "./location-name";
import { parsePm25, parsePsi } from "./public-readings";

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
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const cleanup: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
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
    const fetch = vi.spyOn(globalThis, "fetch");
    const documentListener = vi.spyOn(document, "addEventListener");
    const windowListener = vi.spyOn(window, "addEventListener");
    const controller = createAirQualityController(available());
    expect(fetch).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();
    expect(windowListener).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(controller.getSnapshot());
    const notify = vi.fn();
    cleanup.push(controller.subscribe(notify));
    controller.selectRegion("west");
    expect(controller.getSnapshot().state.display).toEqual({ kind: "manual", region: "west" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("ignores a pre-cleanup permission response after Strict Mode effect replay", async () => {
    const old = deferred<PermissionStatus>();
    vi.mocked(navigator.permissions.query).mockReturnValueOnce(old.promise);
    const controller = createAirQualityController(available());
    controller.start()();
    cleanup.push(controller.start());
    const permission = {
      state: "granted",
      onchange: null,
      name: "geolocation",
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    } satisfies PermissionStatus;
    old.resolve(permission);
    await old.promise;
    await Promise.resolve();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("detaches browser listeners and ignores readings delivered after unmount", async () => {
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const controller = createAirQualityController(available());
    const notify = vi.fn();
    cleanup.push(controller.subscribe(notify));
    const stop = controller.start();
    await Promise.resolve();
    stop();
    const snapshot = controller.getSnapshot();
    const calls = notify.mock.calls.length;
    controller.updateReadings({
      pm25: { kind: "unavailable", message: "Late readings" },
      psi: { kind: "unavailable", message: "Late readings" },
    });
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(notify).toHaveBeenCalledTimes(calls);
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("focus", expect.any(Function));
  });

  it("ignores a late browser position after unmount", async () => {
    const controller = createAirQualityController(available());
    const stop = controller.start();
    controller.requestLocation();
    const success = vi.mocked(navigator.geolocation.getCurrentPosition).mock.calls[0]?.[0];
    if (!success) throw new Error("Missing position callback");
    stop();
    success({ coords: { latitude: 1.32, longitude: 103.88 } } as GeolocationPosition);
    expect(controller.getSnapshot().state.display.kind).toBe("manual");
    expect(lookupLocationName).not.toHaveBeenCalled();
  });

  it("ignores late geocoding after a manual choice", async () => {
    const controller = createAirQualityController(available());
    cleanup.push(controller.start());
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
