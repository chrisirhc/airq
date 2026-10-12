import { loadAirQuality } from "./air-quality-client";
import { createBackgroundBadge } from "./background-badge";
import {
  badgeTargetSchema,
  ESTIMATOR_VERSION,
  READING_LIFETIME_MS,
  referenceFingerprint,
  TARGET_LIFETIME_MS,
} from "./badge-domain";
import { type AirQualitySnapshot, type Coordinate, coordinateSchema, type Region } from "./domain";
import { estimatePm25, type Pm25Estimate } from "./location-estimator";
import { lookupLocationName } from "./location-name";

const LOCATION_PREFERENCE_KEY = "airq:location-mode";

export type DisplayMode =
  | { readonly kind: "manual"; readonly region: Region }
  | {
      readonly kind: "estimated";
      readonly estimate: Pm25Estimate;
      readonly referenceFingerprint: string;
      readonly capturedAt: number;
      readonly locationName: string | null;
      readonly coordinate: Coordinate;
    };

type DataState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly snapshot: AirQualitySnapshot };

type LocationState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting" }
  | { readonly kind: "error"; readonly message: string };

export interface AppState {
  readonly data: DataState;
  readonly display: DisplayMode;
  readonly location: LocationState;
}

// Browser callbacks share one synchronous state snapshot; React subscribes without tearing.
export function createAirQualityController() {
  let loadGeneration = 0;
  let state: AppState = {
    data: { kind: "loading" },
    display: { kind: "manual", region: "central" },
    location: { kind: "idle" },
  };

  let locationRequestId = 0;
  let active = false;
  const listeners = new Set<() => void>();
  const badge = createBackgroundBadge(publish);
  let snapshot = { state, badge: badge.view() };

  function publish(): void {
    snapshot = { state, badge: badge.view() };
    if (active) for (const listener of listeners) listener();
  }

  async function initialize(): Promise<void> {
    const generation = locationRequestId;
    void badge.start().then(() => {
      if (!active || generation !== locationRequestId) return;
      const savedRegion = badge.savedRegion();
      if (savedRegion && locationRequestId === generation)
        state = { ...state, display: { kind: "manual", region: savedRegion } };
      syncBadge(state.display.kind === "estimated");
      publish();
    });
    await load();
    if (
      !active ||
      locationRequestId !== generation ||
      state.data.kind !== "loaded" ||
      state.data.snapshot.pm25.kind !== "available"
    ) {
      return;
    }

    const preference = readLocationPreference();
    if (preference === "disabled") return;

    let permission: PermissionState | undefined;
    try {
      permission = (await navigator.permissions?.query({ name: "geolocation" }))?.state;
    } catch {
      // A remembered location choice also works when permission queries are unsupported.
    }

    if (!active || locationRequestId !== generation) return;
    if (permission === "denied") {
      saveLocationPreference("disabled");
      return;
    }
    if (permission === "granted" || preference === "enabled") requestLocation();
  }

  function readLocationPreference(): "enabled" | "disabled" | undefined {
    try {
      const preference = localStorage.getItem(LOCATION_PREFERENCE_KEY);
      return preference === "enabled" || preference === "disabled" ? preference : undefined;
    } catch {
      return undefined;
    }
  }

  function saveLocationPreference(preference: "enabled" | "disabled"): void {
    try {
      localStorage.setItem(LOCATION_PREFERENCE_KEY, preference);
    } catch {
      // Location remains usable when browser storage is unavailable.
    }
  }

  async function load(): Promise<void> {
    const generation = loadGeneration;
    const snapshot = await loadAirQuality();
    if (!active || generation !== loadGeneration) return;
    if (state.display.kind === "estimated" && snapshot.pm25.kind === "available") {
      const display = state.display;
      const reading = snapshot.pm25.reading;
      if (display.referenceFingerprint === referenceFingerprint(reading.references)) {
        const contributions = display.estimate.contributions.map((contribution) => ({
          ...contribution,
          value: reading.values[contribution.region],
        }));
        state = {
          ...state,
          display: {
            ...display,
            estimate: {
              ...display.estimate,
              contributions,
              value: contributions.reduce(
                (sum, contribution) => sum + contribution.weight * contribution.value,
                0,
              ),
            },
          },
        };
      } else {
        state = {
          ...state,
          display: { kind: "manual", region: display.estimate.closestRegion },
          location: {
            kind: "error",
            message:
              "Regional reference points changed. Use your location again to rebuild the estimate.",
          },
        };
      }
    }
    state = { ...state, data: { kind: "loaded", snapshot } };
    syncBadge(false);
    publish();
  }

  function syncBadge(replaceTarget: boolean): void {
    if (state.data.kind === "loading") return;
    if (state.data.snapshot.pm25.kind !== "available") {
      badge.sync(null, false);
      return;
    }
    const reading = state.data.snapshot.pm25.reading;
    const snapshot = {
      revision: 0,
      readingAt: reading.timestamp.getTime(),
      updatedAt: reading.updatedAt.getTime(),
      validUntil: reading.updatedAt.getTime() + READING_LIFETIME_MS,
      referenceFingerprint: referenceFingerprint(reading.references),
      estimatorVersion: ESTIMATOR_VERSION,
      values: reading.values,
    };
    const weights = { north: 0, south: 0, east: 0, west: 0, central: 0 };
    if (state.display.kind === "estimated")
      for (const contribution of state.display.estimate.contributions)
        weights[contribution.region] = contribution.weight;
    const target = badgeTargetSchema.parse(
      state.display.kind === "manual"
        ? { kind: "region", region: state.display.region }
        : {
            kind: "estimate",
            weights,
            referenceFingerprint: state.display.referenceFingerprint,
            estimatorVersion: ESTIMATOR_VERSION,
            capturedAt: state.display.capturedAt,
            expiresAt: state.display.capturedAt + TARGET_LIFETIME_MS,
          },
    );
    badge.sync({ target, snapshot }, replaceTarget);
  }

  function requestLocation(): void {
    const requestId = ++locationRequestId;
    if (!("geolocation" in navigator)) {
      state = {
        ...state,
        location: { kind: "error", message: "This browser does not support location access." },
      };
      publish();
      return;
    }

    state = { ...state, location: { kind: "requesting" } };
    publish();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!active || requestId !== locationRequestId) return;
        applyPosition(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        if (!active || requestId !== locationRequestId) return;
        if (error.code === error.PERMISSION_DENIED) saveLocationPreference("disabled");
        state = {
          ...state,
          display:
            error.code === error.PERMISSION_DENIED
              ? { kind: "manual", region: manualRegion() }
              : state.display,
          location: { kind: "error", message: geolocationError(error) },
        };
        if (error.code === error.PERMISSION_DENIED) syncBadge(true);
        publish();
      },
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 5 * 60 * 1000 },
    );
  }

  function applyPosition(latitude: number, longitude: number): void {
    if (state.data.kind !== "loaded" || state.data.snapshot.pm25.kind !== "available") {
      state = {
        ...state,
        location: {
          kind: "error",
          message: "PM2.5 data is unavailable, so no estimate can be made.",
        },
      };
      publish();
      return;
    }

    const coordinate = coordinateSchema.safeParse({ latitude, longitude });
    if (!coordinate.success) {
      state = {
        ...state,
        location: { kind: "error", message: "The browser returned an invalid location." },
      };
      publish();
      return;
    }

    const pm25 = state.data.snapshot.pm25.reading;
    const result = estimatePm25({
      coordinate: coordinate.data,
      references: pm25.references,
      values: pm25.values,
    });
    switch (result.kind) {
      case "estimated":
        saveLocationPreference("enabled");
        state = {
          ...state,
          display: {
            kind: "estimated",
            estimate: result.estimate,
            referenceFingerprint: referenceFingerprint(pm25.references),
            capturedAt: Date.now(),
            locationName: null,
            coordinate: coordinate.data,
          },
          location: { kind: "idle" },
        };
        void updateLocationName(coordinate.data, locationRequestId);
        break;
      case "outside-coverage":
        state = {
          ...state,
          location: {
            kind: "error",
            message:
              "Your location is outside the Singapore coverage area. Choose a region instead.",
          },
        };
        break;
      case "invalid-input":
        state = { ...state, location: { kind: "error", message: result.message } };
        break;
      default: {
        const exhaustive: never = result;
        throw new Error(`Unhandled estimate result: ${JSON.stringify(exhaustive)}`);
      }
    }
    syncBadge(result.kind === "estimated");
    publish();
  }

  async function updateLocationName(coordinate: Coordinate, requestId: number): Promise<void> {
    const locationName = await lookupLocationName(coordinate);
    if (
      !active ||
      requestId !== locationRequestId ||
      state.display.kind !== "estimated" ||
      !locationName
    )
      return;
    state = { ...state, display: { ...state.display, locationName } };
    publish();
  }

  function geolocationError(error: GeolocationPositionError): string {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return "Location permission was denied. Choose a region to continue.";
      case error.POSITION_UNAVAILABLE:
        return "Your location is unavailable. Choose a region to continue.";
      case error.TIMEOUT:
        return "Location lookup timed out. Try again or choose a region.";
      default:
        return "Your location could not be determined. Choose a region to continue.";
    }
  }

  function manualRegion(): Region {
    return state.display.kind === "manual"
      ? state.display.region
      : state.display.estimate.closestRegion;
  }
  function selectRegion(region: Region): void {
    locationRequestId += 1;
    saveLocationPreference("disabled");
    state = { ...state, display: { kind: "manual", region }, location: { kind: "idle" } };
    syncBadge(true);
    publish();
  }
  function retry(): void {
    loadGeneration++;
    state = { ...state, data: { kind: "loading" } };
    publish();
    void load();
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    start() {
      active = true;
      badge.connect();
      void initialize();
      return () => {
        active = false;
        locationRequestId++;
        loadGeneration++;
        badge.disconnect();
      };
    },
    requestLocation,
    selectRegion,
    retry,
    badge,
  };
}
