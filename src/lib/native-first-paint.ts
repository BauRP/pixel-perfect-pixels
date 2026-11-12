import { useEffect, useState } from "react";

/**
 * On legacy Android Chromium, synchronous mounting of the complete route
 * provider before the first UI frame can starve the WebView renderer.
 * Let the minimal native boot surface paint first, then mount all routes.
 *
 * A fixed deadline is mandatory: WebView may suppress rAF in headless/old
 * compositors. The full gallery still loads even when rAF never fires.
 */
export function useNativeFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    let fired = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    const startRouter = () => {
      if (!alive || fired) return;
      fired = true;
      clearTimeout(deadline);
      setReady(true);
    };
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        frameTimer = setTimeout(startRouter, 0);
      });
    });
    // No dependence on graphics callbacks: old WebViews may never emit rAF.
    const deadline = setTimeout(startRouter, 450);
    return () => {
      alive = false;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (frameTimer !== undefined) clearTimeout(frameTimer);
      clearTimeout(deadline);
    };
  }, []);
  return ready;
}
