import { ESTIMATION_METHOD_URL } from "./view-utils";

export const APP_SHELL = `
    <div class="page-shell">
      <header class="masthead">
        <a class="brand" href="./" aria-label="Airq home">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>Airq</span>
        </a>
        <div class="masthead-actions">
          <airq-theme></airq-theme>
          <a class="source-link" href="https://www.haze.gov.sg/" target="_blank" rel="noreferrer">
            haze.gov.sg <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>

      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Singapore air quality</p>
        <h1 id="page-title">Air quality now.</h1>
        <p class="hero-copy">1-hour PM2.5 and 24-hour PSI, by region or your location.</p>
      </section>

      <airq-controls></airq-controls>
      <airq-readings></airq-readings>
      <airq-pm25-map></airq-pm25-map>
      <airq-badge></airq-badge>

      <details class="method-note" id="reading-guidance">
        <summary>About these readings and estimates</summary>
        <div>
          <h2>Regional data, carefully labeled.</h2>
          <p>NEA reports five broad regions. A location estimate blends their PM2.5 readings by distance. It is an approximation and cannot account for wind, nearby sources, or street-level conditions.</p>
          <p>In location mode, PSI is an experimental blend of regional indices using the same distance weights. PSI is the highest pollutant sub-index, and different pollutants can drive different regions. Averaging those indices does not reconstruct an official local PSI. Do not use this blend as a health advisory; choose an official region or refer to NEA guidance.</p>
          <p>Estimate algorithm: <a href="${ESTIMATION_METHOD_URL}" target="_blank" rel="noreferrer">Inverse-distance weighting with power 2, explained by Esri <span aria-hidden="true">↗</span></a>.</p>
          <a href="https://www.nea.gov.sg/our-services/pollution-control/air-pollution/faqs" target="_blank" rel="noreferrer">Read NEA guidance <span aria-hidden="true">↗</span></a>
        </div>
      </details>

      <footer class="site-footer">
        <p>Data from the National Environment Agency via data.gov.sg.</p>
        <p>For immediate activity decisions, refer to the 1-hour PM2.5 reading and official guidance.</p>
        <p><a href="https://github.com/chrisirhc/airq" target="_blank" rel="noreferrer">Source code on GitHub</a></p>
      </footer>
    </div>
`;
