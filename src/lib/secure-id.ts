/**
 * Android 7–9 WebViews lack crypto.randomUUID(). Generate RFC 4122 v4 UUIDs
 * from cryptographic entropy instead of falling back to Math.random().
 */
export function uuidV4FromBytes(source: Uint8Array): string {
  if (source.length !== 16) throw new Error("UUID requires 16 random bytes");
  const bytes = new Uint8Array(source);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)].join("-");
}
export function createSecureId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return uuidV4FromBytes(bytes);
}
