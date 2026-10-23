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

export interface MirrorStatus {
  consecutiveFailures: number;
  unavailableUntil: number;
}

/** Minimal async/sync health contract used by the mirror fetcher. */
export interface MirrorHealthLike {
  canAttempt(name: string, now?: number): boolean | Promise<boolean>;
  recordSuccess(name: string): void | Promise<void>;
  recordFailure(name: string, now?: number, retryAfterMs?: number): void | Promise<void>;
}

/** Pure state transition shared by in-memory and KV implementations. */
export function nextMirrorStatus(
  prior: MirrorStatus | undefined,
  now: number,
  retryAfterMs = 0,
): MirrorStatus {
  if (prior?.unavailableUntil && now < prior.unavailableUntil) {
    // A longer upstream hint received while already blocked should not be
    // silently discarded, but never shorten the existing block either.
    if (retryAfterMs > 0 && now + retryAfterMs > prior.unavailableUntil) {
      return {
        consecutiveFailures: prior.consecutiveFailures,
        unavailableUntil: now + Math.min(MAX_MIRROR_COOLDOWN_MS, retryAfterMs),
      };
    }
    return prior;
  }
  const failures = (prior?.consecutiveFailures ?? 0) + 1;
  const hint = Number.isFinite(retryAfterMs) && retryAfterMs > 0
    ? Math.min(MAX_MIRROR_COOLDOWN_MS, retryAfterMs)
    : 0;
  const cooldown = failures >= MIRROR_FAILURE_THRESHOLD ? MIRROR_COOLDOWN_MS : 0;
  const wait = Math.max(cooldown, hint);
  return {
    consecutiveFailures: failures,
    unavailableUntil: wait > 0 ? now + wait : 0,
  };
}

export class MirrorHealth implements MirrorHealthLike {
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
    this.state.set(name, nextMirrorStatus(this.state.get(name), now, retryAfterMs));
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

/** KV-backed best-effort global health. KV is eventually consistent and is not
 * an atomic lock; it extends the per-isolate breaker across data centres when
 * the optional MIRROR_HEALTH binding is configured.
 */
export class KvMirrorHealth implements MirrorHealthLike {
  constructor(private readonly kv: KVNamespace, private readonly prefix = 'mirror:') {}

  private key(name: string): string {
    return this.prefix + name;
  }

  private async read(name: string): Promise<MirrorStatus | undefined> {
    const raw = await this.kv.get(this.key(name));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as Partial<MirrorStatus>;
      if (Number.isFinite(value.consecutiveFailures) && Number.isFinite(value.unavailableUntil)) {
        return {
          consecutiveFailures: Number(value.consecutiveFailures),
          unavailableUntil: Number(value.unavailableUntil),
        };
      }
    } catch {
      /* corrupt reputation entry: treat as unknown */
    }
    return undefined;
  }

  async canAttempt(name: string, now = Date.now()): Promise<boolean> {
    const current = await this.read(name);
    if (!current || current.unavailableUntil === 0) return true;
    if (now < current.unavailableUntil) return false;
    await this.kv.delete(this.key(name));
    return true;
  }

  async recordSuccess(name: string): Promise<void> {
    await this.kv.delete(this.key(name));
  }

  async recordFailure(name: string, now = Date.now(), retryAfterMs = 0): Promise<void> {
    const prior = await this.read(name);
    const status = nextMirrorStatus(prior, now, retryAfterMs);
    const ttl = status.unavailableUntil > now
      ? Math.ceil((status.unavailableUntil - now) / 1000) + 60
      : 24 * 60 * 60;
    await this.kv.put(this.key(name), JSON.stringify(status), {
      expirationTtl: Math.min(2 * 24 * 60 * 60, Math.max(60, ttl)),
    });
  }
}

export const mirrorHealth = new MirrorHealth();

export function resetMirrorHealth(): void {
  mirrorHealth.reset();
}
