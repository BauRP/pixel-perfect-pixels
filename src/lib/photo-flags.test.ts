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

  it("preserves protection and rename after Android rescans a changed photo", async () => {
    const { photoFlags } = await import("./photo-flags");
    const before = "content://media/external/file/77:200:5000";
    const after = "content://media/external/file/77:225:6000";
    photoFlags.setProtected(before, true);
    photoFlags.setName(before, "Holiday.jpg");
    expect(photoFlags.isProtected(after)).toBe(true);
    expect(photoFlags.getName(after)).toBe("Holiday.jpg");
    expect(JSON.parse(localStorage.getItem("vault.photo.protected.v1") || "{}"))
      .toHaveProperty("native:content://media/external/file/77", true);
    vi.resetModules();
    const restored = (await import("./photo-flags")).photoFlags;
    expect(restored.isProtected(after)).toBe(true);
    expect(restored.getName(after)).toBe("Holiday.jpg");
  });

  it("recognizes legacy protection and permits removing it permanently", async () => {
    const before = "content://media/external/file/88:10:100";
    const after = "content://media/external/file/88:11:200";
    localStorage.setItem("vault.photo.protected.v1", JSON.stringify({ [before]: true }));
    localStorage.setItem("vault.photo.names.v1", JSON.stringify({ [before]: "Old.jpg" }));
    const { photoFlags } = await import("./photo-flags");
    expect(photoFlags.isProtected(after)).toBe(true);
    expect(photoFlags.getName(after)).toBe("Old.jpg");
    photoFlags.setProtected(after, false);
    photoFlags.setName(after, "New.jpg");
    expect(photoFlags.isProtected(before)).toBe(false);
    expect(photoFlags.getName(before)).toBe("New.jpg");
    vi.resetModules();
    const reloaded = (await import("./photo-flags")).photoFlags;
    expect(reloaded.isProtected(after)).toBe(false);
    expect(reloaded.getName(before)).toBe("New.jpg");
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
