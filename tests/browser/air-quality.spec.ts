import { expect, test } from "@playwright/test";

const pm25Response = {
  code: 0,
  data: {
    regionMetadata: [
      { name: "north", labelLocation: { latitude: 1.41803, longitude: 103.82 } },
      { name: "south", labelLocation: { latitude: 1.29587, longitude: 103.82 } },
      { name: "east", labelLocation: { latitude: 1.35735, longitude: 103.94 } },
      { name: "west", labelLocation: { latitude: 1.35735, longitude: 103.7 } },
      { name: "central", labelLocation: { latitude: 1.35735, longitude: 103.82 } },
    ],
    items: [
      {
        timestamp: new Date().toISOString(),
        updatedTimestamp: new Date().toISOString(),
        readings: { pm25_one_hourly: { north: 10, south: 20, east: 30, west: 40, central: 50 } },
      },
    ],
  },
};

const psiResponse = {
  code: 0,
  data: {
    items: [
      {
        timestamp: new Date().toISOString(),
        updatedTimestamp: new Date().toISOString(),
        readings: {
          psi_twenty_four_hourly: { north: 40, south: 50, east: 60, west: 70, central: 80 },
        },
      },
    ],
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ json: pm25Response }),
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) =>
    route.fulfill({ json: psiResponse }),
  );
});

test("shows exact regional readings and a location estimate", async ({
  context,
  page,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.35735, longitude: 103.94 });
  await page.goto("/");

  await expect(page.getByText("Central region PM2.5")).toBeVisible();
  await expect(page.getByText("Central region PSI")).toBeVisible();
  await expect(
    page.locator(".reading-card").filter({ hasText: "Central region PM2.5" }),
  ).toContainText("50");

  await page.getByRole("combobox", { name: "Choose an official region" }).selectOption("west");
  await expect(page.getByText("West region PM2.5")).toBeVisible();
  await expect(
    page.locator(".reading-card").filter({ hasText: "West region PM2.5" }),
  ).toContainText("40");
  await expect(page.locator(".reading-card").filter({ hasText: "West region PSI" })).toContainText(
    "70",
  );

  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toBeVisible();
  await expect(page.locator(".reading-card").filter({ hasText: "Estimated PM2.5" })).toContainText(
    "30",
  );
  await expect(page.getByText("East region PSI")).toBeVisible();
  await expect(
    page.getByText("Location found. Showing an approximate PM2.5 estimate."),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/airq-home-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("keeps manual readings available when location permission is denied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback | undefined,
        ): void => {
          error?.({
            code: 1,
            message: "User denied geolocation",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Central region PM2.5")).toBeVisible();

  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByRole("alert")).toContainText("Location permission was denied");
  await expect(page.getByRole("combobox", { name: "Choose an official region" })).toBeEnabled();
});

test("keeps PSI available when the PM2.5 endpoint fails", async ({ page }) => {
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");

  await expect(page.getByText("Reading unavailable")).toBeVisible();
  await expect(page.getByText("Central region PSI")).toBeVisible();
  await expect(
    page.locator(".reading-card").filter({ hasText: "Central region PSI" }),
  ).toContainText("80");
});
