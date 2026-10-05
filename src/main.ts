import "./styles.css";
import { loadAirQuality } from "./air-quality-client";
import { classifyPm25, classifyPsi, statusTone } from "./classifiers";
import {
  type AirQualitySnapshot,
  coordinateSchema,
  REGION_LABELS,
  REGIONS,
  type Region,
} from "./domain";
import { estimatePm25, type Pm25Estimate } from "./location-estimator";

type DisplayMode =
  | { readonly kind: "manual"; readonly region: Region }
  | { readonly kind: "estimated"; readonly estimate: Pm25Estimate };

type DataState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly snapshot: AirQualitySnapshot };

type LocationState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting" }
  | { readonly kind: "error"; readonly message: string };

interface AppState {
  readonly data: DataState;
  readonly display: DisplayMode;
  readonly location: LocationState;
}

const root = findRoot();

let state: AppState = {
  data: { kind: "loading" },
  display: { kind: "manual", region: "central" },
  location: { kind: "idle" },
};

render();
void load();

async function load(): Promise<void> {
  const snapshot = await loadAirQuality();
  state = { ...state, data: { kind: "loaded", snapshot } };
  render();
}

function render(): void {
  root.innerHTML = `
    <div class="page-shell">
      <header class="masthead">
        <a class="brand" href="/" aria-label="Air around you home">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>Air around you</span>
        </a>
        <a class="source-link" href="https://www.haze.gov.sg/" target="_blank" rel="noreferrer">
          Official source <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Singapore air quality</p>
        <h1 id="page-title">Know what you are breathing.</h1>
        <p class="hero-copy">See official regional readings, or use your location for an approximate PM2.5 estimate.</p>
      </section>

      <section class="controls" aria-label="Location and region controls">
        <button class="location-button" id="location-button" type="button" ${state.location.kind === "requesting" ? "disabled" : ""}>
          <span class="location-icon" aria-hidden="true">⌖</span>
          ${state.location.kind === "requesting" ? "Finding your location…" : "Use my location"}
        </button>
        <div class="divider" aria-hidden="true"><span>or</span></div>
        <label class="region-field">
          <span>Choose an official region</span>
          <select id="region-select">
            ${REGIONS.map(
              (region) =>
                `<option value="${region}" ${manualRegion() === region ? "selected" : ""}>${REGION_LABELS[region]}</option>`,
            ).join("")}
          </select>
        </label>
        <p class="privacy-note">Your coordinates stay in this browser and are not saved.</p>
        ${locationMessage()}
      </section>

      <section class="readings" aria-live="polite" aria-busy="${state.data.kind === "loading"}">
        ${renderReadings()}
      </section>

      <section class="method-note">
        <p class="eyebrow">What this means</p>
        <div>
          <h2>Regional data, carefully labeled.</h2>
          <p>NEA reports five broad regions. A location estimate blends their PM2.5 readings by distance. It is an approximation and cannot account for wind, nearby sources, or street-level conditions.</p>
          <a href="https://www.nea.gov.sg/our-services/pollution-control/air-pollution/faqs" target="_blank" rel="noreferrer">Read NEA guidance <span aria-hidden="true">↗</span></a>
        </div>
      </section>

      <footer class="site-footer">
        <p>Data from the National Environment Agency via data.gov.sg.</p>
        <p>For immediate activity decisions, refer to the 1-hour PM2.5 reading and official guidance.</p>
      </footer>
    </div>
  `;

  bindInteractions();
}

function renderReadings(): string {
  if (state.data.kind === "loading") {
    return `
      <article class="reading-card skeleton-card">
        <p class="card-kicker">Loading official data</p>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
      </article>
      <article class="reading-card skeleton-card">
        <p class="card-kicker">Checking latest readings</p>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
      </article>
    `;
  }

  const { pm25, psi } = state.data.snapshot;
  const selectedRegion =
    state.display.kind === "manual" ? state.display.region : state.display.estimate.closestRegion;

  const pm25Card = (() => {
    if (pm25.kind === "unavailable") return renderUnavailable("1-hour PM2.5", pm25.message);

    const display = state.display;
    const estimated = display.kind === "estimated";
    const value = estimated ? display.estimate.value : pm25.reading.values[selectedRegion];
    const band = classifyPm25(value);
    const label = estimated ? "Estimated PM2.5" : `${REGION_LABELS[selectedRegion]} region PM2.5`;
    const detail = estimated
      ? renderContributions(display.estimate)
      : `<p class="card-detail">Official 1-hour regional concentration</p>`;

    return `
      <article class="reading-card primary-card ${statusTone(value, "pm25")}">
        <div class="card-heading">
          <div>
            <p class="card-kicker">${label}</p>
            <p class="status-label">Band ${band.level} · ${band.label}</p>
          </div>
          ${renderSourceBadge(pm25.source, pm25.reading.stale)}
        </div>
        <div class="reading-value"><strong>${Math.round(value)}</strong><span>µg/m³</span></div>
        ${detail}
        <p class="timestamp">Reading at ${formatTimestamp(pm25.reading.timestamp)}</p>
      </article>
    `;
  })();

  const psiCard = (() => {
    if (psi.kind === "unavailable") return renderUnavailable("24-hour PSI", psi.message);
    const value = psi.reading.values[selectedRegion];
    const context =
      state.display.kind === "estimated" ? "Closest reference region" : "Official regional reading";

    return `
      <article class="reading-card ${statusTone(value, "psi")}">
        <div class="card-heading">
          <div>
            <p class="card-kicker">${REGION_LABELS[selectedRegion]} region PSI</p>
            <p class="status-label">${classifyPsi(value)}</p>
          </div>
          ${renderSourceBadge(psi.source, psi.reading.stale)}
        </div>
        <div class="reading-value"><strong>${Math.round(value)}</strong><span>24-hour PSI</span></div>
        <p class="card-detail">${context}</p>
        <p class="timestamp">Reading at ${formatTimestamp(psi.reading.timestamp)}</p>
      </article>
    `;
  })();

  return pm25Card + psiCard;
}

function renderContributions(estimate: Pm25Estimate): string {
  const rows = estimate.contributions
    .filter((contribution) => contribution.weight >= 0.005)
    .sort((left, right) => right.weight - left.weight)
    .map(
      (contribution) => `
        <li>
          <span>${REGION_LABELS[contribution.region]}</span>
          <span>${Math.round(contribution.weight * 100)}%</span>
        </li>
      `,
    )
    .join("");

  return `
    <details class="contributions">
      <summary>How this estimate is weighted</summary>
      <ul>${rows}</ul>
    </details>
  `;
}

function renderUnavailable(title: string, message: string): string {
  return `
    <article class="reading-card unavailable-card">
      <p class="card-kicker">${title}</p>
      <h2>Reading unavailable</h2>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="text-button retry-button">Try again</button>
    </article>
  `;
}

function renderSourceBadge(source: "live" | "cached", stale: boolean): string {
  if (source === "cached") return `<span class="data-badge warning">Cached</span>`;
  if (stale) return `<span class="data-badge warning">Stale</span>`;
  return `<span class="data-badge">Live data</span>`;
}

function locationMessage(): string {
  if (state.location.kind === "error") {
    return `<p class="control-message error" role="alert">${escapeHtml(state.location.message)}</p>`;
  }
  if (state.display.kind === "estimated") {
    return `<p class="control-message success">Location found. Showing an approximate PM2.5 estimate.</p>`;
  }
  return "";
}

function manualRegion(): Region {
  return state.display.kind === "manual"
    ? state.display.region
    : state.display.estimate.closestRegion;
}

function bindInteractions(): void {
  const locationButton = document.querySelector("#location-button");
  locationButton?.addEventListener("click", requestLocation);

  const select = document.querySelector("#region-select");
  select?.addEventListener("change", (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    const region = REGIONS.find((candidate) => candidate === target.value);
    if (!region) return;
    state = { ...state, display: { kind: "manual", region }, location: { kind: "idle" } };
    render();
  });

  for (const retry of document.querySelectorAll(".retry-button")) {
    retry.addEventListener("click", () => {
      state = { ...state, data: { kind: "loading" } };
      render();
      void load();
    });
  }
}

function requestLocation(): void {
  if (!("geolocation" in navigator)) {
    state = {
      ...state,
      location: { kind: "error", message: "This browser does not support location access." },
    };
    render();
    return;
  }

  state = { ...state, location: { kind: "requesting" } };
  render();
  navigator.geolocation.getCurrentPosition(
    (position) => applyPosition(position.coords.latitude, position.coords.longitude),
    (error) => {
      state = { ...state, location: { kind: "error", message: geolocationError(error) } };
      render();
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
    render();
    return;
  }

  const coordinate = coordinateSchema.safeParse({ latitude, longitude });
  if (!coordinate.success) {
    state = {
      ...state,
      location: { kind: "error", message: "The browser returned an invalid location." },
    };
    render();
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
      state = {
        ...state,
        display: { kind: "estimated", estimate: result.estimate },
        location: { kind: "idle" },
      };
      break;
    case "outside-coverage":
      state = {
        ...state,
        location: {
          kind: "error",
          message: "Your location is outside the Singapore coverage area. Choose a region instead.",
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
  render();
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

function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}

function findRoot(): HTMLElement {
  const element = document.querySelector("#app");
  if (!(element instanceof HTMLElement)) throw new Error("The app root is missing.");
  return element;
}
