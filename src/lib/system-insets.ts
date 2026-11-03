import { Capacitor, registerPlugin } from "@capacitor/core";
import { normalizeSystemInsets, fitInsetsToViewport, isMeasuredViewport, isTrustedNativeInsetsSnapshot, type RawSystemInsets } from "./insets-math";

type Insets = RawSystemInsets & { measured?: boolean };
import type { GalleryLayoutEvidence } from "./gallery-geometry";
export type { GalleryLayoutEvidence } from "./gallery-geometry";

interface SystemInsetsPlugin {
  getInsets(): Promise<Insets>;
  signalUiReady(options: GalleryLayoutEvidence): Promise<void>;
  setSystemBarAppearance(options: { lightBackground: boolean }): Promise<void>;
  addListener(name: "insetsChanged", cb: (insets: Insets) => void):
    Promise<{ remove: () => Promise<void> }>;
}

const nativeInsets = registerPlugin<SystemInsetsPlugin>("SystemInsets");
let initialized = false;
let pushedVersion = 0;
let lastAppliedNativeInsets: Insets | null = null;
let nativeRefresh: (() => void) | null = null;
let nativeResubscribe: (() => void) | null = null;

/** The app window may resize without the OS sending a new inset event.
 * Recalculate against the last real snapshot immediately while requesting
 * a fresh native read. This prevents stale padding during fold/rotation.
 */
export function refreshSystemInsetsForViewport(): void {
  if (!Capacitor.isNativePlatform()) return;
  nativeResubscribe?.();
  nativeRefresh?.();
}

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
    if (!isTrustedNativeInsetsSnapshot(i)) {
      // A null/early native WindowInsets never means "zero safe areas".
      // Preserve previously measured CSS padding until Android supplies
      // a real reading for this activity.
      document.documentElement.dataset.novaInsetsReady = "pending";
      return;
    }
    lastAppliedNativeInsets = i;
    const safe = fitInsetsToViewport(normalizeSystemInsets(i),
      window.innerWidth, window.innerHeight);
    const values = [safe.top, safe.bottom, safe.left, safe.right];
    const keyboard = safe.keyboardVisible;
    // The window can shrink while Android's raw insets remain unchanged.
    // Include viewport dimensions when deciding whether to recompute.
    const key = values.join(":") + ":" + keyboard +
      ":" + window.innerWidth + ":" + window.innerHeight;
    const root = document.documentElement;
    const ready = isMeasuredViewport(window.innerWidth, window.innerHeight)
      ? "true" : "pending";
    // A discarded early native snapshot may flip readiness to pending even
    // if the physical bar dimensions are identical. Do NOT stop there:
    // otherwise React never sees 'true' again and CI reports NO_REACT_SHELL.
    if (key === last && root.dataset.novaInsetsReady === ready) return;
    last = key;
    ["top", "bottom", "left", "right"].forEach((name, n) =>
      root.style.setProperty(`--native-safe-${name}`, `${values[n]}px`));
    // Chrome 69 cannot divide CSS custom-property lengths inside calc().
    // Calculate the safe viewport's center in JS using the real OS insets.
    root.style.setProperty("--app-modal-center-shift",
      `${(safe.top - safe.bottom) / 2}px`);
    root.dataset.imeOpen = String(keyboard);
    // Expose a passive boot marker for emulator integration testing; no
    // private data or user photo metadata is involved.
    // A zero-sized WebView can occur before its first real frame. Preserve
    // the native inset values but report that viewport validation is pending.
    root.dataset.novaInsetsReady = ready;
    document.dispatchEvent(new Event("nova-native-insets"));
  };
  const refresh = () => {
    const versionAtRequest = pushedVersion;
    void nativeInsets.getInsets().then((snapshot) => {
      if (versionAtRequest === pushedVersion) apply(snapshot);
    }).catch((error) => {
      console.warn("[insets] native snapshot failed", error);
    });
  };
  nativeRefresh = refresh;
  nativeResubscribe = () => {
    if (lastAppliedNativeInsets) apply(lastAppliedNativeInsets);
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
  const refreshForWindow = () => {
    // Reapply the last real insets against the current viewport first,
    // then obtain a newer OS snapshot. Never invent 0px during rotation.
    nativeResubscribe?.();
    refresh();
  };
  window.addEventListener("focus", refreshForWindow);
  window.addEventListener("pageshow", refreshForWindow);
  window.addEventListener("orientationchange", refreshForWindow);
  window.visualViewport?.addEventListener("resize", refreshForWindow);
  window.visualViewport?.addEventListener("scroll", refreshForWindow);
  window.addEventListener("resize", refreshForWindow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshForWindow();
  });
}

/** Keep system button/gesture icons visible with the current app theme. */
export async function updateSystemBarAppearance(lightBackground: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await nativeInsets.setSystemBarAppearance({ lightBackground });
}

/**
 * Only the mounted gallery UI sends this native handshake.
 * A WebView's loading progress alone cannot certify React has rendered.
 */
export function signalGalleryUiReady(evidence: GalleryLayoutEvidence): void {
  if (!Capacitor.isNativePlatform()) return;
  void nativeInsets.signalUiReady(evidence).catch((error) => {
    console.warn("[gallery] native UI-ready signal failed", error);
  });
}
