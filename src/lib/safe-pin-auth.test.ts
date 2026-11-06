import { describe, expect, it, vi } from "vitest";
import { establishSafePin, unlockSafeWithPin } from "./safe-pin-auth";

function controls({ uiPassword = "1234", cryptoPassword = "1234",
  hasUi = true, hasCrypto = true }: {
  uiPassword?: string; cryptoPassword?: string;
  hasUi?: boolean; hasCrypto?: boolean;
} = {}) {
  let uiValue = hasUi ? uiPassword : "";
  let cryptoValue = hasCrypto ? cryptoPassword : "";
  let active = false;
  const ui = {
    verify: vi.fn(async (pin: string) => pin === uiValue && !!uiValue),
    setPin: vi.fn(async (pin: string) => { uiValue = pin; }),
    lock: vi.fn(),
  };
  const secured = {
    hasPassword: vi.fn(() => Boolean(cryptoValue)),
    verifyPassword: vi.fn(async (pin: string) => {
      if (pin !== cryptoValue || !cryptoValue) return false;
      active = true;
      return true;
    }),
    setInitialPassword: vi.fn(async (pin: string) => {
      if (cryptoValue) throw new Error("Cannot overwrite existing vault");
      cryptoValue = pin;
      active = true;
    }),
    isUnlocked: vi.fn(() => active),
    lock: vi.fn(() => { active = false; }),
  };
  return { ui, secured, uiValue: () => uiValue, cryptoValue: () => cryptoValue };
}

describe("encrypted Safe PIN recovery", () => {
  it("verifies the encryption key before repairing a missing UI PIN", async () => {
    const { ui, secured, uiValue } = controls({ hasUi: false, hasCrypto: true });
    expect(await establishSafePin("0000", ui, secured)).toBe(false);
    expect(ui.setPin).not.toHaveBeenCalled();
    expect(secured.setInitialPassword).not.toHaveBeenCalled();
    expect(await establishSafePin("1234", ui, secured)).toBe(true);
    expect(uiValue()).toBe("1234");
    expect(secured.setInitialPassword).not.toHaveBeenCalled();
  });

  it("recovers after password rewrap succeeded but UI PIN update failed", async () => {
    const { ui, secured, uiValue } = controls({
      uiPassword: "1234", cryptoPassword: "5678",
    });
    expect(await unlockSafeWithPin("1234", ui, secured)).toBe(false);
    expect(ui.setPin).not.toHaveBeenCalled();
    expect(await unlockSafeWithPin("5678", ui, secured)).toBe(true);
    expect(uiValue()).toBe("5678");
  });

  it("rejects an old PIN even when the AES file key remains unlocked in RAM", async () => {
    const { ui, secured } = controls({ uiPassword: "1234", cryptoPassword: "5678" });
    expect(await secured.verifyPassword("5678")).toBe(true);
    expect(secured.isUnlocked()).toBe(true);
    expect(await unlockSafeWithPin("1234", ui, secured)).toBe(false);
    expect(ui.lock).toHaveBeenCalled();
    expect(secured.setInitialPassword).not.toHaveBeenCalled();
  });

  it("never unlocks existing ciphertext on an old or incorrect UI PIN", async () => {
    const { ui, secured } = controls({ cryptoPassword: "5678" });
    expect(await unlockSafeWithPin("1234", ui, secured)).toBe(false);
    expect(secured.isUnlocked()).toBe(false);
    expect(secured.setInitialPassword).not.toHaveBeenCalled();
  });

  it("can finish setup after UI-PIN stored but crypto initialization failed", async () => {
    const { ui, secured } = controls({ hasCrypto: false });
    expect(await unlockSafeWithPin("1234", ui, secured)).toBe(true);
    expect(secured.setInitialPassword).toHaveBeenCalledWith("1234");
    expect(await unlockSafeWithPin("0000", ui, secured)).toBe(false);
  });

  it("does not create or replace keys for an unrecognized PIN", async () => {
    const { ui, secured } = controls({ hasUi: false, hasCrypto: false });
    expect(await unlockSafeWithPin("1234", ui, secured)).toBe(false);
    expect(secured.setInitialPassword).not.toHaveBeenCalled();
    expect(await establishSafePin("123", ui, secured)).toBe(false);
    expect(secured.setInitialPassword).not.toHaveBeenCalled();
  });

  it("locks both layers if a PIN hash write fails after crypto setup", async () => {
    const { ui, secured } = controls({ hasCrypto: false, hasUi: false });
    ui.setPin.mockRejectedValueOnce(new Error("Storage full"));
    await expect(establishSafePin("1234", ui, secured)).rejects.toThrow("Storage full");
    expect(secured.lock).toHaveBeenCalledTimes(1);
    expect(ui.lock).toHaveBeenCalledTimes(1);
    expect(secured.hasPassword()).toBe(true);
    expect(await establishSafePin("1234", ui, secured)).toBe(true);
  });

  it("does not grant access when repairing a PIN hash fails", async () => {
    const { ui, secured } = controls({ uiPassword: "1111", cryptoPassword: "1234" });
    ui.setPin.mockRejectedValueOnce(new Error("Storage full"));
    await expect(unlockSafeWithPin("1234", ui, secured)).rejects.toThrow("Storage full");
    expect(secured.lock).toHaveBeenCalledTimes(1);
    expect(ui.lock).toHaveBeenCalledTimes(1);
  });
});
