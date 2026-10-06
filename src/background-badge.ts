import { z } from "zod";
import {
  type BadgeCommand,
  type BadgeState,
  type BadgeTarget,
  badgeStateSchema,
  currentDecision,
  decideBadge,
  type RegionalSnapshot,
} from "./badge-domain";
import {
  enrollmentReceiptSchema,
  pushConfigSchema,
  testStatusMessage,
  testStatusSchema,
} from "./push-protocol";

const credentialSchema = z.object({ id: z.string(), token: z.string() });
const responseSchema = z.object({ state: badgeStateSchema });
const CREDENTIAL_KEY = "airq:push-enrollment:v1";
type BadgeInput = { target: BadgeTarget; snapshot: RegionalSnapshot };

export function createBackgroundBadge(onChange: () => void) {
  const debug = new URLSearchParams(window.location.search).has("debug");
  let state: BadgeState = { mode: "disabled" };
  let busy = false;
  let message = "";
  let testMessage = "";
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let checkingStatus = false;
  let statusGeneration = 0;
  let configured = false;
  let publicKey = "";
  let current: BadgeInput | null = null;
  let registration: ServiceWorkerRegistration | null = null;
  let pendingSync = Promise.resolve();
  let targetChangedWhileBusy = false;
  const supported =
    "serviceWorker" in navigator && "setAppBadge" in navigator && "Notification" in window;

  async function command(input: BadgeCommand): Promise<void> {
    const worker = registration?.active;
    if (!worker) throw new Error("The badge service worker is not ready. Reload and try again.");
    const channel = new MessageChannel();
    try {
      const result: unknown = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Badge update timed out")), 5_000);
        channel.port1.onmessage = (event: MessageEvent<unknown>) => {
          clearTimeout(timeout);
          resolve(event.data);
        };
        worker.postMessage(input, [channel.port2]);
      });
      const parsed = responseSchema.safeParse(result);
      if (!parsed.success) {
        const failure = z.object({ error: z.string() }).safeParse(result);
        throw new Error(
          failure.success && failure.data.error === "Invalid badge command"
            ? "Close every AirQ window and reopen the installed app to activate the new badge controls."
            : failure.success
              ? failure.data.error
              : "Badge storage is unavailable. No saved target was updated.",
        );
      }
      state = parsed.data.state;
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  }

  async function start(): Promise<void> {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        type: "module",
        scope: import.meta.env.BASE_URL,
      });
      registration = await navigator.serviceWorker.ready;
      await command({ kind: "status" });
      if (debug) {
        const response = await fetch("/api/badge/config", { signal: AbortSignal.timeout(3_000) });
        const config = pushConfigSchema.safeParse(await response.json());
        if (config.success) {
          configured = config.data.enabled;
          publicKey = config.data.publicKey;
        }
      }
    } catch {
      message = debug
        ? "Background tests are unavailable here. Foreground badges may still work."
        : "Badge settings are unavailable. Reload and try again.";
    }
    onChange();
    void refreshTestStatus();
  }

  function credential() {
    const value = localStorage.getItem(CREDENTIAL_KEY);
    return value ? credentialSchema.parse(JSON.parse(value)) : null;
  }

  async function api(path: string, method: string): Promise<Response> {
    const saved = credential();
    if (!saved) throw new Error("Push enrollment is missing. Disable and enable again.");
    const response = await fetch(`/api/badge/subscriptions/${saved.id}${path}`, {
      method,
      signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${saved.token}` },
    });
    if (!response.ok) {
      if (method === "DELETE" && (response.status === 401 || response.status === 410))
        return response;
      if (response.status === 401 || response.status === 410)
        throw new Error(
          "Push enrollment is missing or expired. Disable and enable background testing again.",
        );
      const error = z.object({ error: z.string() }).safeParse(await response.json());
      throw new Error(error.success ? error.data.error : "Push request failed");
    }
    return response;
  }

  async function refreshTestStatus(): Promise<void> {
    if (!debug || checkingStatus || busy || state.mode !== "background" || document.hidden) return;
    clearTimeout(statusTimer);
    checkingStatus = true;
    const generation = statusGeneration;
    try {
      const result = testStatusSchema.parse(await (await api("/test", "GET")).json());
      if (state.mode !== "background" || generation !== statusGeneration) return;
      testMessage = testStatusMessage(result);
      if (result.status === "pending")
        statusTimer = setTimeout(() => void refreshTestStatus(), 2_500);
    } catch (error: unknown) {
      if (generation !== statusGeneration || state.mode !== "background") return;
      testMessage =
        error instanceof Error
          ? error.message
          : "Cannot check test delivery. Reopen AirQ to retry.";
    } finally {
      checkingStatus = false;
      if (generation !== statusGeneration && state.mode === "background")
        statusTimer = setTimeout(() => void refreshTestStatus(), 0);
      onChange();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshTestStatus();
  });
  window.addEventListener("focus", () => void refreshTestStatus());

  async function stopPush(): Promise<void> {
    const subscription = await registration?.pushManager?.getSubscription();
    const saved = credential();
    if (saved) await api("", "DELETE");
    if (subscription && !(await subscription.unsubscribe()))
      throw new Error("Could not unsubscribe. Try disabling again.");
    localStorage.removeItem(CREDENTIAL_KEY);
    statusGeneration++;
    clearTimeout(statusTimer);
    testMessage = "";
  }

  async function enroll(): Promise<void> {
    if (!registration || !current)
      throw new Error("Wait for fresh readings before enabling a badge.");
    const existing = await registration.pushManager.getSubscription();
    const key = Uint8Array.from(
      atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (character) => character.charCodeAt(0),
    );
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));
    const saved = credential();
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token =
      saved?.token ??
      btoa(String.fromCharCode(...random))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const id = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint)),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    // Save revocation credentials before registration, so a network interruption remains recoverable.
    localStorage.setItem(CREDENTIAL_KEY, JSON.stringify({ id, token }));
    const response = await fetch("/api/badge/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), token }),
    });
    if (!response.ok)
      throw new Error("Push enrollment failed. Disable to clean up, then try again.");
    enrollmentReceiptSchema.parse(await response.json());
    await command({ kind: "target", ...current });
  }

  function run(operation: () => Promise<void>): void {
    busy = true;
    message = "";
    onChange();
    void operation()
      .catch((error: unknown) => {
        message = error instanceof Error ? error.message : "Badge operation failed";
      })
      .finally(() => {
        busy = false;
        const replaceTarget = targetChangedWhileBusy;
        targetChangedWhileBusy = false;
        sync(current, replaceTarget);
        onChange();
        void refreshTestStatus();
      });
  }

  function enable(background: boolean): void {
    // Safari requires this call in the original click handler, before any awaited setup.
    const permission =
      Notification.permission === "granted"
        ? Promise.resolve("granted")
        : Notification.requestPermission();
    run(async () => {
      if ((await permission) !== "granted")
        throw new Error(
          "Notifications permission is required for an iPhone badge. Enable it in Settings to try again.",
        );
      if (!current) throw new Error("Fresh PM2.5 data is required.");
      if (decideBadge(current.snapshot, current.target, Date.now()).kind !== "reading")
        throw new Error("Wait for fresh official data before enabling a badge.");
      if (background) {
        await enroll();
        message = "Background test enabled. Automatic updates are not enabled yet.";
      } else {
        await command({
          kind: "foreground",
          decision: decideBadge(current.snapshot, current.target, Date.now()),
        });
        await stopPush();
      }
    });
  }

  function sync(input: BadgeInput | null, replaceTarget: boolean): void {
    current = input;
    if (busy) {
      targetChangedWhileBusy ||= replaceTarget;
      return;
    }
    pendingSync = pendingSync
      .then(async () => {
        if (busy || !registration || state.mode === "disabled") return;
        if (state.mode === "foreground") {
          await command({
            kind: "foreground",
            decision: input
              ? decideBadge(input.snapshot, input.target, Date.now())
              : { kind: "clear", reason: "stale" },
          });
        } else if (replaceTarget && input) await command({ kind: "target", ...input });
        else await command({ kind: "snapshot", snapshot: input?.snapshot ?? null });
        onChange();
      })
      .catch(() => {
        message = "The badge could not be updated. Open the installed app and try again.";
        onChange();
      });
  }

  function html(): string {
    const decision = currentDecision(state, Date.now());
    const active = state.mode !== "disabled";
    const target = state.mode === "background" ? state.target : null;
    const label =
      target?.kind === "estimate"
        ? "saved location estimate"
        : target?.kind === "region"
          ? `${target.region} regional reading`
          : "current reading";
    const detail =
      decision.kind === "reading"
        ? `Badge ${decision.rounded} µg/m³, ${label}. Reading at ${new Date(decision.readingAt).toLocaleTimeString("en-SG", { timeZone: "Asia/Singapore" })}.`
        : decision.reason === "test"
          ? debug
            ? "Badge cleared for test. Push stays enabled. Send a test and close AirQ; check that the number reappears before reopening. A zero reading cannot show a numeric badge."
            : "Badge temporarily cleared for testing."
          : active
            ? `Badge cleared: ${decision.reason}.`
            : "Badge is off.";
    const expiry =
      target?.kind === "estimate"
        ? `<p>Saved location expires ${new Date(target.expiresAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}. Use your location again to refresh it.</p>`
        : "";
    return `<section class="badge-controls" aria-labelledby="badge-title">
      <p class="eyebrow">Home Screen app</p><h2 id="badge-title">A reading on your app icon.</h2>
      <details id="badge-help" class="badge-help">
      <summary>Installation and how badges work</summary>
      <p>On iPhone, use Share → Add to Home Screen, then open AirQ from that icon. The badge is rounded PM2.5 in µg/m³, not a notification count. Zero clears it.</p>
      <p>Foreground-only updates when this app is open. The badge is the last received reading, not live tracking.</p>
      ${debug ? "<p>Background testing saves location-derived weights on this device for up to 24 hours, never coordinates. Every received push shows a visible notification.</p>" : ""}
      ${debug ? "<p>You can send a test after opting in.</p>" : ""}
      </details>
      <p>Automatic background updates are not enabled yet.</p>
      <div class="badge-actions">
        <button id="badge-foreground" type="button" ${!supported || !registration || !current || busy ? "disabled" : ""}>${state.mode === "foreground" ? "Foreground badge enabled" : "Enable foreground-only badge"}</button>
        ${debug ? `<button id="badge-background" type="button" ${!supported || !registration || !configured || !current || busy || state.mode === "background" ? "disabled" : ""}>Enable background test and notifications</button>` : ""}
        ${active || message ? `<button id="badge-disable" type="button" ${busy ? "disabled" : ""}>Disable badge and notifications</button>` : ""}
        ${debug && state.mode === "background" ? `<button id="badge-test" type="button" ${busy ? "disabled" : ""}>Send test notification</button>` : ""}
        ${debug && state.mode === "background" ? `<button id="badge-clear-test" type="button" ${busy ? "disabled" : ""}>Clear badge for test</button>` : ""}
      </div>
      <p role="status" id="badge-status">${busy ? "Updating badge settings…" : escapeText(detail)} ${escapeText(message)}</p>${expiry}
      ${debug && state.mode === "background" ? `<p role="status" id="badge-test-status">${escapeText(testMessage)}</p>` : ""}
      ${!supported ? "<p>This browser does not expose app badges. Install the app on a supported device to use them.</p>" : ""}
      ${debug && supported && !configured ? "<p>Background test delivery is not configured on this host.</p>" : ""}
    </section>`;
  }

  function bind(): void {
    document.querySelector("#badge-clear-test")?.addEventListener("click", () =>
      run(async () => {
        await command({ kind: "clear-for-test" });
      }),
    );
    document.querySelector("#badge-foreground")?.addEventListener("click", () => enable(false));
    document.querySelector("#badge-background")?.addEventListener("click", () => enable(true));
    document.querySelector("#badge-disable")?.addEventListener("click", () =>
      run(async () => {
        await command({ kind: "disable" });
        await stopPush();
        message = "Badge cleared and push enrollment removed.";
      }),
    );
    document.querySelector("#badge-test")?.addEventListener("click", () =>
      run(async () => {
        statusGeneration++;
        clearTimeout(statusTimer);
        await api("/test", "POST");
        testMessage = testStatusMessage({ status: "pending" });
        await refreshTestStatus();
      }),
    );
  }

  return {
    start,
    html,
    bind,
    sync,
    savedRegion: () =>
      state.mode === "background" && state.target?.kind === "region" ? state.target.region : null,
  };
}

function escapeText(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}
