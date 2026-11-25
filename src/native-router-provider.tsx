// Loaded ONLY after the lightweight Android startup surface commits.
// Keep the router and all generated route modules out of the initial
// WebView entry chunk. The website's router/SSR code is untouched.
import { RouterProvider } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { getRouter } from "./router";
import { shouldRetryNativeRoute } from "./lib/native-route-recovery";

const router = getRouter();

export function NativeRouterProvider() {
  // API29/30 old Chromium occasionally mounts the provider but never
  // commits its asynchronous first child route. One bounded retry refreshes
  // the router without reloading WebView or touching any user files.
  useLayoutEffect(() => {
    console.info("[NovaBoot] router-provider-committed");
    const timer = setTimeout(() => {
      if (!shouldRetryNativeRoute({
        visible: document.visibilityState === "visible",
        hasRoute: !!document.querySelector("[data-nova-route-content]"),
        hasPrivacy: !!document.querySelector("[data-nova-privacy-screen]"),
        hasRecovery: !!document.querySelector("[data-nova-react-recovery], [data-nova-error]"),
      })) return;
      console.warn("[NovaBoot] initial-route-retry-once");
      void router.invalidate().catch(() => {
        console.warn("[NovaBoot] initial-route-retry-failed");
      });
    }, 4500);
    return () => clearTimeout(timer);
  }, []);
  return <RouterProvider router={router} />;
}
