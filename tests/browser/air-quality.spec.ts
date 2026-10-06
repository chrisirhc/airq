import { expect, test } from "@playwright/test";

import { pm25Response, psiResponse } from "./fixtures";

// Playwright request interception cannot reliably route service-worker-controlled pages.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/location", (route) =>
    route.fulfill({ status: 503, json: { error: "Location name unavailable" } }),
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({ json: pm25Response }),
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) =>
    route.fulfill({ json: psiResponse }),
  );
});

test("shows a nearby OneMap name without interpreting it as HTML", async ({ context, page }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.3254295, longitude: 103.9005321 });
  let coordinates: unknown;
  await page.route("**/api/location", async (route) => {
    coordinates = route.request().postDataJSON();
    expect(route.request().method()).toBe("POST");
    await route.fulfill({ json: { label: "351 UBI AVENUE 1 <img src=x>" } });
  });
  await page.goto("/");
  await expect(page.getByText("Your location: near 351 UBI AVENUE 1 <img src=x>.")).toBeVisible();
  await expect(page.getByRole("link", { name: "OneMap, Singapore Land Authority" })).toBeVisible();
  await expect(page.locator(".control-message img")).toHaveCount(0);
  expect(coordinates).toEqual({ latitude: 1.3254295, longitude: 103.9005321 });
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toBeVisible();
});

test("keeps the estimate when OneMap has no name", async ({ context, page }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.3254295, longitude: 103.9005321 });
  await page.route("**/api/location", (route) => route.fulfill({ json: { label: null } }));
  await page.goto("/");
  await expect(page.getByText("Your location", { exact: true })).toBeVisible();
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toBeVisible();
});

test("ignores a late location name after selecting a region", async ({ context, page }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.3254295, longitude: 103.9005321 });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/location", async (route) => {
    await gate;
    await route.fulfill({ json: { label: "KAMPONG UBI VIEW" } });
  });
  const lookup = page.waitForRequest("**/api/location");
  await page.goto("/");
  await lookup;
  await page.getByRole("combobox").selectOption("west");
  const response = page.waitForResponse("**/api/location");
  release?.();
  await response;
  await expect(page.getByText("West region PM2.5")).toBeVisible();
  await expect(page.getByText(/KAMPONG UBI VIEW/)).toHaveCount(0);
  await expect(page.getByText("Your location", { exact: true })).toHaveCount(0);
});

test("shows exact regional readings and a location estimate", async ({
  context,
  page,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.35735, longitude: 103.94 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", { configurable: true, value: undefined });
  });
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
  await expect(page.getByRole("button", { name: "Using your location" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const calculation = page.getByRole("region", { name: "Estimate calculation" });
  await expect(calculation).toBeVisible();
  await expect(calculation.getByRole("row")).toHaveCount(6);
  await expect(calculation.getByRole("row", { name: "East 30 0.00 100.00%" })).toBeVisible();
  await expect(calculation).toContainText("within 1 metre of the East reference point");
  await expect(calculation).toContainText("30 × 100.00%");
  await expect(calculation).toContainText("≈ 30.00 µg/m³");
  await expect(
    page.getByText("Location found. Showing an approximate PM2.5 estimate."),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/airq-home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("combobox").selectOption("central");
  await expect(page.getByRole("button", { name: "Use my location" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByText("Central region PM2.5")).toBeVisible();
});

test("refreshes an active estimate when regional values change", async ({ context, page }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.35735, longitude: 103.94 });
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/psi", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Using your location" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Estimate calculation" })).toContainText(
    "≈ 30.00 µg/m³",
  );
  await page.route("https://api-open.data.gov.sg/v2/real-time/api/pm25", (route) =>
    route.fulfill({
      json: {
        ...pm25Response,
        data: {
          ...pm25Response.data,
          items: pm25Response.data.items.map((item) => ({
            ...item,
            readings: { pm25_one_hourly: { ...item.readings.pm25_one_hourly, east: 35 } },
          })),
        },
      },
    }),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("region", { name: "Estimate calculation" })).toContainText(
    "≈ 35.00 µg/m³",
  );
});

test("explains the weighted estimate using all five regional readings", async ({
  context,
  page,
}, testInfo) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.32, longitude: 103.88 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Using your location" })).toBeVisible();
  const calculation = page.getByRole("region", { name: "Estimate calculation" });
  await expect(calculation).toContainText("Each weight is (1 ÷ distance²)");
  await expect(calculation).toContainText("≈ 30.53 µg/m³");
  await expect(calculation.getByRole("row")).toHaveCount(6);
  for (const region of ["North", "South", "East", "West", "Central"]) {
    await expect(calculation.getByRole("rowheader", { name: region, exact: true })).toBeVisible();
  }
  await page.screenshot({
    path: `test-results/airq-calculation-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

for (const permission of ["prompt", "denied", "unsupported"]) {
  test(`does not automatically request location when permission is ${permission}`, async ({
    page,
  }) => {
    await page.addInitScript((permission) => {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: async () => {
            document.documentElement.dataset.permissionChecked = "true";
            if (permission === "unsupported") throw new TypeError("Unsupported permission");
            return { state: permission };
          },
        },
      });
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: () => {
            document.documentElement.dataset.locationRequested = "true";
          },
        },
      });
    }, permission);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-permission-checked", "true");
    await expect(page.getByRole("button", { name: "Use my location" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator("html")).not.toHaveAttribute("data-location-requested", "true");
    await expect(page.getByText("Central region PM2.5")).toBeVisible();
  });
}

for (const permission of ["prompt", "unsupported"]) {
  test(`restores location after refresh when Safari permission is ${permission}`, async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 1.32, longitude: 103.88 });
    await page.addInitScript((permission) => {
      Object.defineProperty(navigator, "permissions", {
        configurable: true,
        value: {
          query: async () => {
            if (permission === "unsupported") throw new TypeError("Unsupported permission");
            return { state: permission };
          },
        },
      });
    }, permission);
    await page.goto("/");
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByRole("button", { name: "Using your location" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Using your location" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("region", { name: "Estimate calculation" })).toContainText(
      "≈ 30.53 µg/m³",
    );
  });
}

test("keeps location off after choosing a manual region and refreshing", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 1.32, longitude: 103.88 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Using your location" })).toBeVisible();
  await page.getByRole("combobox").selectOption("west");
  await page.reload();
  await expect(page.getByRole("button", { name: "Use my location" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByText("Estimated PM2.5", { exact: true })).toHaveCount(0);
});

test("stops restoring location after the browser denies a remembered request", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "prompt" }) },
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback | undefined,
        ) => {
          document.documentElement.dataset.locationRequested = "true";
          error?.({
            code: 1,
            message: "Denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Use my location" })).toBeEnabled();
  await page.evaluate(() => localStorage.setItem("airq:location-mode", "enabled"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Location permission was denied");
  await page.reload();
  await expect(page.getByRole("button", { name: "Use my location" })).toBeEnabled();
  await expect(page.locator("html")).not.toHaveAttribute("data-location-requested", "true");
});

test("shows location progress and respects a manual selection during lookup", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["geolocation"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (success: PositionCallback) => {
          window.addEventListener(
            "test-location-ready",
            () =>
              success({
                coords: {
                  latitude: 1.32,
                  longitude: 103.88,
                  accuracy: 10,
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null,
                  toJSON: () => ({}),
                },
                timestamp: Date.now(),
                toJSON: () => ({}),
              }),
            { once: true },
          );
        },
      },
    });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Finding your location…" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(
    page.getByRole("region", { name: "Location and region controls" }).getByRole("status"),
  ).toContainText("Finding your location");
  await page.getByRole("combobox").selectOption("west");
  await page.evaluate(() => window.dispatchEvent(new Event("test-location-ready")));
  await expect(page.getByText("West region PM2.5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use my location" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
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
