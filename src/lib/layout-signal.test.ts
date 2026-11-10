import { describe, expect, it, vi } from "vitest";
import { createLayoutSignalPublisher, type NativeLayoutSignal } from "./layout-signal";

const evidence: NativeLayoutSignal = {
  viewportWidth: 360,
  viewportHeight: 780,
  navBottom: 780,
  navWidth: 360,
  navHeight: 72,
  navInnerBottom: 756,
  navInnerLeft: 0,
  navInnerRight: 360,
  links: 3,
  minLinkWidth: 48,
  minLinkHeight: 48,
  maxLinkBottom: 756,
  minLinkLeft: 0,
  maxLinkRight: 360,
  contentTop: 24,
  safeTop: 24,
  nativeInsetsReady: true,
  imeOpen: false,
  layoutIssue: "OK",
};

describe("Android layout evidence bridge rate limiting", () => {
  it("sends the first reading but coalesces unchanged observer/watchdog readings", () => {
    let now = 1_000;
    const send = vi.fn();
    const publish = createLayoutSignalPublisher(send, 10_000, () => now);
    expect(publish(evidence)).toBe(true);
    for (let i = 0; i < 200; i++) expect(publish({ ...evidence })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    now += 9_999;
    expect(publish(evidence)).toBe(false);
    now++;
    expect(publish(evidence)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("immediately reports changed insets, screen size and failure states", () => {
    const send = vi.fn();
    const publish = createLayoutSignalPublisher(send, 10_000, () => 100);
    expect(publish(evidence)).toBe(true);
    expect(publish({ ...evidence, navHeight: 73 })).toBe(true);
    expect(publish({ ...evidence, viewportWidth: 320 })).toBe(true);
    expect(publish({ ...evidence, layoutIssue: "BOTTOM_NAV_MISSING" })).toBe(true);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("does not permanently hide a reading after a synchronous publishing error", () => {
    const send = vi.fn().mockImplementationOnce(() => { throw new Error("bridge unavailable"); });
    const publish = createLayoutSignalPublisher(send, 10_000, () => 100);
    expect(() => publish(evidence)).toThrow("bridge unavailable");
    expect(publish(evidence)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not rate limit a new measurement even after a previously healthy layout", () => {
    const send = vi.fn();
    const publish = createLayoutSignalPublisher(send, 10_000, () => 100);
    expect(publish(evidence)).toBe(true);
    expect(publish({ ...evidence, nativeInsetsReady: false })).toBe(true);
    expect(publish({ ...evidence, nativeInsetsReady: true })).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
