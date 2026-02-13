import type { TBreaker } from '../types/api.ts'

export type TProtectOptions<T> = {
  /** If exceeded, throws TimeoutError. */
  timeout?: number
  /**
   * Called when the breaker is open instead of executing `fn`.
   * If not provided, `fn` executes anyway (fail-open) with a warning logged.
   *
   * **Note:** The fallback is not wrapped with a timeout or AbortSignal.
   * If your fallback calls external services, apply your own timeout.
   */
  fallback?: () => Promise<T> | T
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

export type TBreakerOperations = {
  protect<T>(
    slug: string,
    fn: (signal: AbortSignal) => Promise<T> | T,
    options?: TProtectOptions<T>,
  ): Promise<T>
  isOpen(slug: string): Promise<boolean>
  isClosed(slug: string): Promise<boolean>
  fetchStatus(slug: string, signal?: AbortSignal): Promise<TBreaker | null>
}

/**
 * A handle bound to a single breaker slug. Created by {@link Openfuse.breaker}.
 *
 * All methods delegate to the parent client — this is a thin, stateless proxy.
 *
 * @example
 * ```typescript
 * const stripe = client.breaker('stripe-api')
 *
 * const charge = await stripe.protect(async (signal) => {
 *   return stripe.charges.create({ amount: 1000 }, { signal })
 * }, { timeout: 5000, fallback: () => ({ queued: true }) })
 *
 * if (await stripe.isOpen()) {
 *   return cachedResponse
 * }
 * ```
 */
export class BreakerHandle {
  readonly slug: string
  private readonly ops: TBreakerOperations

  constructor(slug: string, ops: TBreakerOperations) {
    this.slug = slug
    this.ops = ops
  }

  protect<T>(
    fn: (signal: AbortSignal) => Promise<T> | T,
    options?: TProtectOptions<T>,
  ): Promise<T> {
    return this.ops.protect(this.slug, fn, options)
  }

  isOpen(): Promise<boolean> {
    return this.ops.isOpen(this.slug)
  }

  isClosed(): Promise<boolean> {
    return this.ops.isClosed(this.slug)
  }

  status(signal?: AbortSignal): Promise<TBreaker | null> {
    return this.ops.fetchStatus(this.slug, signal)
  }
}
