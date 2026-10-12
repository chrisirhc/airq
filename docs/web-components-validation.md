# Web Components migration validation

Validation performed in `/Users/chris/code/airq-web-components` on 2026-10-12. Dependencies were installed locally with `npm ci`; `package.json` and `package-lock.json` are unchanged. No React or UI-framework runtime was added. See [ADR-006](decisions/006-native-custom-elements.md) for the architecture.

## Final build checks

| Command | Result |
| --- | --- |
| `npm run lint` | Passed; 65 files checked, no diagnostics |
| `npm run typecheck` | Passed |
| `npm test` | Passed; 97 tests in 11 files (baseline: 78 in 8 files) |
| `npm run build` | Passed; app and service worker built |
| `npm run test:worker` | Passed; isolated D1/Worker integration and encrypted push network checks |
| `npm run test:browser -- --project=chromium --project=firefox` | Passed; 85 tests, 5 pre-existing Firefox badge/service-worker skips |
| `npm audit --omit=dev` | No vulnerabilities |

Regression coverage includes actual custom-element registration, native control focus, persistent live-region containers, disclosure preservation, map inspection stability during late location naming, reconnect behavior, stale geolocation/permission/data responses, request cancellation, badge message-port cleanup, timer/listener disposal, and notification opt-in cancellation. Existing regional readings, severity styling, experimental PSI, source warnings, privacy/error handling, cached data, OneMap escaping, installation, service-worker persistence, notification gesture, and opt-out tests remain in place. Worker source, routes, schemas, migrations, and deployment configuration were not modified.

## Browser verification caveat

`npm run verify` **did not complete successfully**: this machine's headless WebKit runs repeatedly stalled waiting for element stability or page evaluation. The initial full run exceeded its execution budget. Serial desktop WebKit retries with 60- and 90-second per-test budgets still timed out on ordinary interactions. Some desktop WebKit checks passed, including severity colors, location naming, experimental PSI, and the new map/focus regression; the suite is not fully verified.

The final mobile-Safari attempt used:

```sh
npm run test:browser -- --project=mobile-safari --workers=1 --timeout=60000 --max-failures=2
```

It reported 14 passed, 2 failed by click/stability timeout, and 29 not run. A separate plain-HTML reproduction with no application code or stylesheet also timed out on `locator('summary').click()` waiting for stability. This strongly indicates a local WebKit/harness issue, but does not establish full Safari compatibility. Re-run both Safari projects on a healthy machine before release. Tests were not skipped, forced, weakened, or given permanent timeout increases to hide this blocker.

An early Chromium run incorrectly reused a pre-existing preview on port 4173 and is **not** migration evidence. The test configuration now starts this workspace's own strict-port preview on 4183 and refuses reuse. All reported final Chromium/Firefox results use that isolated server. Override the port with `AIRQ_TEST_PORT` if needed; do not stop another workspace's server.

## Dependency versions and warnings

Exact direct versions installed from the existing lockfile:

- Runtime: `zod@4.6.5`, `@block65/webcrypto-web-push@2.0.0` (Worker).
- Development: `@biomejs/biome@2.5.15`, `@cloudflare/workers-types@5.20261005.1`, `@playwright/test@1.63.0`, `@types/node@24.19.1`, `esbuild@0.28.2`, `jsdom@27.4.0`, `miniflare@5.20261001.0-alpha`, `typescript@5.9.3`, `vite@7.3.6`, `vitest@5.0.3`, `wrangler@4.147.0`.

The build emits upstream Zod pure-annotation warnings but succeeds. Full `npm audit` reports three inherited high-severity development-tool findings in the `sharp` → `miniflare` → `wrangler` chain (GHSA-wq5f-xc86-pv6w); the suggested fix changes pinned tooling and is outside this frontend migration. Production-only audit is clean. No deployment, push, merge, live API smoke test, or physical-device badge presentation test was performed.
