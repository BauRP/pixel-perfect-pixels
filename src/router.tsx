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
 * - Native (Capacitor / Android WebView with `androidScheme: 'file'`) MUST use
 *   hash history. Under file:// the WebView has no origin, so any deep link
 *   or cold reload on a non-root path would 404 into a white screen.
 * - Web (Lovable preview, SSR, production browser) uses standard browser
 *   history so URLs stay clean and SSR/prerender work correctly.
 *
 * `Capacitor.isNativePlatform()` is safe to call on both the server and the
 * browser; it returns `false` anywhere that isn't a Capacitor runtime.
 */
function pickHistory() {
  if (typeof window === "undefined") return undefined; // SSR: let router default
  try {
    if (Capacitor.isNativePlatform()) return createHashHistory();
  } catch {
    // Fall through to browser history on any Capacitor detection error.
  }
  return createBrowserHistory();
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
  });

  return router;
};
