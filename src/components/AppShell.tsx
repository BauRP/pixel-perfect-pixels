import { useEffect, type ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { useApplyTheme } from "@/lib/theme";
import { applyDocumentDirection, ensureLangResolved, useLang } from "@/lib/i18n";
import { Capacitor } from "@capacitor/core";
import { useVault } from "@/lib/vault-store";
import { cssColorToHex } from "@/lib/native-ads";

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
 * System status bar: the WebView is laid out BELOW the status bar
 * (`setOverlaysWebView(false)`), its background follows the app theme and
 * the icon colour contrasts with it. On Android 15+ (forced edge-to-edge)
 * the WebView may still extend under the bar; the frame below then pads its
 * top by `--app-safe-top`, so content never hides under the status icons.
 * The plugin is loaded lazily so the web build never touches it.
 */
function useSystemStatusBar() {
  const theme = useVault((s) => s.theme);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
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
        await StatusBar.setOverlaysWebView({ overlay: false });
        // Style.Light = dark icons (for a light background), Style.Dark = light icons.
        await StatusBar.setStyle({ style: light ? Style.Light : Style.Dark });
        if (/^#[0-9a-f]{6}$/i.test(bg)) await StatusBar.setBackgroundColor({ color: bg });
        await StatusBar.show();
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
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ paddingTop: "var(--app-safe-top)", background: "var(--color-background)" }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="mx-auto max-w-md pb-24">{children}</div>
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
        {right}
      </div>
    </header>
  );
}
