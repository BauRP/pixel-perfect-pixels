// ─────────────────────────────────────────────────────────────────────────────
// Google Mobile Ads "Native Advanced" — first slot of the gallery folder grid.
//
// The only ad module in the app. The WebView always renders the slot
// container (<NativeAdTile />); on Android, NativeAdsPlugin.java draws a real
// NativeAdView over it once an ad is loaded. Web build: no-op, slot stays as
// a neutral fallback.
//
// State machine (one per process, survives remounts / list refreshes):
//   IDLE → LOADING → LOADED
//                  ↘ NO_FILL | FAILED | TIMED_OUT → (backoff) → LOADING
//   NO_INTERNET / WAITING_FOR_NETWORK when the device has no validated net.
// Timing: 8 s soft deadline per request (late fills are still shown),
// retries via backoffDelay(): 5 s → 10 s → 20 s → 30 s cap, ±20 % jitter.
// Connectivity and ad availability are separate checks: the network state
// comes from ConnectivityManager callbacks; ad availability only from the SDK.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor, registerPlugin } from "@capacitor/core";
import { backoffDelay } from "./backoff";

export { cssColorToHex } from "./css-color";
import { cssColorToHex } from "./css-color";

/** Production native ad unit (debuggable builds swap in Google's test unit natively). */
export const NATIVE_AD_UNIT_ID = "ca-app-pub-9902253594429663/3903747602";
export const AD_SOFT_DEADLINE_MS = 8_000;

export type AdState =
  | "IDLE"
  | "NO_INTERNET"
  | "WAITING_FOR_NETWORK"
  | "LOADING"
  | "LOADED"
  | "NO_FILL"
  | "FAILED"
  | "TIMED_OUT";

type NetStatus = "none" | "unvalidated" | "online";

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

interface NetInfo { status: NetStatus; transport: string }

interface NativeAdsPlugin {
  getNetworkState(): Promise<NetInfo>;
  loadAd(options: { adId: string }): Promise<{ started: boolean; reason?: string }>;
  setBounds(options: NativeAdBounds): Promise<void>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  addListener(event: "networkChanged", cb: (d: NetInfo) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: "adLoaded", cb: () => void): Promise<{ remove: () => Promise<void> }>;
  addListener(
    event: "adFailed",
    cb: (d: { code: number; message: string; noFill: boolean }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const NativeAds = registerPlugin<NativeAdsPlugin>("NativeAds");

export const isNativeAdSupported = () => Capacitor.isNativePlatform();

// ── Store (useSyncExternalStore) ────────────────────────────────────────────
let state: AdState = "IDLE";
const listeners = new Set<() => void>();
function setState(next: AdState) {
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}
export function subscribeNativeAd(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export const getNativeAdState = (): AdState => state;
export const getServerNativeAdState = (): AdState => "IDLE";

// ── Scheduler ───────────────────────────────────────────────────────────────
let net: NetStatus = "online";
let requestInFlight = false;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
let foreground = true;
let screenActive = 0; // number of mounted ad slots (0 or 1)
let started = false;

function clearRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}
function clearDeadline() {
  if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  deadlineTimer = null;
}
const eligible = () => foreground && screenActive > 0 && state !== "LOADED";

function scheduleRetry() {
  if (retryTimer !== null || !eligible() || net !== "online") return;
  const delay = backoffDelay(attempt);
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestAd();
  }, delay);
}

function onNetwork(status: NetStatus) {
  const prev = net;
  net = status;
  if (state === "LOADED") return;
  if (status === "none") {
    clearRetry();
    if (!requestInFlight) setState("NO_INTERNET");
    return;
  }
  if (status === "unvalidated") {
    clearRetry();
    if (!requestInFlight) setState("WAITING_FOR_NETWORK");
    return;
  }
  // Connectivity restored → fresh schedule, single controlled attempt.
  if (prev !== "online") {
    attempt = 0;
    clearRetry();
    void requestAd();
  }
}

function onAdLoaded() {
  requestInFlight = false;
  clearDeadline();
  clearRetry();
  attempt = 0;
  // A late fill is shown only while the gallery is still active.
  setState("LOADED");
}

function onAdFailed(noFill: boolean) {
  requestInFlight = false;
  clearDeadline();
  if (state === "LOADED") return;
  if (net === "none") setState("NO_INTERNET");
  else if (net === "unvalidated") setState("WAITING_FOR_NETWORK");
  else setState(noFill ? "NO_FILL" : "FAILED");
  scheduleRetry();
}

async function requestAd(): Promise<void> {
  if (!isNativeAdSupported() || requestInFlight || !eligible()) return;
  if (net !== "online") {
    setState(net === "none" ? "NO_INTERNET" : "WAITING_FOR_NETWORK");
    return;
  }
  requestInFlight = true;
  setState("LOADING");
  clearRetry();
  clearDeadline();
  deadlineTimer = setTimeout(() => {
    deadlineTimer = null;
    // Soft deadline: show fallback, keep the SDK request alive; a late
    // adLoaded still transitions to LOADED, a late adFailed schedules a retry.
    if (state === "LOADING") setState("TIMED_OUT");
  }, AD_SOFT_DEADLINE_MS);
  try {
    const res = await NativeAds.loadAd({ adId: NATIVE_AD_UNIT_ID });
    if (!res.started && res.reason !== "LOAD_IN_PROGRESS" && res.reason !== "ALREADY_LOADED") {
      onAdFailed(false);
    }
  } catch {
    onAdFailed(false);
  }
}

async function start() {
  if (started) return;
  started = true;
  try {
    await NativeAds.addListener("networkChanged", (d) => onNetwork(d.status));
    await NativeAds.addListener("adLoaded", onAdLoaded);
    await NativeAds.addListener("adFailed", (d) => onAdFailed(!!d.noFill));
  } catch {
    /* plugin missing — slot stays as fallback */
  }
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appStateChange", ({ isActive }) => {
      foreground = isActive;
      if (!isActive) {
        clearRetry();
        return;
      }
      listeners.forEach((l) => l()); // re-place overlay after resume
      if (state !== "LOADED" && !requestInFlight) {
        attempt = 0;
        void requestAd();
      }
    });
  } catch {
    /* lifecycle listener unavailable */
  }
  try {
    net = (await NativeAds.getNetworkState()).status;
  } catch {
    net = typeof navigator !== "undefined" && navigator.onLine === false ? "none" : "online";
  }
}

/** Called by the slot on mount; returns the unmount cleanup. */
export function activateNativeAdSlot(): () => void {
  screenActive += 1;
  if (isNativeAdSupported()) {
    void start().then(() => {
      if (state === "LOADED") return;
      if (net !== "online") onNetwork(net);
      else if (!requestInFlight && retryTimer === null) void requestAd();
    });
  }
  return () => {
    screenActive = Math.max(0, screenActive - 1);
    if (screenActive === 0) clearRetry();
  };
}

export function setNativeAdBounds(bounds: NativeAdBounds) {
  if (!isNativeAdSupported()) return;
  void NativeAds.setBounds(bounds).catch(() => {});
}

export function hideNativeAd() {
  if (!isNativeAdSupported()) return;
  void NativeAds.hide().catch(() => {});
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
