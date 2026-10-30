import type { AppState } from "./air-quality-controller";
import { classifyPm25, classifyPsi, statusTone } from "./classifiers";
import { Disclosure } from "./disclosures";
import { REGION_LABELS } from "./domain";
import { type ExperimentalPsiEstimate, estimateExperimentalPsi } from "./experimental-psi";
import type { Pm25Estimate } from "./location-estimator";

export const ESTIMATION_METHOD_URL =
  "https://pro.arcgis.com/en/pro-app/3.5/help/analysis/geostatistical-analyst/how-inverse-distance-weighted-interpolation-works.htm";

export function LoadingReadings() {
  return (
    <>
      <article className="reading-card skeleton-card">
        <p className="card-kicker">Loading official data</p>
        <div className="skeleton-line wide" />
        <div className="skeleton-line" />
      </article>
      <article className="reading-card skeleton-card">
        <p className="card-kicker">Checking latest readings</p>
        <div className="skeleton-line wide" />
        <div className="skeleton-line" />
      </article>
    </>
  );
}

export function Readings({ state, retry }: { state: AppState; retry: () => void }) {
  const { pm25, psi } = state.readings;
  const display = state.display;
  const region = display.kind === "manual" ? display.region : display.estimate.closestRegion;
  const pmValue =
    display.kind === "estimated"
      ? display.estimate.value
      : pm25.kind === "available"
        ? pm25.reading.values[region]
        : 0;
  const pmBand = classifyPm25(pmValue);
  const psiEstimate =
    display.kind === "estimated" && psi.kind === "available"
      ? estimateExperimentalPsi(display.estimate.contributions, psi.reading.values)
      : null;
  const psiValue = psiEstimate
    ? psiEstimate.value
    : psi.kind === "available"
      ? psi.reading.values[region]
      : 0;
  return (
    <>
      {pm25.kind === "unavailable" ? (
        <Unavailable title="1-hour PM2.5" message={pm25.message} retry={retry} />
      ) : (
        <article className={`reading-card primary-card ${statusTone(pmValue, "pm25")}`}>
          <div className="card-heading">
            <div>
              <p className="card-kicker">
                {display.kind === "estimated"
                  ? "Estimated PM2.5"
                  : `${REGION_LABELS[region]} region PM2.5`}
              </p>
              <p className="status-label">
                <span className="severity-marker" aria-hidden="true" />
                Band {pmBand.level} · {pmBand.label}
              </p>
            </div>
            <SourceBadge source={pm25.source} stale={pm25.reading.stale} />
          </div>
          <div className="reading-value">
            <strong>{Math.round(pmValue)}</strong>
            <span>µg/m³</span>
          </div>
          <p className="card-detail">
            {display.kind === "estimated"
              ? "Approximate 1-hour concentration · not a local measurement"
              : "Official 1-hour regional concentration"}
          </p>
          {display.kind === "estimated" && <Contributions estimate={display.estimate} />}
          <p className="timestamp">Reading at {formatTimestamp(pm25.reading.timestamp)}</p>
        </article>
      )}
      {psi.kind === "unavailable" ? (
        <Unavailable title="24-hour PSI" message={psi.message} retry={retry} />
      ) : display.kind === "estimated" && !psiEstimate ? (
        <Unavailable
          title="Estimated PSI (experimental)"
          message="All five valid regional readings and location weights are required. Choose an official region to view its PSI."
          retry={retry}
        />
      ) : (
        <article className={`reading-card ${statusTone(psiValue, "psi")}`}>
          <div className="card-heading">
            <div>
              <p className="card-kicker">
                {psiEstimate
                  ? "Estimated PSI (experimental)"
                  : `${REGION_LABELS[region]} region PSI`}
              </p>
              <p className="status-label">
                <span className="severity-marker" aria-hidden="true" />
                {psiEstimate ? "Approximate · " : ""}
                {classifyPsi(psiValue)}
              </p>
            </div>
            <SourceBadge source={psi.source} stale={psi.reading.stale} />
          </div>
          <div className="reading-value">
            <strong>{Math.round(psiValue)}</strong>
            <span>24-hour PSI</span>
          </div>
          <p className="card-detail">
            {psiEstimate
              ? "Experimental regional blend · not an official local PSI or health advisory"
              : "Official regional reading"}
          </p>
          {psiEstimate && <Contributions estimate={psiEstimate} metric="psi" />}
          <p className="timestamp">Reading at {formatTimestamp(psi.reading.timestamp)}</p>
        </article>
      )}
    </>
  );
}

function Contributions({
  estimate,
  metric = "pm25",
}: {
  estimate: Pm25Estimate | ExperimentalPsiEstimate;
  metric?: "pm25" | "psi";
}) {
  const isPsi = metric === "psi";
  const unit = isPsi ? "" : " µg/m³";
  const contributions = estimate.contributions
    .slice()
    .sort((left, right) => right.weight - left.weight);
  const exact = estimate.contributions.find((contribution) => contribution.distanceMeters <= 1);
  const method = exact
    ? `Your location is within 1 metre of the ${REGION_LABELS[exact.region]} reference point, so its reading receives 100% weight and the other regions receive 0%.`
    : "Distances are measured from your location to the five regional reference points supplied with the PM2.5 data. Each weight is (1 ÷ distance²) divided by the sum of all five (1 ÷ distance²) values. Closer regions receive more weight.";
  const terms = contributions
    .map((contribution) => `${contribution.value} × ${(contribution.weight * 100).toFixed(2)}%`)
    .join(" + ");
  return (
    <Disclosure
      className="contributions"
      id={isPsi ? "psi-estimate-calculation" : "estimate-calculation"}
      summary="How your estimate is calculated"
    >
      <section aria-label={isPsi ? "Experimental PSI calculation" : "Estimate calculation"}>
        {isPsi && (
          <p>
            This is a weighted blend of the final regional PSI indices, not of pollutant
            concentrations. Different pollutants may drive each region’s index; the blend is not a
            scientifically validated local PSI or a health advisory. Select a region for its
            official PSI.
          </p>
        )}
        <p>{method}</p>
        <div className="contribution-table">
          <table>
            <caption>
              Official {isPsi ? "24-hour PSI" : "1-hour PM2.5"} readings used in this{" "}
              {isPsi ? "experimental blend" : "estimate"}
            </caption>
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col">
                  {isPsi ? (
                    "24-hour PSI"
                  ) : (
                    <>
                      PM2.5
                      <br />
                      µg/m³
                    </>
                  )}
                </th>
                <th scope="col">
                  Distance
                  <br />
                  km
                </th>
                <th scope="col">Weight</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((contribution) => (
                <tr key={contribution.region}>
                  <th scope="row">{REGION_LABELS[contribution.region]}</th>
                  <td>{contribution.value}</td>
                  <td>{(contribution.distanceMeters / 1000).toFixed(2)}</td>
                  <td>{(contribution.weight * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="estimate-equation">
          {terms} ≈ {estimate.value.toFixed(2)}
          {unit}
        </p>
        <p>
          Multiply each regional reading by its weight, then add the results. The headline rounds
          this to {Math.round(estimate.value)}
          {unit}. Distances and weights above are rounded for display; the calculation uses their
          full precision.
        </p>
        <p>
          <a href={ESTIMATION_METHOD_URL} target="_blank" rel="noreferrer">
            Read Esri's explanation of inverse-distance weighting <span aria-hidden="true">↗</span>
          </a>
          . This {isPsi ? "experimental blend" : "estimate"} uses power 2 with all five regional
          reference points.
          {isPsi
            ? " This reference explains the weighting method, not the validity of blending PSI indices."
            : ""}
        </p>
      </section>
    </Disclosure>
  );
}
function Unavailable({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry: () => void;
}) {
  return (
    <article className="reading-card unavailable-card">
      <p className="card-kicker">{title}</p>
      <h2>Reading unavailable</h2>
      <p>{message}</p>
      <button type="button" className="text-button retry-button" onClick={retry}>
        Try again
      </button>
    </article>
  );
}
function SourceBadge({ source, stale }: { source: "live" | "cached"; stale: boolean }) {
  return (
    <span className={`data-badge${source === "cached" || stale ? " warning" : ""}`}>
      {source === "cached" ? "Cached" : stale ? "Stale" : "Live data"}
    </span>
  );
}
function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
