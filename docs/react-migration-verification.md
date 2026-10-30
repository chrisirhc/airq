# React migration verification

This records the original standalone React branch. For the later Fate/Void integration and its checks, see [ADR-008](decisions/008-async-react-with-fate.md).


Verified in `/Users/chris/code/airq-react` on 2026-10-12. No original/parallel workspace files were changed, and no push, merge, or deployment was performed.

## Registry and versions

`npm view react dist-tags --json`, `npm view react@latest version`, and `npm view react-dom@latest version` reported stable **19.3.0**, distinct from the canary/experimental/beta/RC tags. React DOM's peer dependency is `react: ^19.3.0`. The new dependencies are exact pins; existing dependencies retain their previous declared ranges and locked versions.

| Dependency | Exact installed version | Change |
| --- | --- | --- |
| `react` | 19.3.0 | Added |
| `react-dom` | 19.3.0 | Added |
| `@types/react` | 19.3.0 | Added |
| `@types/react-dom` | 19.3.0 | Added |
| `@vitejs/plugin-react` | 5.2.0 | Added; supports Vite 7 |
| `typescript` | 5.9.3 | Retained |
| `vite` | 7.3.6 | Retained |
| `vitest` | 5.0.3 | Retained |
| `jsdom` | 27.4.0 | Retained |
| `@playwright/test` | 1.63.0 | Retained |
| `@biomejs/biome` | 2.5.15 | Retained |
| `@types/node` | 24.19.1 | Retained |
| `zod` | 4.6.5 | Retained |
| `@block65/webcrypto-web-push` | 2.0.0 | Retained |
| `@cloudflare/workers-types` | 5.20261005.1 | Retained |
| `esbuild` | 0.28.2 | Retained |
| `miniflare` | 5.20261001.0-alpha | Retained |
| `wrangler` | 4.147.0 | Retained |

Installed locally, without sharing `node_modules`. Validation used Node 26.7.0 and npm 12.2.0.

## Checks

- **Passed:** `npm run lint`, `npm run typecheck`, `npm test` — **85 tests in 10 files**, including React Strict Mode effect replay, pure controller construction, listener cleanup, obsolete responses, late geolocation/geocoding, lazy SVG rendering, reconciliation/focus, and the original domain tests.
- **Passed:** `npm run build`. The original CSS is unchanged (same emitted CSS hash); the service worker remains a module entry at `sw.js`, independent of the React renderer. The app's JS entry is approximately 266.34 kB / 84.24 kB gzip, plus the existing shared data/badge chunk. React increases client bundle size.
- **Passed:** `npm run test:worker` — local D1/API integration and real Worker encrypted push-network checks, including authorization, ordering/expiry, cache headers, and redirect restrictions. Worker/service-worker source and message contracts are unchanged.
- **Passed:** isolated Chromium browser suite — **45 tests**.
- **Passed:** isolated Firefox browser suite — **40 tests**, **5 existing capability skips** for service-worker/badge scenarios.
- **Passed:** all three new reconciliation/async map-focus/cross-tab theme regressions on WebKit and mobile Safari, including the final nine-test Firefox/WebKit/mobile run with one worker after adding map close/reopen retention. All three also pass on Chromium.
- **Not a full pass:** `npm run verify` / complete four-project browser suite. Chromium and Firefox scenarios passed, but WebKit/mobile Safari repeatedly stalled in browser actions or visibility checks. A full run exceeded a 600-second command budget before completion. A one-worker retry with a 90-second test timeout also stalled in the existing manual-to-location scenario. Traces show actions/inspector checks hanging after controls or requests had been reached; the exact cause is unresolved. Concurrent WebKit execution in another workspace was observed during some attempts, but cannot conclusively explain every failure. Do not treat the complete Safari suite as verified; rerun on an isolated runner/device before deployment. No forced clicks, disabled assertions, blanket retries, or production behavior changes were introduced to mask these failures.

### Test isolation correction

The inherited Playwright configuration allowed reusing an already-running server on port 4173. An initial Chromium run and the first full-suite attempt therefore did not provide trustworthy workspace-specific browser validation. Those results are superseded by runs after changing to a workspace-owned strict-port preview on 4175 with reuse disabled. Unit/build/type/Worker checks were always local to this workspace.

The late-name reconciliation test uses a controlled fetch promise rather than holding a real request past OneMap's three-second timeout while a slower engine initializes the map. Production lookup timing is unchanged.

## Remaining caveats

- npm audit reports **three high-severity development-tool advisories** through the existing `sharp` → `miniflare` → `wrangler` chain (GHSA-wq5f-xc86-pv6w). Upgrading unrelated Cloudflare tooling was kept outside this frontend migration. The new React packages are not in that advisory chain. `npm audit --omit=dev` reports zero vulnerabilities.
- The build prints two non-fatal Rollup annotation warnings from the existing Zod package; it completes successfully.
- Live data.gov.sg/OneMap and installed iPhone badge presentation were not revalidated against production. Mocked public data, local Worker integration, actual module service workers, and browser permission gesture tests cover the migration without deploying or using secrets.
