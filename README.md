# Air around you

A Singapore air-quality site. It shows official regional 1-hour PM2.5 and 24-hour PSI readings from data.gov.sg. With permission, it uses the browser's coordinates to calculate a clearly labeled, distance-weighted PM2.5 estimate and an explicitly experimental blend of regional PSI indices. An optional installed-app badge displays the rounded PM2.5 reading.

The interface automatically follows your system's light or dark appearance, including changes while the page is open. Air-quality severity colors stay the same in both themes.

## Run locally

```sh
npm install
npm run dev
```

Browser geolocation works on `localhost`. Production deployments must use HTTPS.
On page load, the app resumes a previously successful location choice or uses location if permission is already granted.
It remembers only whether location mode is enabled, and asks the browser for coordinates again after a refresh.
Safari may show another permission prompt if its earlier approval has expired.
Otherwise, select **Use my location** to request access.
The button shows **Finding your location…** during lookup and **Using your location** with a green background when the estimate is active.
Choosing an official region returns to manual readings and keeps location mode off after a refresh.

To install AirQ and configure its optional badge-test backend, see [the badge setup guide](BADGE_SETUP.md).

## Deploy to Cloudflare

The production site is [airq.b65.dev](https://airq.b65.dev/).
Run deployment commands from this repository's root.

### Set up a machine

Install the pinned dependencies and browser binaries:

```sh
npm ci
npx playwright install
```

Authorize Wrangler with the Cloudflare account that manages `b65.dev`.
Complete the authorization in the browser that opens:

```sh
npx wrangler login
npx wrangler whoami
```

Confirm that `whoami` reports the intended account before deploying.
If authorization times out, run `npx wrangler login` again.
Wrangler stores the login locally. Do not commit credentials or API tokens.

### Publish an update

Run the checks against the code you intend to publish:

```sh
npm run verify
```

Optionally validate the upload configuration without publishing:

```sh
npx wrangler deploy --dry-run
```

The verification command builds `dist/`, which the dry run inspects.
Build again and publish to production:

```sh
npm run deploy
```

`npm run deploy` runs `npm run build` followed by `wrangler deploy`.
It uploads the local build, including any uncommitted changes.
Review the working copy before publishing. Pushing to GitHub does not deploy the site automatically.

The successful deployment output includes `airq.b65.dev (custom domain)` and a version ID.
Save that version ID if you need to identify the deployment later.

### Check production

Check the HTTPS response:

```sh
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://airq.b65.dev/
```

Expect `200`. Then open [airq.b65.dev](https://airq.b65.dev/) and check the application:

1. Confirm that the PM2.5 and PSI cards show regional readings.
2. Choose another region and confirm that both cards update.
3. Select **Use my location** and allow location access from a supported Singapore location.
4. Confirm that the estimate shows all five regional inputs, distances, weights, and the weighted-average calculation.

The HTTP check proves that the site is reachable. The browser checks also verify assets, live data, and location permissions.

### Hosting configuration

`wrangler.jsonc` configures the `airq` Worker to serve `dist/` at `https://airq.b65.dev/`.
The `workers.dev` hostname is disabled.
Cloudflare manages the custom domain's DNS record and HTTPS certificate.
The deploy uploads the static build and `worker/index.ts`. Browser air-quality requests still go directly to data.gov.sg. The optional badge-test endpoint also reads public PM2.5 data server-side.

The older copy at `https://static.slt.b65.dev/airq/index.html` is a separate deployment.
`npm run deploy` updates Cloudflare only.

## Verify

Install Playwright's browser binaries once:

```sh
npx playwright install
```

Then run the complete check:

```sh
npm run verify
```

The check runs linting, TypeScript, unit tests, the production build, Worker integration tests with isolated local D1 storage, and browser tests against the built app.

To test the built app against the live data.gov.sg endpoints, run:

```sh
npm run test:live
```

## Configure OneMap location names

Register a [OneMap account](https://www.onemap.gov.sg/apidocs/register), then configure the Worker secrets. Enter the values at the prompts; do not put credentials in source code:

```sh
npx wrangler secret put ONEMAP_EMAIL
npx wrangler secret put ONEMAP_PASSWORD
```

The Worker obtains an authentication token and reuses it in memory until one minute before expiry. OneMap tokens last three days. Concurrent lookups in the same Worker isolate share token acquisition. Separate isolates obtain their own tokens. Lookups search for buildings within 100 metres and choose the nearest usable name. The UI says "near" because browser coordinates and the nearest address may not identify the user's exact building.

OneMap publishes a 300-call/minute limit. The app performs one lookup per accepted browser position, with no polling or automatic retries. The Worker returns `Cache-Control: no-store`, and credentials and tokens never reach the browser. Missing credentials, upstream errors, timeouts and rate limits fall back to the generic location label.

For local end-to-end use, copy `.dev.vars.example` to `.dev.vars`, fill in your credentials, run `npm run build`, then `npx wrangler dev`. Vite's standalone dev/preview server does not run the Worker, so it uses the generic location label.

### Diagnose location lookup failures

Persistent Workers Logs are enabled with 100% sampling. In Cloudflare, open **Workers & Pages > airq > Observability** and filter for `onemap_lookup_failed`. Each failed lookup records its stage, reason, elapsed time and upstream HTTP status when available. Reasons distinguish timeouts, network errors, invalid responses, upstream HTTP errors and missing configuration. Invocation logs also capture the HTTP response status.

The Worker logs only these diagnostic fields. It does not log coordinates, location names, credentials, tokens, raw error messages or OneMap response bodies. Tracing is disabled to avoid recording outgoing OneMap URLs containing coordinates. A handled HTTP 503 still counts as a successful Worker invocation in the Metrics chart; use Observability to inspect the failure. Enabling logs does not recover earlier events.

## Visual design

Color is reserved for air-quality severity. The interface, controls, and freshness badges are neutral; PSI uses outlined markers in the official Haze.gov.sg colors alongside explicit descriptors. PM2.5 uses an app-defined green/yellow/orange/red marker palette with explicit band numbers and labels; this is not an official NEA color mapping. See [ADR-001: Severity-only color](docs/decisions/001-severity-only-color.md) and [ADR-002: PM2.5 severity colors](docs/decisions/002-pm25-severity-colors.md) for the rationale and reference colors.

Calculations, reading guidance, and badge installation help use collapsed native disclosures to keep repeat visits focused on readings. Values, severity, timestamps, controls, privacy information, and warnings remain visible. Disclosure choices survive in-page refreshes but reset on a new visit. See [ADR-003: Progressive disclosure](docs/decisions/003-progressive-disclosure.md).

The expandable PM2.5 map samples the same inverse-distance estimator across a coarse grid and colors cells by the documented PM2.5 bands. Tap a point or use arrow keys to inspect its five regional weights without changing your selected location. It is a model illustration, not measured pollution coverage; reference dots are not individual monitoring stations. The map bundles a simplified Natural Earth outline and makes no tile requests. See [ADR-005: PM2.5 interpolation map](docs/decisions/005-pm25-interpolation-map.md).

## Data and privacy

The app calls the public PM2.5 and PSI endpoints at `api-open.data.gov.sg`. It stores the location-mode preference and the last successful API responses for an offline error fallback. In location mode, coordinates are sent in a POST body to the AirQ Worker, which forwards them to OneMap to find a nearby building or road name. AirQ does not log, cache, or save the coordinates or location name. OneMap's own data practices apply to its processing. A failed lookup leaves the air-quality estimate usable with the generic "Your location" label.

Background badge enrollment additionally saves interpolation weights on the device in IndexedDB. They expire after 24 hours and are removed on the next service-worker execution. Weights are location-derived sensitive information; enabling background testing explicitly consents to this storage. For background badge enrollment, the server receives only a Web Push subscription, its encryption keys, and a random revocation token. D1 stores the token hash and enrollment expiry. Revocation credentials remain in browser local storage. Foreground-only mode stores the last badge reading, not coordinates or weights.

Readings older than 45 minutes are marked stale. The PM2.5 estimate uses inverse-square distance weighting over the five reference coordinates supplied by the PM2.5 API. It is not an official local measurement.

In location mode, **Estimated PSI (experimental)** blends the five regional 24-hour PSI indices using the same location weights. Different pollutants may drive each region's PSI: blending the final indices does not reconstruct an official local PSI and must not be used as a health advisory. The visible warning and approximate descriptor remain outside the collapsed calculation. PSI keeps its own source timestamp and stale/cached status. Select an official region for its exact PSI. See [ADR-004: Experimental PSI blend](docs/decisions/004-experimental-psi-blend.md).
