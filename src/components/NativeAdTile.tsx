import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import {
  activateNativeAdSlot, getNativeAdState, getServerNativeAdState, hideNativeAd,
  isNativeAdSupported, onAppResume, readThemeColors, setNativeAdBounds, subscribeNativeAd,
} from "@/lib/native-ads";

/** Anything drawn ABOVE the grid that the native overlay must not cover. */
const OVERLAY_SELECTOR =
  "[data-radix-popper-content-wrapper], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox']";

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
    let colors = readThemeColors();

    const sync = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const header = document.querySelector<HTMLElement>("[data-sticky-header]");
      const nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
      const sr = scroller?.getBoundingClientRect();
      const clipTop = Math.max(sr?.top ?? 0, header?.getBoundingClientRect().bottom ?? 0);
      const clipBottom = Math.min(
        sr?.bottom ?? window.innerHeight,
        nav?.getBoundingClientRect().top ?? window.innerHeight,
      );
      const covered = document.querySelector(OVERLAY_SELECTOR) !== null;
      setNativeAdBounds({
        x: r.left, y: r.top, width: r.width, height: r.height,
        clipTop, clipBottom, visible: !covered, label, colors,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const themeObserver = new MutationObserver(() => {
      colors = readThemeColors();
      schedule();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const overlayObserver = new MutationObserver(schedule);
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const offResume = onAppResume(schedule);
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      themeObserver.disconnect();
      overlayObserver.disconnect();
      resize.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
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
