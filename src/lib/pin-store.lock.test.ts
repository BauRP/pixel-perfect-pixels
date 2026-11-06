import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVault = vi.hoisted(() => ({ lock: vi.fn() }));
vi.mock("./vault-store", () => ({ vault: mockVault }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
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
});
