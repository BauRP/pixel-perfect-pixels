import { afterEach, describe, expect, it, vi } from "vitest";

const fakeNative = vi.hoisted(() => ({
  getInsets: vi.fn(),
  listeners: [] as Array<(value: {
    measured?: boolean; top?: number; bottom?: number;
    left?: number; right?: number; keyboardVisible?: boolean;
  }) => void>,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    getInsets: fakeNative.getInsets,
    addListener: (_name: string, cb: (value: {
      measured?: boolean; top?: number; bottom?: number;
      left?: number; right?: number; keyboardVisible?: boolean;
    }) => void) => {
      fakeNative.listeners.push(cb);
      return Promise.resolve({ remove: async () => {} });
    },
    setSystemBarAppearance: () => Promise.resolve(),
    signalUiReady: () => Promise.resolve(),
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("Android system insets during WebView startup", () => {
  it("retries early unmeasured reads, then preserves measured geometry after a later pending response", async () => {
    vi.useFakeTimers();
    const valid = {
      measured: true, top: 28, bottom: 48, left: 0, right: 0,
      keyboardVisible: false,
    };
    fakeNative.getInsets
      .mockResolvedValueOnce({ measured: false })
      .mockResolvedValueOnce({ measured: false })
      .mockResolvedValueOnce(valid)
      .mockResolvedValue({ measured: false });
    const { initSystemInsets } = await import("./system-insets");
    initSystemInsets();
    await vi.advanceTimersByTimeAsync(500);
    expect(fakeNative.getInsets.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(document.documentElement.dataset.novaInsetsReady).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--native-safe-top")).toBe("28px");

    // A stale/unmeasured getInsets response must not cancel the genuine
    // navigation and status bar geometry already delivered by Android.
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.documentElement.dataset.novaInsetsReady).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--native-safe-bottom")).toBe("48px");

    // OS event changes remain authoritative; real rotation/gesture changes
    // still override the previous insets as normal.
    fakeNative.listeners[0]({
      measured: true, top: 25, bottom: 18, left: 0, right: 0,
      keyboardVisible: false,
    });
    expect(document.documentElement.style.getPropertyValue("--native-safe-bottom")).toBe("18px");
    expect(document.documentElement.dataset.novaInsetsReady).toBe("true");
  });
});
