import { expect, test } from "@playwright/test";
import { pm25Response, psiResponse } from "./fixtures";

test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ json: pm25Response }),
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) =>
    route.fulfill({ json: psiResponse }),
  );
  await page.route("**/api/location", (route) => route.fulfill({ json: { label: null } }));
});

test("mounts native custom elements and keeps focused controls across state updates", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Central region PM2.5")).toBeVisible();
  expect(
    await page.evaluate(() => {
      const names = [
        "airq-app",
        "airq-controls",
        "airq-readings",
        "airq-pm25-map",
        "airq-badge",
        "airq-theme",
      ];
      return names.every((name) => {
        const element = document.querySelector(name);
        const definition = customElements.get(name);
        return definition && element instanceof definition && element.shadowRoot === null;
      });
    }),
  ).toBe(true);
  const select = page.getByRole("combobox", { name: "Choose an official region" });
  await select.focus();
  const nodes = await page.evaluateHandle(() => ({
    select: document.querySelector("#region-select"),
    theme: document.querySelector("#theme-button"),
    liveRegion: document.querySelector(".readings"),
  }));
  await select.selectOption("west");
  await expect(page.getByText("West region PM2.5")).toBeVisible();
  await expect(select).toBeFocused();
  expect(
    await nodes.evaluate(
      (before) =>
        before.select === document.querySelector("#region-select") &&
        before.theme === document.querySelector("#theme-button") &&
        before.liveRegion === document.querySelector(".readings"),
    ),
  ).toBe(true);
});

test("late location naming does not reset map inspection, disclosures, or keyboard focus", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.32, longitude: 103.88 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/location", async (route) => {
    await gate;
    await route.fulfill({ json: { label: "KAMPONG UBI" } });
  });
  await page.goto("/");
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toBeVisible();
  await page.locator("#estimate-calculation > summary").click();
  await page.locator("#pm25-map > summary").click();
  const map = page.getByRole("group", { name: "Interactive modelled PM2.5 heatmap" });
  await map.focus();
  await page.keyboard.press("ArrowRight");
  const inspected = await page.locator(".heatmap-point h3").textContent();
  const nodes = await page.evaluateHandle(() => ({
    svg: document.querySelector(".heatmap-chart svg"),
    calculation: document.querySelector("#estimate-calculation"),
  }));
  release();
  await expect(page.getByText("Your location: near KAMPONG UBI.")).toBeVisible();
  await expect(map).toBeFocused();
  await expect(page.locator(".heatmap-point h3")).toHaveText(inspected ?? "");
  await expect(page.locator("#estimate-calculation")).toHaveAttribute("open", "");
  expect(
    await nodes.evaluate(
      (before) =>
        before.svg === document.querySelector(".heatmap-chart svg") &&
        before.calculation === document.querySelector("#estimate-calculation"),
    ),
  ).toBe(true);
});

test("reconnecting the app ignores old geolocation and binds new controls once", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const callbacks: PositionCallback[] = [];
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          callbacks.push(success);
        },
      },
    });
    Object.assign(window, {
      locationCallbacks: callbacks,
      completeLocation: (index: number) =>
        callbacks[index]?.({
          coords: { latitude: 1.35735, longitude: 103.94 },
        } as GeolocationPosition),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByRole("button", { name: "Finding your location…" })).toBeDisabled();
  await page.evaluate(() => {
    const app = document.querySelector("airq-app");
    if (!app) throw new Error("App missing");
    app.remove();
    document.querySelector("main")?.append(app);
  });
  await expect(page.getByText("Central region PM2.5")).toBeVisible();
  await page.evaluate("window.completeLocation(0)");
  await expect(page.getByText("Central region PM2.5")).toBeVisible();
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Use my location" }).click();
  expect(await page.evaluate("window.locationCallbacks.length")).toBe(2);
  await page.evaluate("window.completeLocation(1)");
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toBeVisible();
  await expect(page.locator(".primary-card .reading-value strong")).toHaveText("30");
});
