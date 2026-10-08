// Lazy thumbnail generator for the gallery grid.
//
// Full-resolution photos (often 10–40 MP) crash mobile browsers when
// decoded en-masse. We downscale each item to a ~256 px square via an
// offscreen canvas the first time it becomes visible, cache the result
// as a blob: URL, and hand the tiny thumb to the grid. The full-res
// original is only touched when the user taps to open the viewer.
//
// The cache is bounded (LRU) so scrolling through thousands of items
// never exhausts memory — old blob URLs are revoked as they fall out.

import type { ScannedItem } from "./device-scan";

const MAX_EDGE = 256;
const MAX_ENTRIES = 400;

const cache = new Map<string, string>();        // id → blob: URL
const inFlight = new Map<string, Promise<string>>();

function touch(id: string, url: string) {
  cache.delete(id);
  cache.set(id, url);
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (!first) break;
    const stale = cache.get(first);
    if (stale) URL.revokeObjectURL(stale);
    cache.delete(first);
  }
}

async function renderImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(bitmap, 0, 0, w, h);
    if ("convertToBlob" in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: "image/webp", quality: 0.72 });
    }
    return await new Promise<Blob>((res, rej) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => b ? res(b) : rej(new Error("toBlob failed")),
        "image/webp", 0.72,
      );
    });
  } finally {
    bitmap.close?.();
  }
}

async function renderVideoPosterFromUrl(url: string, revoke: boolean): Promise<Blob> {
  try {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.crossOrigin = "anonymous";
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("video decode failed"));
    });
    // seek to a bit past the start for a non-black frame
    await new Promise<void>((res) => {
      v.onseeked = () => res();
      v.currentTime = Math.min(0.1, (v.duration || 1) * 0.05);
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(1, Math.round(v.videoWidth * scale));
    const h = Math.max(1, Math.round(v.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(v, 0, 0, w, h);
    return await new Promise<Blob>((res, rej) => {
      canvas.toBlob(
        (b) => b ? res(b) : rej(new Error("toBlob failed")),
        "image/webp", 0.72,
      );
    });
  } finally {
    if (revoke) URL.revokeObjectURL(url);
  }
}

async function renderVideoPoster(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  return renderVideoPosterFromUrl(url, true);
}

/** Get (or generate) a downscaled thumbnail URL for a scanned item. */
export function getThumb(item: ScannedItem): Promise<string> {
  const hit = cache.get(item.id);
  if (hit) { touch(item.id, hit); return Promise.resolve(hit); }
  const pending = inFlight.get(item.id);
  if (pending) return pending;
  const p = (async () => {
    try {
      // Native (capacitor:// / file://) items:
      //  * Images — the WebView decoder can render the original URL
      //    directly and caches efficiently, so we forward the URL.
      //  * Videos — <img src="video.mp4"> renders a broken placeholder.
      //    Extract a real poster frame via a <video> element pointed at
      //    the native URL (MediaStore-style thumbnail retrieval).
      if (!item.file) {
        if (item.kind === "video") {
          const blob = await renderVideoPosterFromUrl(item.url, false);
          const posterUrl = URL.createObjectURL(blob);
          touch(item.id, posterUrl);
          return posterUrl;
        }
        touch(item.id, item.url);
        return item.url;
      }
      const blob = item.kind === "video"
        ? await renderVideoPoster(item.file)
        : await renderImage(item.file);
      const url = URL.createObjectURL(blob);
      touch(item.id, url);
      return url;
    } catch {
      // Fall back to the original — bitmap decode may fail for HEIC on some
      // WebViews; the original URL still renders through the platform decoder.
      touch(item.id, item.url);
      return item.url;
    } finally {
      inFlight.delete(item.id);
    }
  })();
  inFlight.set(item.id, p);
  return p;
}
