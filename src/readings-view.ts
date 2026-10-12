import type { AppState } from "./app-state";
import { classifyPm25, classifyPsi, statusTone } from "./classifiers";
import { REGION_LABELS } from "./domain";
import { type ExperimentalPsiEstimate, estimateExperimentalPsi } from "./experimental-psi";
import type { Pm25Estimate } from "./location-estimator";
import { ESTIMATION_METHOD_URL, escapeHtml, formatTimestamp } from "./view-utils";

export function renderReadings(state: AppState): string {
  if (state.data.kind === "loading") {
    return `
      <article class="reading-card skeleton-card">
        <p class="card-kicker">Loading official data</p>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
      </article>
      <article class="reading-card skeleton-card">
        <p class="card-kicker">Checking latest readings</p>
        <div class="skeleton-line wide"></div>
        <div class="skeleton-line"></div>
      </article>
    `;
  }

  const { pm25, psi } = state.data.snapshot;
  const selectedRegion =
    state.display.kind === "manual" ? state.display.region : state.display.estimate.closestRegion;

  const pm25Card = (() => {
    if (pm25.kind === "unavailable") return renderUnavailable("1-hour PM2.5", pm25.message);

    const display = state.display;
    const estimated = display.kind === "estimated";
    const value = estimated ? display.estimate.value : pm25.reading.values[selectedRegion];
    const band = classifyPm25(value);
    const label = estimated ? "Estimated PM2.5" : `${REGION_LABELS[selectedRegion]} region PM2.5`;
    const detail = estimated
      ? `<p class="card-detail">Approximate 1-hour concentration · not a local measurement</p>${renderContributions(display.estimate)}`
      : `<p class="card-detail">Official 1-hour regional concentration</p>`;

    return `
      <article class="reading-card primary-card ${statusTone(value, "pm25")}">
        <div class="card-heading">
          <div>
            <p class="card-kicker">${label}</p>
            <p class="status-label"><span class="severity-marker" aria-hidden="true"></span>Band ${band.level} · ${band.label}</p>
          </div>
          ${renderSourceBadge(pm25.source, pm25.reading.stale)}
        </div>
        <div class="reading-value"><strong>${Math.round(value)}</strong><span>µg/m³</span></div>
        ${detail}
        <p class="timestamp">Reading at ${formatTimestamp(pm25.reading.timestamp)}</p>
      </article>
    `;
  })();

  const psiCard = (() => {
    if (psi.kind === "unavailable") return renderUnavailable("24-hour PSI", psi.message);
    const estimate =
      state.display.kind === "estimated"
        ? estimateExperimentalPsi(state.display.estimate.contributions, psi.reading.values)
        : null;
    if (state.display.kind === "estimated" && !estimate) {
      return renderUnavailable(
        "Estimated PSI (experimental)",
        "All five valid regional readings and location weights are required. Choose an official region to view its PSI.",
      );
    }
    const value = estimate ? estimate.value : psi.reading.values[selectedRegion];
    const label = estimate
      ? "Estimated PSI (experimental)"
      : `${REGION_LABELS[selectedRegion]} region PSI`;
    const context = estimate
      ? "Experimental regional blend · not an official local PSI or health advisory"
      : "Official regional reading";

    return `
      <article class="reading-card ${statusTone(value, "psi")}">
        <div class="card-heading">
          <div>
            <p class="card-kicker">${label}</p>
            <p class="status-label"><span class="severity-marker" aria-hidden="true"></span>${estimate ? "Approximate · " : ""}${classifyPsi(value)}</p>
          </div>
          ${renderSourceBadge(psi.source, psi.reading.stale)}
        </div>
        <div class="reading-value"><strong>${Math.round(value)}</strong><span>24-hour PSI</span></div>
        <p class="card-detail">${context}</p>
        ${estimate ? renderContributions(estimate, "psi") : ""}
        <p class="timestamp">Reading at ${formatTimestamp(psi.reading.timestamp)}</p>
      </article>
    `;
  })();

  return pm25Card + psiCard;
}

function renderContributions(
  estimate: Pm25Estimate | ExperimentalPsiEstimate,
  metric: "pm25" | "psi" = "pm25",
): string {
  const isPsi = metric === "psi";
  const unit = isPsi ? "" : " µg/m³";
  const contributions = estimate.contributions
    .slice()
    .sort((left, right) => right.weight - left.weight);
  const rows = contributions
    .map(
      (contribution) => `
        <tr>
          <th scope="row">${REGION_LABELS[contribution.region]}</th>
          <td>${contribution.value}</td>
          <td>${(contribution.distanceMeters / 1000).toFixed(2)}</td>
          <td>${(contribution.weight * 100).toFixed(2)}%</td>
        </tr>
      `,
    )
    .join("");

  const exact = estimate.contributions.find((contribution) => contribution.distanceMeters <= 1);
  const method = exact
    ? `Your location is within 1 metre of the ${REGION_LABELS[exact.region]} reference point, so its reading receives 100% weight and the other regions receive 0%.`
    : "Distances are measured from your location to the five regional reference points supplied with the PM2.5 data. Each weight is (1 ÷ distance²) divided by the sum of all five (1 ÷ distance²) values. Closer regions receive more weight.";
  const terms = contributions
    .map((contribution) => `${contribution.value} × ${(contribution.weight * 100).toFixed(2)}%`)
    .join(" + ");

  return `
    <details class="contributions" id="${isPsi ? "psi-estimate-calculation" : "estimate-calculation"}">
      <summary>How your estimate is calculated</summary>
      <section aria-label="${isPsi ? "Experimental PSI calculation" : "Estimate calculation"}">
      ${isPsi ? "<p>This is a weighted blend of the final regional PSI indices, not of pollutant concentrations. Different pollutants may drive each region’s index; the blend is not a scientifically validated local PSI or a health advisory. Select a region for its official PSI.</p>" : ""}
      <p>${method}</p>
      <div class="contribution-table">
        <table>
          <caption>Official ${isPsi ? "24-hour PSI" : "1-hour PM2.5"} readings used in this ${isPsi ? "experimental blend" : "estimate"}</caption>
          <thead><tr><th scope="col">Region</th><th scope="col">${isPsi ? "24-hour PSI" : "PM2.5<br>µg/m³"}</th><th scope="col">Distance<br>km</th><th scope="col">Weight</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="estimate-equation">${terms} ≈ ${estimate.value.toFixed(2)}${unit}</p>
      <p>Multiply each regional reading by its weight, then add the results. The headline rounds this to ${Math.round(estimate.value)}${unit}. Distances and weights above are rounded for display; the calculation uses their full precision.</p>
      <p><a href="${ESTIMATION_METHOD_URL}" target="_blank" rel="noreferrer">Read Esri's explanation of inverse-distance weighting <span aria-hidden="true">↗</span></a>. This ${isPsi ? "experimental blend" : "estimate"} uses power 2 with all five regional reference points.${isPsi ? " This reference explains the weighting method, not the validity of blending PSI indices." : ""}</p>
      </section>
    </details>
  `;
}

function renderUnavailable(title: string, message: string): string {
  return `
    <article class="reading-card unavailable-card">
      <p class="card-kicker">${title}</p>
      <h2>Reading unavailable</h2>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="text-button retry-button">Try again</button>
    </article>
  `;
}

function renderSourceBadge(source: "live" | "cached", stale: boolean): string {
  if (source === "cached") return `<span class="data-badge warning">Cached</span>`;
  if (stale) return `<span class="data-badge warning">Stale</span>`;
  return `<span class="data-badge">Live data</span>`;
}

export function locationMessage(state: AppState): string {
  if (state.location.kind === "requesting") {
    return `<p class="control-message" role="status">Finding your location to calculate a PM2.5 estimate.</p>`;
  }
  if (state.location.kind === "error") {
    return `<p class="control-message error" role="alert">${escapeHtml(state.location.message)}</p>`;
  }
  if (state.display.kind === "estimated") {
    const name = state.display.locationName;
    return `<p class="control-message">Your location${name ? `: near ${escapeHtml(name)}. <a href="https://www.onemap.gov.sg/" target="_blank" rel="noreferrer">OneMap, Singapore Land Authority</a>` : ""}</p><p class="control-message success" role="status">Location found. Showing an approximate PM2.5 estimate.</p>`;
  }
  return "";
}
