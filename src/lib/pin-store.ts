import { useSyncExternalStore } from "react";
import { useVault, vault } from "./vault-store";

// Simple SHA-256(salt+pin) storage. Not intended to be cryptographic vault
// material — the encrypted vault has its own key derivation. This gates the
// UI entry into the Safe section.

const KEY = "vault.safe.pin.v1";
const SESSION_KEY = "vault.safe.unlocked.session";

type Stored = { salt: string; hash: string };
let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());

function read(): Stored | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch { return null; }
}

async function hash(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(salt + ":" + pin);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randSalt(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const safePin = {
  hasPin(): boolean { return read() !== null; },
  async setPin(pin: string): Promise<void> {
    const salt = randSalt();
    const h = await hash(pin, salt);
    localStorage.setItem(KEY, JSON.stringify({ salt, hash: h }));
    sessionStorage.setItem(SESSION_KEY, "1");
    emit();
  },
  async verify(pin: string): Promise<boolean> {
    const s = read();
    if (!s) return false;
    const h = await hash(pin, s.salt);
    const ok = h === s.hash;
    if (ok) sessionStorage.setItem(SESSION_KEY, "1");
    return ok;
  },
  isUnlocked(): boolean {
    if (typeof window === "undefined") return false;
    // Android may restore sessionStorage after WebView/process recreation.
    // Its marker is NOT an encryption key. Never bypass the PIN gate unless
    // the encrypted Safe has a live in-memory AES key as well.
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1" && vault.isUnlocked();
    } catch {
      return false;
    }
  },
  lock(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(SESSION_KEY);
    // UI lock MUST also invalidate the in-memory AES key and any in-flight
    // decrypt/import. A PIN overlay alone cannot protect opened media.
    vault.lock();
    emit();
  },
  reset(): void {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(SESSION_KEY);
    vault.lock();
    emit();
  },
};

const SERVER_SNAP = { hasPin: false, unlocked: false };
let cached: { hasPin: boolean; unlocked: boolean } = SERVER_SNAP;

function getSnap() {
  const next = { hasPin: safePin.hasPin(), unlocked: safePin.isUnlocked() };
  if (cached.hasPin === next.hasPin && cached.unlocked === next.unlocked) return cached;
  cached = next;
  return cached;
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((x) => x !== cb); };
}

export function useSafePin() {
  // A real AES unlock/lock changes vault state independently of the PIN
  // session marker, so subscribe to BOTH sources. The stable PIN snapshot
  // prevents repeated React renders when neither source changes.
  useVault((s) => s.unlocked);
  return useSyncExternalStore(subscribe, getSnap, () => SERVER_SNAP);
}
