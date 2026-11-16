import { useEffect, useState, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { useNativeFirstPaint } from "../lib/native-first-paint";

/**
 * On older WebViews, a synchronous import of the generated route tree
 * evaluates every page, vault/ad module and UI component before any React
 * startup pixels can be committed. Load the full router as a separate,
 * local-only APK chunk after the first lightweight frame or the bounded
 * 450ms compositor fallback. All screens still mount normally afterwards.
 */
export function NativeFirstPaintRouter({ onRouterLoaded }: { onRouterLoaded: () => void }) {
  const ready = useNativeFirstPaint();
  const [Provider, setProvider] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    void import("../native-router-provider").then(({ NativeRouterProvider }) => {
      if (!active) return;
      onRouterLoaded();
      // First router mount must not depend on a deferred React scheduler
      // turn after the offline startup surface had its paint opportunity.
      flushSync(() => setProvider(() => NativeRouterProvider));
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [ready, onRouterLoaded]);

  // The outer error boundary renders an accessible Retry action. Never
  // silently swallow a failed local module/chunk load into a black screen.
  if (failed) throw new Error("Android native route bundle failed to load");

  if (Provider) return <Provider />;
  return (
    <div data-nova-route-pending="true" role="status" aria-live="polite"
      style={{
        minHeight: "75vh", padding: "48px 24px",
        background: "#101116", color: "#f5f5f7",
        fontFamily: "system-ui, sans-serif", fontSize: 16,
      }}>
      Nova Gallery is starting…
    </div>
  );
}
