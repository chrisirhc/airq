# ADR-001: Reserve color for air-quality severity

## Status

Accepted. The neutral-PM2.5 decision and open question below are superseded by [ADR-002](002-pm25-severity-colors.md). The remaining severity-only color policy is unchanged.

## Date

2026-10-06

## Context

AirQ used coral headings and focus outlines, navy primary cards, green location-success states and live badges, orange data warnings, and faint severity-colored decorative circles. These competing meanings weaken severity encoding: a green live badge can suggest safe air even when the reading is unhealthy. PM2.5 and PSI have distinct classifications and must not imply equivalent severity through shared ordinal color classes.

## Decision

- Use achromatic surfaces, branding, controls, focus indicators, and text. Prioritize PM2.5 through layout and numeric size rather than hue.
- Reserve chromatic color for a compact marker adjacent to the PSI severity descriptor. Remove decorative colored circles. Keep readings, units, and labels in high-contrast neutral text.
- Match the official Haze.gov.sg PSI convention:

  | PSI | Descriptor | Marker fill |
  | --- | --- | --- |
  | 0–50 | Good | `#479B02` |
  | 51–100 | Moderate | `#006FA1` |
  | 101–200 | Unhealthy | `#FFCE03` |
  | 201–300 | Very unhealthy | `#FFA800` |
  | >300 | Hazardous | `#D60000` |

- Use a neutral outline around markers so yellow and orange remain visible on light surfaces. Do not use these fills as text colors.
- Keep PM2.5 bands neutral with their band numbers and descriptors. Do not map its four bands to the first four PSI colors. Use metric-specific class names to prevent accidental palette sharing.
- Communicate live, stale, cached, unavailable, location success, and errors through wording, borders, icons where already present, and weight—not hue. Keep focus rings visibly neutral.
- Make meaning available without color: retain all descriptors and band numbers; decorative markers are hidden from assistive technology. Missing/loading readings have no severity marker.
- Align installed-app theme colors and icons with the neutral interface.

## Evidence

Reviewed [Haze.gov.sg](https://www.haze.gov.sg/), its [stylesheet](https://www.haze.gov.sg/assets/styles/main.css), and its [reading script](https://www.haze.gov.sg/assets/scripts/data.js) on 2026-10-06. The PSI table and stylesheet specify the colors above. The PM2.5 table specifies four bands without colors; the script displays PM2.5 values in neutral `#595959`. This is not evidence of an official four-color PM2.5 palette.

## Alternatives Considered

### Preserve decorative brand and interaction colors

Rejected: color would continue to encode unrelated meanings and compete with air-quality severity.

### Replace official colors with a perceptually uniform sequential palette

Such a palette would better encode ordered magnitude in a continuous visualization, but diverges from the official local categorical convention. Prefer official PSI recognition here, with labels carrying the ordering; do not claim the palette is perceptually uniform.

### Reuse PSI colors by band number for PM2.5

Rejected: separate thresholds and category counts do not establish equivalent health meanings. In particular, the highest PM2.5 band must not inherit a color just because it is the fourth category.

### Color full cards or severity text

Rejected: full-card hue dominates the reading, while yellow/orange text is difficult to read on light surfaces. Compact outlined fills preserve neutral text contrast.

## Consequences

- Color has one meaning, and data freshness no longer implies air-quality safety.
- Labels remain usable in grayscale and with color-vision deficiencies; color is supplemental, not essential.
- PM2.5 is intentionally neutral until a separate palette is agreed upon.
- Regression tests must cover metric-specific classes, official PSI fills, neutral status indicators and surfaces, and the absence of decorative severity on unavailable readings.
- Classification thresholds, estimation, and data freshness behavior are unchanged.

## Open Question

Should PM2.5 receive a separate severity palette? If so, verify a separate official mapping or explicitly approve an app-defined four-band palette; do not infer it from PSI.
