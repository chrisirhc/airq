import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Disclosure } from "./disclosures";
import type { Coordinate, ReadingSource } from "./domain";
import type { MapReading } from "./pm25-map";

const MapInspection = lazy(() => import("./pm25-map-inspection"));

export function Pm25Map(props: {
  reading: MapReading;
  location: Coordinate | null;
  source: ReadingSource;
}) {
  // Reset inspection when the selected location changes, not on unrelated badge/name updates.
  const key = props.location ? `${props.location.latitude},${props.location.longitude}` : "manual";
  return (
    <Disclosure className="pm25-map" id="pm25-map" summary="Explore the PM2.5 estimate map">
      {(open) => (
        <>
          <p>
            Modelled estimates—not measured coverage. Every cell uses the same inverse-square
            distance weighting as the PM2.5 card. This is not a pollution forecast or a health
            advisory.
          </p>
          <p id="map-instructions">
            Tap the map to inspect a point, or focus it and use the arrow keys. The neutral dots are
            regional reference points, not individual monitoring stations. Inspecting the map does
            not change your selected location.
          </p>
          <LazyMapInspection key={key} open={open} {...props} />
          <p className="map-attribution">
            Simplified land outline:{" "}
            <a
              href="https://www.naturalearthdata.com/about/terms-of-use/"
              target="_blank"
              rel="noreferrer"
            >
              Natural Earth (public domain)
            </a>
            , via{" "}
            <a href="https://github.com/datasets/geo-countries" target="_blank" rel="noreferrer">
              geo-countries
            </a>
            . Offshore islands and recent reclamation may be omitted. The model ignores wind, local
            sources, and street-level variation.
          </p>
        </>
      )}
    </Disclosure>
  );
}

function LazyMapInspection({
  open,
  ...props
}: {
  open: boolean;
  reading: MapReading;
  location: Coordinate | null;
  source: ReadingSource;
}) {
  const [initialized, setInitialized] = useState(open);
  useEffect(() => {
    if (open) setInitialized(true);
  }, [open]);
  // Keep the loaded chart mounted so closing details preserves inspection and SVG nodes.
  return initialized || open ? (
    <MapLoadBoundary>
      <Suspense fallback={<p role="status">Loading map…</p>}>
        <MapInspection {...props} />
      </Suspense>
    </MapLoadBoundary>
  ) : null;
}

class MapLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return <p role="alert">The map could not be loaded. Reload the page to try again.</p>;
    return this.props.children;
  }
}
