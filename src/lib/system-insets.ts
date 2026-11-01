import { Capacitor, registerPlugin } from "@capacitor/core";
import { normalizeSystemInsets, fitInsetsToViewport, type RawSystemInsets } from "./insets-math";

type Insets = RawSystemInsets;

interface SystemInsetsPlugin {
  getInsets(): Promise<Insets>;
  setSystemBarAppearance(options: { lightBackground: boolean }): Promise<void>;
  addListener(name: "insetsChanged", cb: (insets: Insets) => void):
    Promise<{ remove: () => Promise<void> }>;
}

const nativeInsets = registerPlugin<SystemInsetsPlugin>("SystemInsets");
let initialized = false;
let pushedVersion = 0;

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
    const safe = fitInsetsToViewport(normalizeSystemInsets(i),
      window.innerWidth, window.innerHeight);
    const values = [safe.top, safe.bottom, safe.left, safe.right];
    const keyboard = safe.keyboardVisible;
    // The window can shrink while Android's raw insets remain unchanged.
    // Include viewport dimensions when deciding whether to recompute.
    const key = values.join(":") + ":" + keyboard +
      ":" + window.innerWidth + ":" + window.innerHeight;
    if (key === last) return;
    last = key;
    const root = document.documentElement;
    ["top", "bottom", "left", "right"].forEach((name, n) =>
      root.style.setProperty(`--native-safe-${name}`, `${values[n]}px`));
    // Chrome 69 cannot divide CSS custom-property lengths inside calc().
    // Calculate the safe viewport's center in JS using the real OS insets.
    root.style.setProperty("--app-modal-center-shift",
      `${(safe.top - safe.bottom) / 2}px`);
    root.dataset.imeOpen = String(keyboard);
    // Expose a passive boot marker for emulator integration testing; no
    // private data or user photo metadata is involved.
    root.dataset.novaInsetsReady = "true";
  };
  const refresh = () => {
    const versionAtRequest = pushedVersion;
    void nativeInsets.getInsets().then((snapshot) => {
      if (versionAtRequest === pushedVersion) apply(snapshot);
    }).catch((error) => {
      console.warn("[insets] native snapshot failed", error);
    });
  };
  // Read immediately rather than waiting for native listener registration;
  // then take another snapshot once subscribed to close any startup race.
  refresh();
  void nativeInsets.addListener("insetsChanged", (event) => {
    pushedVersion++;
    apply(event);
  }).then(() => { refresh(); })
    .catch((error) => {
      console.warn("[insets] native listener unavailable; refreshing on resume", error);
      refresh();
    });
  window.addEventListener("focus", refresh);
  window.addEventListener("orientationchange", refresh);
  window.visualViewport?.addEventListener("resize", refresh);
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
