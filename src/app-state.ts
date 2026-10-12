import { loadAirQuality } from "./air-quality-client";
import type { createBackgroundBadge } from "./background-badge";
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

type DisplayMode =
  | { readonly kind: "manual"; readonly region: Region }
  | {
      readonly kind: "estimated";
      readonly estimate: Pm25Estimate;
      readonly referenceFingerprint: string;
      readonly capturedAt: number;
      readonly locationName: string | null;
      readonly coordinate: Coordinate;
    };

export interface AppState {
  readonly data:
    | { readonly kind: "loading" }
    | { readonly kind: "loaded"; readonly snapshot: AirQualitySnapshot };
  readonly display: DisplayMode;
  readonly location:
    | { readonly kind: "idle" }
    | { readonly kind: "requesting" }
    | { readonly kind: "error"; readonly message: string };
}

type BadgePort = Pick<ReturnType<typeof createBackgroundBadge>, "start" | "sync" | "savedRegion">;

/** One controller per mounted app. Disposing invalidates non-cancellable browser callbacks. */
export function createAppController(badge: BadgePort, onChange: (state: AppState) => void) {
  let state: AppState = {
    data: { kind: "loading" },
    display: { kind: "manual", region: "central" },
    location: { kind: "idle" },
  };
  const lifetime = new AbortController();
  let locationRequestId = 0;
  let loadRequestId = 0;

  function publish(): void {
    if (!lifetime.signal.aborted) onChange(state);
  }

  async function initialize(): Promise<void> {
    publish();
    void badge.start().then(() => {
      if (lifetime.signal.aborted) return;
      const savedRegion = badge.savedRegion();
      if (savedRegion && locationRequestId === 0)
        state = { ...state, display: { kind: "manual", region: savedRegion } };
      syncBadge(state.display.kind === "estimated");
      publish();
    });
    await load();
    if (
      lifetime.signal.aborted ||
      locationRequestId !== 0 ||
      state.data.kind !== "loaded" ||
      state.data.snapshot.pm25.kind !== "available"
    )
      return;
    const preference = readLocationPreference();
    if (preference === "disabled") return;
    let permission: PermissionState | undefined;
    try {
      permission = (await navigator.permissions?.query({ name: "geolocation" }))?.state;
    } catch {
      // A remembered choice also works when permission queries are unsupported.
    }
    if (lifetime.signal.aborted || locationRequestId !== 0) return;
    if (permission === "denied") {
      saveLocationPreference("disabled");
      return;
    }
    if (permission === "granted" || preference === "enabled") requestLocation();
  }

  async function load(): Promise<void> {
    const requestId = ++loadRequestId;
    const snapshot = await loadAirQuality({ signal: lifetime.signal });
    if (lifetime.signal.aborted || requestId !== loadRequestId) return;
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
              value: contributions.reduce((sum, item) => sum + item.weight * item.value, 0),
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
        // A pending OneMap label must not attach to a replacement estimate.
        locationRequestId++;
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

  function selectRegion(region: Region): void {
    if (lifetime.signal.aborted) return;
    locationRequestId++;
    saveLocationPreference("disabled");
    state = { ...state, display: { kind: "manual", region }, location: { kind: "idle" } };
    syncBadge(true);
    publish();
  }

  function retry(): void {
    if (lifetime.signal.aborted) return;
    state = { ...state, data: { kind: "loading" } };
    publish();
    void load();
  }

  function requestLocation(): void {
    if (lifetime.signal.aborted) return;
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
        if (lifetime.signal.aborted || requestId !== locationRequestId) return;
        applyPosition(position.coords.latitude, position.coords.longitude);
      },
      (error) => {
        if (lifetime.signal.aborted || requestId !== locationRequestId) return;
        if (error.code === error.PERMISSION_DENIED) saveLocationPreference("disabled");
        state = {
          ...state,
          display:
            error.code === error.PERMISSION_DENIED
              ? { kind: "manual", region: manualRegion(state) }
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
    const locationName = await lookupLocationName(coordinate, lifetime.signal);
    if (
      lifetime.signal.aborted ||
      requestId !== locationRequestId ||
      state.display.kind !== "estimated" ||
      !locationName
    )
      return;
    state = { ...state, display: { ...state.display, locationName } };
    publish();
  }

  return {
    initialize,
    selectRegion,
    requestLocation,
    retry,
    get state() {
      return state;
    },
    dispose() {
      lifetime.abort();
      locationRequestId++;
      loadRequestId++;
    },
  };
}

export function manualRegion(state: AppState): Region {
  return state.display.kind === "manual"
    ? state.display.region
    : state.display.estimate.closestRegion;
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
    /* Location remains usable when browser storage is unavailable. */
  }
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
