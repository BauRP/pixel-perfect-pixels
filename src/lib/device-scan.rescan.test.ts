import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web gallery directory watcher keeps only live Blob URLs", () => {
  it("releases temporary URLs from unchanged rescans without breaking visible images", async () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible", configurable: true,
    });
    const createUrl = vi.fn()
      .mockReturnValueOnce("blob:first-displayed")
      .mockReturnValueOnce("blob:unchanged-temporary")
      .mockReturnValueOnce("blob:changed-displayed");
    const revokeUrl = vi.fn();
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    const first = new File(["photo"], "camera.jpg", { type: "image/jpeg", lastModified: 42 });
    const second = new File(["new"], "camera.jpg", { type: "image/jpeg", lastModified: 43 });
    let currentFile = first;
    const directory = {
      name: "Pictures",
      async *entries() {
        yield ["camera.jpg", { kind: "file", getFile: async () => currentFile }] as const;
      },
    } as unknown as FileSystemDirectoryHandle;
    vi.stubGlobal("showDirectoryPicker", async () => directory);
    const { deviceScan } = await import("./device-scan");
    await deviceScan.scan();
    const album = deviceScan.getAlbum("Pictures");
    expect(album?.items[0].url).toBe("blob:first-displayed");
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:unchanged-temporary"));
    expect(revokeUrl).not.toHaveBeenCalledWith("blob:first-displayed");
    expect(deviceScan.getAlbum("Pictures")?.items[0].url).toBe("blob:first-displayed");
    currentFile = second;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(deviceScan.getAlbum("Pictures")?.items[0].url).toBe("blob:changed-displayed"));
    expect(revokeUrl).toHaveBeenCalledWith("blob:first-displayed");
    expect(revokeUrl).not.toHaveBeenCalledWith("blob:changed-displayed");
  });
  it("stops retrying a revoked folder and keeps the previous albums visible", async () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible", configurable: true,
    });
    const revokeUrl = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:displayed");
    URL.revokeObjectURL = revokeUrl;
    let grantRevoked = false;
    const file = new File(["still here"], "camera.jpg", { lastModified: 11 });
    const folder = {
      name: "Pictures",
      async *entries() {
        if (grantRevoked) throw new Error("permission revoked");
        yield ["camera.jpg", { kind: "file", getFile: async () => file }] as const;
      },
    } as unknown as FileSystemDirectoryHandle;
    vi.stubGlobal("showDirectoryPicker", async () => folder);
    const { deviceScan } = await import("./device-scan");
    await deviceScan.scan();
    const displayed = deviceScan.getAlbum("Pictures")?.items[0].url;
    grantRevoked = true;
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(deviceScan.getAlbum("Pictures")?.items[0].url).toBe(displayed));
    // No gallery data or displayed URL should be removed when access expires.
    expect(revokeUrl).not.toHaveBeenCalledWith(displayed);
  });

  it("keeps live photo URLs and object identity when another photo appears", async () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible", configurable: true,
    });
    const reads = new Map<string, number>();
    URL.createObjectURL = vi.fn((file: Blob) => {
      const name = (file as File).name;
      const count = reads.get(name) ?? 0;
      reads.set(name, count + 1);
      if (name === "new.jpg") return "blob:added-photo";
      return count === 0
        ? (name === "old.jpg" ? "blob:kept-photo" : "blob:kept-video")
        : (name === "old.jpg" ? "blob:temporary-photo" : "blob:temporary-video");
    });
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const first = new File(["a"], "old.jpg", { type: "image/jpeg", lastModified: 1 });
    const second = new File(["b"], "old.mp4", { type: "video/mp4", lastModified: 2 });
    const third = new File(["c"], "new.jpg", { type: "image/jpeg", lastModified: 3 });
    const listing = [first, second];
    const folder = {
      name: "Pictures",
      async *entries() {
        for (const file of listing) {
          yield [file.name, { kind: "file", getFile: async () => file }] as const;
        }
      },
    } as unknown as FileSystemDirectoryHandle;
    vi.stubGlobal("showDirectoryPicker", async () => folder);
    const { deviceScan } = await import("./device-scan");
    await deviceScan.scan();
    const originals = deviceScan.getAlbum("Pictures")!.items;
    const originalPhoto = originals.find(i => i.name === "old.jpg")!;
    const originalVideo = originals.find(i => i.name === "old.mp4")!;
    listing.push(third);
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(deviceScan.getAlbum("Pictures")?.items).toHaveLength(3));
    const displayed = deviceScan.getAlbum("Pictures")!.items;
    expect(displayed.find(i => i.name === "old.jpg")).toBe(originalPhoto);
    expect(displayed.find(i => i.name === "old.mp4")).toBe(originalVideo);
    expect(revoke).toHaveBeenCalledWith("blob:temporary-photo");
    expect(revoke).toHaveBeenCalledWith("blob:temporary-video");
    expect(revoke).not.toHaveBeenCalledWith("blob:kept-photo");
    expect(revoke).not.toHaveBeenCalledWith("blob:kept-video");
    expect(displayed.find(i => i.name === "new.jpg")?.url).toBe("blob:added-photo");
  });

});
