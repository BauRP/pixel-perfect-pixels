// Web Crypto — AES-256-GCM + PBKDF2-SHA-256.
// All primitives are native SubtleCrypto: no third-party crypto is bundled,
// and no plain-text credential ever touches disk. On the Android APK build
// these calls execute against the platform BoringSSL implementation backing
// the Chromium WebView, i.e. the same crypto stack the OS Keystore wraps.

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 minimum for PBKDF2-SHA-256
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

const enc = new TextEncoder();

// Helper: allocate a Uint8Array backed by an ArrayBuffer (never
// SharedArrayBuffer). Needed because SubtleCrypto's BufferSource type
// narrowed in TS 5.7+ and rejects `Uint8Array<ArrayBufferLike>`.
function ua(len: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array<ArrayBuffer>(new ArrayBuffer(len));
}
function random(len: number): Uint8Array<ArrayBuffer> {
  const buf = ua(len);
  crypto.getRandomValues(buf);
  return buf;
}


export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = ua(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Everything SubtleCrypto touches goes through this helper so the strict
// BufferSource overload is happy.
const bs = (u: Uint8Array<ArrayBuffer>): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
function copyAB(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = ua(u.byteLength);
  out.set(u);
  return out;
}

async function deriveKek(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw", bs(copyAB(enc.encode(password))), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bs(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false, // KEK is non-extractable
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );
}


async function generateFileKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: KEY_BITS },
    true, // extractable so we can wrap it under the KEK
    ["encrypt", "decrypt"],
  );
}

/** Verifier bundle written to localStorage. Contains ONLY salts and ciphertexts. */
export type VaultCryptoSecrets = {
  salt: string;          // b64 — KEK derivation salt
  iterations: number;
  wrappedKey: string;    // b64 — file key wrapped under KEK (AES-GCM)
  wrapIv: string;        // b64 — IV for the wrap
  verifier: string;      // b64 — AES-GCM ciphertext of a fixed plaintext (wrong-password detector)
  verifierIv: string;    // b64
};

const VERIFIER_PLAINTEXT = "nova.vault.v1";

/** Create a fresh vault: pick a random file-key, wrap it under PBKDF2(password). */
export async function initVaultSecrets(password: string): Promise<{
  secrets: VaultCryptoSecrets;
  fileKey: CryptoKey;
}> {
  const salt = random(SALT_BYTES);
  const kek = await deriveKek(password, salt);
  const fileKey = await generateFileKey();

  const wrapIv = random(IV_BYTES);
  const wrappedKey = await crypto.subtle.wrapKey("raw", fileKey, kek, { name: "AES-GCM", iv: bs(wrapIv) });

  const verifierIv = random(IV_BYTES);
  const verifier = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bs(verifierIv) }, kek, bs(copyAB(enc.encode(VERIFIER_PLAINTEXT))),
  );

  return {
    fileKey,
    secrets: {
      salt: toB64(salt),
      iterations: PBKDF2_ITERATIONS,
      wrappedKey: toB64(wrappedKey),
      wrapIv: toB64(wrapIv),
      verifier: toB64(verifier),
      verifierIv: toB64(verifierIv),
    },
  };
}

/** Verify password + unwrap the file key. Returns null on wrong password. */
export async function unlockVault(
  password: string, secrets: VaultCryptoSecrets,
): Promise<CryptoKey | null> {
  try {
    const kek = await deriveKek(password, fromB64(secrets.salt));
    // Verify first so a wrong password fails fast without touching the wrapped key.
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bs(fromB64(secrets.verifierIv)) }, kek, bs(fromB64(secrets.verifier)),
    );
    return await crypto.subtle.unwrapKey(
      "raw",
      bs(fromB64(secrets.wrappedKey)),
      kek,
      { name: "AES-GCM", iv: bs(fromB64(secrets.wrapIv)) },
      { name: "AES-GCM", length: KEY_BITS },
      false, // unwrapped key stays non-extractable
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

/** Re-wrap the existing file key under a new password (used by "Change password"). */
export async function rewrapWithNewPassword(
  oldPassword: string, newPassword: string, secrets: VaultCryptoSecrets,
): Promise<VaultCryptoSecrets | null> {
  try {
    const oldKek = await deriveKek(oldPassword, fromB64(secrets.salt));
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bs(fromB64(secrets.verifierIv)) }, oldKek, bs(fromB64(secrets.verifier)),
    );
    const rawKey = await crypto.subtle.unwrapKey(
      "raw",
      bs(fromB64(secrets.wrappedKey)),
      oldKek,
      { name: "AES-GCM", iv: bs(fromB64(secrets.wrapIv)) },
      { name: "AES-GCM", length: KEY_BITS },
      true, // extractable — needed to re-wrap
      ["encrypt", "decrypt"],
    );

    const newSalt = random(SALT_BYTES);
    const newKek = await deriveKek(newPassword, newSalt);
    const wrapIv = random(IV_BYTES);
    const wrappedKey = await crypto.subtle.wrapKey("raw", rawKey, newKek, { name: "AES-GCM", iv: bs(wrapIv) });
    const verifierIv = random(IV_BYTES);
    const verifier = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bs(verifierIv) }, newKek, bs(copyAB(enc.encode(VERIFIER_PLAINTEXT))),
    );
    return {
      salt: toB64(newSalt),
      iterations: PBKDF2_ITERATIONS,
      wrappedKey: toB64(wrappedKey),
      wrapIv: toB64(wrapIv),
      verifier: toB64(verifier),
      verifierIv: toB64(verifierIv),
    };
  } catch {
    return null;
  }
}

/** Encrypt raw file bytes under the unwrapped file key. Returns {iv, cipher} b64. */
export async function encryptBytes(
  bytes: ArrayBuffer, key: CryptoKey,
): Promise<{ iv: string; cipher: string }> {
  const iv = random(IV_BYTES);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(iv) }, key, bytes);
  return { iv: toB64(iv), cipher: toB64(cipher) };
}

export async function decryptBytes(
  iv: string, cipher: string, key: CryptoKey,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bs(fromB64(iv)) }, key, bs(fromB64(cipher)),
  );
}
