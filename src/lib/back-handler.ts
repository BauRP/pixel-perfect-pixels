// Central hardware back-button router (Android / Capacitor).
//
// UI layers (fullscreen viewers, overlays, modals, folder screens) register a
// handler while they are visible. On a hardware back press the MOST RECENTLY
// registered handler runs first; returning `true` means "handled, stop here".
// If nothing handles the press we fall back to browser history, and when the
// history is exhausted the app exits — matching native Android behaviour.

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

type Handler = () => boolean | void;

type Entry = { id: number; fn: Handler };

let stack: Entry[] = [];
let seq = 0;
let wired = false;

function runStack(): boolean {
  // Iterate from the top of the stack downwards.
  for (let i = stack.length - 1; i >= 0; i--) {
    const entry = stack[i];
    try {
      if (entry.fn() !== false) return true;
    } catch (e) {
      console.warn("[back] handler threw", e);
      return true;
    }
  }
  return false;
}

/** Wire the single native listener. Safe to call multiple times. */
export function initBackHandler() {
  if (wired || typeof window === "undefined") return;
  wired = true;

  if (Capacitor.isNativePlatform()) {
    void App.addListener("backButton", ({ canGoBack }) => {
      if (runStack()) return;
      if (canGoBack || window.history.length > 1) {
        window.history.back();
        return;
      }
      void App.exitApp();
    });
  } else {
    // Browser/preview parity: Escape mirrors the hardware back button so the
    // same code paths can be exercised outside the device.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (runStack()) e.preventDefault();
    });
  }
}

/**
 * Register a back handler while `active` is true.
 * Return `false` from `fn` to let lower layers handle the press.
 */
export function useBackHandler(active: boolean, fn: Handler) {
  useEffect(() => {
    if (!active) return;
    initBackHandler();
    const entry: Entry = { id: ++seq, fn };
    stack.push(entry);
    return () => { stack = stack.filter((e) => e.id !== entry.id); };
    // `fn` intentionally re-registered on identity change so it always closes
    // over fresh state.
  }, [active, fn]);
}