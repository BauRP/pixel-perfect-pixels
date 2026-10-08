// Persisted per-scope view preferences: grid column count + sorting.
//
// Two independent scopes are used by the app:
//   "folders" — the album grid on the gallery home screen
//   "media"   — the media grid inside a single album
//
// Values live in localStorage so the choice survives an app restart, and
// every subscriber re-renders instantly through useSyncExternalStore.

import { useSyncExternalStore } from "react";

export type Columns = 2 | 3 | 4;
export type SortField = "created" | "name" | "size" | "modified";
export type SortDir = "asc" | "desc";

export type ViewPrefs = {
  columns: Columns;
  field: SortField;
  dir: SortDir;
};

export type Scope = "folders" | "media";

const KEY = "vault.viewprefs.v1";

const DEFAULTS: Record<Scope, ViewPrefs> = {
  folders: { columns: 2, field: "created", dir: "desc" },
  media: { columns: 3, field: "created", dir: "desc" },
};

let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());

// Cached snapshot — useSyncExternalStore requires a stable object identity
// between renders, otherwise React loops forever re-reading the store.
let cache: Record<Scope, ViewPrefs> = { ...DEFAULTS };
let loaded = false;

function load(): Record<Scope, ViewPrefs> {
  if (loaded || typeof window === "undefined") return cache;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<Scope, Partial<ViewPrefs>>>;
      cache = {
        folders: { ...DEFAULTS.folders, ...(parsed.folders ?? {}) },
        media: { ...DEFAULTS.media, ...(parsed.media ?? {}) },
      };
    }
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function save(next: Record<Scope, ViewPrefs>) {
  cache = next;
  if (typeof window !== "undefined") {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota */ }
  }
  emit();
}

export function getPrefs(scope: Scope): ViewPrefs {
  return load()[scope];
}

export function setPrefs(scope: Scope, patch: Partial<ViewPrefs>) {
  const cur = load();
  save({ ...cur, [scope]: { ...cur[scope], ...patch } });
}

export function useViewPrefs(scope: Scope): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      listeners.push(cb);
      return () => { listeners = listeners.filter((x) => x !== cb); };
    },
    () => load()[scope],
    () => DEFAULTS[scope],
  );
  return [prefs, (patch) => setPrefs(scope, patch)];
}

/** Shape every sortable row must expose. All fields are optional. */
export type Sortable = {
  name: string;
  createdAt?: number;
  mtime?: number;
  size?: number;
};

function valueOf(row: Sortable, field: SortField): number | string {
  switch (field) {
    case "name": return row.name.toLowerCase();
    case "size": return row.size ?? 0;
    case "modified": return row.mtime ?? row.createdAt ?? 0;
    case "created":
    default: return row.createdAt ?? row.mtime ?? 0;
  }
}

/** Real Array.prototype.sort() over a copy — never mutates the input. */
export function sortRows<T extends Sortable>(rows: T[], field: SortField, dir: SortDir): T[] {
  const mult = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = valueOf(a, field);
    const bv = valueOf(b, field);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * mult;
    }
    if (av === bv) return a.name.localeCompare(b.name);
    return (av < bv ? -1 : 1) * mult;
  });
}