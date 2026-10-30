import { expect, test } from "@playwright/test";
import { pm25Response, psiResponse } from "./fixtures";

test.use({ serviceWorkers: "block", colorScheme: "light" });
test.beforeEach(async ({ context }) => {
  await context.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ json: pm25Response }),
  );
  await context.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) =>
    route.fulfill({ json: psiResponse }),
  );
  await context.route("**/api/location", (route) => route.fulfill({ json: { label: null } }));
});

test("reconciles region controls without losing keyboard focus or disclosure nodes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Central region PM2.5")).toBeVisible();
  await page.locator("#reading-guidance > summary").click();
  const disclosure = await page.locator("#reading-guidance").elementHandle();
  const select = page.getByRole("combobox", { name: "Choose an official region" });
  await select.focus();
  await select.selectOption("west");
  await expect(page.getByText("West region PM2.5")).toBeVisible();
  await expect(select).toBeFocused();
  expect(await disclosure?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(page.locator("#reading-guidance")).toHaveAttribute("open", "");
});

test("retains map inspection and focus when a late OneMap name updates React", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.32, longitude: 103.88 });
  // This tests reconciliation, not network timeouts. A controlled fetch avoids the
  // real three-second OneMap timeout while slower engines initialize the SVG.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input) !== "/api/location") return nativeFetch(input, init);
      document.documentElement.dataset.locationLookup = "true";
      return new Promise<Response>((resolve) => {
        window.addEventListener(
          "test-location-name-ready",
          () => resolve(Response.json({ label: "UBI <img src=x>" })),
          { once: true },
        );
      });
    };
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-location-lookup", "true");
  await page.locator("#pm25-map > summary").click();
  const map = page.getByRole("group", { name: "Interactive modelled PM2.5 heatmap" });
  await map.focus();
  await page.keyboard.press("ArrowRight");
  const heading = page.locator(".heatmap-point h3");
  await expect(heading).toContainText("Inspected estimate:");
  const value = await heading.textContent();
  const element = await map.elementHandle();
  const cell = await page.locator(".heatmap-cell").first().elementHandle();
  await page.evaluate(() => window.dispatchEvent(new Event("test-location-name-ready")));
  await expect(page.getByText("Your location: near UBI <img src=x>.")).toBeVisible();
  await expect(page.locator(".control-message img")).toHaveCount(0);
  await expect(heading).toHaveText(value ?? "");
  await expect(map).toBeFocused();
  expect(await element?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await cell?.evaluate((node) => node.isConnected)).toBe(true);
  await page.locator("#pm25-map > summary").click();
  await expect(map).toBeHidden();
  expect(await element?.evaluate((node) => node.isConnected)).toBe(true);
  await page.locator("#pm25-map > summary").click();
  await expect(map).toBeVisible();
  await expect(heading).toHaveText(value ?? "");
});

test("synchronizes appearance overrides and storage clearing from another tab", async ({
  context,
  page,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(() => localStorage.setItem("airq:theme", "dark"));
  await expect(page.locator("#theme-button")).toHaveText("Theme: Dark");
  await expect(page.locator(".primary-card")).toHaveCSS("background-color", "rgb(34, 34, 34)");
  await other.evaluate(() => localStorage.clear());
  await expect(page.locator("#theme-button")).toHaveText("Theme: System");
  await expect(page.locator(".primary-card")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("suspends readings while keeping the shell interactive and sharing Strict Mode requests", async ({
  page,
}) => {
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/*", async (route) => {
    requests++;
    await ready;
    await route.fulfill({
      json: route.request().url().endsWith("/pm25") ? pm25Response : psiResponse,
    });
  });
  await page.goto("/");
  await expect(page.getByText("Loading official data")).toBeVisible();
  const theme = page.locator("#theme-button");
  const themeNode = await theme.elementHandle();
  await theme.click();
  await expect(theme).toHaveText("Theme: Light");
  await page.locator("#reading-guidance > summary").click();
  release();
  await expect(page.getByText("Central region PM2.5")).toBeVisible();
  await expect(page.locator("#reading-guidance")).toHaveAttribute("open", "");
  expect(await themeNode?.evaluate((node) => node.isConnected)).toBe(true);
  expect(requests).toBe(2);
});

test("keeps committed readings, controls, and map inspection during an async refresh", async ({
  page,
}) => {
  let recover = false;
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refreshed = structuredClone(pm25Response);
  for (const item of refreshed.data.items) item.readings.pm25_one_hourly.east = 99;
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/*", async (route) => {
    if (!recover) {
      if (route.request().url().endsWith("/psi")) return route.abort();
      return route.fulfill({ json: pm25Response });
    }
    await ready;
    await route.fulfill({
      json: route.request().url().endsWith("/pm25") ? refreshed : psiResponse,
    });
  });
  await page.goto("/");
  await expect(page.getByText("Reading unavailable")).toBeVisible();
  const select = page.locator("#region-select");
  await select.selectOption("west");
  await page.locator("#pm25-map > summary").click();
  const map = page.getByRole("group", { name: "Interactive modelled PM2.5 heatmap" });
  await map.focus();
  await page.keyboard.press("ArrowRight");
  const mapNode = await map.elementHandle();
  const selectNode = await select.elementHandle();
  const inspected = await page.locator(".heatmap-point h3").textContent();
  const value = await page.locator(".primary-card .reading-value strong").textContent();
  recover = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Refreshing readings…" })).toBeVisible();
  await expect(page.locator(".primary-card .reading-value strong")).toHaveText(value ?? "");
  await expect(page.locator(".heatmap-point h3")).toHaveText(inspected ?? "");
  await select.selectOption("east");
  await select.focus();
  release();
  await expect(page.locator(".primary-card .reading-value strong")).toHaveText("99");
  await expect(page.getByText("East region PSI")).toBeVisible();
  await expect(select).toBeFocused();
  await expect(select).toHaveValue("east");
  expect(await selectNode?.evaluate((node) => node.isConnected)).toBe(true);
  expect(await mapNode?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.getByText("Refreshing readings…")).toHaveCount(0);
});
