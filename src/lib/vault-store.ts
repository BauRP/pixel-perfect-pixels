import { useSyncExternalStore } from "react";
import { commitStateAfterPersistence, parseVaultMetadata, isSafeVaultId, isSafeVaultBlobPath } from "./vault-transaction";
import { createSecureId } from "./secure-id";
import { isSafeOperationCurrent } from "./vault-lifecycle";
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
  biometricsEnabled: false,
  theme: "dark",
  unlocked: false,
};

let state: State = DEFAULT;
let hydrated = false;
// Preserve any unreadable encrypted Safe index instead of overwriting it.
let hydrationError: Error | null = null;
let listeners: (() => void)[] = [];

// Unwrapped AES-GCM file key — RAM only, never persisted, wiped on lock().
let liveFileKey: CryptoKey | null = null;
// Any lock, unlock or password update invalidates pending async operations.
// Never allow a completed PBKDF2/decrypt request to reopen a locked Safe.
let keyEpoch = 0;

function persist(next: State) {
  if (typeof window === "undefined") return;
  const { unlocked: _u, ...rest } = next;
  void _u;
  localStorage.setItem(KEY, JSON.stringify(rest));
}
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = parseVaultMetadata(raw, DEFAULT);
  } catch {
    // No raw metadata or private filenames in the diagnostic message.
    hydrationError = new Error("Safe metadata could not be read; changes are blocked to protect your files");
  }
}
function emit() { listeners.forEach((l) => l()); }
function set(mut: (s: State) => State) {
  // Always load existing metadata even when the first action happens
  // before any React component subscribes to the store.
  hydrate();
  if (hydrationError) throw hydrationError;
  // An Android WebView can reject localStorage writes (quota, I/O, browser
  // profile trouble). Never publish a mutation unless its metadata was
  // durably persisted. Otherwise deletion can erase ciphertext while the
  // old index still references it after a restart.
  state = commitStateAfterPersistence(state, mut, persist);
  emit();
}
function setTransient(mut: (s: State) => State) {
  // Only the unlocked flag is changed. It is deliberately NEVER saved
  // to disk; locking must work even when localStorage is unavailable.
  hydrate();
  state = mut(state);
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
  if (!isSafeVaultBlobPath(path)) throw new Error("Unsafe Safe encrypted file path");
  const res = await Filesystem.readFile({ path, directory: Directory.Data });
  return typeof res.data === "string" ? res.data : await (res.data as Blob).text();
}

async function removeBlob(path?: string): Promise<void> {
  if (!isSafeVaultBlobPath(path) || !isNative()) return;
  try { await Filesystem.deleteFile({ path, directory: Directory.Data }); } catch {}
}

async function removeFolderBlobs(folder: VaultFolder): Promise<void> {
  if (!isNative() || !isSafeVaultId(folder.id)) return;
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
    const id = createSecureId();
    set((s) => ({ ...s, folders: [...s.folders, { id, name, createdAt: Date.now(), files: [] }] }));
    // Provision the private, .nomedia-guarded directory for this folder
    // right away so ANY user-created folder is vault-backed, not just a
    // hardcoded one.
    if (isNative()) void ensureNativeVaultDir(id);
    return id;
  },
  deleteFolder: (id: string) => {
    hydrate();
    const folder = state.folders.find((f) => f.id === id);
    if (!folder) return;
    // Commit the index first. On a storage failure the ciphertext remains
    // untouched and accessible, rather than permanently lost.
    set((s) => ({ ...s, folders: s.folders.filter((f) => f.id !== id) }));
    void removeFolderBlobs(folder);
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
    const importKey = liveFileKey;
    const importEpoch = keyEpoch;
    if (hydrationError) throw hydrationError;
    if (!importKey) throw new Error("Vault is locked");
    if (!state.folders.some((f) => f.id === folderId))
      throw new Error("Vault folder no longer exists");
    if (isNative()) await ensureNativeVaultDir(folderId);
    const encrypted: EncryptedFile[] = [];
    const writtenBlobs: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const buf = await f.arrayBuffer();
      const { iv, cipher } = await encryptBytes(buf, importKey);
      const id = createSecureId();
      let blobPath: string | undefined;
      let inlineCipher: string | undefined = cipher;
      if (isNative()) {
        // Native: the ciphertext is MOVED into app-private internal storage
        // instead of being kept inline, so large media never bloats the
        // metadata store and never touches public storage.
        blobPath = await writeBlob(folderId, id, cipher);
        writtenBlobs.push(blobPath);
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
      // Import may outlive a screen lock or password reset. Never commit
      // ciphertext from an operation that started with another RAM key.
      if (!isSafeOperationCurrent(importEpoch, keyEpoch) ||
          liveFileKey !== importKey || !state.unlocked)
        throw new Error("Vault was locked during import");
      // Folder deletion may have happened while we were encrypting or
      // awaiting the native filesystem. Do not orphan encrypted blobs.
      if (!state.folders.some((f) => f.id === folderId))
        throw new Error("Vault folder was removed during import");
      set((s) => ({
        ...s,
        folders: s.folders.map((f) =>
          f.id === folderId ? { ...f, files: [...encrypted, ...f.files] } : f,
        ),
      }));
    } catch (error) {
      // No metadata commit happened: safe to remove only this attempted
      // import's newly written ciphertext. Existing Safe files untouched.
      for (const blobPath of writtenBlobs) await removeBlob(blobPath);
      throw error;
    }
  },
  deleteFile: (folderId: string, fileId: string) => {
    hydrate();
    const target = state.folders
      .find((f) => f.id === folderId)?.files.find((x) => x.id === fileId);
    if (!target) return;
    set((s) => ({
      ...s,
      folders: s.folders.map((f) =>
        f.id === folderId ? { ...f, files: f.files.filter((x) => x.id !== fileId) } : f,
      ),
    }));
    if (target.blobPath) void removeBlob(target.blobPath);
  },
  /** Decrypt an encrypted file into a Blob for viewing. Requires unlock. */
  decryptFile: async (file: EncryptedFile): Promise<Blob> => {
    const key = liveFileKey;
    const epoch = keyEpoch;
    if (!key || !state.unlocked) throw new Error("Vault is locked");
    const cipher = file.blobPath ? await readBlob(file.blobPath) : file.cipher;
    if (!cipher) throw new Error("Encrypted data missing");
    if (!isSafeOperationCurrent(epoch, keyEpoch) || liveFileKey !== key ||
        !state.unlocked) throw new Error("Vault was locked during preview");
    const plain = await decryptBytes(file.iv, cipher, key);
    // A PIN lock while a slow video decrypt is in progress must not deliver
    // decrypted media to a screen that is no longer authorized to show it.
    if (!isSafeOperationCurrent(epoch, keyEpoch) || liveFileKey !== key ||
        !state.unlocked) throw new Error("Vault was locked during preview");
    return new Blob([plain], { type: file.type });
  },

  // ── password / lock ────────────────────────────────────────
  hasPassword: (): boolean => { hydrate(); return state.crypto !== null; },
  /** Initial password setup — creates the vault crypto material. */
  setInitialPassword: async (password: string): Promise<void> => {
    hydrate();
    if (hydrationError) throw hydrationError;
    if (state.crypto) throw new Error("Password already set — use changePassword");
    const startingEpoch = keyEpoch;
    const { secrets, fileKey } = await initVaultSecrets(password);
    if (!isSafeOperationCurrent(startingEpoch, keyEpoch) || state.crypto)
      throw new Error("Safe changed while setting the password");
    // If the new verifier/wrapped key cannot be persisted, do not leave
    // the Safe "unlocked" with an unpersisted password setup.
    const previousKey = liveFileKey;
    liveFileKey = fileKey;
    try {
      set((s) => ({ ...s, crypto: secrets, unlocked: true }));
      keyEpoch++;
    } catch (error) {
      liveFileKey = previousKey;
      throw error;
    }
  },
  /** Change password — re-wraps the file key without re-encrypting files. */
  changePassword: async (oldPassword: string, newPassword: string): Promise<boolean> => {
    hydrate();
    if (hydrationError) throw hydrationError;
    const originalCrypto = state.crypto;
    const epoch = keyEpoch;
    if (!originalCrypto) return false;
    const next = await rewrapWithNewPassword(oldPassword, newPassword, originalCrypto);
    if (!next || !isSafeOperationCurrent(epoch, keyEpoch, originalCrypto, state.crypto))
      return false;
    set((s) => ({ ...s, crypto: next }));
    keyEpoch++;
    return true;
  },
  /** Verify password + unlock the vault. Returns true on success. */
  verifyPassword: async (password: string): Promise<boolean> => {
    hydrate();
    if (hydrationError) throw hydrationError;
    const originalCrypto = state.crypto;
    const epoch = keyEpoch;
    if (!originalCrypto) return false;
    const key = await unlockVault(password, originalCrypto);
    if (!key || !isSafeOperationCurrent(epoch, keyEpoch, originalCrypto, state.crypto))
      return false;
    liveFileKey = key;
    keyEpoch++;
    setTransient((s) => ({ ...s, unlocked: true }));
    return true;
  },
  /** Sync check — true when the in-memory file key is available. */
  isUnlocked: (): boolean => liveFileKey !== null && state.unlocked,
  unlock: () => {
    // Never resurrect unlock state when the encryption key is absent.
    if (liveFileKey) setTransient((s) => ({ ...s, unlocked: true }));
  },
  lock: () => {
    // Locking invalidates *all* pending crypto operations, including unlock.
    keyEpoch++;
    liveFileKey = null;
    setTransient((s) => ({ ...s, unlocked: false }));
  },

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
