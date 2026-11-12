import { useRef, useSyncExternalStore } from "react";

/**
 * React 19 requires useSyncExternalStore's getSnapshot to return the same
 * reference while the external data has not changed. This is also true
 * when a selector constructs an object during each React render.
 */
type Cache<S, T> = { state: S; selector: (state: S) => T; value: T };

function shallowSelectedEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aArray = Array.isArray(a);
  if (aArray !== Array.isArray(b)) return false;
  if (!aArray) {
    const pa = Object.getPrototypeOf(a);
    const pb = Object.getPrototypeOf(b);
    if (pa !== pb || (pa !== Object.prototype && pa !== null)) return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const ka = Object.keys(left);
  const kb = Object.keys(right);
  if (ka.length !== kb.length) return false;
  return ka.every(key =>
    Object.prototype.hasOwnProperty.call(right, key) &&
    Object.is(left[key], right[key]));
}

export function useStableStoreSelector<S, T>(
  subscribe: (onChange: () => void) => () => void,
  getState: () => S,
  getServerState: () => S,
  select: (state: S) => T,
): T {
  // Refs must survive renders. Recreating them inside the function, as the
  // previous gallery selector did, can cause an infinite React render loop.
  const current = useRef<Cache<S, T> | null>(null);
  const server = useRef<Cache<S, T> | null>(null);
  const selectCached = (value: S, ref: { current: Cache<S, T> | null }): T => {
    const old = ref.current;
    if (old && old.state === value && old.selector === select) return old.value;
    const selected = select(value);
    const stable = old && shallowSelectedEqual(old.value, selected)
      ? old.value : selected;
    ref.current = { state: value, selector: select, value: stable };
    return stable;
  };
  return useSyncExternalStore(
    subscribe,
    () => selectCached(getState(), current),
    () => selectCached(getServerState(), server),
  );
}
