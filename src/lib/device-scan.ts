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

import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";

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
};

let state: State = { albums: [], scanning: false, scanned: false };
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
const guessMime = guessMimeFromName;

/**
 * Lazily materialise a native-scanned item into a real `File` object.
 * Reads the underlying bytes through @capacitor/filesystem exactly once.
 */
export async function materializeFile(item: ScannedItem): Promise<File> {
  if (item.file) return item.file;
  if (!item.nativeUri) {
    throw new Error("Cannot read this file — no native URI available");
  }
  const res = await Filesystem.readFile({ path: item.nativeUri });
  const bin = atob(String(res.data));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const mime = guessMime(item.name);
  const file = new File([arr], item.name, { type: mime, lastModified: item.mtime });
  // Cache so repeated share / add operations don't re-read the file.
  (item as { file: File | null }).file = file;
  return file;
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

function group(items: { item: ScannedItem; path: string }[]): ScannedAlbum[] {
  const map = new Map<string, ScannedItem[]>();
  for (const { item, path } of items) {
    const key = albumKey(path);
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  const out: ScannedAlbum[] = [];
  for (const [name, arr] of map) {
    arr.sort((a, b) => b.mtime - a.mtime);
    out.push({ id: name.toLowerCase().replace(/\s+/g, "-"), name, items: arr });
  }
  out.sort((a, b) => b.items.length - a.items.length);
  return out;
}

function revokeAll() {
  for (const a of state.albums) for (const i of a.items) URL.revokeObjectURL(i.url);
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
  try {
    const collected: { item: ScannedItem; path: string }[] = [];
    await walkDir(handle, handle.name, collected);
    const nextIds = new Set(collected.map((c) => c.item.id));
    const currentIds = new Set(state.albums.flatMap((a) => a.items.map((i) => i.id)));
    const changed =
      nextIds.size !== currentIds.size ||
      [...nextIds].some((id) => !currentIds.has(id));
    if (changed) {
      revokeAll();
      set({ albums: group(collected), scanned: true });
    }
  } finally {
    rescanInFlight = false;
    if (rescanQueued) {
      rescanQueued = false;
      void rescanHandle(handle);
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
      void obs.observe(handle, { recursive: true });
      fsObserver = obs;
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
  await walkDir(root, root.name, collected);
  revokeAll();
  set({ albums: group(collected), scanning: false, scanned: true });
  startWatch(root);
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
      if (files.length === 0) { resolve(); return; }
      set({ scanning: true });
      await new Promise((r) => setTimeout(r, 0));
      const collected: { item: ScannedItem; path: string }[] = [];
      for (const f of files) {
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const item = toItem(f, path);
        if (item) collected.push({ item, path });
      }
      revokeAll();
      set({ albums: group(collected), scanning: false, scanned: true });
      document.body.removeChild(input);
      resolve();
    };
    input.oncancel = () => { document.body.removeChild(input); resolve(); };
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

async function walkNative(
  path: string,
  out: { item: ScannedItem; path: string }[],
): Promise<void> {
  let entries: NativeFileEntry[] = [];
  try {
    const res = await Filesystem.readdir({
      path,
      directory: Directory.ExternalStorage,
    });
    entries = res.files as unknown as NativeFileEntry[];
  } catch {
    return; // permission denied or folder missing — skip silently
  }
  for (const entry of entries) {
    const childPath = `${path}/${entry.name}`;
    if (entry.type === "directory") {
      // Skip Android system junk folders that never contain user media.
      if (entry.name.startsWith(".")) continue;
      await walkNative(childPath, out);
      continue;
    }
    const isImg = IMG.test(entry.name);
    const isVid = VID.test(entry.name);
    if (!isImg && !isVid) continue;
    let uri = entry.uri;
    if (!uri) {
      try {
        const g = await Filesystem.getUri({
          path: childPath,
          directory: Directory.ExternalStorage,
        });
        uri = g.uri;
      } catch {
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
    out.push({ item, path: childPath });
  }
}

async function scanNative(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  if (state.scanning) return true;
  set({ scanning: true });
  const roots = ["DCIM", "Pictures", "Movies", "Download", "Documents"];
  const collected: { item: ScannedItem; path: string }[] = [];
  for (const root of roots) {
    await walkNative(root, collected);
  }
  set({ albums: group(collected), scanning: false, scanned: true });
  return true;
}

export const deviceScan = {
  async scan() {
    if (state.scanning) return;
    // Native Android — read MediaStore-visible folders directly.
    if (await scanNative()) return;
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
    const norm = (p: string) => p.replace(/^file:\/\//, "");
    const set$ = new Set(paths.map(norm));
    const hit = (i: ScannedItem) =>
      set$.has(norm(i.nativeUri ?? "")) ||
      set$.has(norm(i.path)) ||
      [...set$].some((p) => p.endsWith(`/${i.path}`));
    const albums = state.albums
      .map((a) => ({
        ...a,
        items: a.items.filter((i) => {
          if (!hit(i)) return true;
          if (i.url.startsWith("blob:")) URL.revokeObjectURL(i.url);
          return false;
        }),
      }))
      .filter((a) => a.items.length > 0);
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
    set({ albums });
  },
};

const SERVER_STATE: State = { albums: [], scanning: false, scanned: false };

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((x) => x !== cb); };
}

export function useDeviceScan<T>(sel: (s: State) => T): T {
  // Cache the last (state, result) pair per-hook-instance so
  // useSyncExternalStore sees a stable snapshot between store emits.
  const cacheRef = { current: null as null | { state: State; value: T } };
  const getClient = () => {
    const c = cacheRef.current;
    if (c && c.state === state) return c.value;
    const value = sel(state);
    cacheRef.current = { state, value };
    return value;
  };
  const serverCache = { current: null as null | T };
  const getServer = () => {
    if (serverCache.current === null) serverCache.current = sel(SERVER_STATE);
    return serverCache.current;
  };
  return useSyncExternalStore(subscribe, getClient, getServer);
}
