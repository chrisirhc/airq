# Plan: reusable coordinate-local air-quality estimation

## Status

**Proposed for review.** This document authorizes no implementation or deployment. Approval should resolve the questions at the end before application behavior changes.

## Goal

Let AirQ and other applications estimate PM2.5 for a supplied coordinate without sending that coordinate to an estimation service. Separate public-data fetching from a pure local computation API, and offer an explicit coordinate-local mode that skips the existing OneMap location-name lookup.

The privacy claim is narrowly **“coordinates stay on this device”**, not anonymity, scientific validation of the model, or protection from a malicious hosting website.

## Findings

There is no widely adopted “privacy-preserving JSONP” format that both distributes arbitrary JavaScript and guarantees confidential inputs cannot be transmitted. JSONP executes remote scripts with page privileges; it is not appropriate here.

The practical standard building blocks are:

- **ES modules** to distribute a callable local function.
- **JSON** for public regional snapshots. GeoJSON is an option for reference-point geometry, not an executable model or privacy policy.
- **Web Workers** if computation needs to move off the main thread. Workers can make network requests; isolation alone is not a privacy guarantee.
- **WebAssembly** for a stronger module capability boundary when instantiated without I/O imports. The host wrapper and page must still be trusted.
- **JsonLogic** for restricted declarative rules. It is not a general geospatial standard and would require custom operations/runtime trust for this estimator.

Prefer a small, pinned, self-hosted ES module for the initial implementation. No third-party script execution, new expression interpreter, or WASM rewrite is needed for the current arithmetic.

## Current Behavior

- `src/location-estimator.ts` computes PM2.5 locally from a coordinate, the five public reference points, and regional readings. It contains no fetching, persistence, or logging.
- `src/experimental-psi.ts` locally blends regional PSI using the resulting location weights. Its experimental/non-advisory interpretation must remain explicit; see [ADR-004](../decisions/004-experimental-psi-blend.md).
- The browser retrieves public PM2.5 and PSI data and caches successful responses.
- The location-name lookup sends coordinates to AirQ's Worker, which forwards them to OneMap. Therefore the current location experience is **not** fully coordinate-local.
- The map holds the coordinate in transient memory. Optional background badge testing persists location-derived weights on-device. These are sensitive derived data even though they are not raw coordinates.

## Proposed Architecture

```text
Public regional readings and reference metadata
                 |
                 v
      Host application's data loader/cache
                 |
                 v
Coordinate --> Pure local estimator --> Value, weights, provenance
                 |
                 +--> Optional local experimental PSI blend

No coordinate-bearing estimation or naming request in coordinate-local mode.
```

### 1. Pure computation module

Create a dedicated browser-compatible ES-module entry point that exports the existing estimator and input validation without importing UI initialization, geolocation, networking, storage, logging, or badge code.

The host supplies:

- A valid latitude/longitude.
- The complete five-region reference geometry.
- Complete, finite, nonnegative regional values.

Return an explicit result rather than a plausible-looking number for invalid inputs or outside-coverage coordinates. Preserve existing inverse-square weighting, great-circle distances, normalization, exact-point behavior, deterministic region ordering, and fractional precision.

Include method/version metadata in the public interface. Keep source timestamps, freshness, cached status, and snapshot revision available in a wrapper/result contract without letting the computation fetch data itself. Design the exact public API and build artifact names during implementation review; no new endpoint currently exists.

Experimental PSI must be an explicitly named, separate export rather than an unqualified local-PSI API. It does not become validated through packaging.

### 2. Public regional-data contract

Continue using the existing public APIs initially. The data-loader layer parses responses into a documented, versioned JSON snapshot containing regional readings, reference geometry, independent PM2.5/PSI timestamps and availability, and provenance.

Do not require the caller's coordinate, a location-derived query parameter, a user identifier, or a coordinate-bearing request body to obtain this snapshot. Any future AirQ snapshot endpoint must return shared regional data rather than personalized estimates.

Do not adopt GeoJSON merely to imply an executable-model standard. Decide whether standard point geometry adds enough interoperability value to justify an additional representation.

### 3. Explicit coordinate-local mode

Offer a clearly described setting before a coordinate is requested or a remembered location preference triggers restoration:

> Coordinates stay on this device. Estimate air quality locally without looking up a nearby address.

When enabled:

- Obtain location through the existing permission-based browser API, or accept a coordinate supplied by the embedding host.
- Use the generic “Your location” label; do not call `/api/location` or OneMap.
- Keep the coordinate in memory only. Do not introduce URL parameters, local/session storage, analytics, logs, or error reports containing it.
- Allow local estimates and map rendering from current or cached public readings; retain visible stale/cached/unavailable warnings.
- Persist only the user's privacy preference if preference persistence is approved.

Default behavior, migration of remembered preferences, and mid-session switching require review. A request already sent to OneMap cannot be undone; changing the setting must not imply prior disclosure was erased. Invalidate pending naming results so they cannot reappear after switching modes. Explain that geolocation permission alone does not authorize remote naming in coordinate-local mode.

### 4. Distribution and trust

Publish a versioned build artifact or package only if external reuse is approved. Document self-hosting/pinning as the recommended consumption model. Do not offer an `eval`-based JSON computation payload or recommend a mutable third-party `<script>` as a privacy boundary.

Integrity verification can detect unexpected code changes; it does not prove an approved module is private. Subresource Integrity does not automatically cover every dynamic module import. Prefer a bundled, pinned artifact and document the supported integrity mechanism instead of inventing import syntax.

### 5. Optional hardening, deferred

If protecting the coordinate from the computation module itself is a requirement, investigate a minimal WASM module with no network/storage callbacks or other I/O capabilities. Audit imports and keep the JavaScript host wrapper trusted. A Worker can provide responsiveness/termination, but is not a substitute for this capability boundary.

For a JavaScript Worker, evaluate a restrictive CSP on the worker response itself; workers generally have their own policy context. Do not describe either approach as protection against the hosting page, browser extensions, all side channels, or ordinary connection metadata.

## Privacy Boundaries

The initial design aims to prevent precise-coordinate transmission by AirQ's intended computation/naming flow in coordinate-local mode. It does not prevent:

- The browser/OS geolocation provider's own processing.
- Public-data/code servers seeing IP address, request time, and permitted referrer information.
- The trusted hosting page or unrelated page scripts observing a coordinate they already receive.
- Location-derived information being inferred from weights or estimates shared by the host.

Review optional badge behavior separately. Foreground-only badges need only the displayed reading, while background badge weights can reveal location. The preference must not claim “nothing location-derived is stored” unless that stronger promise is implemented. Existing saved weights/enrollment are not automatically erased merely by disabling address lookup.

## Implementation Sequence

1. Approve the privacy scope, defaults, persistence, and badge interaction below.
2. Define the module/snapshot contracts and extract a side-effect-free entry point around existing estimator code.
3. Add contract tests and a minimal embedding example with supplied coordinates and shared regional data.
4. Add the coordinate-local preference and gate naming before initial restoration, new location requests, and asynchronous naming responses.
5. Add end-to-end privacy and compatibility tests; update user-facing documentation with accurately bounded claims.
6. Review implementation and deployment separately. This plan PR ships no runtime changes.

## Acceptance Criteria

- Importing and calling the computation module performs no fetches, storage writes, geolocation requests, logging, analytics, or UI initialization.
- Outputs match the existing estimator for exact points, equal/unequal distances, fractional values, and coverage boundaries. Reject incomplete/duplicate regions, invalid coordinates/values, and invalid PSI weights without silently changing the method.
- The public module and snapshot contract have an explicit version, documented units, result types, provenance, and scientific limitations.
- Browser tests in coordinate-local mode intercept all requests and confirm no calls to the naming endpoint and no coordinate-bearing payloads/URLs. Test initial restoration and late naming responses, not just a manual button click.
- Unit and integration tests verify coordinates do not enter persistent storage or diagnostic output in the new path. Inspect traffic separately from storage, including existing badge-derived data.
- Offline/cached readings work with their real timestamps and warnings; caching does not imply current data.
- Switching to ordinary naming mode requires clear consent and accurately describes OneMap processing.
- Existing regional/manual readings, severity labels/colors, experimental PSI warnings, map behavior, and permission-denied fallback remain intact.

## Review Questions

1. **Default:** Should coordinate-local mode be the default for new users, opt-in, or the only mode? Recommendation: default to coordinate-local; make nearby address naming explicitly optional.
2. **Returning users:** How should previously remembered location/naming preferences migrate? Recommendation: explain the change and do not silently assume permission for remote naming.
3. **Persistence:** May we store a boolean privacy preference? Recommendation: yes, without coordinates or names.
4. **Badges:** Is the promise only no coordinate transmission, or also no persisted location-derived weights? Should enabling this mode disable/remove existing background weights and revoke enrollment? Resolve before making a stronger storage claim.
5. **Distribution:** Is a separately reusable ES module/package needed now, or only internal separation plus an embedding example? Recommendation: define the contract first; choose packaging based on intended consumers.
6. **Threat model:** Do we trust the module/host, or require enforcement against untrusted computation code? Recommendation: trusted, pinned JS initially; WASM capability isolation only for a demonstrated requirement.
7. **Scientific scope:** Include the experimental PSI API in the first reusable artifact, or keep PM2.5-only? Recommendation: PM2.5 primary; if included, keep PSI explicitly experimental and separate.

## References

- [JavaScript modules — MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Web Workers, network access, and CSP — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
- [WebAssembly security model](https://webassembly.org/docs/security/)
- [Subresource Integrity — MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
- [JsonLogic](https://jsonlogic.com/)
- [GeoJSON — RFC 7946](https://www.rfc-editor.org/rfc/rfc7946)
- [Geolocation privacy considerations — W3C](https://www.w3.org/TR/geolocation/)
