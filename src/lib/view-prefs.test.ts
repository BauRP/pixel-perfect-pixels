import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  store.clear();
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("gallery/media view preference resilience", () => {
  it("preserves valid saved settings for both independent grid scopes", async () => {
    store.set("vault.viewprefs.v1", JSON.stringify({
      folders: { columns: 4, field: "size", dir: "asc" },
      media: { columns: 2, field: "name", dir: "desc" },
    }));
    const { getPrefs } = await import("./view-prefs");
    expect(getPrefs("folders")).toEqual({ columns: 4, field: "size", dir: "asc" });
    expect(getPrefs("media")).toEqual({ columns: 2, field: "name", dir: "desc" });
  });

  it("repairs invalid saved sort fields and column counts without erasing valid choices", async () => {
    store.set("vault.viewprefs.v1", JSON.stringify({
      folders: { columns: 100, field: "corrupted", dir: "asc" },
      media: { columns: 3, field: "name", dir: "sideways" },
    }));
    const { getPrefs } = await import("./view-prefs");
    expect(getPrefs("folders")).toEqual({ columns: 2, field: "created", dir: "asc" });
    expect(getPrefs("media")).toEqual({ columns: 3, field: "name", dir: "desc" });
  });

  it("ignores non-object and malformed storage without crashing gallery bootstrap", async () => {
    store.set("vault.viewprefs.v1", "[not-json");
    let { getPrefs } = await import("./view-prefs");
    expect(getPrefs("folders").columns).toBe(2);
    vi.resetModules();
    store.set("vault.viewprefs.v1", "null");
    ({ getPrefs } = await import("./view-prefs"));
    expect(getPrefs("media").columns).toBe(3);
  });

  it("normalizes invalid updates before persisting them, preserving the other scope", async () => {
    const { getPrefs, setPrefs } = await import("./view-prefs");
    setPrefs("folders", { columns: 4, field: "name", dir: "asc" });
    setPrefs("media", { columns: 123 as never, dir: "bad" as never });
    expect(getPrefs("folders")).toEqual({ columns: 4, field: "name", dir: "asc" });
    expect(getPrefs("media")).toEqual({ columns: 3, field: "created", dir: "desc" });
    const written = JSON.parse(store.get("vault.viewprefs.v1")!);
    expect(written).toEqual({ folders: getPrefs("folders"), media: getPrefs("media") });
  });
});
