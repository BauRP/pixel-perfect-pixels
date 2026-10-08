import { Link, useRouterState } from "@tanstack/react-router";
import { Images, Lock, Settings as SettingsIcon } from "lucide-react";
import { useT } from "@/lib/i18n";

export function BottomNav() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const items = [
    { to: "/", label: t("gallery"), Icon: Images, match: (p: string) => p === "/" || p.startsWith("/gallery") },
    { to: "/safe", label: t("safe"), Icon: Lock, match: (p: string) => p.startsWith("/safe") },
    { to: "/settings", label: t("settings"), Icon: SettingsIcon, match: (p: string) => p.startsWith("/settings") },
  ] as const;

  return (
    <nav
      className="glass-strong fixed inset-x-0 bottom-0 z-50 pb-[max(var(--app-safe-bottom),0.25rem)] pt-1"
      aria-label={t("primary_nav")}
      data-bottom-nav
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-3">
        {items.map(({ to, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                className="flex flex-col items-center gap-0.5 rounded-2xl px-2 py-1 transition-colors"
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
