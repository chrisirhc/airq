# ADR-006: Mount the frontend with native custom elements

## Status

Accepted.

## Date

2026-10-12

## Context

The frontend already used TypeScript and native browser APIs, not React. However, `main.ts` owned mutable module-level state, replaced the entire application on every update, and rebound document-wide interactions. This made lifecycle cleanup difficult and could discard keyboard focus or reset the map during unrelated badge and location-name updates. The requested Web Components migration must preserve the existing design, accessibility, data contracts, and Cloudflare Worker behavior without introducing a framework runtime.

## Decision

- Use autonomous custom elements: `airq-app`, `airq-controls`, `airq-readings`, `airq-pm25-map`, `airq-badge`, and `airq-theme`. Register children before the application, with idempotent registration in `src/components/register.ts`.
- Use **light DOM**, not shadow roots. Native semantic sections, buttons, selects, details/summary, tables, SVG, live regions, and the outer `main` remain the accessibility surface. Hosts use `display: contents` to avoid changing the existing grid/flex layout. Keep the original stylesheet and stable IDs; there are no external styling or rendering dependencies.
- Mount the static shell once per app connection. Patch location controls in place; render readings, badge controls, and map only within their own boundaries. Preserve disclosure choices through temporary loading states. Preserve focus when a focused local template node is replaced and has a corresponding replacement. An unrelated update does not replace the theme button, region select, live-region container, or map inspection.
- Keep application state and asynchronous data/location orchestration in a per-app `createAppController`, separate from presentation and the badge service. Components receive typed state through `update(state)`. Controls emit bubbling, composed intent events: `airq-location-request`, `airq-region-change` (a validated `Region` string in `detail`), and `airq-retry`. These are internal UI contracts, not new server APIs.
- Use connection-scoped `AbortController`s for listeners, network requests, map bindings, and badge polling. Dispose the app controller on disconnect, abort fetches and message waits, close message ports, clear timers, and invalidate late geolocation/permission/location-name callbacks. Geolocation and some native service-worker/push operations are not cancellable; ignore late results rather than pretending to undo already-issued browser operations.
- Keep service-worker registration, notification opt-in in the original click gesture, badge persistence, enrollment/revocation, and Worker request/response schemas unchanged. Disconnecting UI components does **not** unregister the service worker or disable a user's saved badge enrollment.
- Retain the existing pure estimators, classifiers, parsers, API retry/cache fallback, source timestamps and warnings. Storage access is best-effort, including when the `localStorage` getter itself throws.

## Alternatives Considered

### React or another component framework

Rejected: the application does not need a runtime to implement these boundaries, and the requested architecture specifically excludes React.

### Shadow DOM for every component

Rejected for this migration: it would require redistributing the shared design system and could alter native labeling relationships, SVG references, selectors, and accessibility behavior. Light DOM deliberately trades encapsulation for faithful design and semantic preservation. Namespaced component tags and scoped queries provide ownership boundaries.

### Wrap the original whole-root renderer in one custom element

Rejected: it would register an element without addressing state ownership, focus loss, unnecessary renders, document-wide event binding, or resource cleanup.

## Consequences

- No new dependencies, React runtime, JSX compilation, or polyfills are required. The existing lockfile continues to determine exact dependency versions.
- Components target browsers with native custom elements, AbortController/AbortSignal composition, and the existing modern CSS support requirements. No legacy-browser support is added.
- Internal components are designed for one AirQ application per document. Stable IDs and document-level theme settings are retained intentionally; this is not a general-purpose multi-instance component library.
- Unit and browser regressions cover registration, reconnect cleanup, cancellation/races, focus and disclosure preservation, lazy map inspection, region/location changes, and the original service-worker/badge flows. The Worker implementation, public routes, deployment configuration, and service-worker build entry remain unchanged.
