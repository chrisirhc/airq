import { useEffect, useState, useSyncExternalStore } from "react";
import { type AppState, createAirQualityController } from "./air-quality-controller";
import { BadgeControls } from "./badge-controls";
import { Disclosure, DisclosureProvider } from "./disclosures";
import { REGION_LABELS, REGIONS } from "./domain";
import { Pm25Map } from "./pm25-map-view";
import { ESTIMATION_METHOD_URL, Readings } from "./readings";
import { ThemeControl } from "./theme";

export function App() {
  const [controller] = useState(createAirQualityController);
  const { state, badge } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => controller.start(), [controller]);
  const estimated = state.display.kind === "estimated";
  const requesting = state.location.kind === "requesting";
  const loading = state.data.kind === "loading";
  const region =
    state.display.kind === "manual" ? state.display.region : state.display.estimate.closestRegion;
  return (
    <DisclosureProvider>
      <div className="page-shell">
        <header className="masthead">
          <a className="brand" href="./" aria-label="Airq home">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>Airq</span>
          </a>
          <div className="masthead-actions">
            <ThemeControl />
            <a
              className="source-link"
              href="https://www.haze.gov.sg/"
              target="_blank"
              rel="noreferrer"
            >
              haze.gov.sg <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">Singapore air quality</p>
          <h1 id="page-title">Air quality now.</h1>
          <p className="hero-copy">1-hour PM2.5 and 24-hour PSI, by region or your location.</p>
        </section>
        <section className="controls" aria-label="Location and region controls">
          <button
            className={`location-button ${estimated ? "is-active" : ""}`}
            id="location-button"
            type="button"
            aria-pressed={estimated}
            aria-busy={requesting}
            disabled={requesting || loading}
            onClick={controller.requestLocation}
          >
            <span className="location-icon" aria-hidden="true">
              {estimated && !requesting ? "✓" : "⌖"}
            </span>{" "}
            {loading
              ? "Loading readings…"
              : requesting
                ? "Finding your location…"
                : estimated
                  ? "Using your location"
                  : "Use my location"}
          </button>
          <div className="divider" aria-hidden="true">
            <span>or</span>
          </div>
          <label className="region-field">
            <span>Choose an official region</span>
            <select
              id="region-select"
              value={region}
              onChange={(event) => {
                const selected = REGIONS.find(
                  (candidate) => candidate === event.currentTarget.value,
                );
                if (selected) controller.selectRegion(selected);
              }}
            >
              {REGIONS.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {REGION_LABELS[candidate]}
                </option>
              ))}
            </select>
          </label>
          <p className="privacy-note">
            To name your location, coordinates are sent through our server to OneMap. AirQ does not
            save them.
          </p>
          <LocationMessage state={state} />
        </section>
        <section className="readings" aria-live="polite" aria-busy={loading}>
          <Readings state={state} retry={controller.retry} />
        </section>
        {state.data.kind === "loaded" && state.data.snapshot.pm25.kind === "available" && (
          <Pm25Map
            reading={state.data.snapshot.pm25.reading}
            location={state.display.kind === "estimated" ? state.display.coordinate : null}
            source={state.data.snapshot.pm25.source}
          />
        )}
        <BadgeControls view={badge} badge={controller.badge} />
        <Disclosure
          className="method-note"
          id="reading-guidance"
          summary="About these readings and estimates"
        >
          <div>
            <h2>Regional data, carefully labeled.</h2>
            <p>
              NEA reports five broad regions. A location estimate blends their PM2.5 readings by
              distance. It is an approximation and cannot account for wind, nearby sources, or
              street-level conditions.
            </p>
            <p>
              In location mode, PSI is an experimental blend of regional indices using the same
              distance weights. PSI is the highest pollutant sub-index, and different pollutants can
              drive different regions. Averaging those indices does not reconstruct an official
              local PSI. Do not use this blend as a health advisory; choose an official region or
              refer to NEA guidance.
            </p>
            <p>
              Estimate algorithm:{" "}
              <a href={ESTIMATION_METHOD_URL} target="_blank" rel="noreferrer">
                Inverse-distance weighting with power 2, explained by Esri{" "}
                <span aria-hidden="true">↗</span>
              </a>
              .
            </p>
            <a
              href="https://www.nea.gov.sg/our-services/pollution-control/air-pollution/faqs"
              target="_blank"
              rel="noreferrer"
            >
              Read NEA guidance <span aria-hidden="true">↗</span>
            </a>
          </div>
        </Disclosure>
        <footer className="site-footer">
          <p>Data from the National Environment Agency via data.gov.sg.</p>
          <p>
            For immediate activity decisions, refer to the 1-hour PM2.5 reading and official
            guidance.
          </p>
          <p>
            <a href="https://github.com/chrisirhc/airq" target="_blank" rel="noreferrer">
              Source code on GitHub
            </a>
          </p>
        </footer>
      </div>
    </DisclosureProvider>
  );
}
function LocationMessage({ state }: { state: AppState }) {
  if (state.location.kind === "requesting")
    return (
      <p className="control-message" role="status">
        Finding your location to calculate a PM2.5 estimate.
      </p>
    );
  if (state.location.kind === "error")
    return (
      <p className="control-message error" role="alert">
        {state.location.message}
      </p>
    );
  if (state.display.kind !== "estimated") return null;
  const name = state.display.locationName;
  return (
    <>
      <p className="control-message">
        Your location
        {name && (
          <>
            : near {name}.{" "}
            <a href="https://www.onemap.gov.sg/" target="_blank" rel="noreferrer">
              OneMap, Singapore Land Authority
            </a>
          </>
        )}
      </p>
      <p className="control-message success" role="status">
        Location found. Showing an approximate PM2.5 estimate.
      </p>
    </>
  );
}
