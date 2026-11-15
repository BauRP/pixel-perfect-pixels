import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeCanvasJpegBase64 } from "./canvas-encode";

afterEach(() => vi.restoreAllMocks());

describe("asynchronous JPEG export on Android WebView", () => {
  it("uses background canvas encoding and preserves the exact base64 JPEG bytes", async () => {
    const canvas = document.createElement("canvas");
    const blob = new Blob(["JPEG"], { type: "image/jpeg" });
    const toBlob = vi.fn((cb: BlobCallback, mime: string, quality: number) => {
      expect(mime).toBe("image/jpeg");
      expect(quality).toBe(0.92);
      cb(blob);
    });
    Object.defineProperty(canvas, "toBlob", { configurable: true, value: toBlob });
    const synchronous = vi.spyOn(canvas, "toDataURL").mockImplementation(() => {
      throw new Error("synchronous encoder must not run");
    });
    await expect(encodeCanvasJpegBase64(canvas, 0.92)).resolves.toBe(btoa("JPEG"));
    expect(toBlob).toHaveBeenCalledTimes(1);
    expect(synchronous).not.toHaveBeenCalled();
  });

  it("rejects failed asynchronous JPEG encoding instead of exporting an empty file", async () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "toBlob", {
      configurable: true, value: (cb: BlobCallback) => cb(null),
    });
    await expect(encodeCanvasJpegBase64(canvas, 0.45)).rejects.toThrow("JPEG encoder failed");
  });

  it("preserves older WebViews without canvas.toBlob, including the requested quality", async () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "toBlob", { configurable: true, value: undefined });
    const legacy = vi.spyOn(canvas, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64," + btoa("fallback"));
    await expect(encodeCanvasJpegBase64(canvas, 0.45)).resolves.toBe(btoa("fallback"));
    expect(legacy).toHaveBeenCalledWith("image/jpeg", 0.45);
  });

  it("rejects corrupt encoding results instead of passing invalid bytes to Android storage", async () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "toBlob", { configurable: true, value: undefined });
    vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    await expect(encodeCanvasJpegBase64(canvas, 0.92)).rejects.toThrow("invalid image");
  });
});
