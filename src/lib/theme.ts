import { useEffect } from "react";
import { useVault } from "./vault-store";
import { subscribeSystemColorScheme, type ColorSchemeQuery } from "./theme-compat";

export function useApplyTheme() {
  const theme = useVault((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    let systemQuery: ColorSchemeQuery | null = null;
    // An older embedded WebView may not implement matchMedia at all.
    try {
      if (typeof window.matchMedia === "function") {
        systemQuery = window.matchMedia("(prefers-color-scheme: light)");
      }
    } catch {
      // Continue using the default dark system appearance.
    }
    const apply = () => {
      const useLight = theme === "light" || (theme === "system" && !!systemQuery?.matches);
      root.classList.toggle("light", useLight);
      root.classList.toggle("dark", !useLight);
    };
    apply();
    if (theme === "system" && systemQuery) {
      return subscribeSystemColorScheme(systemQuery, apply);
    }
  }, [theme]);
}
