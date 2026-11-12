import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("photo flags: stable React snapshots and durable data", () => {
  it("returns identical snapshot objects between unrelated renders", async () => {
    const { usePhotoFlags } = await import("./photo-flags");
    const { result, rerender, unmount } = renderHook(() => usePhotoFlags());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    rerender();
    expect(result.current).toBe(first);
    unmount();
  });

  it("updates protection and name without replacing the unrelated snapshot field", async () => {
    const { usePhotoFlags, photoFlags } = await import("./photo-flags");
    const { result, unmount } = renderHook(() => usePhotoFlags());
    const original = result.current;
    act(() => photoFlags.setProtected("photo-1", true));
    expect(result.current.prot["photo-1"]).toBe(true);
    expect(result.current.names).toBe(original.names);
    const names = result.current.names;
    act(() => photoFlags.setName("photo-1", "Holiday.jpg"));
    expect(result.current.names["photo-1"]).toBe("Holiday.jpg");
    expect(result.current.names).not.toBe(names);
    expect(result.current.prot["photo-1"]).toBe(true);
    expect(photoFlags.getName("photo-1")).toBe("Holiday.jpg");
    unmount();
  });

  it("does not claim a write succeeded when localStorage fails", async () => {
    const { photoFlags, getPhotoFlagsSnapshot } = await import("./photo-flags");
    const original = getPhotoFlagsSnapshot();
    const previous = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => photoFlags.setProtected("photo", true)).toThrow("quota");
    expect(getPhotoFlagsSnapshot()).toBe(original);
    expect(photoFlags.isProtected("photo")).toBe(false);
    spy.mockRestore();
    previous("unrelated", "true");
  });

  it("refreshes flags on an external storage event without stale React data", async () => {
    const { usePhotoFlags } = await import("./photo-flags");
    const { result, unmount } = renderHook(() => usePhotoFlags());
    act(() => {
      localStorage.setItem("vault.photo.protected.v1", '{"external":true}');
      window.dispatchEvent(new StorageEvent("storage", {
        key: "vault.photo.protected.v1", newValue: '{"external":true}',
      }));
    });
    expect(result.current.prot.external).toBe(true);
    unmount();
  });

  it("ignores corrupt storage values and inherited property names", async () => {
    localStorage.setItem("vault.photo.names.v1", "null");
    localStorage.setItem("vault.photo.protected.v1", '["bad"]');
    const { photoFlags } = await import("./photo-flags");
    expect(photoFlags.getName("anything")).toBeNull();
    expect(photoFlags.isProtected("toString")).toBe(false);
    expect(photoFlags.isProtected("0")).toBe(false);
  });
});
