import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import {
  activateNativeAdSlot, getNativeAdState, getServerNativeAdState, hideNativeAd,
  isNativeAdSupported, isTestAdsBuild, onAppResume, readThemeColors, setNativeAdBounds, subscribeNativeAd,
} from "@/lib/native-ads";

/** Height of the ad slot in CSS px (spans the full grid row; constant across states). */
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
 * First item of the gallery grid — a dedicated ad slot, never a real folder.
 * The container is always rendered (any network / ad state). When the SDK
 * delivers an ad, the Android shell paints a real NativeAdView on top of it;
 * otherwise a neutral, non-clickable placeholder is shown.
 */
export function NativeAdTile() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const state = useSyncExternalStore(subscribeNativeAd, getNativeAdState, getServerNativeAdState);
  const loaded = state === "LOADED";
  const label = t("ad_label");

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
  }, [loaded, label]);

  const pulsing = state === "LOADING" || state === "IDLE";
  // Debug-only state label (test-ad builds or the web dev server); never in release.
  const showDebug = !loaded && (isTestAdsBuild() || import.meta.env.DEV);

  return (
    <div
      ref={ref}
      aria-label={t("ad_sponsored")}
      data-ad-state={state}
      className="relative overflow-hidden rounded-3xl select-none"
      style={{
        gridColumn: "1 / -1",
        height: NATIVE_AD_TILE_HEIGHT,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      {(
        <div className="flex h-full items-center gap-3 p-3" aria-hidden="true">
          <div
            className={`h-full aspect-square rounded-2xl ${pulsing ? "animate-pulse" : ""}`}
            style={{ background: "var(--color-muted)" }}
          />
          <div className="min-w-0 flex-1 space-y-2">
            <span
              className="inline-block rounded px-1.5 text-[9px] font-bold"
              style={{ background: "var(--color-muted)", color: "var(--color-muted-foreground)" }}
            >
              {label}
            </span>
            <div
              className={`h-2.5 w-3/4 rounded ${pulsing ? "animate-pulse" : ""}`}
              style={{ background: "var(--color-muted)" }}
            />
            <div
              className={`h-2.5 w-1/2 rounded ${pulsing ? "animate-pulse" : ""}`}
              style={{ background: "var(--color-muted)" }}
            />
            {showDebug && (
              <p className="font-mono text-[9px] text-muted-foreground" data-ad-debug>
                ad: {state.toLowerCase().replace(/_/g, " ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
