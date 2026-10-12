import type { BackgroundBadge, BadgeView } from "./background-badge";
import { Disclosure } from "./disclosures";

export function BadgeControls({ view, badge }: { view: BadgeView; badge: BackgroundBadge }) {
  const {
    debug,
    supported,
    configured,
    ready,
    busy,
    active,
    mode,
    detail,
    message,
    testMessage,
    expiry,
  } = view;
  return (
    <section className="badge-controls" aria-labelledby="badge-title">
      <p className="eyebrow">Home Screen app</p>
      <h2 id="badge-title">A reading on your app icon.</h2>
      <Disclosure id="badge-help" className="badge-help" summary="Installation and how badges work">
        <p>
          On iPhone, use Share → Add to Home Screen, then open AirQ from that icon. The badge is
          rounded PM2.5 in µg/m³, not a notification count. Zero clears it.
        </p>
        <p>
          Foreground-only updates when this app is open. The badge is the last received reading, not
          live tracking.
        </p>
        {debug && (
          <>
            <p>
              Background testing saves location-derived weights on this device for up to 24 hours,
              never coordinates. Every received push shows a visible notification.
            </p>
            <p>You can send a test after opting in.</p>
          </>
        )}
      </Disclosure>
      <p>Automatic background updates are not enabled yet.</p>
      <div className="badge-actions">
        <button
          id="badge-foreground"
          type="button"
          disabled={!supported || !ready || busy}
          onClick={badge.enableForeground}
        >
          {mode === "foreground" ? "Foreground badge enabled" : "Enable foreground-only badge"}
        </button>
        {debug && (
          <button
            id="badge-background"
            type="button"
            disabled={!supported || !ready || !configured || busy || mode === "background"}
            onClick={badge.enableBackground}
          >
            Enable background test and notifications
          </button>
        )}
        {(active || message) && (
          <button id="badge-disable" type="button" disabled={busy} onClick={badge.disable}>
            Disable badge and notifications
          </button>
        )}
        {debug && mode === "background" && (
          <>
            <button id="badge-test" type="button" disabled={busy} onClick={badge.sendTest}>
              Send test notification
            </button>
            <button
              id="badge-clear-test"
              type="button"
              disabled={busy}
              onClick={badge.clearForTest}
            >
              Clear badge for test
            </button>
          </>
        )}
      </div>
      <p role="status" id="badge-status">
        {busy ? "Updating badge settings…" : detail} {message}
      </p>
      {expiry && <p>Saved location expires {expiry}. Use your location again to refresh it.</p>}
      {debug && mode === "background" && (
        <p role="status" id="badge-test-status">
          {testMessage}
        </p>
      )}
      {!supported && (
        <p>
          This browser does not expose app badges. Install the app on a supported device to use
          them.
        </p>
      )}
      {debug && supported && !configured && (
        <p>Background test delivery is not configured on this host.</p>
      )}
    </section>
  );
}
