import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useStableStoreSelector } from "./store-selector";

describe("stable external-store selections on React 19 WebView", () => {
  it("reuses object selections across unrelated rerenders", () => {
    let state = { folders: ["one"], scanned: true };
    const subscribers = new Set<() => void>();
    const subscribe = (cb: () => void) => {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    };
    const { result, rerender, unmount } = renderHook(() =>
      useStableStoreSelector(subscribe, () => state, () => state,
        s => ({ folders: s.folders, scanned: s.scanned })));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      state = { folders: ["one", "two"], scanned: true };
      subscribers.forEach(cb => cb());
    });
    expect(result.current).not.toBe(first);
    expect(result.current.folders).toEqual(["one", "two"]);
    unmount();
  });

  it("preserves snapshot when store changes unrelated fields", () => {
    let state = { value: "safe", unrelated: 1 };
    const subscribers = new Set<() => void>();
    const subscribe = (cb: () => void) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; };
    const { result, unmount } = renderHook(() =>
      useStableStoreSelector(subscribe, () => state, () => state, s => ({ value: s.value })));
    const first = result.current;
    act(() => { state = { ...state, unrelated: 2 }; subscribers.forEach(cb => cb()); });
    expect(result.current).toBe(first);
    unmount();
  });

  it("responds to a different selector closure even without a new store event", () => {
    const state = { folders: ["private"], scanned: true };
    const subscribe = () => () => {};
    const { result, rerender, unmount } = renderHook(
      ({ choose }) => useStableStoreSelector(subscribe, () => state, () => state,
        s => ({ selected: choose === "folders" ? s.folders : s.scanned })),
      { initialProps: { choose: "folders" as string } },
    );
    expect(result.current.selected).toEqual(["private"]);
    rerender({ choose: "scanned" });
    expect(result.current.selected).toBe(true);
    unmount();
  });

  it("does not mistakenly flatten Date, Set or other non-plain values", () => {
    let value = new Date(1);
    let state = { value };
    const subscribers = new Set<() => void>();
    const subscribe = (cb: () => void) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; };
    const { result, unmount } = renderHook(() =>
      useStableStoreSelector(subscribe, () => state, () => state, s => s.value));
    const first = result.current;
    act(() => {
      value = new Date(2);
      state = { value };
      subscribers.forEach(cb => cb());
    });
    expect(result.current).not.toBe(first);
    expect(result.current.getTime()).toBe(2);
    unmount();
  });
});
