import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ shareMediaUris: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({ shareMediaUris: mock.shareMediaUris }),
}));

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

describe("Android native album share", () => {
  it("passes all MediaStore URIs without reading image/video bytes", async () => {
    const { shareNativeAlbum } = await import("./native-vault");
    mock.shareMediaUris.mockResolvedValue({ success: true });
    const uris = [
      "content://media/external/images/media/1",
      "content://media/external/video/media/2",
    ];
    expect(await shareNativeAlbum(uris, "Camera")).toBe(true);
    expect(mock.shareMediaUris).toHaveBeenCalledTimes(1);
    expect(mock.shareMediaUris).toHaveBeenCalledWith({ uris, title: "Camera" });
  });
  it("does not open Android share with an empty album", async () => {
    const { shareNativeAlbum } = await import("./native-vault");
    expect(await shareNativeAlbum([], "Empty")).toBe(false);
    expect(mock.shareMediaUris).not.toHaveBeenCalled();
  });
});
