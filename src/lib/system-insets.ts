import { Capacitor, registerPlugin } from "@capacitor/core";

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface SystemInsetsPlugin {
  getInsets(): Promise<Insets>;
  addListener(name: "insetsChanged", cb: (insets: Insets) => void):
    Promise<{ remove: () => Promise<void> }>;
}

const nativeInsets = registerPlugin<SystemInsetsPlugin>("SystemInsets");
let initialized = false;

/**
 * Native Android reads WindowInsetsCompat on every actual system UI change.
 * No assumption about the user's navigation style or Android version.
 * Values are in CSS px, so the same layout works for gestures/3 buttons.
 */
export function initSystemInsets(): void {
  if (initialized || !Capacitor.isNativePlatform() || typeof document === "undefined") return;
  initialized = true;
  let last = "";
  const apply = (i: Insets) => {
    const values = [i.top, i.bottom, i.left, i.right]
      .map((n) => Math.max(0, Math.min(256, Number.isFinite(n) ? n : 0)));
    const key = values.join(":");
    if (last === key) return;
    last = key;
    const root = document.documentElement;
    const names = ["top", "bottom", "left", "right"];
    names.forEach((name, n) => root.style.setProperty(`--native-safe-${name}`, `${values[n]}px`));
  };
  void nativeInsets.addListener("insetsChanged", apply)
    .then(() => nativeInsets.getInsets().then(apply))
    .catch((error) => console.warn("[insets] native listener unavailable", error));
}
