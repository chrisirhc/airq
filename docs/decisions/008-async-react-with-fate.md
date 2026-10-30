# ADR-008: Use Fate's async React integration

## Status

Accepted as a local integration experiment. Supersedes the framework-free client choice in ADR-006 and the controller-owned data fetching in ADR-007.

## Date

2026-10-30

## Context

The user asked to consider merging the existing React refactor to use async React with Fate.
The standalone React branch already provides component reconciliation, retained map inspection, Strict Mode lifecycle checks, and cleanup for browser callbacks.
Its controller still fetches readings imperatively, so merging it alone would leave Fate's React integration unused.

## Decision

Merge `refactor/react` and `refactor/fate` on a separate `refactor/fate-react` branch.
Keep Void routes, the public API transport, per-metric offline fallback, and existing production bindings.

Provide one Fate client per app. `useRequest` owns the initial reading request and subscribes to subsequent results.
A Suspense boundary shows reading skeletons while the initial request waits. The header, theme control, and reading guidance remain mounted outside this boundary.
Metric failures remain typed unavailable/cached results, so a failed PSI endpoint does not hide PM2.5.
An error boundary handles unexpected request/render failures with a reload action.

Refresh with `useRefetch` inside an async `useTransition` action. Display a pending status while keeping committed readings, region controls, map inspection, and disclosure nodes mounted.
The user can change region while a refresh waits. The new readings apply to that selection when the request completes.

The controller receives the initial resolved readings and later committed updates from React.
It keeps a synchronous snapshot for geolocation, OneMap naming, estimator updates, and serialized badge operations.
Remove its fetcher, loading state, retry action, and request-generation counter. Strict Mode cleanup still invalidates browser callbacks and detaches badge listeners.
The app/component tests use the real Fate client with a controlled network fetcher.

## Alternatives considered

Merging React without changing the controller would add React's runtime cost without using Fate's Suspense or refresh integration.
Replacing every browser workflow with hooks would also require rewriting badge ordering and native permission handling. Those workflows remain in the tested controller.
Moving to server-rendered pages is a separate requirement. This app continues to render on the client and use Void for HTTP routes.

## Consequences

The integration uses async React for initial loading and refreshes, and preserves component identity across updates.
It still uses two snapshot value roots. Entity views, live subscriptions, optimistic mutations, and server rendering remain unused.

The app entry measured about 121 kB gzip after integration, compared with about 52 kB for the framework-free Fate branch.
The common badge-domain chunk remains about 26 kB gzip, and the service worker remains independent of React.
This merge adds UI behavior; it does not reduce Fate's existing bundle overhead. Recheck sizes with `npm run build`.

The original React branch's verification report remains historical. The integration uses Vite 8, the explicit native light-dark CSS targets, and a strict local preview port with reuse disabled.
No deployment or production-resource changes are part of this experiment.

## Verification

Run `npm run verify` for lint, types, unit/component tests, the production build, real Worker integration with isolated D1, and all four browser projects.
The additional browser checks delay the initial response to prove that the shell remains interactive and Strict Mode shares its requests.
A delayed refresh proves that the old values remain visible, the user can change region, and controls and map nodes survive the new response.
Existing lifecycle checks cover cleanup, stale permission/geolocation callbacks, and late names after manual selection.

On 2026-10-30, `npm run verify` passed with 90 unit/component tests, Worker integration checks, and 175 browser tests across Chromium, Firefox, WebKit, and mobile Safari. The 13 capability skips are inherited.

## References

- [Fate React setup](https://fate.technology/guide/getting-started)
- [Fate requests and refresh](https://fate.technology/guide/requests)
