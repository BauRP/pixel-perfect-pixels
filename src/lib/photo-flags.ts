import { useSyncExternalStore } from "react";

// Per-item local flags: protection-from-deletion and rename overrides.
// Keyed by the ScannedItem id so it survives rescans (the scanner recomputes
// ids from path+size+mtime).

const PROT_KEY = "vault.photo.protected.v1";
const NAME_KEY = "vault.photo.names.v1";

type ProtectedSet = Record<string, true>;
type NameMap = Record<string, string>;

let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());

function readProt(): ProtectedSet {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(PROT_KEY) || "{}"); } catch { return {}; }
}
function readNames(): NameMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(NAME_KEY) || "{}"); } catch { return {}; }
}
function writeProt(v: ProtectedSet) { localStorage.setItem(PROT_KEY, JSON.stringify(v)); emit(); }
function writeNames(v: NameMap) { localStorage.setItem(NAME_KEY, JSON.stringify(v)); emit(); }

export const photoFlags = {
  isProtected(id: string): boolean { return !!readProt()[id]; },
  setProtected(id: string, v: boolean): void {
    const m = readProt();
    if (v) m[id] = true; else delete m[id];
    writeProt(m);
  },
  getName(id: string): string | null { return readNames()[id] ?? null; },
  setName(id: string, name: string): void {
    const m = readNames();
    m[id] = name;
    writeNames(m);
  },
};

export function usePhotoFlags() {
  return useSyncExternalStore(
    (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    () => ({ prot: readProt(), names: readNames() }),
    () => ({ prot: {} as ProtectedSet, names: {} as NameMap }),
  );
}
