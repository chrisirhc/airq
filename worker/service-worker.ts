import {
  applyBadgeCommand,
  type BadgeState,
  badgeCommandSchema,
  badgeStateSchema,
  currentDecision,
  expireSavedTarget,
  newestSnapshot,
  notificationPresentation,
  regionalSnapshotSchema,
} from "../src/badge-domain";

declare const self: ServiceWorkerGlobalScope;
let operations = Promise.resolve();

function serialize(operation: () => Promise<void>): Promise<void> {
  const next = operations.then(operation);
  operations = next.catch(() => {});
  return next;
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("airq-badge", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readState(): Promise<BadgeState> {
  const db = await database();
  try {
    const value: unknown = await new Promise((resolve, reject) => {
      const request = db.transaction("settings").objectStore("settings").get("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const parsed = badgeStateSchema.safeParse(value);
    return parsed.success ? expireSavedTarget(parsed.data, Date.now()) : { mode: "disabled" };
  } finally {
    db.close();
  }
}

async function writeState(state: BadgeState): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("settings", "readwrite");
      transaction.objectStore("settings").put(state, "state");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function present(state: BadgeState): Promise<void> {
  const decision = currentDecision(state, Date.now());
  if ("setAppBadge" in self.navigator) {
    try {
      await self.navigator.setAppBadge(decision.kind === "reading" ? decision.rounded : 0);
    } catch {
      /* A badge failure must not suppress the required notification. */
    }
  }
}

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
  const command = badgeCommandSchema.safeParse(event.data);
  if (!command.success) {
    event.ports[0]?.postMessage({ error: "Invalid badge command" });
    return;
  }
  event.waitUntil(
    serialize(async () => {
      try {
        const state = applyBadgeCommand(await readState(), command.data);
        await writeState(state);
        if (command.data.kind !== "status" || state.mode !== "disabled") await present(state);
        event.ports[0]?.postMessage({ state, decision: currentDecision(state, Date.now()) });
      } catch {
        event.ports[0]?.postMessage({ error: "Badge storage is unavailable" });
      }
    }),
  );
});
self.addEventListener("push", (event) => {
  event.waitUntil(
    serialize(async () => {
      let state: BadgeState = { mode: "disabled" };
      try {
        state = await readState();
        let raw: unknown = null;
        try {
          raw = event.data ? JSON.parse(event.data.text()) : null;
        } catch {
          /* Malformed pushes still display the current status. */
        }
        const parsed = regionalSnapshotSchema.safeParse(raw);
        if (parsed.success && state.mode === "background") {
          state = { ...state, snapshot: newestSnapshot(state.snapshot, parsed.data) };
        }
        await writeState(state);
        await present(state);
      } catch {
        await present({ mode: "disabled" });
        state = { mode: "disabled" };
      }
      const notification = notificationPresentation(state, Date.now());
      await self.registration.showNotification(notification.title, {
        body: notification.body,
        tag: "airq-reading",
        icon: "./icons/icon-192.png",
      });
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) await existing.focus();
      else await self.clients.openWindow(self.registration.scope);
    })(),
  );
});
