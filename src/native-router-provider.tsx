// Loaded ONLY after the lightweight Android startup surface commits.
// Keep the router and all generated route modules out of the initial
// WebView entry chunk. The website's router/SSR code is untouched.
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

const router = getRouter();

export function NativeRouterProvider() {
  return <RouterProvider router={router} />;
}
