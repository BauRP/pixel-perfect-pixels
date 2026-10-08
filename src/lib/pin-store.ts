import { useSyncExternalStore } from "react";

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
    return sessionStorage.getItem(SESSION_KEY) === "1";
  },
  lock(): void {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(SESSION_KEY);
    emit();
  },
  reset(): void {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(SESSION_KEY);
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

// Ensure store mutations invalidate the cached snapshot before notifying React.
const origEmit = emit;
listeners = listeners; // keep reference
function notify() { cached = { hasPin: safePin.hasPin(), unlocked: safePin.isUnlocked() }; origEmit(); }

export function useSafePin() {
  return useSyncExternalStore(
    (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    getSnap,
    () => SERVER_SNAP,
  );
}

// Re-wire emit-triggering methods to also refresh cache.
const _set = safePin.setPin;
safePin.setPin = async (p: string) => { await _set(p); notify(); };
const _lock = safePin.lock;
safePin.lock = () => { _lock(); notify(); };
const _reset = safePin.reset;
safePin.reset = () => { _reset(); notify(); };
const _verify = safePin.verify;
safePin.verify = async (p: string) => { const ok = await _verify(p); if (ok) notify(); return ok; };
