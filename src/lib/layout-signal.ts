import type { GalleryLayoutEvidence } from "./gallery-geometry";

export type NativeLayoutSignal = GalleryLayoutEvidence & { layoutIssue: string };

/**
 * The native watchdog needs fresh evidence when the layout changes, but a
 * stable frame should not send identical Capacitor callbacks every time an
 * observer or watchdog checks its geometry. A slow repeat allows a transient
 * bridge error to recover without requiring a viewport change.
 */
export function createLayoutSignalPublisher(
  publish: (signal: NativeLayoutSignal) => void,
  repeatAfterMs = 10_000,
  clock: () => number = () => Date.now(),
): (signal: NativeLayoutSignal) => boolean {
  let lastSignature: string | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  return (signal) => {
    const signature = JSON.stringify(signal);
    const now = clock();
    if (signature === lastSignature && now - lastSentAt < repeatAfterMs) {
      return false;
    }
    // Only acknowledge delivery to the callback after it returns normally.
    // A synchronous bridge failure must not suppress the next measurement.
    publish(signal);
    lastSignature = signature;
    lastSentAt = now;
    return true;
  };
}
