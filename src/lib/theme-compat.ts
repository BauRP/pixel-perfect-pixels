/**
 * Android 7–9 WebViews can expose MediaQueryList.addListener but not
 * addEventListener. One compatibility wrapper keeps system-theme changes
 * live without crashing the Settings route or changing manual themes.
 */
export interface ColorSchemeQuery {
  matches: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export function subscribeSystemColorScheme(query: ColorSchemeQuery, update: () => void): () => void {
  if (typeof query.addEventListener === "function" && typeof query.removeEventListener === "function") {
    query.addEventListener("change", update);
    return () => query.removeEventListener?.("change", update);
  }
  if (typeof query.addListener === "function" && typeof query.removeListener === "function") {
    query.addListener(update);
    return () => query.removeListener?.(update);
  }
  return () => {};
}
