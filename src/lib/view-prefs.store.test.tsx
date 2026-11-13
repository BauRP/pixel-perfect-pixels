import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getPrefs, setPrefs, useViewPrefs } from "./view-prefs";

describe("stable gallery preference subscriptions", () => {
  it("keeps a stable snapshot during rerenders and accepts external storage updates", () => {
    act(() => setPrefs("folders", { columns: 2, field: "created", dir: "desc" }));
    const add = vi.spyOn(window, "addEventListener");
    const { result, rerender, unmount } = renderHook(() => useViewPrefs("folders"));
    const initial = result.current[0];
    const initialStorageSubscriptions = add.mock.calls.filter(call => call[0] === "storage").length;
    rerender();
    rerender();
    expect(result.current[0]).toBe(initial);
    expect(add.mock.calls.filter(call => call[0] === "storage").length).toBe(initialStorageSubscriptions);
    const external = {
      folders: { columns: 4, field: "name", dir: "asc" },
      media: getPrefs("media"),
    };
    window.localStorage.setItem("vault.viewprefs.v1", JSON.stringify(external));
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "vault.viewprefs.v1" })));
    expect(result.current[0]).toEqual(external.folders);
    const updated = result.current[0];
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "unrelated.key" })));
    expect(result.current[0]).toBe(updated);
    unmount();
    add.mockRestore();
    act(() => setPrefs("folders", { columns: 2, field: "created", dir: "desc" }));
  });
});
