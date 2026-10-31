// Bridge to the native SecureVault Android plugin.
//
// Responsibilities on the native side:
//   • ensurePrivateDir()      — creates <internal>/nova_vault + .nomedia so the
//                               encrypted blobs can never be indexed by the
//                               Android MediaStore or seen by file managers.
//   • hasAllFilesAccess()     — reports MANAGE_EXTERNAL_STORAGE status.
//   • requestAllFilesAccess() — opens the system grant screen.
//   • deleteOriginals()       — permanently removes the original media from
//                               public storage (file + MediaStore row). On
//                               Android 11+ without all-files access it falls
//                               back to a single MediaStore delete request
//                               dialog covering the whole batch.

import { registerPlugin, Capacitor } from "@capacitor/core";

export type MediaPermissionState = "granted" | "partial" | "denied" | "prompt";
export type DeleteResult = { deleted: string[]; failed: string[] };

export interface SecureVaultPlugin {
  ensurePrivateDir(): Promise<{ path: string; nomedia: boolean }>;
  checkMediaPermission(): Promise<{ state: MediaPermissionState }>;
  requestMediaPermission(): Promise<{ state: MediaPermissionState }>;
  getMediaItems(): Promise<{ items: { uri: string; name: string; mime: string;
    size: number; mtime: number; relativePath: string }[] }>;
  hasAllFilesAccess(): Promise<{ granted: boolean }>;
  requestAllFilesAccess(): Promise<{ granted: boolean }>;
  deleteOriginals(options: { paths: string[] }): Promise<DeleteResult>;
  setWallpaper(options: {
    path?: string; base64?: string; target?: "home" | "lock" | "both";
  }): Promise<{ success: boolean }>;
  saveImage(options: { base64: string; name?: string; mime?: string }): Promise<{ path: string }>;
  shareFile(options: {
    path?: string; base64?: string; name?: string; mime?: string; title?: string;
  }): Promise<{ success: boolean }>;
  restoreFile(options: {
    base64: string; name?: string; mime?: string; relativePath?: string;
  }): Promise<{ path: string }>;
}

const noop: SecureVaultPlugin = {
  async ensurePrivateDir() { return { path: "", nomedia: false }; },
  async checkMediaPermission() { return { state: "granted" as const }; },
  async requestMediaPermission() { return { state: "granted" as const }; },
  async getMediaItems() { return { items: [] }; },
  async hasAllFilesAccess() { return { granted: false }; },
  async requestAllFilesAccess() { return { granted: false }; },
  async deleteOriginals() { return { deleted: [], failed: [] }; },
  async setWallpaper() { return { success: false }; },
  async saveImage() { return { path: "" }; },
  async shareFile() { return { success: false }; },
  async restoreFile() { return { path: "" }; },
};

export const SecureVault: SecureVaultPlugin = Capacitor.isNativePlatform()
  ? registerPlugin<SecureVaultPlugin>("SecureVault")
  : noop;

export const isNative = () => Capacitor.isNativePlatform();

/** Make sure the private (non-indexable) vault directory exists. */
export async function ensurePrivateVaultDir(): Promise<void> {
  if (!isNative()) return;
  try { await SecureVault.ensurePrivateDir(); } catch { /* best effort */ }
}

/**
 * Ask for MANAGE_EXTERNAL_STORAGE once so originals can be deleted without a
 * per-batch confirmation dialog. Returns the current grant state; a `false`
 * result is NOT fatal — deleteOriginals() then routes through the system
 * MediaStore delete request instead.
 */
export async function ensureDeletePermission(): Promise<boolean> {
  // Prefer scoped MediaStore user confirmation; never request unrestricted
  // filesystem access just to move an image into the private Safe.
  return false;
}

/** Permanently delete the given public-storage files. */
export async function deleteOriginals(paths: string[]): Promise<DeleteResult> {
  if (!isNative() || paths.length === 0) return { deleted: [], failed: paths };
  try {
    return await SecureVault.deleteOriginals({ paths });
  } catch {
    return { deleted: [], failed: paths };
  }
}

/**
 * Set an image as the device wallpaper. Pass a native path/URI, or raw base64
 * bytes when the picture has been edited in-app.
 */
export async function setWallpaper(opts: {
  path?: string; base64?: string; target?: "home" | "lock" | "both";
}): Promise<boolean> {
  if (!isNative()) return false;
  const res = await SecureVault.setWallpaper(opts);
  return !!res.success;
}

/**
 * Robust wallpaper application.
 *
 * Tries the on-device path first (cheapest — the native side decodes and
 * downsamples off the UI thread). If that fails for any reason (SAF-only
 * URI, missing read permission, unsupported codec), it falls back to raw
 * base64 bytes supplied by the caller. Never throws.
 */
export async function setWallpaperSafely(opts: {
  path?: string;
  target?: "home" | "lock" | "both";
  /** Lazily produces raw base64 bytes for the fallback attempt. */
  getBase64?: () => Promise<string>;
}): Promise<boolean> {
  if (!isNative()) return false;
  const target = opts.target ?? "both";
  if (opts.path) {
    try {
      const res = await SecureVault.setWallpaper({ path: opts.path, target });
      if (res?.success) return true;
    } catch { /* fall through to the base64 attempt */ }
  }
  if (opts.getBase64) {
    try {
      const base64 = await opts.getBase64();
      const res = await SecureVault.setWallpaper({ base64, target });
      return !!res?.success;
    } catch { return false; }
  }
  return false;
}

/** Persist an edited image (base64) into public storage; returns its path. */
export async function saveEditedImage(
  base64: string, name: string, mime = "image/jpeg",
): Promise<string> {
  if (!isNative()) return "";
  const res = await SecureVault.saveImage({ base64, name, mime });
  return res.path;
}

/**
 * Open the native Android share sheet. Accepts either an on-device path or
 * raw base64 bytes (used for decrypted Safe media, which has no plaintext
 * file on disk).
 */
export async function shareNative(opts: {
  path?: string; base64?: string; name?: string; mime?: string; title?: string;
}): Promise<boolean> {
  if (!isNative()) return false;
  const res = await SecureVault.shareFile(opts);
  return !!res.success;
}

/**
 * Write decrypted bytes back into public storage at their original relative
 * folder (e.g. "DCIM/Camera") and re-register them with the MediaStore.
 */
export async function restoreToPublic(opts: {
  base64: string; name: string; mime: string; relativePath?: string;
}): Promise<string> {
  if (!isNative()) return "";
  const res = await SecureVault.restoreFile(opts);
  return res.path;
}
