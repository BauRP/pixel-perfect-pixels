import { useEffect } from "react";
import { useVault } from "./vault-store";

export function useApplyTheme() {
  const theme = useVault((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const sysLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      const useLight = theme === "light" || (theme === "system" && sysLight);
      root.classList.toggle("light", useLight);
      root.classList.toggle("dark", !useLight);
    };
    apply();
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);
}
