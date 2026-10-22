/** Per-Worker-isolate mirror circuit breaker.
 *
 * Skips a provider for 10 minutes after three consecutive provider failures.
 * State is in-memory for one Worker isolate; it is NOT durable or globally
 * coordinated across Cloudflare data centres.
 */
export const MIRROR_FAILURE_THRESHOLD = 3;
export const MIRROR_COOLDOWN_MS = 10 * 60 * 1000;

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

  recordFailure(name: string, now = Date.now()): void {
    const prior = this.state.get(name);
    if (prior?.unavailableUntil && now < prior.unavailableUntil) return;
    const failures = (prior?.consecutiveFailures ?? 0) + 1;
    this.state.set(name, {
      consecutiveFailures: failures,
      unavailableUntil: failures >= MIRROR_FAILURE_THRESHOLD ? now + MIRROR_COOLDOWN_MS : 0,
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
