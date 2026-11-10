import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForNativePlugin } from "./native-ad-bridge-ready";

describe("Wave Notes-style native AdMob bridge readiness", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("accepts an already registered native plugin without delay", async () => {
    const ready = vi.fn(() => true);
    await expect(waitForNativePlugin(ready)).resolves.toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a bridge injected after initial React rendering", async () => {
    let nativePluginReady = false;
    const ready = vi.fn(() => nativePluginReady);
    const pending = waitForNativePlugin(ready, 1_000, 100);
    await vi.advanceTimersByTimeAsync(250);
    nativePluginReady = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out without infinite polling if native plugin is missing", async () => {
    const pending = waitForNativePlugin(() => false, 300, 50);
    await vi.advanceTimersByTimeAsync(350);
    await expect(pending).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not get stuck when a bridge probe initially throws", async () => {
    const probe = vi.fn().mockImplementationOnce(() => {
      throw new Error("Capacitor not injected");
    }).mockReturnValue(true);
    await expect(waitForNativePlugin(probe, 500, 50)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports cancellation when the startup is abandoned", async () => {
    const controller = new AbortController();
    const pending = waitForNativePlugin(() => false, 1_000, 100, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
