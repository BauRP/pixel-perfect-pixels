import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import {
  getNativeAdLoaded, getServerNativeAdLoaded, hideNativeAd, isNativeAdSupported,
  loadNativeAd, readThemeColors, setNativeAdBounds, subscribeNativeAd,
} from "@/lib/native-ads";

/** Height of the native ad tile in CSS px (spans the full grid row). */
export const NATIVE_AD_TILE_HEIGHT = 140;

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
 * First item of the gallery grid — always the Google AdMob native ad.
 * The tile reserves the slot; the Android shell paints the real ad on top of
 * it and the overlay follows the tile while scrolling.
 */
export function NativeAdTile() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useSyncExternalStore(subscribeNativeAd, getNativeAdLoaded, getServerNativeAdLoaded);
  const label = t("ad_label");

  useEffect(() => {
    void loadNativeAd();
  }, []);

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
      const clipBottom = Math.min(sr?.bottom ?? window.innerHeight, nav?.getBoundingClientRect().top ?? window.innerHeight);
      const covered = document.querySelector(OVERLAY_SELECTOR) !== null;
      setNativeAdBounds({
        x: r.left, y: r.top, width: r.width, height: r.height,
        clipTop, clipBottom, visible: !covered, label, colors,
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };

    const themeObserver = new MutationObserver(() => { colors = readThemeColors(); schedule(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const overlayObserver = new MutationObserver(schedule);
    overlayObserver.observe(document.body, { childList: true, subtree: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      themeObserver.disconnect();
      overlayObserver.disconnect();
      resize.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      hideNativeAd();
    };
  }, [loaded, label]);

  return (
    <div
      ref={ref}
      aria-label={t("ad_sponsored")}
      className="relative overflow-hidden rounded-3xl"
      style={{
        gridColumn: "1 / -1",
        height: NATIVE_AD_TILE_HEIGHT,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      {!loaded && (
        <div className="flex h-full items-center gap-3 p-3">
          <div className="h-full aspect-square rounded-2xl animate-pulse" style={{ background: "var(--color-muted)" }} />
          <div className="min-w-0 flex-1 space-y-2">
            <span
              className="inline-block rounded px-1.5 text-[9px] font-bold"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-foreground)" }}
            >
              {label}
            </span>
            <p className="truncate text-[11px] text-muted-foreground">{t("ad_sponsored")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
