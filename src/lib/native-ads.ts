// ─────────────────────────────────────────────────────────────────────────────
// Google AdMob "Native Advanced" ad for the first gallery tile.
//
// The WebView renders a placeholder tile (<NativeAdTile />). On Android the
// NativeAdsPlugin (NativeAdsPlugin.java) draws a real NativeAdView exactly on
// top of it; this module keeps the overlay glued to the tile while the grid
// scrolls, hides it whenever a menu/dialog opens above the grid, and retries
// failed loads with exponential backoff (5 s → 10 s → 20 s … capped at 5 min,
// ±20 % jitter). The backoff resets after a successful load, and a regained
// network connection or app resume triggers an immediate attempt.
// Web build: no-op.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor, registerPlugin } from "@capacitor/core";
import { backoffDelay } from "./backoff";

export const ADMOB_APP_ID = "ca-app-pub-9902253594429663~9587409077";
export const NATIVE_AD_UNIT_ID = "ca-app-pub-9902253594429663/3903747602";

export interface NativeAdColors {
  surface: string;
  border: string;
  foreground: string;
  muted: string;
  accent: string;
  accentForeground: string;
}

export interface NativeAdBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  clipTop: number;
  clipBottom: number;
  visible: boolean;
  label: string;
  colors: NativeAdColors;
}

interface NativeAdsPlugin {
  loadAd(options: { adId: string }): Promise<{ loaded: boolean; error?: string }>;
  setBounds(options: NativeAdBounds): Promise<void>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  isOnline(): Promise<{ online: boolean }>;
  addListener(
    event: "networkAvailable" | "adLoaded" | "adFailed",
    cb: (data: { error?: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const NativeAds = registerPlugin<NativeAdsPlugin>("NativeAds");

export const isNativeAdSupported = () => Capacitor.isNativePlatform();

// ── Loaded-state store (useSyncExternalStore friendly) ──────────────────────
let loaded = false;
const listeners = new Set<() => void>();
function setLoaded(v: boolean) {
  if (v === loaded) return;
  loaded = v;
  listeners.forEach((l) => l());
}
export function subscribeNativeAd(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export const getNativeAdLoaded = () => loaded;
export const getServerNativeAdLoaded = () => false;

let inFlight = false;
let attempt = 0;
let retryTimer: number | null = null;
let watchersInstalled = false;
let foreground = true;

function clearRetry() {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** Single pending retry, delayed by the exponential backoff schedule. */
function scheduleRetry(reason: string) {
  if (retryTimer !== null || loaded || !foreground) return;
  const delay = backoffDelay(attempt);
  attempt += 1;
  console.warn(`[ads] native ad retry #${attempt} in ${delay} ms (${reason})`);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void loadNativeAd();
  }, delay);
}

/** Retry immediately with a fresh schedule (network regained / app resumed). */
function retryNow() {
  if (loaded) return;
  clearRetry();
  attempt = 0;
  void loadNativeAd();
}

function onLoaded() {
  clearRetry();
  attempt = 0;
  setLoaded(true);
}

async function installWatchers() {
  if (watchersInstalled) return;
  watchersInstalled = true;
  void NativeAds.addListener("networkAvailable", retryNow).catch(() => {});
  // A fill that arrives after the bridge call timed out still shows at once.
  void NativeAds.addListener("adLoaded", onLoaded).catch(() => {});
  // A late failure after a timeout just keeps the backoff going.
  void NativeAds.addListener("adFailed", ({ error }) => {
    if (!loaded) scheduleRetry(error ?? "late failure");
  }).catch(() => {});
  window.addEventListener("online", retryNow);
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appStateChange", ({ isActive }) => {
      foreground = isActive;
      if (!isActive) {
        clearRetry();
        return;
      }
      retryNow();
      // Ask the tile to re-place the overlay after resume.
      listeners.forEach((l) => l());
    });
  } catch (e) {
    console.warn("[ads] lifecycle listener unavailable", e);
  }
}

export async function loadNativeAd(): Promise<void> {
  if (!isNativeAdSupported() || loaded || inFlight || !foreground) return;
  void installWatchers();
  inFlight = true;
  try {
    let online = typeof navigator === "undefined" || navigator.onLine !== false;
    try {
      online = (await NativeAds.isOnline()).online;
    } catch {
      /* native check unavailable — keep navigator.onLine */
    }
    if (loaded) return;
    if (!online) {
      // The networkAvailable / online events trigger an immediate attempt;
      // the backoff timer is a safety net.
      scheduleRetry("offline");
      return;
    }
    clearRetry();
    const res = await NativeAds.loadAd({ adId: NATIVE_AD_UNIT_ID });
    if (res?.loaded) {
      onLoaded();
      return;
    }
    // LOAD_IN_PROGRESS means a request is still running natively; its outcome
    // arrives through adLoaded / adFailed, so no retry is queued for it.
    if (res?.error === "LOAD_IN_PROGRESS") return;
    scheduleRetry(res?.error ?? "unknown");
  } catch (e) {
    scheduleRetry(e instanceof Error ? e.message : String(e));
  } finally {
    inFlight = false;
  }
}

export function setNativeAdBounds(bounds: NativeAdBounds) {
  if (!isNativeAdSupported()) return;
  void NativeAds.setBounds(bounds).catch(() => {});
}

export function hideNativeAd() {
  if (!isNativeAdSupported()) return;
  void NativeAds.hide().catch(() => {});
}

// ── Theme colour resolution (any CSS colour → #rrggbb) ─────────────────────
let ctx: CanvasRenderingContext2D | null = null;
export function cssColorToHex(cssColor: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = fallback;
  ctx.fillStyle = cssColor || fallback;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function readThemeColors(): NativeAdColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cssColorToHex(s.getPropertyValue(name).trim() || fb, fb);
  return {
    surface: v("--color-surface", "#1c1c1e"),
    border: v("--color-border", "#2c2c2e"),
    foreground: v("--color-foreground", "#ffffff"),
    muted: v("--color-muted-foreground", "#8e8e93"),
    accent: v("--color-accent", "#0a84ff"),
    accentForeground: v("--color-accent-foreground", "#ffffff"),
  };
}
