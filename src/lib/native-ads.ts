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
import { useSyncExternalStore } from "react";
import { backoffDelay } from "./backoff";

export { cssColorToHex } from "./css-color";
import { cssColorToHex } from "./css-color";

/** Production native ad unit (debuggable builds swap in Google's test unit natively). */
export const NATIVE_AD_UNIT_ID = "ca-app-pub-9902253594429663/1072650268";
export const AD_SOFT_DEADLINE_MS = 8_000;

export type AdState =
  | "IDLE"
  | "NO_INTERNET"
  | "WAITING_FOR_NETWORK"
  | "LOADING"
  | "LOADED"
  | "NO_FILL"
  | "FAILED"
  | "TIMED_OUT"
  | "CONSENT_PENDING"
  | "CONSENT_REQUIRED";

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
interface ConsentStatus { required: boolean; canRequestAds: boolean; resolved: boolean; debugFallback?: boolean }

interface NativeAdsPlugin {
  getNetworkState(): Promise<NetInfo>;
  loadAd(options: { adId: string }): Promise<{ started: boolean; reason?: string }>;
  setBounds(options: NativeAdBounds): Promise<{ shown: boolean; reason?: string }>;
  getConsentStatus(): Promise<ConsentStatus>;
  log(options: { level: "info" | "warn" | "error"; message: string }): Promise<void>;
  getBuildInfo(): Promise<{ testAds: boolean; allowUnvalidatedNetwork: boolean }>;
  hide(): Promise<void>;
  destroy(): Promise<void>;
  addListener(event: "networkChanged", cb: (d: NetInfo) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: "adLoaded" | "adGone", cb: () => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: "consentUpdated", cb: (d: ConsentStatus) => void): Promise<{ remove: () => Promise<void> }>;
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
const ERROR_STATES: AdState[] = ["FAILED"];
const WARN_STATES: AdState[] = [
  "NO_FILL", "TIMED_OUT", "NO_INTERNET", "WAITING_FOR_NETWORK", "CONSENT_PENDING", "CONSENT_REQUIRED",
];
let lastDetail = "";
/** Logs to the WebView console and forwards to Android logcat (tag NativeAds). */
function adLog(level: "info" | "warn" | "error", message: string) {
  const line = `[ads] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
  if (isNativeAdSupported()) void NativeAds.log({ level, message }).catch(() => {});
}
function setState(next: AdState, detail = "") {
  if (next === state && detail === lastDetail) return;
  const prev = state;
  state = next;
  lastDetail = detail;
  const level = ERROR_STATES.includes(next) ? "error" : WARN_STATES.includes(next) ? "warn" : "info";
  adLog(level, `${prev} → ${next}${detail ? ` (${detail})` : ""}`);
  listeners.forEach((l) => l());
}

/** True only for builds that use Google's test ad unit (debug); enables the on-tile state label. */
let testAdsBuild = false;
export const isTestAdsBuild = () => testAdsBuild;
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
let canRequestAds = false;

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

function onConsent(c: ConsentStatus) {
  setPrivacyRequired(!!c.required);
  const was = canRequestAds;
  canRequestAds = !!c.canRequestAds;
  if (c.debugFallback) adLog("warn", "consent unresolved — DEBUG fallback allows test ads only");
  if (!canRequestAds) {
    clearRetry();
    if (state !== "LOADED" && !requestInFlight) {
      setState(c.resolved ? "CONSENT_REQUIRED" : "CONSENT_PENDING",
        c.resolved ? "consent does not permit ad requests" : "waiting for consent info");
    }
    return;
  }
  if (!was && state !== "LOADED") {
    attempt = 0;
    setState("IDLE");
    void requestAd();
  }
}

/** Native side no longer holds an ad (destroyed / torn down): resync and reload. */
function onAdGone() {
  if (state !== "LOADED") return;
  setState("IDLE");
  attempt = 0;
  void requestAd();
}

function onAdFailed(noFill: boolean, detail = "") {
  requestInFlight = false;
  clearDeadline();
  if (state === "LOADED") return;
  if (net === "none") setState("NO_INTERNET", detail);
  else if (net === "unvalidated") setState("WAITING_FOR_NETWORK", detail);
  else setState(noFill ? "NO_FILL" : "FAILED", detail);
  scheduleRetry();
}

async function requestAd(): Promise<void> {
  if (!isNativeAdSupported() || requestInFlight || !eligible()) return;
  if (!canRequestAds) {
    // Never request (or retry) while consent forbids it; consentUpdated resumes us.
    clearRetry();
    return;
  }
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
    if (res.reason === "CONSENT_PENDING" || res.reason === "CONSENT_REQUIRED") {
      // Consent state, not an ad failure: no backoff loop.
      requestInFlight = false;
      clearDeadline();
      canRequestAds = false;
      setState(res.reason);
      return;
    }
    if (!res.started && res.reason !== "LOAD_IN_PROGRESS" && res.reason !== "ALREADY_LOADED") {
      onAdFailed(false, res.reason ?? "not started");
    }
  } catch (e) {
    onAdFailed(false, e instanceof Error ? e.message : String(e));
  }
}

async function start() {
  if (started) return;
  started = true;
  try {
    await NativeAds.addListener("networkChanged", (d) => onNetwork(d.status));
    await NativeAds.addListener("adLoaded", onAdLoaded);
    await NativeAds.addListener("adFailed", (d) => onAdFailed(!!d.noFill, `code ${d.code}: ${d.message}`));
    await NativeAds.addListener("adGone", onAdGone);
    // retainUntilConsumed on native side delivers a resolution that preceded this listener.
    await NativeAds.addListener("consentUpdated", onConsent);
  } catch (e) {
    adLog("error", `NativeAds plugin unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("appStateChange", ({ isActive }) => {
      foreground = isActive;
      if (!isActive) {
        clearRetry();
        return;
      }
      resumeListeners.forEach((l) => l()); // re-place overlay after resume
      if (state !== "LOADED" && !requestInFlight) {
        attempt = 0;
        void requestAd();
      }
    });
  } catch {
    /* lifecycle listener unavailable */
  }
  try {
    testAdsBuild = !!(await NativeAds.getBuildInfo()).testAds;
    listeners.forEach((l) => l());
  } catch {
    testAdsBuild = false;
  }
  try {
    onConsent(await NativeAds.getConsentStatus());
  } catch (e) {
    canRequestAds = false;
    adLog("error", `consent status unavailable: ${e instanceof Error ? e.message : String(e)}`);
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
      if (state === "LOADED" || !canRequestAds) return;
      if (net !== "online") onNetwork(net);
      else if (!requestInFlight && retryTimer === null) void requestAd();
    });
  }
  return () => {
    screenActive = Math.max(0, screenActive - 1);
    if (screenActive === 0) clearRetry();
  };
}

/** Places the overlay; if the native side reports it no longer has an ad, JS state is resynced. */
export function setNativeAdBounds(bounds: NativeAdBounds) {
  if (!isNativeAdSupported()) return;
  void NativeAds.setBounds(bounds)
    .then((r) => {
      if (r && r.reason === "NO_AD") onAdGone();
    })
    .catch(() => {});
}

/** Subscribe to foreground resumes so the slot can re-place the overlay. */
const resumeListeners = new Set<() => void>();
export function onAppResume(cb: () => void) {
  resumeListeners.add(cb);
  return () => {
    resumeListeners.delete(cb);
  };
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

// ── Google UMP privacy options (EEA / UK consent) ───────────────────────────
interface ConsentPlugin {
  getPrivacyOptionsStatus(): Promise<{ required: boolean }>;
  showPrivacyOptionsForm(): Promise<{ required: boolean }>;
}
const Consent = NativeAds as unknown as ConsentPlugin;

let privacyRequired = false;
let privacyWatch = false;
const privacyListeners = new Set<() => void>();
function setPrivacyRequired(v: boolean) {
  if (v === privacyRequired) return;
  privacyRequired = v;
  privacyListeners.forEach((l) => l());
}
function watchPrivacy() {
  if (privacyWatch || !isNativeAdSupported()) return;
  privacyWatch = true;
  void Consent.getPrivacyOptionsStatus().then((r) => setPrivacyRequired(!!r.required)).catch(() => {});
}

/** True only for users in a region where Google requires a privacy-options entry point. */
export function usePrivacyOptionsRequired(): boolean {
  return useSyncExternalStore(
    (cb) => {
      watchPrivacy();
      privacyListeners.add(cb);
      return () => {
        privacyListeners.delete(cb);
      };
    },
    () => privacyRequired,
    () => false,
  );
}

export async function showPrivacyOptions(): Promise<void> {
  if (!isNativeAdSupported()) return;
  try {
    const r = await Consent.showPrivacyOptionsForm();
    setPrivacyRequired(!!r.required);
    // Native also emits consentUpdated; refresh explicitly in case of a race.
    onConsent(await NativeAds.getConsentStatus());
  } catch {
    /* form unavailable */
  }
}
