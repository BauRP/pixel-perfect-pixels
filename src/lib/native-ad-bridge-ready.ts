/**
 * Wave Notes' successful AdMob startup waits for the Capacitor native
 * plugin to appear, not merely for React to mount. Keep the waiting logic
 * independent of AdMob, UMP and Nova's screen/menu policies.
 */
export function waitForNativePlugin(
  ready: () => boolean,
  timeoutMs = 12_000,
  intervalMs = 100,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  try { if (ready()) return Promise.resolve(true); } catch { /* bridge not injected */ }

  return new Promise<boolean>((resolve) => {
    let finished = false;
    let interval: ReturnType<typeof setInterval>;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      clearInterval(interval);
      clearTimeout(timeout);
      if (typeof document !== "undefined") document.removeEventListener("deviceready", check);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const check = () => {
      try { if (ready()) finish(true); } catch { /* bridge still starting */ }
    };
    const abort = () => finish(false);
    interval = setInterval(check, intervalMs);
    timeout = setTimeout(() => finish(false), timeoutMs);
    if (typeof document !== "undefined") document.addEventListener("deviceready", check);
    signal?.addEventListener("abort", abort, { once: true });
    check();
  });
}
