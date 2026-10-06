# ADR-003: Keep repeat visits focused on readings

## Status

Accepted.

## Date

2026-10-06

## Context

Returning users primarily need current readings, severity, freshness, and location controls. The always-visible calculation table, weighting explanation, large introductory copy, and guidance made users scroll through background material on every visit, especially on mobile. Hiding all context would make an approximate estimate look like a local measurement, or hide important stale-data and permission warnings.

## Decision

- Use native `details`/`summary` disclosures, collapsed initially, for the calculation, general reading guidance, and Home Screen badge installation explanation.
- Keep values, units, severity labels and colors, timestamps, freshness warnings, location controls, and errors visible. Add a concise visible statement that estimated PM2.5 is approximate and not a local measurement.
- Keep badge actions and their status visible; only the setup explanation is collapsed, so opt-in and disable actions remain readily available.
- Shorten the introduction and reduce oversized card and section spacing. Let cards size independently so expanding the calculation does not stretch the PSI card.
- Preserve disclosure choices during in-page re-renders, including loading transitions. Do not persist choices across visits or add a returning-user tracking flag; every visit starts with a compact layout.
- Retain all calculation rows, equations, limitations, attribution, and guidance links inside the disclosures. Keep the location privacy notice visible before permission is requested.

## Alternatives Considered

### Detect returning users and render a separate layout

Rejected: a single compact layout avoids additional persisted state and gives first-time users the same readily discoverable explanations.

### Remove calculation details entirely

Rejected: users still need access to the estimate's provenance and limitations.

### Custom accordion buttons

Rejected: native disclosures already provide keyboard interaction and expanded/collapsed semantics without additional ARIA state management.

## Consequences

- Default visits require less scrolling without changing readings, classifications, estimation, or badge behavior.
- Calculation tests expand the disclosure before inspecting its table, and cover keyboard access and preservation during refresh.
- General guidance and badge help remain discoverable through explicit summaries.
- Core information and warnings must never be moved exclusively into collapsed content in future layout changes.
