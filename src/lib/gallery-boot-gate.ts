/**
 * Run optional startup work only after Android has reported a real measured
 * gallery layout. The callback is asynchronous even if layout is already
 * ready, so the caller can always assign/cancel the returned subscription.
 * A cancelled or unmounted slot must never start an old native operation.
 */
export function afterMeasuredGalleryLayout(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  let finished = false;
  let cancelled = false;
  let observer: MutationObserver | null = null;
  const check = () => {
    if (finished || cancelled || root.dataset.novaBootPhase !== "gallery-layout-ready") return;
    finished = true;
    observer?.disconnect();
    // Don't launch optional Capacitor bridge calls during the layout effect
    // which has just declared the measured gallery ready.
    void Promise.resolve().then(() => {
      if (!cancelled) callback();
    });
  };
  if (typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(check);
    observer.observe(root, { attributes: true, attributeFilter: ["data-nova-boot-phase"] });
  }
  check();
  return () => {
    cancelled = true;
    observer?.disconnect();
  };
}
