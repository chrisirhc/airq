import "./styles.css";
import { loadAirQuality } from "./air-quality-client";
import { createBackgroundBadge } from "./background-badge";
import {
  badgeTargetSchema,
  ESTIMATOR_VERSION,
  READING_LIFETIME_MS,
  referenceFingerprint,
  TARGET_LIFETIME_MS,
} from "./badge-domain";
import { type AirQualitySnapshot, coordinateSchema, regionSchema } from "./domain";
import { Elm } from "./elm/Main.elm";
import { lookupLocationName } from "./location-name";
import { bindPm25Map, renderPm25Map } from "./pm25-map";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("The app root is missing.");
const app = Elm.Main.init({ node: root, flags: themePreference() });
let snapshot: AirQualitySnapshot | null = null;
let mapLocation: ReturnType<typeof coordinateSchema.parse> | null = null;

// Elm owns these nodes, but deliberately gives their children to the browser adapters.
class BadgeElement extends HTMLElement {
  connectedCallback() {
    this.refresh();
  }
  refresh() {
    const open = this.querySelector<HTMLDetailsElement>("details")?.open ?? false;
    this.innerHTML = badge.html();
    const details = this.querySelector<HTMLDetailsElement>("details");
    if (details) details.open = open;
    badge.bind();
  }
}
class MapElement extends HTMLElement {
  connectedCallback() {
    this.refresh();
  }
  refresh() {
    const open = this.querySelector<HTMLDetailsElement>("details")?.open ?? false;
    this.innerHTML = renderPm25Map();
    const details = this.querySelector<HTMLDetailsElement>("details");
    if (details) details.open = open;
    if (snapshot?.pm25.kind === "available") {
      bindPm25Map(this, snapshot.pm25.reading, mapLocation, snapshot.pm25.source);
    }
  }
}
const badge = createBackgroundBadge(() => {
  document.querySelector<BadgeElement>("airq-badge")?.refresh();
});
customElements.define("airq-badge", BadgeElement);
customElements.define("airq-map", MapElement);

function send(event: Record<string, unknown>) {
  app.ports.events.send(event);
}

// Ports run before Elm's next animation-frame render. Wait for that render before
// refreshing browser-owned content, including a newly mounted map after a retry.
function refreshAdapters() {
  requestAnimationFrame(() => {
    document.querySelector<MapElement>("airq-map")?.refresh();
    document.querySelector<BadgeElement>("airq-badge")?.refresh();
  });
}

app.ports.effects.subscribe(async (effect) => {
  switch (effect.kind) {
    case "load": {
      try {
        snapshot = await loadAirQuality();
        send({
          kind: "snapshot",
          snapshot: { pm25: serializeMetric(snapshot.pm25), psi: serializeMetric(snapshot.psi) },
        });
      } catch {
        // Accessing localStorage itself can throw in restricted browsers.
        snapshot = await loadAirQuality({ storage: inertStorage });
        send({
          kind: "snapshot",
          snapshot: { pm25: serializeMetric(snapshot.pm25), psi: serializeMetric(snapshot.psi) },
        });
      }
      break;
    }
    case "restoreLocation": {
      const preference = readStorage("airq:location-mode");
      if (preference === "disabled") break;
      let permission: PermissionState | undefined;
      try {
        permission = (await navigator.permissions?.query({ name: "geolocation" }))?.state;
      } catch {
        // Safari can remember the choice without supporting permission queries.
      }
      if (permission === "denied") saveStorage("airq:location-mode", "disabled");
      else if (permission === "granted" || preference === "enabled")
        send({ kind: "restoreLocation" });
      break;
    }
    case "location": {
      const id = effect.id;
      if (!("geolocation" in navigator)) {
        send({
          kind: "locationError",
          id,
          denied: false,
          message: "This browser does not support location access.",
        });
        break;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coordinate = coordinateSchema.safeParse({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          if (coordinate.success)
            send({ kind: "position", id, coordinate: coordinate.data, capturedAt: Date.now() });
          else
            send({
              kind: "locationError",
              id,
              denied: false,
              message: "The browser returned an invalid location.",
            });
        },
        (error) =>
          send({
            kind: "locationError",
            id,
            denied: error.code === 1,
            message: geolocationMessage(error.code),
          }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
      );
      break;
    }
    case "lookup": {
      const coordinate = coordinateSchema.parse(effect.coordinate);
      send({ kind: "locationName", id: effect.id, name: await lookupLocationName(coordinate) });
      break;
    }
    case "preference":
      saveStorage("airq:location-mode", effect.enabled ? "enabled" : "disabled");
      break;
    case "theme":
      applyTheme(effect.theme);
      saveStorage("airq:theme", effect.theme === "system" ? null : effect.theme);
      break;
    case "sync": {
      const location = effect.location;
      mapLocation = location ? coordinateSchema.parse(location.coordinate) : null;
      if (snapshot?.pm25.kind === "available") {
        const reading = snapshot.pm25.reading;
        const target = badgeTargetSchema.parse(
          location
            ? {
                kind: "estimate",
                weights: location.weights,
                referenceFingerprint: location.fingerprint,
                estimatorVersion: ESTIMATOR_VERSION,
                capturedAt: location.capturedAt,
                expiresAt: location.capturedAt + TARGET_LIFETIME_MS,
              }
            : { kind: "region", region: regionSchema.parse(effect.region) },
        );
        badge.sync(
          {
            target,
            snapshot: {
              revision: 0,
              readingAt: reading.timestamp.getTime(),
              updatedAt: reading.updatedAt.getTime(),
              validUntil: reading.updatedAt.getTime() + READING_LIFETIME_MS,
              referenceFingerprint: referenceFingerprint(reading.references),
              estimatorVersion: ESTIMATOR_VERSION,
              values: reading.values,
            },
          },
          effect.replace,
        );
      } else badge.sync(null, false);
      refreshAdapters();
      break;
    }
  }
});

void badge.start().then(() => {
  const region = badge.savedRegion();
  if (region) send({ kind: "savedRegion", region });
});

function serializeMetric(metric: AirQualitySnapshot["pm25"] | AirQualitySnapshot["psi"]) {
  if (metric.kind === "unavailable") return metric;
  const reading = metric.reading;
  const references = "references" in reading ? reading.references : [];
  return {
    kind: "available",
    source: metric.source,
    values: reading.values,
    stale: reading.stale,
    timestamp: new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(reading.timestamp),
    references,
    fingerprint: references.length ? referenceFingerprint(references) : "",
  };
}

function geolocationMessage(code: number) {
  switch (code) {
    case 1:
      return "Location permission was denied. Choose a region to continue.";
    case 2:
      return "Your location is unavailable. Choose a region to continue.";
    case 3:
      return "Location lookup timed out. Try again or choose a region.";
    default:
      return "Your location could not be determined. Choose a region to continue.";
  }
}
function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function saveStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Preferences still work for this session. */
  }
}
function themePreference() {
  const value = document.documentElement.dataset.theme;
  return value === "light" || value === "dark" ? value : "system";
}
const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
let theme = themePreference();
function applyTheme(preference: string) {
  theme = preference;
  const html = document.documentElement;
  if (theme === "system") delete html.dataset.theme;
  else html.dataset.theme = theme;
  html.style.colorScheme = theme === "system" ? "light dark" : theme;
  const dark = theme === "dark" || (theme === "system" && systemAppearance.matches);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#161616" : "#f5f5f5");
}
systemAppearance.addEventListener("change", () => applyTheme(theme));
window.addEventListener("storage", (event) => {
  if (event.key !== "airq:theme" && event.key !== null) return;
  const value = readStorage("airq:theme");
  const preference = value === "light" || value === "dark" ? value : "system";
  applyTheme(preference);
  send({ kind: "theme", theme: preference });
});
applyTheme(theme);

const inertStorage: Storage = {
  length: 0,
  clear() {},
  getItem() {
    return null;
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {},
};
