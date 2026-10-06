import { expect, test } from "@playwright/test";
import { pm25Response, psiResponse } from "./fixtures";

test("reports rejected test delivery instead of leaving it requested", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Requires module service-worker persistence");
  await page.addInitScript(
    ({ pm25Response, psiResponse }) => {
      const nativeFetch = window.fetch.bind(window);
      let requested = sessionStorage.getItem("mock-test-requested") === "true";
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/api/pm25")) return Promise.resolve(Response.json(pm25Response));
        if (url.endsWith("/api/psi")) return Promise.resolve(Response.json(psiResponse));
        if (url === "/api/badge/config")
          return Promise.resolve(
            Response.json({ enabled: true, publicKey: "test", testOnly: true }),
          );
        if (url.endsWith("/test")) {
          if (init?.method === "GET") document.documentElement.dataset.testStatusFetched = "true";
          if (init?.method === "POST") {
            requested = true;
            sessionStorage.setItem("mock-test-requested", "true");
            return Promise.resolve(
              Response.json({ status: "pending", delaySeconds: 10 }, { status: 202 }),
            );
          }
          return Promise.resolve(
            Response.json(
              requested
                ? { status: "failed", error: "push-rejected", httpStatus: 403 }
                : { status: "none" },
            ),
          );
        }
        return nativeFetch(input, init);
      };
    },
    { pm25Response, psiResponse },
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("Missing badge worker");
  await worker.evaluate(
    "self.badges = []; Object.defineProperty(self.navigator, 'setAppBadge', { value: async (n) => self.badges.push(n) });",
  );
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const now = Date.now();
    const channel = new MessageChannel();
    await new Promise((resolve) => {
      channel.port1.onmessage = resolve;
      registration.active?.postMessage(
        {
          kind: "target",
          target: { kind: "region", region: "east" },
          snapshot: {
            revision: 1,
            readingAt: now,
            updatedAt: now,
            validUntil: now + 60_000,
            referenceFingerprint: "test",
            estimatorVersion: 1,
            values: { north: 10, south: 20, east: 30, west: 40, central: 50 },
          },
        },
        [channel.port2],
      );
    });
    localStorage.setItem(
      "airq:push-enrollment:v1",
      JSON.stringify({ id: "a".repeat(64), token: "A".repeat(43) }),
    );
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Clear badge for test" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send test notification" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Enable background test and notifications" }),
  ).toHaveCount(0);
  await expect(page.locator("#badge-test-status")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-test-status-fetched", "true");
  await expect(page.getByRole("button", { name: "Disable badge and notifications" })).toBeVisible();
  await page.goto("/?debug");
  await page.getByRole("button", { name: "Clear badge for test" }).click();
  await expect(page.locator("#badge-status")).toContainText(
    "Badge cleared for test. Push stays enabled.",
  );
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(0);
  await page.reload();
  await expect(page.locator("#badge-status")).toContainText(
    "Badge cleared for test. Push stays enabled.",
  );
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("airq:push-enrollment:v1") ?? "null"),
    ),
  ).toEqual({ id: "a".repeat(64), token: "A".repeat(43) });
  await page.getByRole("button", { name: "Send test notification" }).click();
  await expect(page.locator("#badge-test-status")).toContainText(
    "Push service rejected the test (HTTP 403)",
  );
  await page.reload();
  await expect(page.locator("#badge-test-status")).toContainText(
    "Push service rejected the test (HTTP 403)",
  );
  await expect(page.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/chrisirhc/airq",
  );
});

test("foreground-only opt-in updates the rounded badge and removes it on disable", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Native presentation is intercepted through Chromium's worker handle",
  );
  await context.grantPermissions(["notifications"]);
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ json: pm25Response }),
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) =>
    route.fulfill({ json: psiResponse }),
  );
  await page.route("**/api/badge/config", (route) =>
    route.fulfill({ json: { enabled: false, publicKey: "", testOnly: true } }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("Missing badge worker");
  await worker.evaluate(
    `self.badges = []; Object.defineProperty(self.navigator, 'setAppBadge', { value: async (n) => self.badges.push(n) });`,
  );
  await page.getByRole("button", { name: "Enable foreground-only badge" }).click();
  await expect(page.locator("#badge-status")).toContainText("Badge 50 µg/m³");
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(50);
  await page.getByRole("combobox").selectOption("west");
  await expect(page.locator("#badge-status")).toContainText("Badge 40 µg/m³");
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(40);
  expect(await page.evaluate(() => localStorage.getItem("airq:push-enrollment:v1"))).toBeNull();
  await page.getByRole("button", { name: "Disable badge and notifications" }).click();
  await expect(page.locator("#badge-status")).toContainText(
    "Badge cleared and push enrollment removed",
  );
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(0);
});

test("requests notification permission only from opt-in and handles denial", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "This browser exposes the badge API in the test context",
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ json: pm25Response }),
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) =>
    route.fulfill({ json: psiResponse }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "requestPermission", {
      value: async () => {
        document.documentElement.dataset.notificationGesture = String(
          navigator.userActivation.isActive,
        );
        return "denied";
      },
    });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Enable foreground-only badge" });
  await expect(button).toBeEnabled();
  await expect(page.locator("html")).not.toHaveAttribute("data-notification-gesture", "true");
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-notification-gesture", "true");
  await expect(page.locator("#badge-status")).toContainText("Notifications permission is required");
  await expect(page.locator("#badge-status")).toContainText("Badge is off");
});

test("restores location after refresh with a real service worker active", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "firefox",
    "This Firefox build does not support module service workers",
  );
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.32, longitude: 103.88 });
  await page.addInitScript(
    ({ pm25Response, psiResponse }) => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url === "https://api-open.data.gov.sg/v2/real-time/api/pm25")
          return Promise.resolve(new Response(JSON.stringify(pm25Response)));
        if (url === "https://api-open.data.gov.sg/v2/real-time/api/psi")
          return Promise.resolve(new Response(JSON.stringify(psiResponse)));
        return nativeFetch(input, init);
      };
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "prompt" }) },
      });
    },
    { pm25Response, psiResponse },
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole("button", { name: "Use my location" }).click();
  await page.locator("#estimate-calculation > summary").click();
  await expect(page.getByRole("region", { name: "Estimate calculation" })).toContainText(
    "≈ 30.53 µg/m³",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Using your location" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#estimate-calculation")).not.toHaveAttribute("open", "");
  await page.locator("#estimate-calculation > summary").click();
  await expect(page.getByRole("region", { name: "Estimate calculation" })).toContainText(
    "≈ 30.53 µg/m³",
  );
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
});

test("publishes an installable manifest and correctly sized Home Screen icons", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "./manifest.webmanifest",
  );
  const response = await request.get("/manifest.webmanifest");
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.id).toBe("./");
  for (const [name, size] of [
    ["icon-192", 192],
    ["icon-512", 512],
    ["apple-touch-icon", 180],
  ]) {
    expect(
      await page.evaluate(
        async ({ name }) => {
          const image = new Image();
          image.src = `/icons/${name}.png`;
          await image.decode();
          return [image.naturalWidth, image.naturalHeight];
        },
        { name },
      ),
    ).toEqual([size, size]);
  }
  await expect(page.getByText("Automatic background updates are not enabled yet.")).toBeVisible();
});

test("uses the real service worker for target persistence, ordering, and opt-out", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Service-worker evaluation is supported by Playwright Chromium",
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("The badge worker was not registered");
  const send = (command: unknown) =>
    page.evaluate(async (command) => {
      const registration = await navigator.serviceWorker.ready;
      const channel = new MessageChannel();
      return await new Promise((resolve) => {
        channel.port1.onmessage = (event) => {
          channel.port1.close();
          resolve(event.data);
        };
        registration.active?.postMessage(command, [channel.port2]);
      });
    }, command);
  await worker.evaluate(`self.badges = []; self.notifications = [];
    Object.defineProperty(self.navigator, 'setAppBadge', { configurable: true, value: async (n) => self.badges.push(n) });
    self.registration.showNotification = async (title, options) => self.notifications.push({title, ...options});`);
  const now = Date.now();
  const snapshot = {
    revision: 2,
    readingAt: now,
    updatedAt: now,
    validUntil: now + 60_000,
    referenceFingerprint: "test",
    estimatorVersion: 1,
    values: { north: 10, south: 20, east: 30, west: 40, central: 50 },
  };
  await send({ kind: "target", target: { kind: "region", region: "east" }, snapshot });
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(30);
  await send({ kind: "clear-for-test" });
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(0);
  await send({ kind: "status" });
  await send({ kind: "snapshot", snapshot });
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(0);
  const push = (data: unknown) =>
    worker.evaluate(`new Promise((resolve, reject) => {
    const event = new PushEvent('push', {data: ${JSON.stringify(JSON.stringify(data))}});
    Object.defineProperty(event, 'waitUntil', { value: (promise) => promise.then(resolve, reject) });
    self.dispatchEvent(event);
  })`);
  await push(snapshot);
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(30);
  await push({ ...snapshot, revision: 1, values: { ...snapshot.values, east: 99 } });
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(30);
  expect(await worker.evaluate("self.notifications.at(-1).title")).toBe("PM2.5 30 µg/m³");
  await push({ ...snapshot, revision: 3, values: { ...snapshot.values, east: 35 } });
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(35);
  await send({ kind: "target", target: { kind: "region", region: "west" }, snapshot });
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(40);
  await send({ kind: "disable" });
  await push(snapshot);
  expect(await worker.evaluate("self.badges.at(-1)")).toBe(0);
  expect(await worker.evaluate("self.notifications.at(-1).body")).toContain(
    "No current background estimate",
  );
  expect(await worker.evaluate("self.notifications.length")).toBe(4);
  await page.reload();
  expect(await send({ kind: "status" })).toMatchObject({ state: { mode: "disabled" } });
});
