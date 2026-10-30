import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { pm25Response, psiResponse } from "../tests/browser/fixtures";
import { AirQualityProvider, useAirQuality, useBadgeControls } from "./air-quality-context";
import { BadgeControls } from "./badge-controls";
import { DisclosureProvider } from "./disclosures";
import { parsePm25, parsePsi } from "./public-readings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("scoped air-quality subscriptions", () => {
  it("updates badge feedback without rerendering reading consumers, and still publishes region choices", async () => {
    vi.stubGlobal("navigator", {
      permissions: { query: vi.fn().mockResolvedValue({ state: "prompt" }) },
    });
    const readings = {
      pm25: {
        kind: "available",
        source: "live",
        reading: parsePm25(pm25Response, new Date(), 45 * 60 * 1000),
      },
      psi: {
        kind: "available",
        source: "live",
        reading: parsePsi(psiResponse, new Date(), 45 * 60 * 1000),
      },
    } as const;
    let readingRenders = 0;
    function ReadingConsumer() {
      readingRenders++;
      const { state, selectRegion } = useAirQuality();
      return (
        <>
          <output id="region">
            {state.display.kind === "manual" ? state.display.region : "estimated"}
          </output>
          <button type="button" onClick={() => selectRegion("west")}>
            Choose west
          </button>
        </>
      );
    }
    function BadgeAction() {
      const { badge } = useBadgeControls();
      return (
        <button type="button" onClick={badge.disable}>
          Exercise badge action
        </button>
      );
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <AirQualityProvider readings={readings}>
            <DisclosureProvider>
              <ReadingConsumer />
              <BadgeAction />
              <BadgeControls />
            </DisclosureProvider>
          </AirQualityProvider>,
        ),
      );
      expect(container.querySelector("#region")?.textContent).toBe("central");
      const beforeBadgeAction = readingRenders;
      const buttons = container.querySelectorAll("button");
      const badgeButton = Array.from(buttons).find(
        (button) => button.textContent === "Exercise badge action",
      );
      const regionButton = Array.from(buttons).find(
        (button) => button.textContent === "Choose west",
      );
      if (!badgeButton || !regionButton) throw new Error("Missing action controls");
      await act(async () => badgeButton.click());
      expect(container.querySelector("#badge-status")?.textContent).toContain(
        "The badge service worker is not ready.",
      );
      expect(readingRenders).toBe(beforeBadgeAction);
      await act(async () => regionButton.click());
      expect(container.querySelector("#region")?.textContent).toBe("west");
      expect(readingRenders).toBeGreaterThan(beforeBadgeAction);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
});
