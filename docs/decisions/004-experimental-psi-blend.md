# ADR-004: Show an explicitly experimental PSI blend in location mode

## Status

Accepted at the user's explicit request for an experimental estimate. Supersedes the original implementation-plan decision to show only the closest region's official PSI in location mode. Manual regional readings remain official and unchanged.

## Date

2026-10-06

## Context

The user wants location mode to provide a consistent estimate for both PM2.5 and 24-hour PSI and explicitly selected an experimental PSI estimate after discussion of the limitations.

PM2.5 is a concentration; PSI is a derived index based on the highest pollutant sub-index. Different pollutants can drive different regions' PSI. Averaging the final indices does not reconstruct local pollutant concentrations or an official local PSI. A smooth numeric output is not evidence of scientific validity or improved geographic accuracy.

## Decision

- In location mode, blend the five regional `psi_twenty_four_hourly` values using the existing PM2.5 inverse-square distance weights. Compute the sum of each PSI value multiplied by its weight; classify the unrounded result, and round only the headline.
- Use parallel labels **Estimated PM2.5** and **Estimated PSI (experimental)** and the shared disclosure summary **How your estimate is calculated**. Both use the same inverse-square weighting methodology, but blending indices has different scientific limitations from interpolating concentrations. Qualify the PSI descriptor with **Approximate**, and keep **Experimental regional blend · not an official local PSI or health advisory** visible even with calculation details collapsed.
- Reuse the official PSI category colors as a supplemental classification of the numeric blend, not a claim that NEA endorses a local severity assessment.
- Provide a separate native disclosure containing the source PSI values, distances, weights, full-precision result displayed to two decimals, and the explanation that regional indices may reflect different dominant pollutants. Direct users to official regional readings and NEA guidance for health decisions.
- Reuse the location weights only; do not reuse PM2.5 concentrations, classifications, timestamps, or freshness status. Recompute the blend from the current PSI snapshot on each render so PSI refreshes are independent.
- Require all five finite, nonnegative PSI values and valid, complete normalized weights. Do not drop missing regions or silently renormalize incomplete data. Show an unavailable message on invalid blend input.
- The weight geometry still comes from the PM2.5 API's regional reference points. No separate PSI reference geometry, pollutant-level interpolation, or new model is claimed. Initially obtaining location weights requires the existing successful PM2.5 estimation path. Already captured weights may be reused when an endpoint later fails; each metric independently retains its existing unavailable/cached/stale handling. Changed reference geometry still requires rebuilding the location estimate.
- At an exact reference point, its PSI receives 100% weight. Keep the experimental label even when the output equals an official value.
- Manual selection shows the selected region's exact official PSI without experimental labels or calculation disclosures. No changes to the installed-app badge, which remains rounded PM2.5.

## Alternatives Considered

### Official PSI for the closest reference region

Scientifically more conservative and the prior behavior. Replaced in location mode at the user's explicit request; official readings remain available through the region selector.

### Interpolate pollutant concentrations and recompute PSI

This would require pollutant-specific averaging periods, complete sub-index inputs, a separate model, and validation. Out of scope; the experimental blend must not imply this method is implemented.

### Unqualified “Estimated PSI”

Rejected: parity with the PM2.5 card would conceal the stronger scientific limitations of blending indices.

## Consequences

- Both location-mode cards provide weighted outputs with the same geometric weights, but their labels explicitly distinguish concentration estimation from experimental index blending.
- The blend may obscure a region's higher PSI; it is not a substitute for official health guidance or exposure planning.
- Tests cover equal and exact-point weights, fractional output, refreshed values, invalid/missing inputs, shared weights, independent freshness, disclosure content, classification, and switching back to official readings.
- Any future validated PSI model should supersede this decision rather than silently changing the interpretation of the existing output.
