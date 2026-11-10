import { describe, expect, it, vi } from "vitest";
import { subscribeSystemColorScheme } from "./theme-compat";

describe("system theme on modern and legacy Android WebViews", () => {
  it("subscribes and unsubscribes via modern addEventListener", () => {
    const handler = vi.fn();
    const add = vi.fn();
    const remove = vi.fn();
    const unsubscribe = subscribeSystemColorScheme({
      matches: false, addEventListener: add, removeEventListener: remove,
    }, handler);
    expect(add).toHaveBeenCalledWith("change", handler);
    unsubscribe();
    expect(remove).toHaveBeenCalledWith("change", handler);
  });

  it("does not throw on Android WebViews with only addListener", () => {
    const handler = vi.fn();
    const add = vi.fn();
    const remove = vi.fn();
    const unsubscribe = subscribeSystemColorScheme({
      matches: true, addListener: add, removeListener: remove,
    }, handler);
    expect(add).toHaveBeenCalledWith(handler);
    unsubscribe();
    expect(remove).toHaveBeenCalledWith(handler);
  });

  it("remains safe without event APIs", () => {
    const handler = vi.fn();
    expect(() => subscribeSystemColorScheme({ matches: false }, handler)()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("supports old media-query emitters actually updating the theme", () => {
    let change: (() => void) | undefined;
    const query = {
      matches: false,
      addListener: (cb: () => void) => { change = cb; },
      removeListener: (cb: () => void) => { if (change === cb) change = undefined; },
    };
    let isLight = query.matches;
    const unsubscribe = subscribeSystemColorScheme(query, () => { isLight = query.matches; });
    query.matches = true;
    change?.();
    expect(isLight).toBe(true);
    unsubscribe();
    expect(change).toBeUndefined();
  });
});
