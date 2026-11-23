import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" }, Filesystem: native,
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, convertFileSrc: (s: string) => s },
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  native.readFile.mockResolvedValue({ data: "AQIDBA==" });
});
function item(size: number) {
  return {
    id: "one", name: "video.mp4", kind: "video" as const,
    file: null as File | null, url: "content://media/1",
    mtime: 2, size, path: "content://media/1", nativeUri: "content://media/1",
  };
}
describe("materialization cache of native media", () => {
  it("caches small files to avoid repeated reads", async () => {
    const { materializeFile } = await import("./device-scan");
    const media = item(4);
    const a = await materializeFile(media);
    expect(await materializeFile(media)).toBe(a);
    expect(native.readFile).toHaveBeenCalledTimes(1);
    expect(a.type).toBe("video/mp4");
  });
  it("does not retain big or unknown-size videos on album state", async () => {
    const { materializeFile } = await import("./device-scan");
    for (const size of [9 * 1024 * 1024, 0]) {
      const media = item(size);
      const a = await materializeFile(media);
      expect(media.file).toBeNull();
      const b = await materializeFile(media);
      expect(b).not.toBe(a);
    }
    expect(native.readFile).toHaveBeenCalledTimes(4);
  });
  it("keeps Android MediaStore MIME when an image has a misleading extension", async () => {
    const { materializeFile } = await import("./device-scan");
    const media = { ...item(4), name: "camera.bin", nativeMime: "image/heic" };
    const photo = await materializeFile(media);
    expect(photo.type).toBe("image/heic");
    expect(photo.name).toBe("camera.bin");
    const fallback = { ...item(4), name: "camera.jpg", nativeMime: "application/octet-stream" };
    const jpg = await materializeFile(fallback);
    expect(jpg.type).toBe("image/jpeg");
  });

  it("preserves supplied web File without native I/O", async () => {
    const { materializeFile } = await import("./device-scan");
    const media = item(4);
    media.file = new File(["foo"], "video.mp4", {type:"video/mp4"});
    expect(await materializeFile(media)).toBe(media.file);
    expect(native.readFile).not.toHaveBeenCalled();
  });
  it("coalesces simultaneous share and Safe reads without retaining large Files", async () => {
    let complete!: (value: { data: string }) => void;
    native.readFile.mockImplementationOnce(() => new Promise((resolve) => {
      complete = resolve;
    }));
    const { materializeFile } = await import("./device-scan");
    const media = item(20 * 1024 * 1024);
    const share = materializeFile(media);
    const safeImport = materializeFile(media);
    expect(native.readFile).toHaveBeenCalledTimes(1);
    complete({ data: "AQIDBA==" });
    const [shared, imported] = await Promise.all([share, safeImport]);
    expect(imported).toBe(shared);
    expect(media.file).toBeNull();
    await materializeFile(media);
    expect(native.readFile).toHaveBeenCalledTimes(2);
  });
  it("releases failed in-flight reads so a permission retry can succeed", async () => {
    native.readFile.mockRejectedValueOnce(new Error("transient read failure"));
    const { materializeFile } = await import("./device-scan");
    const media = item(20 * 1024 * 1024);
    const first = materializeFile(media);
    const second = materializeFile(media);
    await expect(first).rejects.toThrow("transient read failure");
    await expect(second).rejects.toThrow("transient read failure");
    expect(native.readFile).toHaveBeenCalledTimes(1);
    await expect(materializeFile(media)).resolves.toBeInstanceOf(File);
    expect(native.readFile).toHaveBeenCalledTimes(2);
  });

  it("recognizes valid photos and videos when a MediaStore provider omits MIME", async () => {
    const { inferNativeMediaKind } = await import("./device-scan");
    expect(inferNativeMediaKind("", "Camera/IMG_0001.HEIC")).toBe("image");
    expect(inferNativeMediaKind(null, "movie.MP4")).toBe("video");
    expect(inferNativeMediaKind("application/octet-stream", "photo.webp")).toBe("image");
    expect(inferNativeMediaKind("video/mp4", "unusual_extension")).toBe("video");
    expect(inferNativeMediaKind("", "document.pdf")).toBeNull();
    expect(inferNativeMediaKind("application/pdf", "photo.jpg")).toBeNull();
    expect(inferNativeMediaKind("IMAGE/JPEG", "photo")).toBe("image");
  });

});
