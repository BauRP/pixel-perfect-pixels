// Dynamic device media scanner with a lightweight change watcher.
//
// Priority order:
//   1. Native Android (Capacitor) — walk standard MediaStore-visible
//      directories on the device (DCIM, Pictures, Movies, Download) using
//      @capacitor/filesystem. Files are exposed to the WebView through
//      Capacitor.convertFileSrc() so <img>/<video> can display them without
//      copying bytes.
//   2. Chromium desktop / dev preview — File System Access API.
//   3. Other browsers — <input webkitdirectory> fallback.
//
// Everything is 100% local: no file bytes ever leave the device.

import { useStableStoreSelector } from "./store-selector";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { dropThumbnails } from "./thumbnails";
import { processInBatches } from "./scan-batching";
import { decodeBase64InBatches } from "./base64-batching";
import { groupMediaItems, groupMediaItemsInBatches } from "./media-grouping";
import { createRemovalMatcher } from "./media-removal-match";
import { normalizeNativeMedia } from "./native-media-normalize";
import { classifyNativeRows } from "./native-scan-status";

export type ScannedItem = {
  id: string;
  name: string;
  kind: "image" | "video";
  file: File | null;
  url: string;
  mtime: number;
  size: number;
  path: string;
  // Present on native Android scans — points at the raw file:// URI so we
  // can lazily read bytes when the Vault or Share API needs a real File.
  nativeUri?: string;
  // MediaStore's recorded MIME is more reliable than a file extension.
  nativeMime?: string;
};
export type ScannedAlbum = {
  id: string;
  name: string;
  items: ScannedItem[];
};

type State = {
  albums: ScannedAlbum[];
  scanning: boolean;
  scanned: boolean;
  mediaPermission: "unknown" | "prompt" | "granted" | "partial" | "denied";
};

let state: State = { albums: [], scanning: false, scanned: false, mediaPermission: "unknown" };
let mediaRequestedAutomatically = false;
let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());
const set = (s: Partial<State>) => { state = { ...state, ...s }; emit(); };

const IMG = /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/i;
const VID = /\.(mp4|mov|m4v|webm|mkv|3gp|avi)$/i;

export function guessMimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", heic: "image/heic", heif: "image/heif", avif: "image/avif",
    bmp: "image/bmp",
    mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v",
    webm: "video/webm", mkv: "video/x-matroska", "3gp": "video/3gpp",
    avi: "video/x-msvideo",
  };
  return map[ext] ?? "application/octet-stream";
}
/** Prefer the real Android MediaStore type when it is meaningful.
 * The extension remains the fallback for missing or generic MIME. */
export function mediaMime(item: Pick<ScannedItem, "name" | "nativeMime">): string {
  const reported = item.nativeMime?.trim().toLowerCase() ?? "";
  return reported && reported !== "application/octet-stream"
    ? reported : guessMimeFromName(item.name);
}

const guessMime = guessMimeFromName;

/** MediaStore providers sometimes omit MIME; keep known photo/video files
 * available by their extension without accepting unknown binary formats. */
export function inferNativeMediaKind(mime: string | null | undefined, name: string): ScannedItem["kind"] | null {
  const mimeValue = mime?.trim().toLowerCase() ?? "";
  if (mimeValue.startsWith("image/")) return "image";
  if (mimeValue.startsWith("video/")) return "video";
  // Explicitly reported documents are not photos even if an OEM gives
  // them an incorrect .jpg display name.
  if (mimeValue && mimeValue !== "application/octet-stream") return null;
  if (IMG.test(name)) return "image";
  if (VID.test(name)) return "video";
  return null;
}

/**
 * Lazily materialise a native-scanned item into a real File object.
 * Never retain a large decoded video in gallery album state: after a share
 * or encrypted import, caching the whole media file can keep hundreds of MB
 * alive indefinitely. Small photos remain cached for convenient reuse.
 */
// Share and Safe import may request the SAME native video at the same time.
// One in-flight read/decode per item avoids duplicate full-size base64 copies
// in the WebView. The promise is discarded after completion or failure;
// large decoded Files are never kept alive by this map.
const materializing = new WeakMap<ScannedItem, Promise<File>>();

export async function materializeFile(item: ScannedItem): Promise<File> {
  if (item.file) return item.file;
  const pending = materializing.get(item);
  if (pending) return pending;
  if (!item.nativeUri) {
    throw new Error("Cannot read this file — no native URI available");
  }
  const task = (async (): Promise<File> => {
  const res = await Filesystem.readFile({ path: item.nativeUri });
  // A single atob() of a large video creates a second, full-size binary
  // string and blocks the WebView JS thread until every byte is copied.
  // Decode in bounded chunks with event-loop turns between them instead.
  const arr = await decodeBase64InBatches(String(res.data));
  const mime = mediaMime(item);
  const file = new File([arr], item.name, { type: mime, lastModified: item.mtime });
  // Unknown-sized and large native media are deliberately NOT cached.
  // This does not remove the current File from its caller; it just releases
  // the gallery's long-lived reference once the operation finishes.
  const MAX_CACHED_MEDIA_BYTES = 8 * 1024 * 1024;
  if (item.size > 0 && item.size <= MAX_CACHED_MEDIA_BYTES &&
      file.size <= MAX_CACHED_MEDIA_BYTES) {
    (item as { file: File | null }).file = file;
  }
  return file;
  })();
  materializing.set(item, task);
  try {
    return await task;
  } finally {
    // Failed reads must be retryable, and completed large videos must not
    // remain referenced by a settled promise in long-lived gallery state.
    if (materializing.get(item) === task) materializing.delete(item);
  }
}

// Retained handle for event-driven re-scan (native OS MediaStore observer analog).
let watchedHandle: FileSystemDirectoryHandle | null = null;
let fsObserver: { disconnect(): void } | null = null;
let listenersAttached = false;
let rescanInFlight = false;
let rescanQueued = false;

function albumKey(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts[parts.length - 1] || parts[0] || "Root";
}

function toItem(file: File, path: string): ScannedItem | null {
  const isImg = IMG.test(file.name);
  const isVid = VID.test(file.name);
  if (!isImg && !isVid) return null;
  return {
    id: `${path}:${file.size}:${file.lastModified}`,
    name: file.name,
    kind: isVid ? "video" : "image",
    file,
    url: URL.createObjectURL(file),
    mtime: file.lastModified,
    size: file.size,
    path,
  };
}


function revokeObjectUrls(items: readonly ScannedItem[]) {
  // Only browser-created blob: URLs hold native resources. Never revoke
  // a capacitor:// or file:// URI belonging to the actual Android gallery.
  for (const item of items) {
    if (item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
  }
}
function revokeAll() {
  for (const album of state.albums) revokeObjectUrls(album.items);
}

/** Drop only the thumbnails no longer present in the NEXT album list. */
function dropRemovedThumbnails(nextAlbums: readonly ScannedAlbum[]) {
  const nextIds = new Set(nextAlbums.flatMap(album => album.items.map(item => item.id)));
  const removed = state.albums.flatMap(album => album.items)
    .filter(item => !nextIds.has(item.id))
    .map(item => item.id);
  dropThumbnails(removed);
}

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: { item: ScannedItem; path: string }[],
): Promise<void> {
  const entries = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
  for await (const [name, handle] of entries) {
    const path = `${prefix}/${name}`;
    if (handle.kind === "file") {
      try {
        const f = await (handle as FileSystemFileHandle).getFile();
        const item = toItem(f, path);
        if (item) out.push({ item, path });
      } catch {}
    } else if (handle.kind === "directory") {
      await new Promise((r) => setTimeout(r, 0));
      await walkDir(handle as FileSystemDirectoryHandle, path, out);
    }
  }
}

async function rescanHandle(handle: FileSystemDirectoryHandle) {
  if (rescanInFlight) { rescanQueued = true; return; }
  rescanInFlight = true;
  const collected: { item: ScannedItem; path: string }[] = [];
  let adopted = false;
  try {
    await walkDir(handle, handle.name, collected);
    // An older folder observer can finish after the user has replaced the
    // directory grant. Its results must never overwrite the newer gallery.
    if (watchedHandle !== handle) return;
    const nextIds = new Set(collected.map((c) => c.item.id));
    const currentIds = new Set(state.albums.flatMap((a) => a.items.map((i) => i.id)));
    const changed =
      nextIds.size !== currentIds.size ||
      [...nextIds].some((id) => !currentIds.has(id));
    if (changed) {
      // Reusing unchanged items also reuses their live blob: URLs. Revoking
      // every displayed URL on each new photo used to break an OPEN viewer
      // and force all existing thumbnails to reload unnecessarily.
      const previous = new Map(state.albums.flatMap(album =>
        album.items.map(item => [item.id, item] as const)));
      for (const entry of collected) {
        const old = previous.get(entry.item.id);
        if (!old || old.path !== entry.item.path) continue;
        // A fresh scan generated a temporary URL, but the original still
        // points to the same file revision and is used by active viewers.
        if (entry.item.url.startsWith("blob:")) URL.revokeObjectURL(entry.item.url);
        entry.item = old;
      }
      const nextAlbums = groupMediaItems(collected);
      const retainedUrls = new Set(collected.map(entry => entry.item.url));
      // Only URLs which have actually disappeared may be revoked.
      for (const old of previous.values()) {
        if (old.url.startsWith("blob:") && !retainedUrls.has(old.url)) {
          URL.revokeObjectURL(old.url);
        }
      }
      adopted = true;
      dropRemovedThumbnails(nextAlbums);
      set({ albums: nextAlbums, scanned: true });
    }
  } catch {
    // A directory grant can be revoked between window focus and traversal.
    // Stop automatic retries instead of producing uncaught rejections on
    // every visibilitychange. Existing gallery items remain displayed.
    if (watchedHandle === handle) {
      watchedHandle = null;
      try { fsObserver?.disconnect(); } catch { /* obsolete observer */ }
      fsObserver = null;
    }
  } finally {
    // Every unchanged scan previously leaked one Blob URL per photo on
    // focus/pageshow. Partial/failed walks leaked them too. Cleanup only
    // temporary URLs; the displayed album URLs must remain usable.
    if (!adopted) revokeObjectUrls(collected.map(({ item }) => item));
    rescanInFlight = false;
    if (rescanQueued) {
      rescanQueued = false;
      // A rejected directory permission invalidates the old handle.
      // Never queue another read of that revoked directory indefinitely.
      if (watchedHandle) void rescanHandle(watchedHandle);
    }
  }
}

// Event-driven watcher. Prefers the native FileSystemObserver API
// (Chromium 129+; Android Chromium/WebView) — the same change stream that
// backs Android's MediaStore ContentObserver in the packaged shell. Falls
// back to visibility/focus/pageshow events so re-entering the app after
// capturing a photo triggers an immediate re-scan, with NO timers.
type FSObserverRecord = { changedHandle: FileSystemHandle };
type FSObserverCtor = new (
  cb: (records: FSObserverRecord[]) => void,
) => { observe(h: FileSystemHandle, opts?: { recursive?: boolean }): Promise<void>; disconnect(): void };

function startWatch(handle: FileSystemDirectoryHandle) {
  if (fsObserver) { try { fsObserver.disconnect(); } catch {} fsObserver = null; }
  watchedHandle = handle;

  const Ctor = (globalThis as unknown as { FileSystemObserver?: FSObserverCtor }).FileSystemObserver;
  if (Ctor) {
    try {
      const obs = new Ctor(() => {
        if (watchedHandle) void rescanHandle(watchedHandle);
      });
      fsObserver = obs;
      void obs.observe(handle, { recursive: true }).catch(() => {
        // FileSystemObserver is optional; window focus remains a fallback.
        if (fsObserver === obs) {
          obs.disconnect();
          fsObserver = null;
        }
      });
    } catch {
      fsObserver = null;
    }
  }

  if (!listenersAttached && typeof window !== "undefined") {
    listenersAttached = true;
    const trigger = () => {
      if (document.visibilityState !== "visible") return;
      if (watchedHandle) void rescanHandle(watchedHandle);
    };
    document.addEventListener("visibilitychange", trigger);
    window.addEventListener("focus", trigger);
    window.addEventListener("pageshow", trigger);
  }
}

async function scanWithPicker(): Promise<boolean> {
  const anyWin = window as unknown as {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!anyWin.showDirectoryPicker) return false;
  let root: FileSystemDirectoryHandle;
  try {
    root = await anyWin.showDirectoryPicker();
  } catch {
    return true;
  }
  set({ scanning: true });
  const collected: { item: ScannedItem; path: string }[] = [];
  let published = false;
  try {
    await walkDir(root, root.name, collected);
    const nextAlbums = groupMediaItems(collected);
    dropRemovedThumbnails(nextAlbums);
    revokeAll();
    published = true;
    set({ albums: nextAlbums, scanning: false, scanned: true });
    startWatch(root);
  } catch {
    // Revoked browser folder permission cannot strand the loading spinner
    // or erase a previously displayed album.
    set({ scanning: false, scanned: true });
  } finally {
    if (!published) revokeObjectUrls(collected.map(({ item }) => item));
  }
  return true;
}

function scanWithInput(): Promise<void> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.display = "none";
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      const collected: { item: ScannedItem; path: string }[] = [];
      let published = false;
      try {
        if (files.length === 0) return;
        set({ scanning: true });
        await new Promise(resolve => setTimeout(resolve, 0));
        for (const f of files) {
          const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
          const item = toItem(f, path);
          if (item) collected.push({ item, path });
        }
        const nextAlbums = groupMediaItems(collected);
        dropRemovedThumbnails(nextAlbums);
        revokeAll();
        published = true;
        set({ albums: nextAlbums, scanning: false, scanned: true });
      } catch {
        set({ scanning: false, scanned: true });
      } finally {
        if (!published) revokeObjectUrls(collected.map(({ item }) => item));
        input.remove();
        resolve();
      }
    };
    input.oncancel = () => { input.remove(); resolve(); };
    document.body.appendChild(input);
    input.click();
  });
}

// ── Native (Capacitor / Android) MediaStore-style scan ────────────────
//
// The Android MediaStore is folder-oriented; competing gallery apps such
// as Google Photos, MIUI Gallery and Samsung Gallery all group content by
// the *parent folder name* of each file (Camera, Screenshots, WhatsApp
// Images, …). We mirror that behaviour by walking the standard media
// roots on external storage and keying every album by the immediate
// parent directory name.

type NativeFileEntry = { name: string; type: string; size?: number; mtime?: number; uri?: string };

const SCAN_TAG = "[GalleryScan]";

type RootReport = { root: string; ok: boolean; items: number; error?: string };
type WalkCtx = { out: { item: ScannedItem; path: string }[]; errors: string[] };

export type ScanStatus = "success" | "empty" | "permission_denied" | "unavailable";
export type ScanResult = {
  status: ScanStatus;
  albums: ScannedAlbum[];
  errors: string[];
  roots: RootReport[];
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Recursively lists one directory. Throws only for the root (so the caller can classify it). */
async function walkNative(path: string, ctx: WalkCtx, isRoot: boolean): Promise<void> {
  let entries: NativeFileEntry[] = [];
  try {
    const res = await Filesystem.readdir({ path, directory: Directory.ExternalStorage });
    entries = res.files as unknown as NativeFileEntry[];
  } catch (e) {
    if (isRoot) throw e;
    const msg = `${path}: ${errText(e)}`;
    ctx.errors.push(msg);
    console.debug(SCAN_TAG, "skip subfolder", msg);
    return;
  }
  for (const entry of entries) {
    const childPath = `${path}/${entry.name}`;
    if (entry.type === "directory") {
      // Skip Android system junk folders that never contain user media.
      if (entry.name.startsWith(".")) continue;
      await walkNative(childPath, ctx, false);
      continue;
    }
    const isImg = IMG.test(entry.name);
    const isVid = VID.test(entry.name);
    if (!isImg && !isVid) continue;
    let uri = entry.uri;
    if (!uri) {
      try {
        const g = await Filesystem.getUri({ path: childPath, directory: Directory.ExternalStorage });
        uri = g.uri;
      } catch (e) {
        ctx.errors.push(`${childPath}: ${errText(e)}`);
        continue;
      }
    }
    const url = Capacitor.convertFileSrc(uri);
    const item: ScannedItem = {
      id: `${childPath}:${entry.size ?? 0}:${entry.mtime ?? 0}`,
      name: entry.name,
      kind: isVid ? "video" : "image",
      file: null,
      url,
      mtime: entry.mtime ?? 0,
      size: entry.size ?? 0,
      path: childPath,
      nativeUri: uri,
    };
    ctx.out.push({ item, path: childPath });
  }
}

const isPermissionError = (m: string) => /permission|denied|EACCES|not allowed|security/i.test(m);
const isMissingError = (m: string) => /does not exist|not found|ENOENT|no such/i.test(m);

/** Permission refusal and a broken native bridge are different outcomes.
 * A temporary bridge failure must not erase previously displayed albums. */
async function ensureMediaPermission(): Promise<"allowed" | "denied" | "unavailable"> {
  const { SecureVault } = await import("./native-vault");
  try {
    let { state: st } = await SecureVault.checkMediaPermission();
    if (st === "prompt" && !mediaRequestedAutomatically) {
      mediaRequestedAutomatically = true;
      st = (await SecureVault.requestMediaPermission()).state;
    }
    set({ mediaPermission: st });
    console.info(SCAN_TAG, "media permission:", st);
    // "prompt" means Android has NOT decided yet, which is not the same
    // as the user explicitly denying access. Never clear prior albums.
    if (st === "granted" || st === "partial") return "allowed";
    return st === "denied" ? "denied" : "unavailable";
  } catch (e) {
    // No Android permission decision was received: keep the previous
    // permission state and photos, and let the next foreground scan retry.
    console.warn(SCAN_TAG, "permission check unavailable:", errText(e));
    return "unavailable";
  }
}

async function runNativeScan(): Promise<ScanResult> {
  const permission = await ensureMediaPermission();
  if (permission === "unavailable") {
    return { status: "unavailable", albums: [], errors: ["media permission bridge unavailable"], roots: [] };
  }
  if (permission === "denied") {
    return { status: "permission_denied", albums: [], errors: ["media permission not granted"], roots: [] };
  }
  const { SecureVault } = await import("./native-vault");
  const response = await SecureVault.getMediaItems();
  // A failed bridge response is not proof that all photos were deleted.
  if (!response || !Array.isArray(response.items))
    throw new Error("Android returned an invalid media list");
  const entries: { item: ScannedItem; path: string }[] = [];
  let invalidRows = 0;
  await processInBatches(response.items, (raw) => {
    const media = normalizeNativeMedia(raw);
    if (!media) { invalidRows++; return; }
    const kind = inferNativeMediaKind(media.mime, media.name);
    if (!kind) return;
    const folder = media.relativePath.replace(/^\/+|\/+$/g, "") || "Pictures";
    const path = folder + "/" + media.name;
    entries.push({ path, item: {
      id: media.uri + ":" + media.size + ":" + media.mtime,
      name: media.name, kind, file: null,
      url: Capacitor.convertFileSrc(media.uri), nativeMime: media.mime,
      mtime: media.mtime, size: media.size, path, nativeUri: media.uri,
    } });
  });
  const status = classifyNativeRows(response.items.length, invalidRows, entries.length);
  return { status, albums: status === "unavailable" ? [] : await groupMediaItemsInBatches(entries),
    errors: status === "unavailable" ? ["Android returned only malformed media rows"] : [],
    roots: [{ root: "MediaStore", ok: status !== "unavailable", items: entries.length }] };
}

let lastScanResult: ScanResult | null = null;
export const getLastScanResult = () => lastScanResult;

let activeScanPromise: Promise<boolean> | null = null;

async function scanNative(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (activeScanPromise) return activeScanPromise;

  activeScanPromise = (async () => {
    if (state.scanning) return true;
    set({ scanning: true });
    let res: ScanResult;
    try {
      res = await runNativeScan();
    } catch (e) {
      res = { status: "unavailable", albums: [], errors: [errText(e)], roots: [] };
    }
    lastScanResult = res;
    console.info(SCAN_TAG, `scan ${res.status}: ${res.albums.length} album(s), ${res.errors.length} error(s)`);
    
    // A successful MediaStore query returning zero rows really means the
    // currently authorized media set is empty; don't keep stale photos.
    const genuineEmpty = res.status === "empty";

    // SAFEGUARD: Never wipe existing albums on a subsequent empty or partial scan result
    if (res.status === "success" || res.status === "empty") {
      dropRemovedThumbnails(res.albums);
      set({ albums: res.albums, scanning: false, scanned: true });
    } else if (res.status === "permission_denied") {
      dropRemovedThumbnails([]);
      set({ albums: [], scanning: false, scanned: true });
    } else {
      console.warn(SCAN_TAG, `keeping ${state.albums.length} existing album(s) — status: ${res.status}, genuineEmpty: ${genuineEmpty}`);
      set({ scanning: false, scanned: true });
    }
    return true;
  })();

  try {
    return await activeScanPromise;
  } finally {
    activeScanPromise = null;
  }
}

// ── Coalesced automatic rescans (focus / visibilitychange / pageshow) ──
const RESCAN_DEBOUNCE_MS = 600;
let rescanTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAfterScan = false;

export const deviceScan = {
  /** Explicit permission change, initiated by the user's tap. */
  async changeMediaAccess() {
    if (!Capacitor.isNativePlatform()) return;
    mediaRequestedAutomatically = true;
    const { SecureVault } = await import("./native-vault");
    try {
      const { state: status } = await SecureVault.requestMediaPermission({ reselect: true });
      set({ mediaPermission: status });
      await deviceScan.scan();
    } catch (error) {
      console.warn(SCAN_TAG, "media access update failed:", errText(error));
    }
  },
  /**
   * Debounced, coalesced rescan for lifecycle events. Bursts of focus /
   * visibilitychange / pageshow (e.g. right after a permission dialog closes)
   * collapse into one scan; a request during a running scan runs once after it.
   */
  requestRescan() {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (!Capacitor.isNativePlatform()) {
      // Browser focus/pageshow is NOT a user gesture. Never open another
      // directory picker automatically; reuse the already-granted handle.
      if (watchedHandle) void rescanHandle(watchedHandle);
      return;
    }
    if (rescanTimer !== null) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      if (state.scanning) {
        pendingAfterScan = true;
        return;
      }
      void deviceScan.scan();
    }, RESCAN_DEBOUNCE_MS);
  },
  async scan() {
    if (!Capacitor.isNativePlatform() && watchedHandle) {
      // A mounted route or focus after choosing a folder should rescan that
      // same directory, not ask for a fresh permission grant on every visit.
      await rescanHandle(watchedHandle);
      return;
    }
    if (state.scanning) {
      pendingAfterScan = true;
      return;
    }
    // Native Android — read MediaStore-visible folders directly.
    if (await scanNative()) {
      if (pendingAfterScan) {
        pendingAfterScan = false;
        deviceScan.requestRescan();
      }
      return;
    }
    const handled = await scanWithPicker();
    if (!handled) await scanWithInput();
  },
  getAlbum(id: string) { return state.albums.find((a) => a.id === id); },
  /**
   * Drop items whose underlying file has been permanently removed from
   * public storage (e.g. after a secure move into the Safe). Matching is
   * done on the native URI *and* the relative path so both native and
   * web-scanned entries are covered.
   */
  removeByPaths(paths: string[]) {
    if (paths.length === 0) return;
    // Precompile path suffixes once. Comparing every displayed item against
    // every removed path used to block the WebView for large Safe imports.
    // Preserve exact native URIs and the legacy absolute/relative path matches.
    const hit = createRemovalMatcher(paths);
    const removedIds: string[] = [];
    const albums = state.albums
      .map((a) => ({
        ...a,
        items: a.items.filter((i) => {
          if (!hit(i)) return true;
          removedIds.push(i.id);
          if (i.url.startsWith("blob:")) URL.revokeObjectURL(i.url);
          return false;
        }),
      }))
      .filter((a) => a.items.length > 0);
    dropThumbnails(removedIds);
    set({ albums });
  },
  removeItems(albumId: string, itemIds: Set<string>) {
    const albums = state.albums
      .map((a) => a.id === albumId
        ? { ...a, items: a.items.filter((i) => {
            if (itemIds.has(i.id)) {
              // Only object URLs need revocation; native capacitor:// URLs don't.
              if (i.url.startsWith("blob:")) URL.revokeObjectURL(i.url);
              return false;
            }
            return true;
          }) }
        : a)
      .filter((a) => a.items.length > 0);
    dropThumbnails(itemIds);
    set({ albums });
  },
};

const SERVER_STATE: State = { albums: [], scanning: false, scanned: false };

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((x) => x !== cb); };
}

export function useDeviceScan<T>(sel: (s: State) => T): T {
  return useStableStoreSelector(subscribe, () => state, () => SERVER_STATE, sel);
}
