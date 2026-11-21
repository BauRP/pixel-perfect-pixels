import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVault = vi.hoisted(() => ({ lock: vi.fn(), isUnlocked: vi.fn(() => false) }));
vi.mock("./vault-store", () => ({ vault: mockVault }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("locking the Safe also drops its encryption key", () => {
  it("locks crypto whenever the UI PIN is locked", async () => {
    const { safePin } = await import("./pin-store");
    safePin.lock();
    expect(mockVault.lock).toHaveBeenCalledTimes(1);
    expect(safePin.isUnlocked()).toBe(false);
  });

  it("invalidates crypto when resetting the UI PIN", async () => {
    const { safePin } = await import("./pin-store");
    safePin.reset();
    expect(mockVault.lock).toHaveBeenCalledTimes(1);
    expect(safePin.hasPin()).toBe(false);
    expect(safePin.isUnlocked()).toBe(false);
  });
  it("does not restore the PIN session after a pending verification is locked", async () => {
    const original = new ArrayBuffer(32);
    let resolveHash!: (digest: ArrayBuffer) => void;
    const digest = vi.fn()
      .mockResolvedValueOnce(original)
      .mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { resolveHash = resolve; }));
    vi.stubGlobal("crypto", {
      subtle: { digest },
      getRandomValues: (value: Uint8Array) => value,
    });
    const { safePin } = await import("./pin-store");
    await safePin.setPin("1234");
    const verification = safePin.verify("1234");
    safePin.lock();
    resolveHash(original);
    expect(await verification).toBe(false);
    expect(sessionStorage.getItem("vault.safe.unlocked.session")).toBeNull();
  });

  it("cannot persist a PIN update that completes after reset", async () => {
    let finish!: (digest: ArrayBuffer) => void;
    vi.stubGlobal("crypto", {
      subtle: { digest: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) },
      getRandomValues: (value: Uint8Array) => value,
    });
    const { safePin } = await import("./pin-store");
    const pending = safePin.setPin("5678");
    safePin.reset();
    finish(new ArrayBuffer(32));
    await expect(pending).rejects.toThrow("locked");
    expect(localStorage.getItem("vault.safe.pin.v1")).toBeNull();
  });

});
