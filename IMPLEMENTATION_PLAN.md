# Location-aware Singapore air-quality site

## Goal

Build a small web app that asks for the user's location, estimates PM2.5 using distance-weighted regional readings, and lets the user view NEA's five regional readings directly.

Distinguish app estimates from official regional readings. NEA does not publish a reading for each coordinate.

## Product decisions

- Show the 1-hour PM2.5 concentration as the main "air quality now" value.
- Show the 24-hour PSI as a secondary value.
- Label automatic PM2.5 as "Estimated PM2.5" and show its contributing regions and source timestamp.
- Let the user switch to an official regional reading through the manual selector.
- Keep 24-hour PSI as an official reading for a named region. Do not average regional PSI values.
- Support evergreen Chrome, Edge, Firefox, and Safari, including iOS Safari. Test current stable releases and the previous major iOS Safari release. Legacy browsers are out of scope.
- Keep location processing in the browser. Do not store or send the user's coordinates.
- Use the current data.gov.sg APIs instead of scraping HTML from haze.gov.sg.

The 1-hour PM2.5 value supports immediate activity decisions. The 24-hour PSI supports longer exposure and activity planning. These values use different units and labels, so the UI must not combine them into one generic AQI value.

## Scope

The first release includes:

- A location permission request triggered by a user action.
- Automatic distance-weighted PM2.5 estimation from nearby region reference points.
- A manual region selector.
- The latest 1-hour PM2.5 concentration and its NEA band.
- The latest 24-hour PSI and its NEA descriptor.
- Loading, permission-denied, unsupported-browser, out-of-coverage, stale-data, and API-error states.
- Responsive and keyboard-accessible presentation.

The first release does not include:

- Street-level air-quality claims.
- User accounts or saved locations.
- Background location tracking.
- Push notifications.
- Historical charts, forecasts, or health advice beyond links to official guidance.

## Data sources

Use these official public endpoints:

- `https://api-open.data.gov.sg/v2/real-time/api/pm25`
- `https://api-open.data.gov.sg/v2/real-time/api/psi`

Read these fields from the newest item in each response:

| Display value | Response field |
| --- | --- |
| 1-hour PM2.5 | `readings.pm25_one_hourly[region]` |
| 24-hour PSI | `readings.psi_twenty_four_hourly[region]` |
| Reading time | `timestamp` |
| Publication time | `updatedTimestamp` |
| Region reference points | `regionMetadata[].labelLocation` |

The endpoints currently allow cross-origin browser requests. If production requires an API key, add a server-side proxy so the browser does not expose the key.

## Proposed architecture

Build a client-only TypeScript app unless deployment requirements call for a server-rendered framework.

```text
Location button
    -> browser Geolocation API
    -> distance weights for regional reference points

data.gov.sg PM2.5 and PSI APIs
    -> response validation
    -> normalized regional readings

location weights or manually selected region + normalized readings
    -> status classification
    -> air-quality card
```

Keep the main logic in framework-independent modules:

- `air-quality-client` fetches and validates both API responses.
- `location-estimator` calculates distance weights and interpolates PM2.5. It also identifies the closest region for the separately labeled official PSI reading.
- `classifiers` maps readings to NEA bands and descriptors.
- The view requests permission and renders application states.

## Location-based estimate

The APIs publish one `labelLocation` coordinate for each region but no official boundary polygons. These label points are regional references, not verified monitoring-station locations. Distance weighting is an app approximation, not a validated street-level measurement.

Use inverse distance weighting, also known as Shepard interpolation. It estimates a numeric value as a weighted average, with weights proportional to `1 / distance^p`. Do not average region names, band labels, or PSI descriptors. [Esri's IDW documentation](https://pro.arcgis.com/en/pro-app/3.5/help/analysis/geostatistical-analyst/how-inverse-distance-weighted-interpolation-works.htm) describes the power and neighborhood choices. Start with `p = 2` as a design default, not an accuracy claim.

For the first release:

1. Request one position with `navigator.geolocation.getCurrentPosition()` after the user selects **Use my location**.
2. Reject coordinates outside a Singapore coverage box with a small tolerance for offshore islands.
3. Calculate great-circle distances in meters from the device coordinate to the PM2.5 API's five `regionMetadata[].labelLocation` points.
4. Use all five regional reference points. The nearer points receive greater weight. Keeping this small, fixed set avoids jumps caused by a changing nearest-neighbor cutoff.
5. If a distance is at most one meter, use that region's PM2.5 value directly to avoid division by zero. Otherwise calculate `w_i = (d_min / d_i)^2`, then normalize with `a_i = w_i / sum(w)`. This is equivalent to inverse-square weighting and keeps intermediate weights bounded.
6. Calculate `estimatedPm25 = sum(a_i * pm25_i)` using readings from the same response item and timestamp. Keep full precision for calculation and classification. Round only for display.
7. Display "Estimated PM2.5", the source timestamp, and the contributing regions and weights. Keep the manual selector visible. Manual selection displays the API's exact regional values without interpolation.
8. Show official 24-hour PSI for the closest reference region in a separate card with that region's name. Use a fixed region-key order to resolve equal-distance ties. This is a display fallback, not an official boundary assignment.

Require all five finite, nonnegative PM2.5 values and valid reference coordinates for interpolation. If the input is incomplete, show the estimate as unavailable and retain valid official regional readings in manual mode. Do not silently change the weighting method. Handle PM2.5 and PSI timestamps and failures independently.

Do not call this process triangulation in the code or interface. The browser determines the coordinate. The app interpolates regional PM2.5 values.

Before release, inspect estimates at reference points, between points, and near the coverage limits. Compare `p = 1` and `p = 2` for sensitivity. Numerical tests prove the calculation, not geographic accuracy. Do not claim local accuracy without independent observations. Distance alone does not account for wind or pollution sources.

## Delivery plan

### 1. Create the application base

- Initialize a Vite TypeScript app.
- Add formatting, linting, unit tests, and browser tests.
- Configure the build for evergreen desktop browsers and iOS Safari. Define the deployment target.
- Add a development command and a production build command.

Exit criteria:

- The app starts locally.
- The production build completes.
- The test commands run in continuous integration.

### 2. Add the data model and API client

- Define types for regions, readings, timestamps, and API errors.
- Fetch the PM2.5 and PSI endpoints in parallel.
- Validate the response shape before reading nested fields.
- Normalize region keys to `north`, `south`, `east`, `west`, and `central`.
- Reject an empty item list or a missing regional reading.
- Mark data as stale when its timestamp exceeds an agreed threshold.

Exit criteria:

- Fixture tests cover valid, missing, malformed, and stale responses.
- One function returns a normalized reading for all five regions.

### 3. Add location estimation and region selection

- Request location only after a button press.
- Set a finite timeout and accept a recent cached location.
- Handle denied permission, unavailable position, and timeout errors separately.
- Implement inverse-square PM2.5 interpolation with the API's reference coordinates, exact-point handling, and normalized weights.
- Add the Singapore coverage check.
- Add a manual region selector that works without location permission.

Exit criteria:

- Reference coordinates reproduce their PM2.5 values. Equal distances produce an arithmetic mean, and unequal distances produce the expected weighted mean.
- The app remains usable when the user denies location permission.
- The app does not persist or transmit coordinates.

### 4. Build the reading interface

- Show estimated PM2.5 with its unit, band, contributing regions, weights, and timestamp. Show official regional PSI separately with its region, descriptor, and timestamp.
- In manual mode, show the selected region's exact PM2.5 and PSI values.
- Use NEA's published thresholds for all labels.
- Distinguish the two metrics through labels and units, not color alone.
- Add loading, empty, stale, and error states.
- Link to haze.gov.sg and the NEA guidance page for context.

Exit criteria:

- A user can obtain a reading or choose a region manually.
- Every number has a metric name, unit where applicable, source region or contributing regions, and timestamp. Estimated values are visibly distinct from official readings.
- Keyboard and screen-reader checks pass for the location button, region selector, and status messages.

### 5. Add reliability and privacy controls

- Cache only the last successful readings and their timestamps.
- Use cached readings only when a live request fails, and label them as cached.
- Add a request timeout and a bounded retry for temporary failures.
- Do not add analytics events that contain coordinates.
- Add a short privacy note beside the location action.

Exit criteria:

- A failed API request never appears as a current reading.
- Logs and analytics contain no precise location data.
- The page works over HTTPS, which browser geolocation requires.

### 6. Verify and deploy

- Run unit tests, browser tests, linting, and the production build.
- Test on iOS Safari with location allowed and denied, plus current stable desktop Chrome, Edge, Firefox, and Safari.
- Compare displayed readings with the live data.gov.sg responses.
- Verify the stale-data behavior with fixed test fixtures.
- Deploy over HTTPS and run a production smoke test.

Exit criteria:

- The deployed app returns the expected weighted estimates and exact manually selected regional values for mocked and live responses.
- The location flow works on the supported mobile browsers.
- The manual selector provides a complete fallback.

## Test cases

At minimum, cover these cases:

- Location succeeds in each of the five regions.
- A location at a reference point reproduces that region's PM2.5 value without division by zero.
- Equal distances give equal weights. Unequal distances match a hand-calculated inverse-square weighted mean.
- Weights sum to one, and the estimate stays between the minimum and maximum source values.
- Small coordinate changes produce continuous estimates outside the one-meter exact-point tolerance.
- Missing values or invalid reference coordinates disable estimation without removing valid manual readings.
- Location permission is denied.
- Geolocation is unavailable or times out.
- The coordinate is outside Singapore.
- The user overrides the estimated region.
- One API succeeds and the other fails.
- The API returns no items, an unknown region, or a missing field.
- The latest response is stale.
- PM2.5 values sit on both sides of every band boundary.
- PSI values sit on both sides of every descriptor boundary.
- A cached reading appears only after a live request fails.

## Acceptance criteria

The release is ready when:

- The app obtains location only after a clear user action.
- The app shows a clearly labeled distance-weighted PM2.5 estimate and allows manual regional selection.
- The app displays official regional 24-hour PSI separately, with its region and timestamp.
- Manual values match the official API response. Estimates match the documented weighting formula and never appear as official local readings.
- The app labels stale or cached data and never presents it as current.
- The app does not store or transmit precise coordinates.
- The app remains useful without location permission.
- Automated tests cover parsing, classification, interpolation, manual selection, and failure states.
- The location and manual flows work on evergreen desktop browsers and iOS Safari.

## Review questions

Resolve these questions before implementation:

1. Does sensitivity testing support `p = 2`, and is the approximation useful enough to release with its stated limitations?
2. Should the first screen lead with 1-hour PM2.5, as proposed, or 24-hour PSI?
3. Which hosting target should the project use? Browser support is limited to evergreen desktop browsers and iOS Safari.
4. Does the product need installation as a progressive web app?
5. What age makes a reading stale for this product?

## References

- [Haze Singapore](https://www.haze.gov.sg/)
- [NEA air-quality FAQ](https://www.nea.gov.sg/our-services/pollution-control/air-pollution/faqs)
- [Pollutant Standards Index dataset](https://data.gov.sg/datasets/d_fe37906a0182569d891506e815e819b7/view)
- [Browser Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition)
- [Inverse distance weighted interpolation](https://pro.arcgis.com/en/pro-app/3.5/help/analysis/geostatistical-analyst/how-inverse-distance-weighted-interpolation-works.htm)
