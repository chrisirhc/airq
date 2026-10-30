# ADR-007: Render the frontend with stable React

## Status

Accepted.

The data-fetching and Vite decisions are superseded by [ADR-008](008-async-react-with-fate.md).

## Date

2026-10-12

## Context

The frontend previously rebuilt the entire app with HTML strings and rebound event listeners after every asynchronous update. The requested migration is to the latest stable React release while retaining the visual design, accessibility, browser permissions, public data contracts, and Cloudflare behavior.

## Decision

- Use React and React DOM **19.3.0**, verified with `npm view react dist-tags --json`, `npm view react@latest version`, and `npm view react-dom@latest version` on 2026-10-12. The `latest` tags resolve to non-prerelease versions; do not use canary, experimental, beta, or RC tags. Pin matching `@types/react` and `@types/react-dom` 19.3.0.
- Retain TypeScript 5.9.3 and Vite 7.3.6 from the existing lockfile. Add `@vitejs/plugin-react` 5.2.0 (whose peer range includes Vite 7), automatic JSX, and TSX test discovery. Do not unnecessarily upgrade the Worker toolchain or adopt a compiler, router, state library, or SSR framework.
- Use `createRoot`, function components, typed JSX, React event handlers, context, and hooks. Enable Strict Mode so development catches lifecycle problems. Remove the HTML-string UI, escaping helpers, and manual DOM event rebinding rather than wrapping them in `dangerouslySetInnerHTML`.
- Keep browser/API orchestration in a per-app, lazily constructed controller, exposed through `useSyncExternalStore`. Browser permission callbacks, late geocoding, and serialized service-worker messages need a synchronous shared snapshot independent of React's render scheduling. The controller publishes immutable snapshots, and is not a process-global singleton. Its factory performs no registration, requests, or listener attachment. React's mount effect starts it; cleanup invalidates outstanding location/data callbacks and detaches badge listeners/timers. Service-worker startup is idempotent across effect replay.
- React owns disclosure choices in a visit-scoped provider so temporary loading states cannot erase them. It owns theme control state, system/storage listener cleanup, map inspection, SVG elements, and accessible output tables. The head script still applies saved theme overrides before first paint.
- Keep the map field lazy with a bounded cache keyed by regional values/reference geometry. After first opening, native details hides the mounted chart so closing/reopening preserves inspection and SVG nodes. Location and pointer/keyboard inspection do not resample the field. Keep the existing coordinate math, production estimator, colors, outline attribution, and one focusable SVG. Narrow documented lint suppressions preserve the interactive SVG and hide only non-focusable decorative groups.
- Keep all data parsing, estimator and badge-domain logic, API routes, D1 schemas, service-worker message protocol, scope, and `sw.js` build entry unchanged. Notification permission remains called directly from the original React click handler, before any `await`, to preserve Safari's user-gesture requirement.

## Alternatives Considered

### Embed the old HTML in a React wrapper

Rejected: retains full-root replacement, focus loss, event rebinding, and manual escaping while providing little benefit from React.

### Move every asynchronous browser workflow into component effects

Rejected: permission requests must stay in gesture handlers, and overlapping browser callbacks and service-worker messages need ordering independent of render closures. A small subscribable controller keeps those existing workflows testable without introducing a state-management dependency.

### Upgrade all build and Cloudflare dependencies

Rejected for this migration: Vite 7 already supports the selected React plugin and JSX runtime. Unrelated Worker upgrades would widen the behavior-change surface.

## Consequences

- Existing styles, native disclosures, labels, warnings, storage keys, endpoints, and badge behavior remain the compatibility contract. React now safely renders upstream messages and location names as text.
- Reconciliation preserves control focus and map nodes through unrelated async updates instead of replacing the whole page.
- React adds runtime bundle weight; the Worker and service worker remain independent of the React renderer.
- Unit/component tests cover the estimator-backed SVG and lifecycle behavior; browser tests remain the end-to-end contract for permission timing, themes, disclosures, location, and badges across browser engines.
