// Only the Android standalone client uses this entry.
// The website keeps TanStack Start SSR unchanged.
import "./polyfills";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";

// A lightweight phase marker lets native regression reports identify where
// startup stalled. It contains no photo, account, or other user information.
const boot = (phase: string) => {
  document.documentElement.dataset.novaBootPhase = phase;
  console.info("[NovaBoot] " + phase);
};

/**
 * TanStack route errors may occur during React's asynchronous render, long
 * after createRoot().render() returned. A surrounding try/catch does not
 * capture those errors. Show a real, accessible offline recovery component
 * rather than leaving a permanently black WebView.
 */
class NativeStartupBoundary extends Component<
  { children: ReactNode }, { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Never log exception messages that might include a private filename.
    boot("react-render-error");
    console.error("[NovaBoot] React render failed");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" data-nova-react-recovery
        style={{
          minHeight: "80vh", padding: "72px 24px 40px",
          background: "#101116", color: "#f5f5f7",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}>
        <h1 style={{ fontSize: 24 }}>Nova Gallery</h1>
        <p>The gallery could not finish opening. Your files are unchanged.</p>
        <button type="button" onClick={() => window.location.reload()}
          style={{ minHeight: 48, padding: "10px 20px", color: "white",
            background: "#2563eb", border: 0, borderRadius: 12 }}>
          Retry gallery
        </button>
      </div>
    );
  }
}

function NativeReactCommitMarker() {
  useEffect(() => boot("react-root-committed"), []);
  return null;
}
boot("entry-loaded");
try {
  const mount = document.getElementById("root");
  if (!mount) throw new Error("Nova Android: #root is missing");
  const router = getRouter();
  boot("router-created");
  createRoot(mount).render(
    <NativeStartupBoundary>
      <NativeReactCommitMarker />
      <RouterProvider router={router} />
    </NativeStartupBoundary>,
  );
  boot("react-render-scheduled");
} catch (error) {
  boot("react-mount-error");
  console.error("[NovaBoot] React client bootstrap failed", error);
  throw error; // The independent inline HTML fallback handles the error.
}
