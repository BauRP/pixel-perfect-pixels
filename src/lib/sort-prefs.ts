import { useSyncExternalStore } from "react";

export type SortKey = "default" | "name" | "date" | "size";

const KEY = "vault.sort.v1";
let listeners: (() => void)[] = [];
const emit = () => listeners.forEach((l) => l());

function read(): Record<string, SortKey> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
function write(v: Record<string, SortKey>) {
  localStorage.setItem(KEY, JSON.stringify(v));
  emit();
}

export function getSort(scope: string): SortKey {
  return read()[scope] ?? "default";
}
export function setSort(scope: string, s: SortKey) {
  const m = read();
  m[scope] = s;
  write(m);
}

export function useSort(scope: string): [SortKey, (s: SortKey) => void] {
  const s = useSyncExternalStore(
    (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    () => getSort(scope),
    () => "default" as SortKey,
  );
  return [s, (n) => setSort(scope, n)];
}

export function sortItems<T extends { name: string; mtime?: number; size?: number; addedAt?: number }>(
  items: T[], key: SortKey,
): T[] {
  if (key === "default") return items;
  const arr = items.slice();
  if (key === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
  else if (key === "size") arr.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  else if (key === "date") arr.sort((a, b) => (b.mtime ?? b.addedAt ?? 0) - (a.mtime ?? a.addedAt ?? 0));
  return arr;
}
