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
      const total = el.getBoundingClientRect().height;
      const nextHeight = Math.max(0, total) + "px";
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
      className="glass-strong fixed inset-x-0 bottom-0 z-50 pb-[max(var(--app-safe-bottom),0.25rem)] pt-1"
      aria-label={t("primary_nav")}
      data-bottom-nav
      style={{ paddingLeft: "var(--app-safe-left)", paddingRight: "var(--app-safe-right)" }}
    >
      <ul className="mx-auto flex max-w-5xl items-stretch justify-around px-3">
        {items.map(({ to, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1 transition-colors"
                style={{
                  color: active ? "var(--color-accent)" : "var(--color-muted-foreground)",
                }}
              >
                <span
                  className="relative flex h-7 w-9 items-center justify-center rounded-xl transition-all"
                  style={{
                    background: active
                      ? "color-mix(in oklab, var(--color-accent) 15%, transparent)"
                      : "transparent",
                  }}
                >
                  <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                </span>
                <span className="text-[9px] font-medium tracking-wide uppercase leading-none">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
