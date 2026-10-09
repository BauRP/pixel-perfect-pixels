// Exponential backoff schedule used by the native ad loader.

export interface BackoffOptions {
  /** Delay before the first retry, in ms. */
  baseMs: number;
  /** Upper bound for any single delay, in ms. */
  maxMs: number;
  /** Growth factor between consecutive retries. */
  factor: number;
  /** Random spread as a fraction of the delay (0.2 → ±20 %). */
  jitter: number;
}

export const NATIVE_AD_BACKOFF: BackoffOptions = {
  baseMs: 5_000,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.2,
};

/**
 * Delay for retry number `attempt` (0-based): base · factor^attempt, capped at
 * maxMs, then spread by ±jitter and clamped back into [0, maxMs].
 */
export function backoffDelay(
  attempt: number,
  opts: BackoffOptions = NATIVE_AD_BACKOFF,
  random: () => number = Math.random,
): number {
  const n = Math.max(0, Math.floor(attempt));
  const raw = Math.min(opts.maxMs, opts.baseMs * Math.pow(opts.factor, n));
  const spread = raw * opts.jitter * (random() * 2 - 1);
  return Math.round(Math.min(opts.maxMs, Math.max(0, raw + spread)));
}
