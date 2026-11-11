import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScannedItem } from "./device-scan";

function nativeItem(id: string, kind: "image" | "video", url = `capacitor://media/${id}`): ScannedItem {
  return {
    id, kind, url, file: null, name: id + (kind === "video" ? ".mp4" : ".jpg"),
    path: id, nativeUri: url, mtime: 0, size: 1024,
  };
}

const revocations = vi.fn();
const urls = vi.fn(() => "blob:generated-poster");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  // Keep URL as a constructor: jsdom, Capacitor mocks and Vitest's
  // environment create URL instances while this test is running.
  const OriginalURL = URL;
  vi.stubGlobal("URL", class extends OriginalURL {
    static createObjectURL = urls;
    static revokeObjectURL = revocations;
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("thumbnail cache ownership and decoder lifetimes", () => {
  it("never revokes borrowed original photo/video URLs during 400-entry LRU eviction", async () => {
    const { getThumb } = await import("./thumbnails");
    const source = nativeItem("original", "image", "blob:gallery-owned-original");
    expect(await getThumb(source)).toBe(source.url);
    for (let i = 0; i < 405; i++) {
      await getThumb(nativeItem("photo-" + i, "image"));
    }
    expect(revocations).not.toHaveBeenCalledWith(source.url);
    expect(revocations).not.toHaveBeenCalled();
  });

  it("a stuck video decoder times out, releases the decoder and returns its original URL", async () => {
    vi.useFakeTimers();
    const video = document.createElement("video");
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    const load = vi.spyOn(video, "load").mockImplementation(() => {});
    const remove = vi.spyOn(video, "removeAttribute");
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag, options) =>
      tag === "video" ? video : originalCreate(tag, options));
    const { getThumb } = await import("./thumbnails");
    const target = nativeItem("timeout-video", "video");
    const result = getThumb(target);
    await vi.advanceTimersByTimeAsync(5100);
    expect(await result).toBe(target.url);
    expect(pause).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("src");
    expect(load).toHaveBeenCalledOnce();
    expect(revocations).not.toHaveBeenCalledWith(target.url);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limits concurrent poster decodes to two and releases queued jobs", async () => {
    const { withVideoDecoder } = await import("./thumbnails");
    const started: number[] = [];
    const finish: Array<() => void> = [];
    const jobs = [1, 2, 3].map((i) => withVideoDecoder(() => {
      started.push(i);
      return new Promise<number>((resolve) => {
        finish[i] = () => resolve(i);
      });
    }));
    expect(started).toEqual([1, 2]);
    finish[1]!();
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
    finish[2]!();
    finish[3]!();
    expect(await Promise.all(jobs)).toEqual([1, 2, 3]);
  });

  it("reclaims generated poster blobs but never revokes original media URLs", async () => {
    const { touch } = await import("./thumbnails");
    touch("generated-poster", { url: "blob:generated-poster", owned: true });
    touch("original-photo", { url: "blob:gallery-owned", owned: false });
    for (let i = 0; i < 400; i++) {
      touch("photo-" + i, { url: "capacitor://photo/" + i, owned: false });
    }
    expect(revocations).toHaveBeenCalledWith("blob:generated-poster");
    expect(revocations).not.toHaveBeenCalledWith("blob:gallery-owned");
  });
});
