import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNativeFirstPaint } from "./native-first-paint";

const frames: FrameRequestCallback[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  frames.length = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Android WebView nonblocking first route paint", () => {
  it("defers full route mounting until after two frame opportunities", () => {
    const { result, unmount } = renderHook(() => useNativeFirstPaint());
    expect(result.current).toBe(false);
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(16));
    expect(result.current).toBe(false);
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(32));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toBe(true);
    unmount();
  });

  it("always proceeds when old Chromium never schedules requestAnimationFrame", () => {
    const { result, unmount } = renderHook(() => useNativeFirstPaint());
    act(() => { vi.advanceTimersByTime(449); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    unmount();
  });

  it("cleans the fallback deadline without updating an unmounted view", () => {
    const { unmount } = renderHook(() => useNativeFirstPaint());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reschedule route mounting after a successful paint", () => {
    const { result, unmount } = renderHook(() => useNativeFirstPaint());
    act(() => { frames.shift()?.(16); frames.shift()?.(32); vi.advanceTimersByTime(0); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(true);
    unmount();
  });
});
