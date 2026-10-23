/** Per-Worker-isolate mirror circuit breaker.
 *
 * Skips a provider for 10 minutes after three consecutive provider failures.
 * State is in-memory for one Worker isolate; it is NOT durable or globally
 * coordinated across Cloudflare data centres.
 */
export const MIRROR_FAILURE_THRESHOLD = 3;
export const MIRROR_COOLDOWN_MS = 10 * 60 * 1000;
/** Upper bound for a provider-supplied Retry-After, so a hostile or buggy header cannot pin a mirror forever. */
export const MAX_MIRROR_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Parse an HTTP Retry-After value (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  let milliseconds: number;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    milliseconds = seconds * 1000;
  } else {
    const date = Date.parse(trimmed);
    if (!Number.isFinite(date)) return 0;
    milliseconds = date - now;
  }
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0;
  return Math.min(MAX_MIRROR_COOLDOWN_MS, Math.round(milliseconds));
}

interface MirrorStatus {
  consecutiveFailures: number;
  unavailableUntil: number;
}

export class MirrorHealth {
  private state = new Map<string, MirrorStatus>();

  canAttempt(name: string, now = Date.now()): boolean {
    const current = this.state.get(name);
    if (!current) return true;
    if (current.unavailableUntil === 0) return true;
    if (now < current.unavailableUntil) return false;
    this.state.delete(name); // new trial after cooldown
    return true;
  }

  recordSuccess(name: string): void {
    this.state.delete(name);
  }

  /** Record a provider failure. `retryAfterMs` is an optional provider hint
   * from the upstream Retry-After header; it can block the mirror immediately
   * or extend the default cooldown, but is capped at 24 hours.
   */
  recordFailure(name: string, now = Date.now(), retryAfterMs = 0): void {
    const prior = this.state.get(name);
    if (prior?.unavailableUntil && now < prior.unavailableUntil) {
      // A longer upstream hint received while already blocked should not be
      // silently discarded, but never shorten the existing block either.
      if (retryAfterMs > 0 && now + retryAfterMs > prior.unavailableUntil) {
        this.state.set(name, {
          consecutiveFailures: prior.consecutiveFailures,
          unavailableUntil: now + Math.min(MAX_MIRROR_COOLDOWN_MS, retryAfterMs),
        });
      }
      return;
    }
    const failures = (prior?.consecutiveFailures ?? 0) + 1;
    const hint = Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(MAX_MIRROR_COOLDOWN_MS, retryAfterMs)
      : 0;
    const cooldown = failures >= MIRROR_FAILURE_THRESHOLD ? MIRROR_COOLDOWN_MS : 0;
    const wait = Math.max(cooldown, hint);
    this.state.set(name, {
      consecutiveFailures: failures,
      unavailableUntil: wait > 0 ? now + wait : 0,
    });
  }

  /** Exposed for test isolation, not intended to reset production reputation. */
  reset(): void {
    this.state.clear();
  }

  status(name: string): Readonly<MirrorStatus> {
    const item = this.state.get(name);
    return { consecutiveFailures: item?.consecutiveFailures ?? 0, unavailableUntil: item?.unavailableUntil ?? 0 };
  }
}

export const mirrorHealth = new MirrorHealth();

export function resetMirrorHealth(): void {
  mirrorHealth.reset();
}
