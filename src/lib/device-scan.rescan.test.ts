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
});
