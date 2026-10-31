import { Capacitor, registerPlugin } from "@capacitor/core";

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
  keyboardVisible?: boolean;
}

interface SystemInsetsPlugin {
  getInsets(): Promise<Insets>;
  setSystemBarAppearance(options: { lightBackground: boolean }): Promise<void>;
  addListener(name: "insetsChanged", cb: (insets: Insets) => void):
    Promise<{ remove: () => Promise<void> }>;
}

const nativeInsets = registerPlugin<SystemInsetsPlugin>("SystemInsets");
let initialized = false;

/**
 * Native Android 7+ WindowInsets are the source of truth for status/navigation
 * bars, not manufacturer heuristics. Gesture edge regions do not add side gaps.
 * Updates also happen when the keyboard, window or navigation mode changes.
 */
export function initSystemInsets(): void {
  if (initialized || !Capacitor.isNativePlatform() || typeof document === "undefined") return;
  initialized = true;
  let last = "";
  const apply = (i: Insets) => {
    if (!i || typeof i.top !== "number" || typeof i.bottom !== "number") return;
    const values = [i.top, i.bottom, i.left ?? 0, i.right ?? 0]
      .map((n) => Math.max(0, Math.min(256, Number.isFinite(n) ? n : 0)));
    const keyboard = !!i.keyboardVisible;
    const key = values.join(":") + ":" + keyboard;
    if (key === last) return;
    last = key;
    const root = document.documentElement;
    ["top", "bottom", "left", "right"].forEach((name, n) =>
      root.style.setProperty(`--native-safe-${name}`, `${values[n]}px`));
    root.dataset.imeOpen = String(keyboard);
  };
  const refresh = () => { void nativeInsets.getInsets().then(apply).catch(() => {}); };
  // Subscribe before the snapshot so a fast system transition cannot be missed.
  void nativeInsets.addListener("insetsChanged", apply)
    .then(() => { refresh(); })
    .catch((error) => {
      initialized = false;
      console.warn("[insets] native listener unavailable", error);
    });
  window.addEventListener("focus", refresh);
  window.addEventListener("resize", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
}

/** Keep system button/gesture icons visible with the current app theme. */
export async function updateSystemBarAppearance(lightBackground: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await nativeInsets.setSystemBarAppearance({ lightBackground });
}
