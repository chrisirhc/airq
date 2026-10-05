# Air around you

A client-only Singapore air-quality site. It shows official regional 1-hour PM2.5 and 24-hour PSI readings from data.gov.sg. With permission, it uses the browser's coordinates to calculate a clearly labeled, distance-weighted PM2.5 estimate.

## Run locally

```sh
npm install
npm run dev
```

Browser geolocation works on `localhost`. Production deployments must use HTTPS.
On page load, the app checks location permission and automatically uses location if permission is already granted.
Otherwise, select **Use my location** to request access.
The button shows **Finding your location…** during lookup and **Using your location** with a green background when the estimate is active.
Choosing an official region returns to manual readings.

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
Only the built static files are uploaded. Air-quality requests still go directly from the browser to data.gov.sg.

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

The check runs linting, TypeScript, unit tests, the production build, and a browser test against the built app.

To test the built app against the live data.gov.sg endpoints, run:

```sh
npm run test:live
```

## Data and privacy

The app calls the public PM2.5 and PSI endpoints at `api-open.data.gov.sg`. It stores only the last successful API responses for an offline error fallback. Coordinates remain in memory, are not sent to another service, and are not saved.

Readings older than 45 minutes are marked stale. The estimate uses inverse-square distance weighting over the five reference coordinates supplied by the PM2.5 API. It is not an official local measurement.
