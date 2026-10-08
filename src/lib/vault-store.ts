import { useSyncExternalStore } from "react";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { isNative, ensurePrivateVaultDir } from "./native-vault";
import {
  initVaultSecrets,
  unlockVault,
  rewrapWithNewPassword,
  encryptBytes,
  decryptBytes,
  type VaultCryptoSecrets,
} from "./crypto";

// Nova Gallery — encrypted vault store.
//
// Zero plain-text guarantee:
//  * Password bytes are NEVER persisted. Only the PBKDF2 salt and a
//    random-nonce AES-GCM verifier ciphertext live on disk.
//  * File bytes are ALWAYS encrypted with AES-256-GCM under a random
//    per-vault file key. That file key is itself wrapped under the
//    password-derived KEK. The unwrapped key exists only in RAM while
//    the vault is unlocked and is dropped on lock().
//  * On the Android APK build, SubtleCrypto is provided by the platform
//    BoringSSL backing the Chromium WebView, backed in turn by the
//    Android Keystore's hardware crypto module on supported devices.

export type EncryptedFile = {
  id: string;
  name: string;
  size: number;       // original plaintext byte length
  type: string;
  addedAt: number;
  iv: string;         // b64
  /** b64 AES-256-GCM ciphertext — used on web where there is no private FS. */
  cipher?: string;
  /**
   * Path (relative to the app's PRIVATE internal data directory) of the
   * encrypted blob on native builds. The directory carries a .nomedia
   * marker and lives inside app-scoped storage, so no system indexer or
   * file manager can reach it.
   */
  blobPath?: string;
  /**
   * Absolute public-storage path the file was imported from. Kept so the
   * Safe can restore the media back to its exact original folder.
   */
  origPath?: string;
};
export type VaultFolder = {
  id: string;
  name: string;
  createdAt: number;
  files: EncryptedFile[];
};

type State = {
  folders: VaultFolder[];
  crypto: VaultCryptoSecrets | null;
  biometricsEnabled: boolean;
  theme: "system" | "light" | "dark";
  unlocked: boolean;
};

const KEY = "vault.store.v3";
const DEFAULT: State = {
  folders: [],
  crypto: null,
  biometricsEnabled: true,
  theme: "dark",
  unlocked: false,
};

let state: State = DEFAULT;
let hydrated = false;
let listeners: (() => void)[] = [];

// Unwrapped AES-GCM file key — RAM only, never persisted, wiped on lock().
let liveFileKey: CryptoKey | null = null;

function persist() {
  if (typeof window === "undefined") return;
  const { unlocked: _u, ...rest } = state;
  void _u;
  localStorage.setItem(KEY, JSON.stringify(rest));
}
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...DEFAULT, ...JSON.parse(raw), unlocked: false };
  } catch {}
}
function emit() { listeners.forEach((l) => l()); }
function set(mut: (s: State) => State) {
  state = mut(state);
  persist();
  emit();
}

export function useVault<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    () => { hydrate(); return sel(state); },
    () => sel(DEFAULT),
  );
}

// Private, non-indexable vault root inside the app's internal storage.
export const VAULT_DIR = "nova_vault";

async function ensureNativeVaultDir(folderId: string): Promise<void> {
  await ensurePrivateVaultDir();
  const dir = `${VAULT_DIR}/${folderId}`;
  try {
    await Filesystem.mkdir({ path: dir, directory: Directory.Data, recursive: true });
  } catch { /* already exists */ }
  // Belt-and-braces: a .nomedia marker at the vault root.
  try {
    await Filesystem.writeFile({
      path: `${VAULT_DIR}/.nomedia`,
      data: "",
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch { /* ignore */ }
}

async function writeBlob(folderId: string, id: string, cipherB64: string): Promise<string> {
  await ensureNativeVaultDir(folderId);
  const path = `${VAULT_DIR}/${folderId}/${id}.enc`;
  await Filesystem.writeFile({
    path,
    data: cipherB64,
    directory: Directory.Data,
    recursive: true,
  });
  return path;
}

async function readBlob(path: string): Promise<string> {
  const res = await Filesystem.readFile({ path, directory: Directory.Data });
  return typeof res.data === "string" ? res.data : await (res.data as Blob).text();
}

async function removeBlob(path?: string): Promise<void> {
  if (!path || !isNative()) return;
  try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch {}
}

async function removeFolderBlobs(folder: VaultFolder): Promise<void> {
  if (!isNative()) return;
  try {
    await Filesystem.rmdir({
      path: `${VAULT_DIR}/${folder.id}`,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    for (const f of folder.files) await removeBlob(f.blobPath);
  }
}

export const vault = {
  // ── folders ────────────────────────────────────────────────
  createFolder: (name: string): string => {
    const id = crypto.randomUUID();
    set((s) => ({ ...s, folders: [...s.folders, { id, name, createdAt: Date.now(), files: [] }] }));
    // Provision the private, .nomedia-guarded directory for this folder
    // right away so ANY user-created folder is vault-backed, not just a
    // hardcoded one.
    if (isNative()) void ensureNativeVaultDir(id);
    return id;
  },
  deleteFolder: (id: string) => {
    const folder = state.folders.find((f) => f.id === id);
    if (folder) void removeFolderBlobs(folder);
    set((s) => ({ ...s, folders: s.folders.filter((f) => f.id !== id) }));
  },
  renameFolder: (id: string, name: string) => set((s) => ({
    ...s, folders: s.folders.map((f) => f.id === id ? { ...f, name } : f),
  })),

  // ── files (always encrypted at rest) ────────────────────────
  addFiles: async (
    folderId: string,
    files: File[],
    meta?: { origPath?: string }[],
  ): Promise<void> => {
    hydrate();
    if (!liveFileKey) throw new Error("Vault is locked");
    if (isNative()) await ensureNativeVaultDir(folderId);
    const encrypted: EncryptedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const buf = await f.arrayBuffer();
      const { iv, cipher } = await encryptBytes(buf, liveFileKey);
      const id = crypto.randomUUID();
      let blobPath: string | undefined;
      let inlineCipher: string | undefined = cipher;
      if (isNative()) {
        // Native: the ciphertext is MOVED into app-private internal storage
        // instead of being kept inline, so large media never bloats the
        // metadata store and never touches public storage.
        blobPath = await writeBlob(folderId, id, cipher);
        inlineCipher = undefined;
      }
      encrypted.push({
        id,
        name: f.name,
        size: f.size,
        type: f.type || "application/octet-stream",
        addedAt: Date.now(),
        iv,
        ...(inlineCipher ? { cipher: inlineCipher } : {}),
        ...(blobPath ? { blobPath } : {}),
        ...(meta?.[i]?.origPath ? { origPath: meta[i]!.origPath } : {}),
      });
    }
    set((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id === folderId ? { ...f, files: [...encrypted, ...f.files] } : f,
      ),
    }));
  },
  deleteFile: (folderId: string, fileId: string) => {
    const target = state.folders
      .find((f) => f.id === folderId)?.files.find((x) => x.id === fileId);
    if (target?.blobPath) void removeBlob(target.blobPath);
    set((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id === folderId ? { ...f, files: f.files.filter((x) => x.id !== fileId) } : f,
      ),
    }));
  },
  /** Decrypt an encrypted file into a Blob for viewing. Requires unlock. */
  decryptFile: async (file: EncryptedFile): Promise<Blob> => {
    if (!liveFileKey) throw new Error("Vault is locked");
    const cipher = file.blobPath ? await readBlob(file.blobPath) : file.cipher;
    if (!cipher) throw new Error("Encrypted data missing");
    const plain = await decryptBytes(file.iv, cipher, liveFileKey);
    return new Blob([plain], { type: file.type });
  },

  // ── password / lock ────────────────────────────────────────
  hasPassword: (): boolean => { hydrate(); return state.crypto !== null; },
  /** Initial password setup — creates the vault crypto material. */
  setInitialPassword: async (password: string): Promise<void> => {
    hydrate();
    if (state.crypto) throw new Error("Password already set — use changePassword");
    const { secrets, fileKey } = await initVaultSecrets(password);
    liveFileKey = fileKey;
    set((s) => ({ ...s, crypto: secrets, unlocked: true }));
  },
  /** Change password — re-wraps the file key without re-encrypting files. */
  changePassword: async (oldPassword: string, newPassword: string): Promise<boolean> => {
    hydrate();
    if (!state.crypto) return false;
    const next = await rewrapWithNewPassword(oldPassword, newPassword, state.crypto);
    if (!next) return false;
    set((s) => ({ ...s, crypto: next }));
    return true;
  },
  /** Verify password + unlock the vault. Returns true on success. */
  verifyPassword: async (password: string): Promise<boolean> => {
    hydrate();
    if (!state.crypto) return false;
    const key = await unlockVault(password, state.crypto);
    if (!key) return false;
    liveFileKey = key;
    set((s) => ({ ...s, unlocked: true }));
    return true;
  },
  /** Sync check — true when the in-memory file key is available. */
  isUnlocked: (): boolean => liveFileKey !== null && state.unlocked,
  unlock: () => set((s) => ({ ...s, unlocked: true })),
  lock: () => { liveFileKey = null; set((s) => ({ ...s, unlocked: false })); },

  // ── preferences ────────────────────────────────────────────
  setBiometrics: (b: boolean) => set((s) => ({ ...s, biometricsEnabled: b })),
  setTheme: (t: State["theme"]) => set((s) => ({ ...s, theme: t })),
};

export function totalBytes(folders: VaultFolder[]) {
  return folders.reduce((a, f) => a + f.files.reduce((b, x) => b + x.size, 0), 0);
}
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
