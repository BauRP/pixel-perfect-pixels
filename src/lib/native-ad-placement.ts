/**
 * An Android native ad is a real View rendered above WebView. Popup state is
 * not an ad-visibility state: only actual physical overlap may obscure it.
 * This module is pure and can be tested without the Android runtime.
 */
export interface PlacementRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectanglesOverlap(a: PlacementRect, b: PlacementRect): boolean {
  const values = [a.left, a.top, a.right, a.bottom, b.left, b.top, b.right, b.bottom];
  if (!values.every(Number.isFinite)) return false;
  return a.right > b.left && b.right > a.left &&
    a.bottom > b.top && b.bottom > a.top;
}

/**
 * Send one Capacitor bridge command at a time. When menu mutations, scrolling,
 * resizing and resumed activity generate commands during a native call, keep
 * only the most recent desired state, including a final hide on unmount.
 */
export function createLatestAsyncDispatcher<T>(
  sender: (value: T) => Promise<unknown>,
  onFailure?: () => void,
): (value: T) => void {
  let inFlight = false;
  let pending: { value: T } | null = null;
  const drain = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      while (pending !== null) {
        const current = pending;
        pending = null;
        try {
          await sender(current.value);
        } catch {
          // A temporary native bridge failure must not prevent a later
          // placement or the final hide from being delivered.
          try { onFailure?.(); } catch { /* do not break the queue */ }
        }
      }
    } finally {
      inFlight = false;
      if (pending !== null) void drain();
    }
  };
  return (value: T) => {
    pending = { value };
    void drain();
  };
}
