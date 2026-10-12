# ADR-006: Use Elm for browser application state and views

## Status

Accepted.

## Date

2026-10-12

## Context

The requested Elm rewrite replaces the browser application's mutable state, HTML-string rendering, and event rebinding. The app must retain its existing air-quality labels, location privacy, cache fallback, appearance preferences, interactive map, and installed-app badge behavior. Cloudflare Workers and service workers do not provide the DOM runtime required by Elm's browser application.

## Decision

- Use Elm 0.19.1 and `Browser.element` for the browser application. `src/elm/Main.elm` owns application state, transitions, views, disclosure choices, location request generations, theme cycling, and effects. Elm renders untrusted names/errors as text, never HTML.
- Put PM2.5 inverse-distance interpolation, regional reading types/decoders, experimental PSI blending, and classification in `src/elm/AirQuality.elm`. Recompute active estimates when readings change and invalidate them when reference geometry changes.
- Compile Elm through `vite-plugin-elm`. The production build uses Elm optimization; local development compiles Elm through Vite. Keep the compiler pinned to the 0.19.1 release line.
- Keep `src/main.ts` as the port adapter for validated data loading/cache fallback, geolocation and permission queries, local storage, Singapore timestamp formatting, OneMap naming, document appearance, and badge/service-worker integration. Coordinates are transient and only sent to the existing OneMap endpoint after Elm accepts a successful estimate.
- Keep the interactive SVG map and badge controls in browser-owned custom elements (`airq-map`, `airq-badge`). Elm owns their placement but never their children. This prevents external DOM mutations from corrupting Elm's virtual DOM. Each adapter preserves its native disclosure state when refreshed. Adapter refreshes wait for Elm's animation-frame render.
- Leave the Cloudflare Worker, service worker, badge protocol, and validated public API client in TypeScript. Elm is not a replacement for these host runtimes. This is a browser application rewrite, not a backend/protocol rewrite.
- Retain the TypeScript estimator for the SVG map and existing TypeScript tests. The Elm card implements the same haversine/inverse-square algorithm and exact-point rule. This changes ADR-005's single-implementation constraint: shared fixture expectations, Elm normalization/range fuzz tests, and existing browser tests guard parity between map and card. If the algorithm changes, update both implementations and their tests together. The old experimental PSI helper remains a TypeScript protocol/reference test target; it is no longer used by the browser card.
- Run Elm compilation, formatting checks, and Elm tests alongside the existing TypeScript, Worker, and browser verification suite.

## Alternatives Considered

### Embed the existing TypeScript application inside Elm

Rejected: an Elm wrapper around string-rendered UI would not transfer application behavior or state ownership to Elm.

### Rewrite every integration in Elm

Rejected for this migration: Elm cannot directly access geolocation, IndexedDB, PushManager, app badges, or service-worker APIs, and cannot run the Cloudflare Worker runtime. Rewriting the validated cache client and SVG interactions would also expand the migration beyond application-state/view replacement.

## Consequences

The principal user interface now follows Elm's model/update/view architecture, while tested host integrations remain behind a narrow port boundary. Request IDs prevent delayed geolocation, permission, and OneMap results from overriding a manual choice. Browser and service-worker behavior remains covered by the existing end-to-end tests. Developing from a fresh checkout requires npm dependencies plus access to Elm's package registry on the first compilation; generated `elm-stuff/` is ignored.
