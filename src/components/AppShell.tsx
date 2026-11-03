import { useEffect, type ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { useApplyTheme } from "@/lib/theme";
import { applyDocumentDirection, ensureLangResolved, useLang } from "@/lib/i18n";
import { Capacitor } from "@capacitor/core";
import { useVault } from "@/lib/vault-store";
import { cssColorToHex } from "@/lib/css-color";
import { initSystemInsets, updateSystemBarAppearance, signalGalleryUiReady, refreshSystemInsetsForViewport } from "@/lib/system-insets";
import { assessGalleryLayout, type GalleryLayoutEvidence } from "@/lib/gallery-geometry";

/**
 * First launch after install: detect the device locale, map it to one of the
 * supported languages (English when unsupported) and persist it. Later
 * launches simply reuse the stored preference. The active language is also
 * mirrored onto <html lang>; structural direction remains left-to-right.
 */
function useResolvedLanguage() {
  const [lang] = useLang();
  // One effect only: resolving and mirroring must not race, otherwise a stale
  // `lang` from the first render can overwrite the just-detected language.
  useEffect(() => {
    const resolved = ensureLangResolved();
    applyDocumentDirection(resolved);
  }, [lang]);
}

/**
 * System status bar: the native WebView draws edge-to-edge. The app frame
 * uses live Android WindowInsetsCompat (plus CSS env on newer WebViews)
 * to keep all interactive content outside the actual system bars and cutouts.
 * The icon colour contrasts with the currently selected theme.
 * The plugin is loaded lazily so the web build never touches it.
 */
function useSystemStatusBar() {
  const theme = useVault((s) => s.theme);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    initSystemInsets();
    let cancelled = false;
    const sync = async () => {
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        if (cancelled) return;
        const light = document.documentElement.classList.contains("light");
        const bg = cssColorToHex(
          getComputedStyle(document.documentElement).getPropertyValue("--color-background").trim(),
          light ? "#f9fafb" : "#000000",
        );
        // Android 16+ enforces edge-to-edge; the old overlay flag no longer works.
        // Insets are taken from the OS instead of toggling this property.
        // Style.Light = dark icons (for a light background), Style.Dark = light icons.
        await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
        if (/^#[0-9a-f]{6}$/i.test(bg)) await StatusBar.setBackgroundColor({ color: bg });
        await StatusBar.show();
        await updateSystemBarAppearance(light);
      } catch (error) {
        console.warn("[status-bar] unavailable", error);
      }
    };
    // The theme class is applied in an effect; wait one frame so it is set.
    const frame = requestAnimationFrame(() => void sync());
    // OS bar appearance is synchronized on theme mutations, not on every
    // viewport measurement. This avoids a continuous native resize loop.
    const observer = new MutationObserver(() => void sync());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [theme]);
}

export function AppShell({ children }: { children: ReactNode }) {
  useApplyTheme();
  useResolvedLanguage();
  useSystemStatusBar();
  useEffect(() => {
    refreshSystemInsetsForViewport();
    // Real DOM geometry travels through the existing native plugin.
    // Old Chromium evaluateJavascript callbacks can stall even if UI mounted.
    let firstFrame = 0;
    let secondFrame = 0;
    let pendingRetry: ReturnType<typeof setTimeout> | undefined;
    let insetRetryCount = 0;
    const MAX_INSET_RETRIES = 8;
    const report = () => {
      const shell = document.querySelector("[data-app-shell]");
      const nav = document.querySelector("[data-bottom-nav]");
      const content = document.querySelector("[data-app-content]");
      const box = nav?.getBoundingClientRect();
      if (!shell || !nav || !content || !box || box.width < 100 || box.height < 36) return;
      const links = Array.from(nav.querySelectorAll("a")).map(a => a.getBoundingClientRect());
      if (!links.length) return;
      const css = getComputedStyle(nav);
      const root = document.documentElement;
      const values: GalleryLayoutEvidence = {
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
        navBottom: box.bottom, navWidth: box.width, navHeight: box.height,
        navInnerBottom: box.bottom - (parseFloat(css.paddingBottom) || 0),
        navInnerLeft: box.left + (parseFloat(css.paddingLeft) || 0),
        navInnerRight: box.right - (parseFloat(css.paddingRight) || 0),
        links: links.length,
        minLinkWidth: Math.min(...links.map(x => x.width)),
        minLinkHeight: Math.min(...links.map(x => x.height)),
        maxLinkBottom: Math.max(...links.map(x => x.bottom)),
        minLinkLeft: Math.min(...links.map(x => x.left)),
        maxLinkRight: Math.max(...links.map(x => x.right)),
        contentTop: content.getBoundingClientRect().top,
        safeTop: parseFloat(getComputedStyle(root).getPropertyValue("--native-safe-top")) || 0,
        nativeInsetsReady: root.dataset.novaInsetsReady === "true",
        imeOpen: root.dataset.imeOpen === "true",
      };
      const layoutIssue = assessGalleryLayout(values);
      if (layoutIssue === "OK") {
        root.dataset.novaBootPhase = "gallery-layout-ready";
      }
      signalGalleryUiReady({ ...values, layoutIssue });
      // Some OEMs dispatch their first inset measurement after the first
      // painted React frame. Retry a bounded snapshot without spinning.
      if (!values.nativeInsetsReady && insetRetryCount < MAX_INSET_RETRIES) {
        insetRetryCount++;
        pendingRetry = setTimeout(() => {
          refreshSystemInsetsForViewport();
          schedule();
        }, 1200);
      } else if (values.nativeInsetsReady) {
        insetRetryCount = 0;
      }
    };
    const schedule = () => {
      if (pendingRetry !== undefined) clearTimeout(pendingRetry);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(report);
      });
    };
    schedule();
    document.addEventListener("nova-native-insets", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("focus", schedule);
    return () => {
      if (pendingRetry !== undefined) clearTimeout(pendingRetry);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      document.removeEventListener("nova-native-insets", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, []);
  return (
    // Fixed app frame: [status bar inset] → [scrollable content] → [bottom nav].
    // The content is the ONLY scroll container, so sticky headers inside it
    // pin to the frame and never drift while scrolling.
    <div
      data-app-shell
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, left: 0,
        display: "flex", flexDirection: "column", overflow: "hidden",
        paddingTop: "var(--app-safe-top)",
        paddingLeft: "var(--app-safe-left)",
        paddingRight: "var(--app-safe-right)",
        background: "var(--color-background)",
      }}
    >
      <div data-app-content className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        style={{ flex: "1 1 auto", minHeight: 0, minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
        <div
          className="mx-auto w-full max-w-5xl"
          style={{ paddingBottom: "var(--app-nav-reserve)", minWidth: 0 }}
        >
          {children}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

export function ScreenHeader({
  title, subtitle, right, back,
}: { title: string; subtitle?: string; right?: ReactNode; back?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 glass-strong px-4 pt-2 pb-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          {back}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-tight">{title}</h1>
            {subtitle && (
              <p className="truncate text-[11px] text-muted-foreground leading-tight">{subtitle}</p>
            )}
          </div>
        </div>
        {right && <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">{right}</div>}
      </div>
    </header>
  );
}
