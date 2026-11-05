/**
 * The password/key generation is advanced on lock, successful unlock and
 * password update. A late async result must never cross that boundary.
 * Object identity catches concurrent crypto metadata replacement.
 */
export function isSafeOperationCurrent<T>(
  expectedEpoch: number,
  currentEpoch: number,
  expectedCrypto?: T | null,
  currentCrypto?: T | null,
): boolean {
  return expectedEpoch === currentEpoch &&
    (expectedCrypto === undefined || expectedCrypto === currentCrypto);
}
