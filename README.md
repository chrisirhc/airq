# Air around you

A client-only Singapore air-quality site. It shows official regional 1-hour PM2.5 and 24-hour PSI readings from data.gov.sg. With permission, it uses the browser's coordinates to calculate a clearly labeled, distance-weighted PM2.5 estimate.

## Run locally

```sh
npm install
npm run dev
```

Browser geolocation works on `localhost`. Production deployments must use HTTPS.

## Deploy to Cloudflare

Authorize Wrangler with the Cloudflare account that manages `b65.dev`:

```sh
npx wrangler login
```

Build and publish the site:

```sh
npm run deploy
```

`wrangler.jsonc` configures the `airq` Worker to serve `dist/` at `https://airq.b65.dev/`.
Cloudflare manages the custom domain's DNS record and HTTPS certificate.
Only the built static files are uploaded. Air-quality requests still go directly from the browser to data.gov.sg.

## Verify

Install Playwright's Chromium browser once:

```sh
npx playwright install chromium
```

Then run the complete check:

```sh
npm run verify
```

The check runs linting, TypeScript, unit tests, the production build, and a browser test against the built app.

To test the built app against the live data.gov.sg endpoints, run:

```sh
npm run test:live
```

## Data and privacy

The app calls the public PM2.5 and PSI endpoints at `api-open.data.gov.sg`. It stores only the last successful API responses for an offline error fallback. Coordinates remain in memory, are not sent to another service, and are not saved.

Readings older than 45 minutes are marked stale. The estimate uses inverse-square distance weighting over the five reference coordinates supplied by the PM2.5 API. It is not an official local measurement.
