# ADR-002: Color PM2.5 using NEA bands and an app-defined palette

## Status

Accepted. Supersedes only the neutral-PM2.5 decision and open question in [ADR-001](001-severity-only-color.md). Its severity-only color policy remains in effect.

## Date

2026-10-06

## Context

The user requested color coding for PM2.5 as well as PSI. PM2.5 has official Singapore 1-hour bands, but the sources reviewed do not establish an official four-color mapping. Standards elsewhere use different averaging periods and classifications; borrowing their category colors does not make our mapping official.

## Evidence and Standards

### Singapore NEA: 1-hour PM2.5 bands

The [Haze.gov.sg 1-hour PM2.5 readings page](https://www.haze.gov.sg/resources/1-hr-pm2.5-readings), reviewed on 2026-10-06, explicitly documents:

| 1-hour concentration (µg/m³) | Band | Descriptor |
| --- | --- | --- |
| 0–55 | 1 | Normal |
| 56–150 | 2 | Elevated |
| 151–250 | 3 | High |
| ≥251 | 4 | Very High |

AirQ's existing classifications match these bands for whole-number readings. The estimator produces fractional values; classification uses the unrounded value with upper cutoffs of 55, 150, and 250, while the headline rounds for display. This behavior is unchanged by the palette decision.

The dedicated page's band table does not specify a four-color mapping. The homepage also shows the four bands without colors, and its reading script displays PM2.5 values in neutral `#595959`; see ADR-001. These observations do not prove that no official palette exists elsewhere. They mean the proposed colors must not be described as verified NEA colors.

### US EPA / AirNow AQI

[AirNow's AQI basics](https://www.airnow.gov/aqi/aqi-basics/), reviewed on 2026-10-06, defines six color-coded categories: green, yellow, orange, red, purple, and maroon. This is an AQI convention, not a four-band concentration legend. PM2.5 concentration is converted to an index; daily reporting uses a 24-hour averaging basis, while current reporting uses NowCast. Neither classification can be substituted directly for NEA's 1-hour bands.

### WHO air-quality guidelines

The [2021 WHO global air-quality guidelines](https://www.who.int/publications/i/item/9789240034228) recommend PM2.5 levels of 5 µg/m³ annual mean and 15 µg/m³ 24-hour mean. These are exposure guidelines, not four real-time severity bands or a prescribed color palette. Different averaging periods prevent direct comparison with a single 1-hour reading.

In particular, NEA's descriptor “Normal” means Band 1 in its 1-hour classification. It is not a claim that the reading meets WHO's longer-term guidelines or that there is no health risk.

## Decision

Retain NEA's 1-hour thresholds and explicit band numbers/descriptors. Add compact outlined markers using this **AirQ-defined** four-band palette:

| PM2.5 band | Descriptor | Marker fill |
| --- | --- | --- |
| 1 | Normal | Green `#479B02` |
| 2 | Elevated | Yellow `#FFCE03` |
| 3 | High | Orange `#FFA800` |
| 4 | Very High | Red `#D60000` |

The fills reuse familiar severity hues from the official PSI palette, but their assignment to PM2.5 bands is an AirQ display convention, not a verified NEA mapping. Do not claim that matching colors imply equivalent PM2.5 and PSI health classifications.

Use metric-specific classes rather than matching categories by ordinal position. Both official regional PM2.5 and location estimates use the same PM2.5 classification; retain the explicit estimate label. Keep text, units, cards, controls, and freshness badges neutral. Markers supplement readable labels and are hidden from assistive technology.

## Alternatives Considered

### Keep PM2.5 neutral

This avoids inventing a palette, but does not satisfy the requested PM2.5 severity encoding. Replaced with an explicitly app-defined mapping.

### Use the first four PSI colors

Rejected: green/blue/yellow/orange would give the highest PM2.5 band orange solely because it is the fourth category. Different category counts and health classifications do not justify ordinal equivalence.

### Apply US AQI categories or WHO guidelines

Rejected: this would change the metric's meaning and averaging basis, not merely its visual encoding. Such a feature would require a separate specification and decision.

## Consequences

- Both metrics have supplemental severity color, with explicit labels preserving meaning in grayscale and for people with color-vision deficiencies.
- Singapore's official bands remain the source of PM2.5 classification; estimation and thresholds are unchanged.
- Documentation must distinguish official PSI colors from the app-defined PM2.5 mapping.
- Regression tests cover each PM2.5 cutoff and marker fill independently of PSI.
- If an official NEA PM2.5 palette is subsequently verified, record the source and a superseding decision before changing this mapping.
