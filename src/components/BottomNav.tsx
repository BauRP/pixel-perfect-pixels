import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Images, Lock, Settings as SettingsIcon } from "lucide-react";
import { useT } from "@/lib/i18n";

export function BottomNav() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navRef = useRef<HTMLElement>(null);

  // Reserve precisely the nav's actual content height, not a fixed guess.
  // Handles font scaling, rotation, narrow/wide screens and different labels.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const setHeight = () => {
      const root = document.documentElement;
      // Full rendered bar already includes the OS gesture/button inset.
      const measured = el.getBoundingClientRect().height;
      // Hidden during text input; do not reserve space underneath the IME.
      // On WebViews with older Tailwind/CSS support, derive the full nav
      // height from the actually rendered element, never a fixed device mode.
      const nextHeight = Math.max(0, measured) + "px";
      // Avoid a style mutation feedback loop with our own MutationObserver.
      if (root.style.getPropertyValue("--app-measured-nav-height") !== nextHeight) {
        root.style.setProperty("--app-measured-nav-height", nextHeight);
      }
    };
    setHeight();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(setHeight);
      observer.observe(el);
    }
    window.addEventListener("resize", setHeight);
    const insetObserver = new MutationObserver(setHeight);
    insetObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ["style", "data-ime-open"],
    });
    return () => {
      observer?.disconnect();
      insetObserver.disconnect();
      window.removeEventListener("resize", setHeight);
      document.documentElement.style.removeProperty("--app-measured-nav-height");
    };
  }, []);

  const items = [
    { to: "/", label: t("gallery"), Icon: Images, match: (p: string) => p === "/" || p.startsWith("/gallery") },
    { to: "/safe", label: t("safe"), Icon: Lock, match: (p: string) => p.startsWith("/safe") },
    { to: "/settings", label: t("settings"), Icon: SettingsIcon, match: (p: string) => p.startsWith("/settings") },
  ] as const;

  return (
    <nav
      ref={navRef}
      className="glass-strong fixed inset-x-0 bottom-0 z-50 pt-1"
      aria-label={t("primary_nav")}
      data-bottom-nav
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        zIndex: 50,
        paddingLeft: "var(--app-safe-left)",
        paddingRight: "var(--app-safe-right)",
        paddingBottom: "calc(var(--app-safe-bottom) + 0.25rem)",
      }}
    >
      <ul className="mx-auto flex max-w-5xl items-stretch justify-around px-3"
        style={{ display: "flex", paddingLeft: "0.75rem", paddingRight: "0.75rem", margin: "0 auto", listStyle: "none" }}>
        {items.map(({ to, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to} className="min-w-0 flex-1" style={{ flex: "1 1 0%", minWidth: 0 }}>
              <Link
                to={to}
                className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl px-2 py-1 transition-colors"
                style={{
                  // 44px remains functional even on old WebViews that ignore
                  // Tailwind's generated calc(var(--spacing) * 11) rule.
                  minHeight: "44px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "4px 8px",
                  textDecoration: "none",
                  color: active ? "var(--color-accent)" : "var(--color-muted-foreground)",
                }}
              >
                <span
                  className="relative flex h-7 w-9 items-center justify-center rounded-xl transition-all"
                  style={{
                    background: active
                      ? "var(--color-muted)"
                      : "transparent",
                  }}
                >
                  <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                </span>
                <span className="max-w-full truncate text-[9px] font-medium tracking-wide uppercase leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
