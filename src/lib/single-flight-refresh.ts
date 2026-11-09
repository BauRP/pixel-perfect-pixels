/**
 * A bounded single-flight scheduler for events that request the same native
 * snapshot. Multiple simultaneous resize/focus/inset events must not create
 * dozens of Capacitor callbacks before Chromium's first paint.
 *
 * At most one request is active and one newer request is queued. Exceptions
 * are delivered to the caller's task and do not poison subsequent refreshes.
 */
export function createSingleFlightRefresh(task: () => Promise<void>): () => void {
  let active = false;
  let queued = false;

  const refresh = () => {
    if (active) {
      queued = true;
      return;
    }
    active = true;
    void Promise.resolve()
      .then(task)
      .catch(() => {
        // The native snapshot task logs its own safe, non-personal error.
        // Always unlock even if a callback rejects unexpectedly.
      })
      .finally(() => {
        active = false;
        if (queued) {
          queued = false;
          refresh();
        }
      });
  };

  return refresh;
}
