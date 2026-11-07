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
  it("preserves supplied web File without native I/O", async () => {
    const { materializeFile } = await import("./device-scan");
    const media = item(4);
    media.file = new File(["foo"], "video.mp4", {type:"video/mp4"});
    expect(await materializeFile(media)).toBe(media.file);
    expect(native.readFile).not.toHaveBeenCalled();
  });
});
