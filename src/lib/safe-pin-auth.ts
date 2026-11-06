import { safePin } from "./pin-store";
import { vault } from "./vault-store";

type UiPin = Pick<typeof safePin, "verify" | "setPin" | "lock">;
type EncryptedSafe = Pick<typeof vault,
  "hasPassword" | "verifyPassword" | "setInitialPassword" | "isUnlocked" | "lock">;

/**
 * A lost UI PIN record must never make an already encrypted Safe inaccessible
 * forever. Repair only after PBKDF2/AES successfully verifies the same PIN.
 * Never regenerate the wrapped file key over existing encrypted media.
 */
export async function establishSafePin(
  pin: string, ui: UiPin = safePin, secured: EncryptedSafe = vault,
): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false;
  if (secured.hasPassword()) {
    if (!(await secured.verifyPassword(pin))) {
      ui.lock();
      return false;
    }
  } else {
    await secured.setInitialPassword(pin);
  }
  try {
    await ui.setPin(pin);
    return true;
  } catch (error) {
    // Crypto metadata may already have been saved. On the next visit the
    // setup gate will safely re-verify the existing key and retry UI storage.
    secured.lock();
    ui.lock();
    throw error;
  }
}

/**
 * The UI hash is only a convenience gate. A successful UI-PIN comparison
 * alone cannot unlock encrypted data. If hashes diverge after a partial
 * password update, only the real AES password can authorize repairing it.
 */
export async function unlockSafeWithPin(
  pin: string, ui: UiPin = safePin, secured: EncryptedSafe = vault,
): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false;
  const uiAccepted = await ui.verify(pin);
  if (!secured.hasPassword()) {
    if (!uiAccepted) {
      ui.lock();
      return false;
    }
    // Recovery after the PIN hash persisted but initial crypto setup failed.
    // Reuse the already-verified UI PIN; never allow an arbitrary replacement.
    try {
      await secured.setInitialPassword(pin);
      return true;
    } catch (error) {
      ui.lock();
      throw error;
    }
  }
  if (uiAccepted && secured.isUnlocked()) return true;
  const keyAccepted = await secured.verifyPassword(pin);
  if (!keyAccepted) {
    ui.lock();
    return false;
  }
  if (!uiAccepted) {
    try {
      await ui.setPin(pin);
    } catch (error) {
      secured.lock();
      ui.lock();
      throw error;
    }
  }
  return true;
}
