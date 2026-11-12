import { act, renderHook } from "@testing-library/react";
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
  vi.resetModules();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mockCrypto.init.mockResolvedValue({ secrets, fileKey });
  mockCrypto.unlock.mockResolvedValue(fileKey);
});

describe("Safe PIN session must have a live AES key", () => {
  it("rejects stale unlocked sessionStorage after WebView process recreation", async () => {
    sessionStorage.setItem("vault.safe.unlocked.session", "1");
    const { safePin } = await import("./pin-store");
    expect(safePin.isUnlocked()).toBe(false);
  });

  it("reactively unlocks UI only after both PIN and encrypted vault are ready", async () => {
    const { vault } = await import("./vault-store");
    const { safePin, useSafePin } = await import("./pin-store");
    const { result, unmount } = renderHook(() => useSafePin());
    expect(result.current.unlocked).toBe(false);
    await act(async () => { await vault.setInitialPassword("1234"); });
    expect(result.current.unlocked).toBe(false);
    await act(async () => { await safePin.setPin("1234"); });
    expect(result.current.unlocked).toBe(true);
    act(() => { vault.lock(); });
    expect(result.current.unlocked).toBe(false);
    expect(safePin.isUnlocked()).toBe(false);
    unmount();
  });

  it("does not reopen Safe with an old session marker before PBKDF2 unlock finishes", async () => {
    const { vault } = await import("./vault-store");
    const { safePin, useSafePin } = await import("./pin-store");
    await vault.setInitialPassword("1234");
    await safePin.setPin("1234");
    safePin.lock();
    sessionStorage.setItem("vault.safe.unlocked.session", "1");
    const { result, unmount } = renderHook(() => useSafePin());
    expect(result.current.unlocked).toBe(false);
    await act(async () => { await vault.verifyPassword("1234"); });
    expect(result.current.unlocked).toBe(true);
    unmount();
  });
});
