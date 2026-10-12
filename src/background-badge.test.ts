import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackgroundBadge } from "./background-badge";

const channels: MockChannel[] = [];
class MockChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  port2 = { close: vi.fn() };
  constructor() {
    channels.push(this);
  }
}
const postMessage = vi.fn();
const registration = { active: { postMessage }, unregister: vi.fn() };
const badges: ReturnType<typeof createBackgroundBadge>[] = [];

function setup() {
  const onChange = vi.fn();
  const badge = createBackgroundBadge(onChange);
  badges.push(badge);
  return { badge, onChange };
}

beforeEach(() => {
  vi.useFakeTimers();
  channels.length = 0;
  postMessage.mockReset();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("MessageChannel", MockChannel);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
  });
});

afterEach(() => {
  for (const badge of badges.splice(0)) badge.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("background badge lifecycle", () => {
  it("closes message ports, clears response timeouts, and stops notifying on dispose", async () => {
    const { badge, onChange } = setup();
    const starting = badge.start();
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    expect(vi.getTimerCount()).toBe(1);
    badge.dispose();
    await starting;
    expect(vi.getTimerCount()).toBe(0);
    expect(channels[0]?.port1.close).toHaveBeenCalledOnce();
    expect(channels[0]?.port2.close).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(registration.unregister).not.toHaveBeenCalled();
  });

  it("stops test polling and global focus/visibility listeners without revoking enrollment", async () => {
    window.history.replaceState(null, "", "/?debug");
    localStorage.setItem(
      "airq:push-enrollment:v1",
      JSON.stringify({ id: "saved", token: "secret" }),
    );
    postMessage.mockImplementation(() =>
      channels.at(-1)?.port1.onmessage?.({
        data: {
          state: { mode: "background", target: null, snapshot: null },
        },
      }),
    );
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      Response.json(
        String(input).endsWith("config")
          ? { enabled: true, publicKey: "test", testOnly: true }
          : { status: "pending" },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const { badge, onChange } = setup();
    await badge.start();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    badge.dispose();
    expect(vi.getTimerCount()).toBe(0);
    const renders = onChange.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledTimes(renders);
    expect(localStorage.getItem("airq:push-enrollment:v1")).not.toBeNull();
    expect(registration.unregister).not.toHaveBeenCalled();
  });

  it("does not continue notification opt-in after its component is disposed", async () => {
    let grant!: (permission: NotificationPermission) => void;
    const requestPermission = vi.fn(
      () =>
        new Promise<NotificationPermission>((resolve) => {
          grant = resolve;
        }),
    );
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const { badge, onChange } = setup();
    const root = document.createElement("div");
    root.innerHTML = '<button id="badge-foreground">Enable</button>';
    const binding = new AbortController();
    badge.bind(root, binding.signal);
    root.querySelector("button")?.click();
    expect(requestPermission).toHaveBeenCalledOnce();
    badge.dispose();
    const renders = onChange.mock.calls.length;
    grant("granted");
    await Promise.resolve();
    await Promise.resolve();
    root.querySelector("button")?.click();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(renders);
    expect(localStorage.getItem("airq:push-enrollment:v1")).toBeNull();
  });

  it("abandons service-worker readiness and never sends commands when the UI disconnects", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => registration),
        ready: new Promise(() => {}),
      },
    });
    const { badge, onChange } = setup();
    const starting = badge.start();
    await Promise.resolve();
    badge.dispose();
    await starting;
    expect(postMessage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
