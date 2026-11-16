// Loaded ONLY after the lightweight Android startup surface commits.
// Keep the router and all generated route modules out of the initial
// WebView entry chunk. The website's router/SSR code is untouched.
import { RouterProvider } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { getRouter } from "./router";

const router = getRouter();

export function NativeRouterProvider() {
  // Chunk import is not proof that React committed the provider.
  useLayoutEffect(() => console.info("[NovaBoot] router-provider-committed"), []);
  return <RouterProvider router={router} />;
}
