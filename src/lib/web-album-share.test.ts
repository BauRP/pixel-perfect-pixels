import { describe, expect, it, vi } from "vitest";
import { shareWebAlbum } from "./web-album-share";
import type { ScannedItem } from "./device-scan";

function item(name: string, file: File | null): ScannedItem {
  return { id: name, name, kind: "image", file, url: "blob:test",
    mtime: 0, size: file?.size ?? 1, path: name };
}
describe("browser album sharing without unnecessary media decoding", () => {
  it("shares all original browser Files without reading any bytes", async () => {
    const files = [new File(["one"], "one.jpg"), new File(["two"], "two.jpg")];
    const read = vi.fn();
    const share = vi.fn(async () => {});
    const host = { share, canShare: vi.fn(() => true) };
    expect(await shareWebAlbum(files.map(f => item(f.name, f)), host, "Trip", read))
      .toBe("shared");
    expect(read).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith({ files, title: "Trip" });
  });

  it("reads only one uncached item when the host rejects multi-file sharing", async () => {
    const first = new File(["photo"], "one.jpg");
    const read = vi.fn(async () => first);
    const share = vi.fn(async () => {});
    const host = { share, canShare: vi.fn(d => d.files.length === 1) };
    const items = [item("one.jpg", null), item("video.mp4", null)];
    expect(await shareWebAlbum(items, host, "Album", read)).toBe("shared");
    expect(read).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ files: [first], title: "one.jpg" });
  });

  it("never opens a second share sheet after the first is cancelled", async () => {
    const read = vi.fn(async (i: ScannedItem) => new File(["x"], i.name));
    const share = vi.fn(async () => { throw new Error("cancelled"); });
    expect(await shareWebAlbum(
      [item("one.jpg", null), item("two.jpg", null)],
      { share }, "Album", read,
    )).toBe("cancelled");
    expect(share).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("skips unreadable media but still shares the first accessible file", async () => {
    const read = vi.fn(async (i: ScannedItem) => {
      if (i.name === "missing.jpg") throw new Error("unavailable");
      return new File(["ok"], i.name);
    });
    const share = vi.fn(async () => {});
    const items = [item("missing.jpg", null), item("present.jpg", null)];
    expect(await shareWebAlbum(items, { share }, "Album", read)).toBe("shared");
    expect(read).toHaveBeenCalledTimes(2);
    expect(share).toHaveBeenCalledTimes(1);
  });
});


describe("unavailable browser sharing permission", () => {
  it("tries the lightweight single-file fallback when multi-file canShare throws", async () => {
    const files = [new File(["a"], "a.jpg"), new File(["b"], "b.jpg")];
    const canShare = vi.fn((d: ShareData) => {
      if ((d.files?.length ?? 0) > 1) throw new DOMException("blocked", "SecurityError");
      return true;
    });
    const share = vi.fn(async () => {});
    const read = vi.fn();
    expect(await shareWebAlbum(files.map(f => item(f.name, f)),
      { canShare, share }, "Album", read)).toBe("shared");
    expect(read).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith({ files: [files[0]], title: "a.jpg" });
  });
  it("does not crash or open a share chooser if canShare always throws", async () => {
    const file = new File(["a"], "a.jpg");
    const share = vi.fn(async () => {});
    expect(await shareWebAlbum([item(file.name, file)], {
      share, canShare: () => { throw new Error("Web Share API unavailable"); },
    }, "Album", async () => file)).toBe("unsupported");
    expect(share).not.toHaveBeenCalled();
  });
});
