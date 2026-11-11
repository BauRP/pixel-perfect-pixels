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

type ThumbEntry = { url: string; owned: boolean };
// The gallery itself owns source media URLs. Only posters we generate here
// may be revoked by this cache; revoking an original Blob URL breaks the
// full-screen viewer and all other gallery references to that same file.
const cache = new Map<string, ThumbEntry>();
const inFlight = new Map<string, Promise<string>>();
const MAX_ACTIVE_VIDEO_DECODERS = 2;
let activeVideoDecoders = 0;
const queuedVideoDecoders: Array<() => void> = [];

export async function withVideoDecoder<T>(work: () => Promise<T>): Promise<T> {
  if (activeVideoDecoders >= MAX_ACTIVE_VIDEO_DECODERS) {
    await new Promise<void>((resume) => queuedVideoDecoders.push(resume));
  }
  activeVideoDecoders++;
  try {
    return await work();
  } finally {
    activeVideoDecoders--;
    queuedVideoDecoders.shift()?.();
  }
}

export function touch(id: string, entry: ThumbEntry) {
  cache.delete(id);
  cache.set(id, entry);
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (!first) break;
    const stale = cache.get(first);
    if (stale?.owned && stale.url.startsWith("blob:")) URL.revokeObjectURL(stale.url);
    cache.delete(first);
  }
}

/** Bounded waits prevent corrupt media or a stalled decoder from pinning the
 * thumbnail promise and holding media surfaces forever on older WebViews. */
function waitForVideoEvent(video: HTMLVideoElement, eventName: string, limitMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (reason?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.removeEventListener(eventName, ready);
      video.removeEventListener("error", failed);
      if (reason) reject(reason);
      else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("video decode failed"));
    const timer = setTimeout(() => finish(new Error("video decoder timeout")), limitMs);
    video.addEventListener(eventName, ready);
    video.addEventListener("error", failed);
  });
}

function boundedCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      reject(new Error("thumbnail encoding timeout"));
    }, 4000);
    canvas.toBlob((blob) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (blob) resolve(blob);
      else reject(new Error("toBlob failed"));
    }, "image/webp", 0.72);
  });
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
    return await boundedCanvasBlob(canvas as HTMLCanvasElement);
  } finally {
    bitmap.close?.();
  }
}

async function renderVideoPosterFromUrl(url: string, revoke: boolean): Promise<Blob> {
  const v = document.createElement("video");
  try {
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.crossOrigin = "anonymous";
    // Install both listeners BEFORE touching src: short local videos can
    // dispatch loadeddata synchronously on old Android implementations.
    const ready = waitForVideoEvent(v, "loadeddata", 5000);
    v.src = url;
    await ready;

    // On malformed/seekless clips the seeked event may never fire. A failed
    // seek must not hang the grid or retain the MediaCodec decoder.
    const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const target = Math.min(0.1, duration * 0.05);
    if (target > 0 && Math.abs(v.currentTime - target) > 0.001) {
      const seeked = waitForVideoEvent(v, "seeked", 1500);
      try { v.currentTime = target; } catch { /* use already decoded frame */ }
      await seeked.catch(() => { /* best-effort seek, render frame zero */ });
    }

    if (v.videoWidth <= 0 || v.videoHeight <= 0) throw new Error("video frame unavailable");
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(1, Math.round(v.videoWidth * scale));
    const h = Math.max(1, Math.round(v.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(v, 0, 0, w, h);
    return await boundedCanvasBlob(canvas);
  } finally {
    // Release the video surface and decoder even if the event/seek/encoding
    // timed out. Simply dropping the element did not release them promptly.
    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
    } catch { /* WebView is tearing down */ }
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
  if (hit) { touch(item.id, hit); return Promise.resolve(hit.url); }
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
          const blob = await withVideoDecoder(() => renderVideoPosterFromUrl(item.url, false));
          const posterUrl = URL.createObjectURL(blob);
          touch(item.id, { url: posterUrl, owned: true });
          return posterUrl;
        }
        touch(item.id, { url: item.url, owned: false });
        return item.url;
      }
      const blob = item.kind === "video"
        ? await withVideoDecoder(() => renderVideoPoster(item.file!))
        : await renderImage(item.file);
      const url = URL.createObjectURL(blob);
      touch(item.id, { url, owned: true });
      return url;
    } catch {
      // Fall back to the original — bitmap decode may fail for HEIC on some
      // WebViews; the original URL still renders through the platform decoder.
      touch(item.id, { url: item.url, owned: false });
      return item.url;
    } finally {
      inFlight.delete(item.id);
    }
  })();
  inFlight.set(item.id, p);
  return p;
}
