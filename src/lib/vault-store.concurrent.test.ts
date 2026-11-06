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
    const pending = vault.decryptFile({
      id: "photo", name: "photo.jpg", size: 3, type: "image/jpeg",
      addedAt: Date.now(), iv: "iv", cipher: "ciphertext",
    });
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
});
