// Only the Android standalone client uses this entry.
// The website keeps TanStack Start SSR unchanged.
import "./polyfills";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import { nativeStartupState, shouldShowBlockingBootOverlay } from "./lib/native-startup-state";

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

/**
 * Root-independent startup surface. React can commit while TanStack Router
 * indefinitely waits for an initial child route on Android 10/13. Until
 * a real route (or privacy page) has rendered, show an accessible loading
 * state and, after a bounded delay, a manual retry. No images or vault data
 * are touched, and this component does not certify gallery readiness.
 */
function NativeRouterBootMonitor() {
  const [status, setStatus] = useState<"quiet" | "loading" | "recovery" | "ready">("quiet");
  useEffect(() => {
    let alive = true;
    let lastReason = "";
    let routeReported = false;
    const inspect = () => nativeStartupState({
      isPrivacy: !!document.querySelector("[data-nova-privacy-screen]"),
      isErrorRecovery: !!document.querySelector("[data-nova-react-recovery]"),
      hasGalleryContent: !!document.querySelector("[data-nova-route-content]"),
      hasShell: !!document.querySelector("[data-app-shell]"),
      hasBottomTabs: !!document.querySelector("[data-bottom-nav]"),
      layoutPhase: document.documentElement.dataset.novaBootPhase ?? "",
    });
    const check = () => {
      if (!alive) return;
      const state = inspect();
      // A route-loading Promise is not proof that any UI is painted.
      // Report true route completion only when its React DOM is present.
      if (!routeReported && document.querySelector("[data-nova-route-content]")) {
        routeReported = true;
        console.info("[NovaBoot] router-load-resolved");
      }
      if (state !== lastReason) {
        console.info("[NovaBoot] state-" + state);
        lastReason = state;
      }
      // If the loading overlay appeared before the async child route, remove
      // it as soon as there is a real gallery shell, even if native
      // WindowInsets are still pending. Otherwise the overlay stays opaque
      // and the OS compositor check reports a black screen.
      if (state === "waiting-for-layout") {
        setStatus("quiet");
        return;
      }
      if (state !== "ready" && state !== "error-recovery") return;
      // Preserve AppShell's authoritative "gallery-layout-ready" marker:
      // overwriting it with "route-visible" made later health checks regress.
      console.info("[NovaBoot] route-visible");
      setStatus("ready");
      observer.disconnect();
      rootObserver.disconnect();
      clearTimeout(showLoading);
      clearTimeout(showRecovery);
    };
    const observer = new MutationObserver(check);
    const mount = document.getElementById("root");
    if (mount) observer.observe(mount, { childList: true, subtree: true });
    // AppShell sets this marker after Android geometry and tabs are verified.
    // The marker is not a DOM child mutation, so listen explicitly as well.
    const rootObserver = new MutationObserver(check);
    rootObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-nova-boot-phase"],
    });
    const showLoading = setTimeout(() => {
      if (alive && shouldShowBlockingBootOverlay(inspect()))
        setStatus("loading");
    }, 1800);
    const showRecovery = setTimeout(() => {
      if (alive && shouldShowBlockingBootOverlay(inspect())) {
        console.warn("[NovaBoot] startup-timeout=" + inspect());
        boot("router-route-timeout");
        setStatus("recovery");
      }
    }, 14000);
    check();
    return () => {
      alive = false;
      observer.disconnect();
      rootObserver.disconnect();
      clearTimeout(showLoading);
      clearTimeout(showRecovery);
    };
  }, []);
  if (status === "quiet" || status === "ready") return null;
  return (
    <div data-nova-router-boot-monitor role="status" aria-live="polite"
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "#101116", color: "#f5f5f7",
        display: "flex", alignItems: "center", justifyContent: "center",
        textAlign: "center", flexDirection: "column", gap: 16,
        padding: "calc(32px + env(safe-area-inset-top, 0px)) 24px calc(32px + env(safe-area-inset-bottom, 0px))",
        fontFamily: "system-ui, sans-serif",
      }}>
      <strong style={{ fontSize: 24 }}>Nova Gallery</strong>
      <span>{status === "loading" ? "Opening gallery…" :
        "The gallery is not responding. Your photos and Safe are unchanged."}</span>
      {status === "recovery" && (
        <button type="button" onClick={() => window.location.reload()}
          style={{ minHeight: 48, border: 0, borderRadius: 12, padding: "10px 22px",
            background: "#2563eb", color: "#ffffff", fontSize: 16 }}>
          Retry opening gallery
        </button>
      )}
    </div>
  );
}
boot("entry-loaded");
try {
  const mount = document.getElementById("root");
  if (!mount) throw new Error("Nova Android: #root is missing");
  const router = getRouter();
  boot("router-created");
  // RouterProvider owns initial navigation. Calling router.load() here
  // concurrently caused "route resolved" reports with no child route on
  // old Android WebViews. The monitor reports actual DOM commits instead.
  boot("react-render-scheduled");
  // AOSP API 29/33 logs reveal that asynchronous router.load() resolves
  // and a sibling commit marker mounts while RouterProvider never paints
  // its initial route. Force the *first* native React commit synchronously:
  // this makes the persistent loading UI and error boundary available even
  // if legacy Chromium stops scheduling concurrent frames. The website and
  // all subsequent route updates retain React's normal concurrent mode.
  flushSync(() => {
    createRoot(mount).render(
      <NativeStartupBoundary>
        <NativeReactCommitMarker />
        <NativeRouterBootMonitor />
        <RouterProvider router={router} />
      </NativeStartupBoundary>,
    );
  });
  boot("react-initial-flush-finished");
} catch (error) {
  boot("react-mount-error");
  console.error("[NovaBoot] React client bootstrap failed", error);
  throw error; // The independent inline HTML fallback handles the error.
}
