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
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: urls,
    revokeObjectURL: revocations,
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

  it("limits simultaneous video decoders to two without blocking later videos", async () => {
    vi.useFakeTimers();
    const created: HTMLVideoElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
      if (tag === "video") {
        const v = originalCreate("video");
        vi.spyOn(v, "pause").mockImplementation(() => {});
        vi.spyOn(v, "load").mockImplementation(() => {});
        created.push(v);
        return v;
      }
      return originalCreate(tag, options);
    });
    const { getThumb } = await import("./thumbnails");
    const calls = ["v1", "v2", "v3"].map(id => getThumb(nativeItem(id, "video")));
    await Promise.resolve();
    expect(created).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5050);
    await vi.waitFor(() => expect(created).toHaveLength(3));
    await vi.advanceTimersByTimeAsync(5050);
    expect(await Promise.all(calls)).toEqual([
      "capacitor://media/v1", "capacitor://media/v2", "capacitor://media/v3",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("revokes owned generated poster URLs, not original media URLs, when the cache fills", async () => {
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
      if (tag === "video") {
        const v = originalCreate("video");
        vi.spyOn(v, "pause").mockImplementation(() => {});
        vi.spyOn(v, "load").mockImplementation(() => {});
        Object.defineProperty(v, "videoWidth", { value: 320 });
        Object.defineProperty(v, "videoHeight", { value: 240 });
        Object.defineProperty(v, "duration", { value: 0 });
        queueMicrotask(() => v.dispatchEvent(new Event("loadeddata")));
        return v;
      }
      if (tag === "canvas") {
        const canvas = originalCreate("canvas");
        vi.spyOn(canvas, "getContext").mockReturnValue({
          drawImage: vi.fn(),
        } as unknown as CanvasRenderingContext2D);
        vi.spyOn(canvas, "toBlob").mockImplementation(cb => cb(new Blob(["poster"])));
        return canvas;
      }
      return originalCreate(tag, options);
    });
    const { getThumb } = await import("./thumbnails");
    const photo = nativeItem("video-good", "video");
    expect(await getThumb(photo)).toBe("blob:generated-poster");
    for (let i = 0; i < 400; i++) await getThumb(nativeItem("img-" + i, "image"));
    expect(revocations).toHaveBeenCalledWith("blob:generated-poster");
    expect(revocations).not.toHaveBeenCalledWith(photo.url);
  });
});
