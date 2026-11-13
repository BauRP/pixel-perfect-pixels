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

const VALID_COLUMNS: readonly Columns[] = [2, 3, 4];
const VALID_FIELDS: readonly SortField[] = ["created", "name", "size", "modified"];
const VALID_DIRS: readonly SortDir[] = ["asc", "desc"];

/**
 * localStorage is not a typed database. Corrupted/old versions can contain
 * invalid column counts and sort modes, which used to reach the live grid.
 * Keep each healthy preference and fall back only for invalid fields.
 */
export function sanitizeViewPrefs(scope: Scope, raw: unknown): ViewPrefs {
  const base = DEFAULTS[scope];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...base };
  const obj = raw as Partial<Record<keyof ViewPrefs, unknown>>;
  const columns = VALID_COLUMNS.includes(obj.columns as Columns) ? obj.columns as Columns : base.columns;
  const field = VALID_FIELDS.includes(obj.field as SortField) ? obj.field as SortField : base.field;
  const dir = VALID_DIRS.includes(obj.dir as SortDir) ? obj.dir as SortDir : base.dir;
  return { columns, field, dir };
}

function load(): Record<Scope, ViewPrefs> {
  if (loaded || typeof window === "undefined") return cache;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const obj = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Partial<Record<Scope, unknown>> : {};
      cache = {
        folders: sanitizeViewPrefs("folders", obj.folders),
        media: sanitizeViewPrefs("media", obj.media),
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
  save({ ...cur, [scope]: sanitizeViewPrefs(scope, { ...cur[scope], ...patch }) });
}

// Stable subscriptions avoid reattaching React 19 external-store listeners
// on every render. Storage changes from another window restore the correct
// cached settings without forcing unrelated screens to rerender.
function samePrefs(a: ViewPrefs, b: ViewPrefs): boolean {
  return a.columns === b.columns && a.field === b.field && a.dir === b.dir;
}

function onPrefsStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  const previous = load();
  loaded = false;
  const current = load();
  if (!samePrefs(previous.folders, current.folders) ||
      !samePrefs(previous.media, current.media)) emit();
}

function subscribe(cb: () => void) {
  const first = listeners.length === 0;
  listeners.push(cb);
  if (first && typeof window !== "undefined") {
    window.addEventListener("storage", onPrefsStorage);
  }
  return () => {
    listeners = listeners.filter((x) => x !== cb);
    if (listeners.length === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onPrefsStorage);
    }
  };
}

const getFoldersSnapshot = () => load().folders;
const getMediaSnapshot = () => load().media;
const getServerFoldersSnapshot = () => DEFAULTS.folders;
const getServerMediaSnapshot = () => DEFAULTS.media;

export function useViewPrefs(scope: Scope): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const prefs = useSyncExternalStore(
    subscribe,
    scope === "folders" ? getFoldersSnapshot : getMediaSnapshot,
    scope === "folders" ? getServerFoldersSnapshot : getServerMediaSnapshot,
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