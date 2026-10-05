# AirQ background estimate badge sketch

## Proposed experience

Install AirQ with a manifest, static icons, and standalone display. A button labeled "Enable background estimate and notifications" requests notification permission directly from a user gesture. Explain that the icon number is rounded PM2.5 in µg/m³ for a saved location, and each background update displays a notification. Start with a foreground-only badge option and offer background updates separately.

The user chooses a saved location or official region. Proposed location expiry is 24 hours; the settings show its age, expiry, latest reading time, and update cadence. Raw coordinates remain transient. Background enrollment explicitly permits device-local storage of interpolation weights, which are still location-derived sensitive data. No target or weights go to the server.

## Data flow

Cloudflare Cron, initially every 15 minutes, retrieves public regional PM2.5 and reference metadata. It reuses the browser-independent parser and accepts only complete, fresh data. A D1 transaction records each new revision and creates delivery outbox rows. Changed values or reference metadata count as revisions even when a reading timestamp is unchanged.

A bounded sender processes the outbox and sends encrypted Web Push to active subscriptions. For this small app, use Worker + Cron + D1; introduce a Queue only if fan-out exceeds a bounded scheduled run. D1 persists subscription credentials, expiry/cadence, observations, and outbox status. VAPID private material stays in Worker secrets. Push acceptance is not proof of device delivery.

On a push, the installed service worker reads its target from IndexedDB, validates the regional snapshot, computes the weighted estimate, rounds with Math.round, updates the app badge, and displays a visible notification. The notification includes PM2.5 units, official reading time, and "saved location." Use one stable notification tag to replace the prior update.

The foreground page sends target and snapshot commands to the service worker. One service-worker presentation path owns badge writes for both page updates and pushes. The page continues to show the full region contribution table.

## Types and interfaces

The caller sees enable, target replacement, and disable operations. Permission prompts start directly in the user's button handler, before other awaited setup. Those operations hide push subscription registration, service-worker messaging, IndexedDB writes, and initial badge presentation.

```ts
type BadgeTarget =
  | { kind: "region"; region: Region }
  | {
      kind: "estimate";
      weights: Readonly<Record<Region, number>>;
      referenceFingerprint: string;
      estimatorVersion: number;
      capturedAt: number;
      expiresAt: number;
    };

type RegionalSnapshot = {
  revision: number;
  readingAt: number;
  updatedAt: number;
  validUntil: number;
  referenceFingerprint: string;
  estimatorVersion: number;
  values: Readonly<Record<Region, number>>;
};

type BadgeDecision =
  | { kind: "reading"; value: number; rounded: number; readingAt: number }
  | { kind: "clear"; reason: "disabled" | "expired" | "stale" | "target-mismatch" };

interface BackgroundBadge {
  enable(input: { target: BadgeTarget; cadence: "each-reading" }): Promise<void>;
  replaceTarget(target: BadgeTarget): Promise<void>;
  disable(): Promise<void>;
}

// Pure: boundary-validated data in, decision out; bodies are not implemented.
function decideBadge(snapshot: RegionalSnapshot, target: BadgeTarget, now: number): BadgeDecision;
```

Actual implementation derives these region/value types from the existing domain and schemas. Normalized weights and valid revisions are constructed and validated at boundaries. The weighted sum and exact-reference-point behavior remain shared with the existing estimator.

## State and delivery rules

- Target commands and pushes pass through one serialized badge writer. IndexedDB holds target generation and newest accepted snapshot revision. Older deliveries cannot regress a newer badge. On target change, compute from the newest valid snapshot for the current target.
- A reference fingerprint covers all five reference-point coordinates. If references or estimator version change, clear the estimate until foreground geolocation can rebuild its profile; a region target can continue using that region's reading.
- Foreground and background must agree about the badge target. While location mode is used and enrollment is active, fresh location replaces the saved profile and its expiry. Choosing a region updates both displayed and badge target to that region. Label a region reading as regional rather than estimated.
- Each received iOS push must produce a visible notification, including retries and old messages. Use the newest valid local state for that notification; if disabled or expired, clear the badge and show a non-numeric status. Do not silently return from stale-push handling.
- Deduplicate outbox creation with subscription ID plus snapshot revision. Bound retries by freshness/TTL; stop sending superseded work. Treat 404/410 as invalid subscriptions and remove them. Short push TTL and a stable topic reduce obsolete queued deliveries.
- The numeric badge is Math.round(value). Zero clears the badge on supported platforms; do not change zero to one. The app and notification still display the actual zero.
- Foreground-only mode updates on app activity. Background mode proposes one visible notification per new official reading. Quiet hours or a slower cadence necessarily make the badge older. Personalized threshold-only delivery requires server-side target knowledge and is outside this base design.
- Missing/stale data and expired targets clear on the next execution event. An offline phone or absent push cannot be forced to clear exactly at expiry. The badge is the last received estimate, not a freshness guarantee.
- Disable first saves disabled state and clears the badge locally, then unsubscribes and deletes server enrollment. Already in-flight pushes may still show a status notification but must never restore a numeric badge. Add expiry cleanup for abandoned server subscriptions.

## Module map

- Existing domain/estimator plus extracted public-data parsers: shared numerical and validation rules, no browser globals.
- Browser background-badge module: installation/permission flow and enrollment controls.
- Service worker: IndexedDB state, push receipt, serialized badge/notification presentation, notification-click navigation.
- Cloudflare Worker: registration/deletion HTTP API, scheduled collection, D1 outbox and push sender, existing static assets.
- Wrangler: Worker entry point, D1 binding, Cron schedule, secrets; existing airq.b65.dev custom domain stays the app origin.

## First implementation gate

Prove install, opt-in, a closed-app push, visible notification, and exact rounded badge on a physical iPhone before building scheduled fan-out. Then test duplicate/out-of-order delivery, foreground target replacement, zero, expiry, storage loss, denial, and opt-out. Enable the scheduler only after that proof.

## References

- https://webkit.org/blog/14112/badging-for-home-screen-web-apps/
- https://webkit.org/blog/16535/meet-declarative-web-push/
- https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/setAppBadge
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
