import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pm25Response, psiResponse } from "../tests/browser/fixtures";
import { createAirQualityClient } from "./air-quality-client";
import { App } from "./app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let root: Root;
const fetcher = vi.fn<typeof fetch>(async (input) =>
  Response.json(String(input).endsWith("/pm25") ? pm25Response : psiResponse),
);
let client: ReturnType<typeof createAirQualityClient>;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  fetcher.mockClear();
  client = createAirQualityClient({ fetcher, storage: localStorage });
  delete document.documentElement.dataset.theme;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("React app reconciliation", () => {
  it("loads under Strict Mode replay and keeps region focus and guidance state", async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <App client={client} />
        </StrictMode>,
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Central region PM2.5");
    const disclosure = container.querySelector<HTMLDetailsElement>("#reading-guidance");
    const select = container.querySelector<HTMLSelectElement>("#region-select");
    if (!disclosure || !select) throw new Error("Missing controls");
    await act(async () => {
      disclosure.open = true;
      disclosure.dispatchEvent(new Event("toggle"));
    });
    await act(async () => {
      select.focus();
      select.value = "west";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("West region PM2.5");
    expect(container.querySelector("#region-select")).toBe(select);
    expect(document.activeElement).toBe(select);
    expect(container.querySelector("#reading-guidance")).toBe(disclosure);
    expect(disclosure.open).toBe(true);
  });

  it("keeps the same theme button and click handler after a data-driven render", async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <App client={client} />
        </StrictMode>,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>("#theme-button");
    const select = container.querySelector<HTMLSelectElement>("#region-select");
    if (!button || !select) throw new Error("Missing controls");
    await act(async () => button.click());
    expect(button.textContent).toBe("Theme: Light");
    await act(async () => {
      select.value = "east";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector("#theme-button")).toBe(button);
    await act(async () => button.click());
    expect(button.textContent).toBe("Theme: Dark");
    expect(localStorage.getItem("airq:theme")).toBe("dark");
  });
});
