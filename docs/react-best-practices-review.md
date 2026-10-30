# React best-practices improvements

Reviewed on 2026-10-30 on `refactor/react-best-practices`, based on `refactor/fate-react`.

## Skills used

Installed and read Vercel's [React best practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) and [composition patterns](https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns), both with skill metadata version 1.0.0.
The local installation directories are `~/.codex/skills/react-best-practices` and `~/.codex/skills/composition-patterns`.

## Changes and evidence

| Guidance | Change | Verification |
| --- | --- | --- |
| `bundle-conditional`, `bundle-dynamic-imports` | Split optional map inspection, geometry, and SVG rendering into a lazy module. Keep the disclosure description in the initial UI. | Browser checks observe zero map-chunk requests before opening, hold the chunk while changing region, then observe one request after opening and no repeat on reopen. |
| `async-suspense-boundaries` | Give the map its own Suspense and error boundaries. | A blocked map chunk shows local loading feedback. An aborted chunk shows a map-specific error while both metric cards and region controls remain usable. |
| `rerender-memo` | Memoize the expensive map inspection component, retaining its existing memoized field. | Existing tests keep SVG nodes, inspection, and keyboard focus across unrelated updates and close/reopen. |
| `rerender-defer-reads`, `rerender-derived-state` | Expose separate cached air-quality and badge snapshots. Subscribe to the needed snapshot at each consumer. | A React test runs a real badge action, checks the changed badge feedback, and records zero extra reading-consumer renders. It then changes region and confirms that the reading consumer updates. |
| `state-decouple-implementation`, `state-lift-state` | Let `AirQualityProvider` own the controller lifecycle and synchronize committed Fate readings. Sibling UI components consume `useAirQuality` and `useBadgeControls`. | Existing Strict Mode, cleanup, late callback, reconciliation, and async refresh checks exercise the provider in the actual app. |

The provider context holds one stable controller. Badge publications retain the air-quality state object's identity, so React's external-store comparison can skip reading consumers.
The controller still invalidates stale native callbacks and serializes badge operations. Notification permission requests stay in the original click handler.

The map remains mounted after first opening to preserve inspection state. Code loading is deferred as well as field construction.
A failed map import is contained within the optional feature and does not replace the readings with the outer error fallback.

## Deliberate limits

The app already fetches independent metrics concurrently through Fate and uses transitions for refreshes. Those paths remain in place.
The effect that sends committed readings to the controller synchronizes estimator and badge operations with an external store; it is not a computed display value to remove mechanically.
The disclosure render function passes its open state to the lazy map. This matches the composition skill's stated exception for render props that supply state.
No Next.js-specific APIs, private Fate imports, runtime dependencies, or broad memoization sweep were added.

These changes defer optional work and reduce unnecessary renders. They do not eliminate React or Fate's core runtime cost.

## Bundle measurement

With the same installed dependencies and Vite 8 build settings, the app entry changed from 395.11 kB / 121.19 kB gzip to 391.47 kB / 119.83 kB gzip.
The optional map chunk is 6.38 kB / 2.77 kB gzip. The common badge-domain chunk and service worker sizes are unchanged.
The entry reduction is modest. Opening the map downloads an extra chunk, so this is a startup improvement rather than a reduction in total code after every feature loads.

## Verification result

`npm run verify` passed on 2026-10-30 with 91 unit/component tests, production client and Worker builds, Worker integration checks, and 183 browser tests across Chromium, Firefox, WebKit, and mobile Safari.
The 13 capability skips are inherited.

## Reproduce

Run `npm run verify` for lint, types, unit/component tests, the build, Worker integration with isolated D1, and all browser projects.
The targeted subscription test is in `src/air-quality-context.test.tsx`. Chunk-loading and failure checks are in `tests/browser/react.spec.ts`.
`npm run build` prints the app entry and optional map chunk sizes.
