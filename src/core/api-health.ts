const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_DEGRADED_WINDOW_MS = 30_000

export type TApiHealthTrackerOptions = {
  failureThreshold?: number
  degradedWindowMs?: number
}

/**
 * Tracks consecutive API failures and enters "degraded" mode after a threshold.
 * In degraded mode, callers should skip API calls and use cached/stale/fail-open paths.
 * After the degraded window expires, one probe request is allowed; if it fails,
 * the window is extended. Timestamp-based: no timers, no cleanup needed.
 */
export class ApiHealthTracker {
  private readonly failureThreshold: number
  private readonly degradedWindowMs: number
  private consecutiveFailures = 0
  private degradedUntil = 0

  constructor(options?: TApiHealthTrackerOptions) {
    this.failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD
    this.degradedWindowMs = options?.degradedWindowMs ?? DEFAULT_DEGRADED_WINDOW_MS
  }

  shouldAttemptRequest(): boolean {
    if (this.consecutiveFailures < this.failureThreshold) return true
    // In degraded mode: allow one probe after the window expires
    return Date.now() >= this.degradedUntil
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
    this.degradedUntil = 0
  }

  recordFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.degradedUntil = Date.now() + this.degradedWindowMs
    }
  }

  reset(): void {
    this.consecutiveFailures = 0
    this.degradedUntil = 0
  }

  get isDegraded(): boolean {
    return this.consecutiveFailures >= this.failureThreshold && Date.now() < this.degradedUntil
  }
}
