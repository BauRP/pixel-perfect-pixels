import { useEffect, type ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { useApplyTheme } from "@/lib/theme";
import { applyDocumentDirection, ensureLangResolved, useLang } from "@/lib/i18n";
import { Capacitor } from "@capacitor/core";
import { useVault } from "@/lib/vault-store";
import { cssColorToHex } from "@/lib/css-color";
import { initSystemInsets, updateSystemBarAppearance } from "@/lib/system-insets";

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
  return (
    // Fixed app frame: [status bar inset] → [scrollable content] → [bottom nav].
    // The content is the ONLY scroll container, so sticky headers inside it
    // pin to the frame and never drift while scrolling.
    <div
      data-app-shell
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{
        paddingTop: "var(--app-safe-top)",
        paddingLeft: "var(--app-safe-left)",
        paddingRight: "var(--app-safe-right)",
        background: "var(--color-background)",
      }}
    >
      <div data-app-content className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
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
