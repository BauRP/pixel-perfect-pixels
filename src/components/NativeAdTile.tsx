import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import {
  activateNativeAdSlot, getNativeAdState, getServerNativeAdState, hideNativeAd,
  isNativeAdSupported, onAppResume, readThemeColors, setNativeAdBounds, subscribeNativeAd,
} from "@/lib/native-ads";

import { rectanglesOverlap } from "@/lib/native-ad-placement";

/**
 * The native card is an Android sibling of WebView. A popup should only
 * obscure it if the popup actually intersects the ad's tile. Merely
 * mounting/opening the three-dot menu elsewhere must never affect the ad.
 */
const POPUP_SELECTOR = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']";

function popupCoversAd(ad: DOMRect): boolean {
  for (const popup of document.querySelectorAll<HTMLElement>(POPUP_SELECTOR)) {
    if (popup.getAttribute("data-state") === "closed" ||
        popup.closest('[aria-hidden="true"]') ||
        popup.getClientRects().length === 0) continue;
    const style = getComputedStyle(popup);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (rectanglesOverlap(ad, popup.getBoundingClientRect())) return true;
  }
  return false;
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement ?? null;
  while (n) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
    n = n.parentElement;
  }
  return null;
}

/**
 * First cell of the folder grid — a square, single-column ad card sized
 * exactly like a folder tile for the active column count. Always rendered as a placeholder;
 * once the SDK reports LOADED the Android shell paints a real
 * NativeAdView over this rect.
 */
export function NativeAdTile({ columns }: { columns: number }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const state = useSyncExternalStore(subscribeNativeAd, getNativeAdState, getServerNativeAdState);
  const loaded = state === "LOADED";
  const label = t("ad_label");
  const dense = columns >= 4;

  useEffect(() => activateNativeAdSlot(), []);

  useEffect(() => {
    if (!isNativeAdSupported() || !loaded) return;
    const el = ref.current;
    if (!el) return;
    const scroller = findScrollParent(el);
    let frame = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let colors = readThemeColors();

    const sync = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = null;
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>("[data-sticky-header]");
      const nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
      const sr = scroller?.getBoundingClientRect();
      const clipTop = Math.max(sr?.top ?? 0, header?.getBoundingClientRect().bottom ?? 0);
      const clipBottom = Math.min(
        sr?.bottom ?? window.innerHeight,
        nav?.getBoundingClientRect().top ?? window.innerHeight,
      );
      setNativeAdBounds({
        x: r.left, y: r.top, width: r.width, height: r.height,
        clipTop, clipBottom, visible: !popupCoversAd(r), label, colors,
      });
    };
    const schedule = () => {
      if (frame || fallbackTimer !== null) return;
      // Older WebViews can stall requestAnimationFrame until the first tap.
      // Never require a three-dot menu interaction to place the loaded ad.
      frame = requestAnimationFrame(sync);
      fallbackTimer = setTimeout(sync, 180);
    };

    const themeObserver = new MutationObserver(() => {
      colors = readThemeColors();
      schedule();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const overlayObserver = new MutationObserver(schedule);
    overlayObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const offResume = onAppResume(sync);
    // The ad is already loaded: place it immediately, independently of menu
    // mutations, and remeasure once the first layout has settled.
    sync();
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      themeObserver.disconnect();
      overlayObserver.disconnect();
      resize.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      offResume();
      hideNativeAd();
    };
  }, [loaded, label, columns]);

  // Always rendered: a permanent first-cell placeholder with the exact box of
  // a folder card (same padding, radius, square preview, two text lines).
  // When LOADED, the native NativeAdView is painted over this rect; otherwise
  // the overlay is hidden (effect cleanup) and the placeholder stays.
  return (
    <div
      ref={ref}
      aria-label={t("ad_sponsored")}
      data-ad-state={state}
      className={`relative overflow-hidden select-none ${dense ? "rounded-2xl p-1.5" : "rounded-3xl p-3"}`}
      style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
    >
      <div
        className={`aspect-square w-full ${dense ? "rounded-xl" : "rounded-2xl"}`}
        style={{ background: "var(--color-muted)" }}
      />
      <div className={dense ? "mt-1.5" : "mt-3"}>
        <div className={`truncate font-semibold ${dense ? "text-[11px]" : "text-sm"}`}>{label}</div>
        <div className={`truncate text-muted-foreground ${dense ? "text-[9px]" : "text-[11px]"}`}>
          {t("ad_sponsored")}
        </div>
      </div>
    </div>
  );
}
