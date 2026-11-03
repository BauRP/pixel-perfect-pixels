// MUST be the very first import so legacy Android WebView (Chrome 74 on
// Android 9) receives String.prototype.replaceAll and other ES2020+ prototype
// methods before any other module (including third-party libraries) runs.
import "./polyfills";

import { QueryClient } from "@tanstack/react-query";
import {
  createRouter,
  createHashHistory,
  createBrowserHistory,
} from "@tanstack/react-router";
import { Capacitor } from "@capacitor/core";
import { routeTree } from "./routeTree.gen";

/**
 * Dual-environment history:
 * - Native Capacitor WebView uses local https://localhost/ served from APK.
 *   Hash history preserves offline deep-link reloads without requesting
 *   nonexistent asset routes from the local server.
 * - Web (Lovable preview, SSR, production browser) uses standard browser
 *   history so URLs stay clean and SSR/prerender work correctly.
 *
 * `Capacitor.isNativePlatform()` is safe to call on both the server and the
 * browser; it returns `false` anywhere that isn't a Capacitor runtime.
 */
function pickHistory() {
  if (typeof window === "undefined") return undefined; // SSR: let router default
  try {
    // The isolated Android SPA is always packaged at https://localhost.
    // Capacitor's JS bridge may arrive asynchronously on old WebViews; never
    // choose browser history on first render merely because it is not ready.
    // This prevents an offline deep-link/boot route mismatch on reload.
    if (import.meta.env.VITE_CAPACITOR_BUILD === "1" ||
        Capacitor.isNativePlatform()) return createHashHistory();
  } catch {
    // Fall through to browser history on any Capacitor detection error.
  }
  return createBrowserHistory();
}

/**
 * A delayed TanStack route must not erase the static Android boot screen
 * into another all-black viewport. This is deliberately not reported as
 * gallery-ready: the real AppShell must still mount and prove its geometry.
 */
function NativeRoutePending() {
  return (
    <div
      data-nova-route-pending="true"
      role="status"
      aria-live="polite"
      style={{
        minHeight: "70vh", padding: "calc(40px + env(safe-area-inset-top, 0px)) 20px 40px",
        background: "#101116", color: "#f5f5f7",
        display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", fontFamily: "system-ui, sans-serif", fontSize: "16px",
      }}
    >
      Nova Gallery is loading…
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();
  const history = pickHistory();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Native WebView: render a visible loading boundary when a route takes
    // longer than expected. It does not certify that any tabs are usable.
    ...(import.meta.env.VITE_CAPACITOR_BUILD === "1"
      ? { defaultPendingComponent: NativeRoutePending,
          defaultPendingMs: 500, defaultPendingMinMs: 700 }
      : {}),
  });

  return router;
};
