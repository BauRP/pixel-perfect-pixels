// Only the Android standalone client uses this entry.
// The website keeps TanStack Start SSR unchanged.
import "./polyfills";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

// A lightweight phase marker lets native regression reports identify where
// startup stalled. It contains no photo, account, or other user information.
const boot = (phase: string) => {
  document.documentElement.dataset.novaBootPhase = phase;
  console.info("[NovaBoot] " + phase);
};
boot("entry-loaded");
try {
  const mount = document.getElementById("root");
  if (!mount) throw new Error("Nova Android: #root is missing");
  const router = getRouter();
  boot("router-created");
  createRoot(mount).render(<RouterProvider router={router} />);
  boot("react-render-scheduled");
} catch (error) {
  boot("react-mount-error");
  console.error("[NovaBoot] React client bootstrap failed", error);
  throw error; // The independent inline HTML fallback handles the error.
}
