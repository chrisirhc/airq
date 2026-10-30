# ADR-006: Use Fate for reading requests and Void for server routes

## Status

Accepted as an experimental refactor.

## Date

2026-10-30

## Context

The user requested a Fate refactor from main, then specified Void for routes.
AirQ already has a DOM-based UI, independent public PM2.5 and PSI endpoints, and a Cloudflare Worker for location names and badge tests.
A failure in one data source must leave the other metric usable. Offline data must retain an explicit cached label.

## Decision

Use `@nkzw/fate` without a UI framework adapter. Its two typed value roots represent the complete per-metric results, including unavailable states.
One client lives for the page lifetime. Fate shares concurrent loads; each later load requests `network-only` data.
These aggregate results use value roots rather than normalized entities because the APIs supply regional snapshots, not objects with independently mutable identities.

Keep Zod parsing, retries, timeouts, and raw-response localStorage fallback in the transport.
Reparse cached data using the current time so stale flags remain accurate. Treat unavailable browser storage as optional.
Fate's in-memory cache does not replace this offline cache or its live/cached provenance.

Use Void's Vite plugin and file-based routes for OneMap, the badge API, the service worker, and the manifest.
Keep badge authorization and D1 operations in `worker/badge.ts`, behind a Void catch-all route.
Preserve the existing production database ID, SQL migration directory, custom domain, and logging policy in `void.config.ts`.
Local values use `.env`, with optional server keys declared in `env.ts`.

## Alternatives considered

A React or Vue rewrite would add a second migration to the data-client change. The core Fate package supports the existing UI.
Moving public readings behind a Fate server would change the request path and introduce server-side caching and failure behavior. This refactor keeps browser requests direct.
Fate persistence would require a cache-format and provenance migration. Keeping the existing offline cache makes this experiment reversible.

## Consequences

Fate coordinates requests, but this app does not yet exercise entity normalization, component views, live updates, or mutations.
The client bundle grows. In this session, the app entry measured about 52 kB gzip after the refactor, compared with about 15 kB before it.
The badge-domain chunk remains separate. Recheck bundle sizes with `npm run build` before judging whether Fate is worth the cost here.

Void requires Vite 8 and Node.js 24.21 or later. It generates route types and separate client and Worker builds.
Explicit CSS targets preserve native `light-dark()` so manual color-scheme overrides still work after Vite 8 minification.
Preview must use `dist/client`, and Worker integration checks must execute `dist/ssr/index.js` rather than the removed handwritten entry.
Void deploys through its own CLI. This refactor does not deploy or modify production resources.

## Verification

Run `npm run verify` to check lint, types, unit behavior, both build outputs, real Worker routing with isolated D1, and all browser projects.
The reading tests cover independent fallback, invalid cache removal, staleness, retries, concurrent loads, later refreshes, and denied storage access.
Browser tests start their own preview on port 4187 and refuse server reuse. The live-data check uses port 4188.
Worker checks cover badge authorization and lifecycle behavior, API 404s, and service-worker and manifest cache headers.

## References

- [Fate manual installation](https://fate.technology/guide/getting-started)
- [Fate requests](https://fate.technology/guide/requests)
- [Void server routing](https://void.cloud/guide/server-routing)
- [Void configuration](https://void.cloud/reference/config)
