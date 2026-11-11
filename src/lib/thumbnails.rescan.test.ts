import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannedItem } from "./device-scan";

const revocations = vi.fn();
let originalURL: typeof URL;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  originalURL = URL;
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revocations);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const photo = (id: string, url: string, mtime = 1): ScannedItem => ({
  id, url, mtime, size: 20, kind: "image", path: id,
  name: "photo.jpg", nativeUri: url, file: null,
});

describe("thumbnail rescans and deletion lifecycle", () => {
  it("replaces a same-ID photo when directory picker changes the source URL", async () => {
    const { getThumb } = await import("./thumbnails");
    expect(await getThumb(photo("same", "blob:first"))).toBe("blob:first");
    expect(await getThumb(photo("same", "blob:second"))).toBe("blob:second");
    expect(revocations).not.toHaveBeenCalledWith("blob:first");
    expect(revocations).not.toHaveBeenCalledWith("blob:second");
  });

  it("does not retain settled promises of native photos across source changes", async () => {
    const { getThumb } = await import("./thumbnails");
    expect(await getThumb(photo("same", "capacitor://first"))).toBe("capacitor://first");
    expect(await getThumb(photo("same", "capacitor://second"))).toBe("capacitor://second");
    expect(await getThumb(photo("same", "capacitor://third"))).toBe("capacitor://third");
  });

  it("removes obsolete generated poster URLs, never browser-owned originals", async () => {
    const { touch, dropThumbnails } = await import("./thumbnails");
    touch("poster", { url: "blob:poster", owned: true });
    touch("photo", { url: "blob:gallery", owned: false });
    dropThumbnails(["poster", "photo"]);
    expect(revocations).toHaveBeenCalledWith("blob:poster");
    expect(revocations).not.toHaveBeenCalledWith("blob:gallery");
  });

  it("invalidates a pending decode on removal so late results cannot resurrect it", async () => {
    let finish!: (value: ImageBitmap) => void;
    const bitmap = { width: 50, height: 50, close: vi.fn() } as unknown as ImageBitmap;
    const create = vi.fn(() => new Promise<ImageBitmap>(resolve => { finish = resolve; }));
    vi.stubGlobal("createImageBitmap", create);
    const canvas = { getContext: () => ({ drawImage: vi.fn() }),
      convertToBlob: async () => new Blob(["poster"]) };
    vi.stubGlobal("OffscreenCanvas", class { getContext = canvas.getContext; convertToBlob = canvas.convertToBlob; });
    const createUrl = vi.fn(() => "blob:late-generated");
    vi.spyOn(URL, "createObjectURL").mockImplementation(createUrl);
    const { getThumb, dropThumbnails } = await import("./thumbnails");
    const item = { ...photo("item", "blob:gallery-owned"), file: new File(["a"], "photo.jpg") };
    const pending = getThumb(item);
    await Promise.resolve(); // start async image decode
    expect(create).toHaveBeenCalledTimes(1);
    dropThumbnails(["item"]);
    finish(bitmap);
    expect(await pending).toBe(item.url);
    expect(revocations).toHaveBeenCalledWith("blob:late-generated");
    expect(bitmap.close).toHaveBeenCalled();
    // No stale poster is retained. A next request uses the live source.
    const newItem = { ...photo("item", "blob:gallery-new"), file: null };
    expect(await getThumb(newItem)).toBe("blob:gallery-new");
    vi.unstubAllGlobals();
  });
});
