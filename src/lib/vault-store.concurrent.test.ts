import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCrypto = vi.hoisted(() => ({
  init: vi.fn(),
  unlock: vi.fn(),
  rewrap: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("./crypto", () => ({
  initVaultSecrets: mockCrypto.init,
  unlockVault: mockCrypto.unlock,
  rewrapWithNewPassword: mockCrypto.rewrap,
  encryptBytes: mockCrypto.encrypt,
  decryptBytes: mockCrypto.decrypt,
}));

const secrets = {
  salt: "salt", iterations: 210000, wrappedKey: "wrapped",
  wrapIv: "wrapIv", verifier: "verifier", verifierIv: "verifierIv",
};
const fileKey = {} as CryptoKey;

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  localStorage.clear();
  mockCrypto.init.mockResolvedValue({ secrets, fileKey });
});

async function unlockedVault() {
  const { vault } = await import("./vault-store");
  await vault.setInitialPassword("correct");
  return vault;
}

describe("real Safe operations reject stale crypto results", () => {
  it("invalidates a previously authorized media operation on lock and re-unlock", async () => {
    const vault = await unlockedVault();
    const token = vault.captureAccessToken();
    expect(token).not.toBeNull();
    expect(vault.isAccessTokenCurrent(token)).toBe(true);
    vault.lock();
    expect(vault.isAccessTokenCurrent(token)).toBe(false);
    mockCrypto.unlock.mockResolvedValue(fileKey);
    expect(await vault.verifyPassword("correct")).toBe(true);
    expect(vault.isAccessTokenCurrent(token)).toBe(false);
    expect(vault.isAccessTokenCurrent(vault.captureAccessToken())).toBe(true);
  });
  it("cannot finish a pending password verification after the Safe locks", async () => {
    const vault = await unlockedVault();
    vault.lock();
    let finish!: (key: CryptoKey) => void;
    mockCrypto.unlock.mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    }));
    const pending = vault.verifyPassword("correct");
    vault.lock();
    finish(fileKey);
    expect(await pending).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });

  it("does not expose a decrypted file when the Safe locks mid-preview", async () => {
    const vault = await unlockedVault();
    let finish!: (bytes: Uint8Array) => void;
    mockCrypto.decrypt.mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    }));
    mockCrypto.encrypt.mockResolvedValue({ iv: "iv", cipher: "ciphertext" });
    const folder = vault.createFolder("Private");
    await vault.addFiles(folder, [{
      name: "photo.jpg", size: 3, type: "image/jpeg",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File]);
    const saved = JSON.parse(localStorage.getItem("vault.store.v3") || "{}");
    const pending = vault.decryptFile(saved.folders[0].files[0]);
    vault.lock();
    finish(new Uint8Array([1, 2, 3]));
    await expect(pending).rejects.toThrow("locked");
  });

  it("refuses deletion or metadata changes while locked", async () => {
    const vault = await unlockedVault();
    const id = vault.createFolder("Family");
    vault.lock();
    const original = localStorage.getItem("vault.store.v3");
    expect(() => vault.createFolder("Blocked")).toThrow("locked");
    expect(() => vault.renameFolder(id, "Blocked")).toThrow("locked");
    expect(() => vault.deleteFolder(id)).toThrow("locked");
    expect(() => vault.deleteFile(id, "file")).toThrow("locked");
    expect(localStorage.getItem("vault.store.v3")).toBe(original);
  });

  it("stops reading the remaining large files after a lock mid-import", async () => {
    const vault = await unlockedVault();
    const folder = vault.createFolder("Private");
    let finish!: (bytes: ArrayBuffer) => void;
    const nextRead = vi.fn(async () => new Uint8Array([4, 5, 6]).buffer);
    const first = { name: "first.jpg", type: "image/jpeg", size: 3,
      arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) } as File;
    const second = { name: "second.mp4", type: "video/mp4", size: 3,
      arrayBuffer: nextRead } as File;
    const pending = vault.addFiles(folder, [first, second]);
    // The first file's read is suspended, so there is no need to process
    // the second file after a lock.
    vault.lock();
    finish(new Uint8Array([1, 2, 3]).buffer);
    await expect(pending).rejects.toThrow("locked");
    expect(nextRead).not.toHaveBeenCalled();
    expect(mockCrypto.encrypt).not.toHaveBeenCalled();
    const persisted = JSON.parse(localStorage.getItem("vault.store.v3") || "{}");
    expect(persisted.folders[0].files).toEqual([]);
  });

  it("does not encrypt the second item if the Safe locks during the first encryption", async () => {
    const vault = await unlockedVault();
    const folder = vault.createFolder("Private");
    let finish!: (payload: { iv: string; cipher: string }) => void;
    mockCrypto.encrypt.mockImplementationOnce(() => new Promise(resolve => {
      finish = resolve;
    }));
    const secondRead = vi.fn(async () => new Uint8Array([4, 5, 6]).buffer);
    const makeFile = (name: string, read: () => Promise<ArrayBuffer>) =>
      ({ name, type: "image/jpeg", size: 3, arrayBuffer: read }) as File;
    const pending = vault.addFiles(folder, [
      makeFile("one.jpg", async () => new Uint8Array([1, 2, 3]).buffer),
      makeFile("two.jpg", secondRead),
    ]);
    await Promise.resolve();
    vault.lock();
    finish({ iv: "nonce", cipher: "encrypted" });
    await expect(pending).rejects.toThrow("locked");
    expect(secondRead).not.toHaveBeenCalled();
    const persisted = JSON.parse(localStorage.getItem("vault.store.v3") || "{}");
    expect(persisted.folders[0].files).toEqual([]);
  });

  it("does not commit an import that finishes after locking", async () => {
    const vault = await unlockedVault();
    const folder = vault.createFolder("Private");
    let finish!: (result: { iv: string; cipher: string }) => void;
    mockCrypto.encrypt.mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    }));
    const file = {
      name: "photo.jpg", type: "image/jpeg", size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File;
    const pending = vault.addFiles(folder, [file]);
    await Promise.resolve();
    vault.lock();
    finish({ iv: "nonce", cipher: "encrypted" });
    await expect(pending).rejects.toThrow("locked");
    const saved = JSON.parse(localStorage.getItem("vault.store.v3") || "{}");
    expect(saved.folders[0].files).toEqual([]);
  });
  it("protects a restored encrypted file and its folder until the native write completes", async () => {
    mockCrypto.encrypt.mockResolvedValue({ iv: "iv", cipher: "ciphertext" });
    const vault = await unlockedVault();
    const folderId = vault.createFolder("Trips");
    await vault.addFiles(folderId, [{
      name: "trip.jpg", size: 3, type: "image/jpeg",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as File]);
    const stored = JSON.parse(localStorage.getItem("vault.store.v3") || "{}");
    const fileId = stored.folders[0].files[0].id as string;
    const before = localStorage.getItem("vault.store.v3");
    const release = vault.beginFileRestore(folderId, fileId);
    expect(() => vault.beginFileRestore(folderId, fileId)).toThrow("already being restored");
    expect(() => vault.deleteFile(folderId, fileId)).toThrow("being restored");
    expect(() => vault.deleteFolder(folderId)).toThrow("being restored");
    expect(localStorage.getItem("vault.store.v3")).toBe(before);
    release();
    release(); // finally cleanup must be safe even if called twice
    vault.deleteFile(folderId, fileId);
    expect(JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files).toEqual([]);
  });

  it("allows cancelling a pending Safe restore after a lock without deleting the original", async () => {
    mockCrypto.encrypt.mockResolvedValue({ iv: "iv", cipher: "ciphertext" });
    const vault = await unlockedVault();
    const folderId = vault.createFolder("Private");
    await vault.addFiles(folderId, [{
      name: "movie.mp4", size: 2, type: "video/mp4",
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
    } as File]);
    const fileId = JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files[0].id;
    const release = vault.beginFileRestore(folderId, fileId);
    vault.lock();
    expect(() => vault.deleteFile(folderId, fileId)).toThrow("locked");
    release();
    mockCrypto.unlock.mockResolvedValue(fileKey);
    expect(await vault.verifyPassword("correct")).toBe(true);
    expect(JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files).toHaveLength(1);
  });

  it("does not delete the destination while two encrypted imports are active", async () => {
    const vault = await unlockedVault();
    const id = vault.createFolder("Family");
    let finishFirst!: (bytes: ArrayBuffer) => void;
    let finishSecond!: (bytes: ArrayBuffer) => void;
    mockCrypto.encrypt.mockResolvedValue({ iv: "iv", cipher: "encrypted" });
    const media = (name: string, save: (f: (bytes: ArrayBuffer) => void) => void) =>
      ({ name, type: "image/jpeg", size: 3,
        arrayBuffer: () => new Promise<ArrayBuffer>(resolve => save(resolve)) }) as File;
    const one = vault.addFiles(id, [media("one.jpg", f => { finishFirst = f; })]);
    const two = vault.addFiles(id, [media("two.jpg", f => { finishSecond = f; })]);
    expect(() => vault.deleteFolder(id)).toThrow("being imported");
    finishFirst(new Uint8Array([1,2,3]).buffer);
    await one;
    expect(() => vault.deleteFolder(id)).toThrow("being imported");
    finishSecond(new Uint8Array([4,5,6]).buffer);
    await two;
    expect(JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files).toHaveLength(2);
    vault.deleteFolder(id);
    expect(JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders).toEqual([]);
  });
  it("allows deleting a Safe folder after a failed encrypted import", async () => {
    const vault = await unlockedVault();
    const id = vault.createFolder("Retry");
    mockCrypto.encrypt.mockRejectedValueOnce(new Error("cipher error"));
    const media = { name: "bad.jpg", type: "image/jpeg", size: 1,
      arrayBuffer: async () => new Uint8Array([7]).buffer } as File;
    await expect(vault.addFiles(id, [media])).rejects.toThrow("cipher error");
    vault.deleteFolder(id);
    expect(JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders).toEqual([]);
  });

  it("does not expose plaintext after another view deletes its Safe file", async () => {
    mockCrypto.encrypt.mockResolvedValue({ iv: "iv", cipher: "ciphertext" });
    const vault = await unlockedVault();
    const folder = vault.createFolder("Private");
    await vault.addFiles(folder, [{
      name: "secret.jpg", type: "image/jpeg", size: 2,
      arrayBuffer: async () => new Uint8Array([4,5]).buffer,
    } as File]);
    const file = JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files[0];
    let release!: (bytes: Uint8Array) => void;
    mockCrypto.decrypt.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const preview = vault.decryptFile(file);
    vault.deleteFile(folder, file.id);
    release(new Uint8Array([4,5]));
    await expect(preview).rejects.toThrow("no longer exists");
    expect(JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files).toEqual([]);
  });

  it("refuses forged and deleted Safe references without decrypting anything", async () => {
    mockCrypto.encrypt.mockResolvedValue({ iv: "iv", cipher: "ciphertext" });
    const vault = await unlockedVault();
    const folder = vault.createFolder("Private");
    await vault.addFiles(folder, [{
      name: "private.jpg", type: "image/jpeg", size: 2,
      arrayBuffer: async () => new Uint8Array([4,5]).buffer,
    } as File]);
    const file = JSON.parse(localStorage.getItem("vault.store.v3") || "{}").folders[0].files[0];
    await expect(vault.decryptFile({ ...file, iv: "forged" })).rejects.toThrow("no longer exists");
    vault.deleteFile(folder, file.id);
    await expect(vault.decryptFile(file)).rejects.toThrow("no longer exists");
    expect(mockCrypto.decrypt).not.toHaveBeenCalled();
  });

});
