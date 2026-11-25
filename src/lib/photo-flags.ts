import { useSyncExternalStore } from "react";
import { persistentPhotoFlagKey } from "./photo-flag-key";

// Per-item local flags: protection-from-deletion and rename overrides.
// Persisted flags have one stable snapshot for React's useSyncExternalStore:
// allocating a new object on every getSnapshot() causes an infinite re-render.
const PROT_KEY = "vault.photo.protected.v1";
const NAME_KEY = "vault.photo.names.v1";

type ProtectedSet = Record<string, true>;
type NameMap = Record<string, string>;
type PhotoFlagsSnapshot = { prot: ProtectedSet; names: NameMap };

const SERVER_SNAPSHOT: PhotoFlagsSnapshot = { prot: {}, names: {} };
let cached: PhotoFlagsSnapshot | null = null;
const listeners = new Set<() => void>();

function readEntries<T extends true | string>(
  key: string, valid: (v: unknown) => v is T,
): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
    // Do not trust prototype properties or malformed legacy data.
    const result: Record<string, T> = Object.create(null);
    for (const [id, value] of Object.entries(raw)) {
      if (valid(value)) result[id] = value;
    }
    // Old versions keyed flags by the full scanned ID (URI:size:mtime).
    // Construct stable aliases in memory without silently rewriting storage
    // or dropping any of the user's previously saved photo settings.
    for (const id of Object.keys(result)) {
      const stable = persistentPhotoFlagKey(id);
      if (stable !== id && !Object.prototype.hasOwnProperty.call(result, stable))
        result[stable] = result[id];
    }
    return result;
  } catch {
    return {};
  }
}

function readProt(): ProtectedSet {
  return readEntries(PROT_KEY, (v): v is true => v === true);
}

function readNames(): NameMap {
  return readEntries(NAME_KEY, (v): v is string => typeof v === "string");
}

export function getPhotoFlagsSnapshot(): PhotoFlagsSnapshot {
  if (cached === null) cached = { prot: readProt(), names: readNames() };
  return cached;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function updatedByAnotherTab(event: StorageEvent) {
  if (event.key !== null && event.key !== PROT_KEY && event.key !== NAME_KEY) return;
  cached = null;
  emit();
}

function subscribe(listener: () => void) {
  const first = listeners.size === 0;
  listeners.add(listener);
  if (first && typeof window !== "undefined") {
    window.addEventListener("storage", updatedByAnotherTab);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", updatedByAnotherTab);
    }
  };
}

/** Remove superseded legacy IDs when a flag is explicitly changed.
 * Otherwise a previous "protected" record could reappear on reload after
 * the user has removed protection for a rescanned Android photograph. */
function clearOldPhotoFlagKeys<T>(map: Record<string, T>, id: string): string {
  const stable = persistentPhotoFlagKey(id);
  for (const candidate of Object.keys(map)) {
    if (candidate !== stable && persistentPhotoFlagKey(candidate) === stable)
      delete map[candidate];
  }
  return stable;
}

function writeProt(v: ProtectedSet) {
  // Do not publish success if localStorage rejects a write.
  localStorage.setItem(PROT_KEY, JSON.stringify(v));
  cached = { ...getPhotoFlagsSnapshot(), prot: v };
  emit();
}

function writeNames(v: NameMap) {
  localStorage.setItem(NAME_KEY, JSON.stringify(v));
  cached = { ...getPhotoFlagsSnapshot(), names: v };
  emit();
}

export const photoFlags = {
  isProtected(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(getPhotoFlagsSnapshot().prot,
      persistentPhotoFlagKey(id));
  },
  setProtected(id: string, v: boolean): void {
    const m = { ...getPhotoFlagsSnapshot().prot };
    const stable = clearOldPhotoFlagKeys(m, id);
    if (v) m[stable] = true;
    else delete m[stable];
    writeProt(m);
  },
  /** Apply protection to a selected album batch in ONE durable write.
   * A 1000-photo selection must not cause 1000 synchronous localStorage
   * writes (or 1000 React rerenders) on an older Android WebView. */
  setProtectedMany(ids: readonly string[], enabled: boolean): void {
    const stableIds = new Set(ids.map(persistentPhotoFlagKey));
    if (stableIds.size === 0) return;
    const next = { ...getPhotoFlagsSnapshot().prot };
    for (const current of Object.keys(next)) {
      if (stableIds.has(persistentPhotoFlagKey(current))) delete next[current];
    }
    if (enabled) {
      for (const id of stableIds) next[id] = true;
    }
    writeProt(next);
  },
  getName(id: string): string | null {
    const m = getPhotoFlagsSnapshot().names;
    const stable = persistentPhotoFlagKey(id);
    return Object.prototype.hasOwnProperty.call(m, stable) ? m[stable] : null;
  },
  setName(id: string, name: string): void {
    const m = { ...getPhotoFlagsSnapshot().names };
    const stable = clearOldPhotoFlagKeys(m, id);
    m[stable] = name;
    writeNames(m);
  },
};

export function usePhotoFlags() {
  return useSyncExternalStore(subscribe, getPhotoFlagsSnapshot, () => SERVER_SNAPSHOT);
}
