# ADR-005: Explain PM2.5 interpolation with a local model map

## Status

Accepted as an initial visualization prototype.

## Date

2026-10-06

## Context

A numeric weighted estimate and source table do not show how reference-point proximity changes the result across Singapore. The user requested a map/heatmap demonstrating the PM2.5 averaging technique. A polished pollution map could overstate the model's accuracy, while external map tiles add dependencies, network traffic, and potential location disclosure.

## Decision

- Add a collapsed **Explore the PM2.5 estimate map** disclosure below the readings. Render the SVG field only when opened and cache the coarse field by regional values/reference geometry across UI renders.
- Evaluate the existing `estimatePm25` function on a coarse 10-viewBox-unit grid over the existing Singapore coverage rectangle. Reuse its great-circle distances, all five inverse-square weights, normalization, and one-metre exact-point behavior; do not create another estimator or infer pollutant dynamics.
- Clip the visible field to a simplified mainland Singapore outline. Use the app-defined PM2.5 severity bands/colors, with an explicit concentration legend. Do not color by contributor identity or weight or invent within-band color gradients. A uniform color is correct when all estimates share a band; inspected numeric values still show within-band variation.
- Draw neutral regional reference dots/labels. Describe them as API reference points, not individual monitoring stations. Draw neutral connections from the inspected point, with thickness proportional to each region's weight, and show the five source readings and weights in an accessible table.
- Support tapping/clicking points and arrow-key movement from a single focusable SVG. Keep inspection separate from application location/region selection. Show a separately labeled user-location ring only after permission and successful estimation. Otherwise start at an explicitly labeled example point, using real source data rather than fictional readings.
- Show **Modelled estimates—not measured coverage**, model limitations, source timestamp in Singapore time, and live/cached/stale source status. The inspection rectangle can include water; a computed output there is not evidence of measured coverage. This component does not display or validate the experimental PSI blend.
- Bundle the outline and code; no tile requests, map SDK, or geocoding is required. The user's coordinate is held only in transient application memory for the location ring, not persisted or sent to an additional service. Existing OneMap location-name processing is unchanged. Manual selection removes the coordinate from display state.

## Geographic Data

The simplified Singapore polygon was extracted from [datasets/geo-countries](https://github.com/datasets/geo-countries/blob/master/data/countries.geojson) on 2026-10-06. That dataset uses Natural Earth data and is dedicated under [PDDL](https://opendatacommons.org/licenses/pddl/1.0/); original [Natural Earth data is public domain](https://www.naturalearthdata.com/about/terms-of-use/). Retain visible attribution and the source comment in `src/singapore-outline.ts`.

This is a small-scale mainland outline, not an official administrative boundary. Offshore islands and recent reclamation may be omitted. The outline is for display only and must not become a location-eligibility or estimator boundary test.

## Alternatives Considered

### External map tiles and a map SDK

Deferred: unnecessary for an initial averaging explanation, adds network/dependency cost, and can expose browsing/location context to another provider.

### Continuous multihue gradients or a fictitious high-severity demo

Rejected for the live component: color must encode the documented severity bands, and a single-band field must not be artificially exaggerated. Synthetic mixed-band fixtures are used only in tests.

### A second simplified interpolation implementation

Rejected: the map must demonstrate the same production estimator as the reading card, including exact-point handling.

## Consequences

- Users can explore how proximity changes regional weights without changing their actual selected location or official readings.
- The coarse raster and simplified outline make this explanatory, not a street-level pollution model or health advisory. Interpolation still ignores wind and local emissions.
- Tests cover projection, sampling the production estimator, uniform/mixed-band fields, lazy rendering, exact-point weights, keyboard/pointer inspection, source freshness, location-marker removal, and unavailable PM2.5 data.
- The SVG field is bundled/local and can render from the existing cached readings without external map infrastructure.
