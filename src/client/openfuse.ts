import {
  AuthError,
  CircuitOpenError,
  ConfigurationError,
  NotFoundError,
  TimeoutError,
} from '../core/errors.ts'
import { logger } from '../core/logger.ts'
import { ApiHealthTracker } from '../core/api-health.ts'
import { generateInstanceId } from '../core/instance.ts'
import { Transport } from '../core/transport.ts'
import {
  executeWithTimeout,
  normalizeBaseUrl,
  raceWithTimeout,
  validateRequiredStrings,
} from '../core/utils.ts'
import { AuthApi } from '../domains/auth/auth.api.ts'
import { TokenManager } from '../domains/auth/token-manager.ts'
import { BreakersApi } from '../domains/breakers/breakers.api.ts'
import { BreakersFeature } from '../domains/breakers/breakers.feature.ts'
import { MetricsApi } from '../domains/metrics/metrics.api.ts'
import { MetricsFeature } from '../domains/metrics/metrics.feature.ts'
import type { TMetricsConfig } from '../domains/metrics/types.ts'
import type { TBreaker, TBreakerStateValue, TSdkBootstrapResponse } from '../types/api.ts'

const STATE_FETCH_BUDGET_MS = 500
const BOOTSTRAP_RETRY_CAP_MS = 30_000
const MAX_NOT_FOUND_WARNINGS = 1_000

export type TOpenfuseOptions = {
  /** API base URL (e.g., https://prod-acme.api.openfuse.io) */
  baseUrl: string
  /** System slug that groups related breakers */
  systemSlug: string
  /** SDK client ID from Openfuse dashboard */
  clientId: string
  /** SDK client secret from Openfuse dashboard */
  clientSecret: string
  /** Optional metrics configuration (overrides server config) */
  metrics?: Partial<TMetricsConfig>
  /**
   * Optional custom instance ID for this SDK process.
   * If not provided, the SDK auto-detects the platform (Lambda, ECS, K8s, Cloud Run, etc.)
   * and uses the appropriate identifier, falling back to hostname-pid-random.
   */
  instanceId?: string
}

type TWithBreakerOptions<T> = {
  /** If exceeded, throws TimeoutError. */
  timeout?: number
  /** Fallback if the breaker is open. */
  onOpen?: () => Promise<T> | T
  /** Fallback if the breaker state is unknown (e.g., network failure fetching state). */
  onUnknown?: () => Promise<T> | T
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
}

/**
 * Openfuse SDK client. Manages remote circuit breakers and records execution metrics.
 *
 * Typical lifecycle:
 * 1. Create the client with your credentials.
 * 2. Call {@link bootstrap} once at startup to authenticate and pre-cache breaker state.
 * 3. Wrap downstream calls with {@link withBreaker} for automatic state checks, metrics,
 *    timeouts, and fallback handling.
 * 4. Call {@link shutdown} on process exit to flush pending metrics.
 *
 * The SDK is **fail-open**: if the Openfuse API is unreachable or bootstrap hasn't
 * completed yet, breakers default to closed and your code executes normally.
 *
 * @example
 * ```typescript
 * const client = new Openfuse({
 *   baseUrl: 'https://prod-acme.api.openfuse.io',
 *   systemSlug: 'payments',
 *   clientId: 'sdk_abc123',
 *   clientSecret: 'secret_xyz',
 * })
 *
 * client.bootstrap()
 *
 * const charge = await client.withBreaker('stripe-api', async (signal) => {
 *   return stripe.charges.create({ amount: 1000 }, { signal })
 * }, {
 *   timeout: 5000,
 *   onOpen: () => ({ queued: true }),
 * })
 * ```
 */
export class Openfuse {
  protected readonly transport: Transport
  private readonly authApi: AuthApi
  private readonly tokenManager: TokenManager
  protected readonly baseUrl: string
  private readonly systemSlug: string
  private readonly instanceId: string
  private readonly metricsApi: MetricsApi
  private readonly apiHealthTracker: ApiHealthTracker

  private breakersFeature: BreakersFeature
  private metricsFeature: MetricsFeature
  private metricsConfig?: Partial<TMetricsConfig>
  private pendingBootstrap: Promise<void> | null = null
  private bootstrapWarningLogged = false
  private notFoundWarnings: Set<string> = new Set()
  protected bootstrapData?: TSdkBootstrapResponse

  private bootstrapRetryTimer: ReturnType<typeof setTimeout> | undefined
  private bootstrapAbortController: AbortController | null = null
  private bootstrapTimeoutMs?: number
  private bootstrapMaxAttempts?: number
  private isShuttingDown = false

  constructor(options: TOpenfuseOptions) {
    validateRequiredStrings(options, ['baseUrl', 'systemSlug', 'clientId', 'clientSecret'])

    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.systemSlug = options.systemSlug
    this.instanceId = options.instanceId ?? generateInstanceId()
    this.metricsConfig = options.metrics
    this.apiHealthTracker = new ApiHealthTracker()

    this.authApi = new AuthApi({
      baseUrl: this.baseUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    })

    this.tokenManager = new TokenManager({
      authApi: this.authApi,
    })

    this.transport = new Transport({
      baseUrl: this.baseUrl,
      authProvider: this.tokenManager,
    })

    const breakersApi = new BreakersApi({ transport: this.transport })
    this.metricsApi = new MetricsApi({ transport: this.transport })

    this.breakersFeature = new BreakersFeature({
      api: breakersApi,
      apiHealth: this.apiHealthTracker,
    })
    this.metricsFeature = this.createMetricsFeature()
  }

  /**
   * Authenticates with the Openfuse API, fetches server configuration (metrics
   * windows, flush intervals), and pre-caches all breaker states for the system.
   *
   * Runs in the background (fire-and-forget). Call once at application startup.
   * Retries automatically with exponential backoff on transient failures.
   * Never throws; errors are logged via `console.warn`.
   *
   * @param options.timeoutMs - Per-attempt timeout in milliseconds (default: 5000).
   * @param options.maxAttempts - Max retries for the bootstrap HTTP call (default: 3).
   *
   * @example
   * ```typescript
   * const client = new Openfuse({ ... })
   * client.bootstrap()
   * // SDK methods are usable immediately
   * ```
   */
  public bootstrap(options?: { timeoutMs?: number; maxAttempts?: number }): void {
    if (this.pendingBootstrap) return
    this.cancelBootstrapRetry()

    this.bootstrapTimeoutMs = options?.timeoutMs
    this.bootstrapMaxAttempts = options?.maxAttempts
    this.bootstrapAbortController = new AbortController()

    this.pendingBootstrap = this.doBootstrap().finally(() => {
      this.pendingBootstrap = null
    })
  }

  private async doBootstrap(): Promise<void> {
    try {
      const response = await this.authApi.bootstrap(this.systemSlug, {
        instanceId: this.instanceId,
        signal: this.bootstrapAbortController?.signal,
        timeoutMs: this.bootstrapTimeoutMs,
        maxAttempts: this.bootstrapMaxAttempts,
      })
      this.applyBootstrapResponse(response)
      try {
        await this.onBootstrapComplete()
      } catch (hookError) {
        logger.warn('Post-bootstrap hook failed:', hookError)
      }
    } catch (error) {
      if (error instanceof AuthError) {
        logger.error(
          'Bootstrap failed: invalid credentials. SDK cannot authenticate. Check clientId/clientSecret.',
        )
        return
      }
      if (this.bootstrapAbortController?.signal.aborted) return
      logger.warn(
        'Bootstrap failed, SDK operating in fail-open mode. Will retry in background.',
        error,
      )
      this.scheduleBootstrapRetry(0)
    }
  }

  private applyBootstrapResponse(response: TSdkBootstrapResponse): void {
    this.bootstrapData = response

    this.tokenManager.setToken(response.accessToken, response.expiresIn)

    // Server-provided metrics config as defaults; user config takes precedence
    if (response.metricsConfig) {
      this.metricsConfig = {
        flushIntervalMs: response.metricsConfig.flushIntervalMs,
        windowSizeMs: response.metricsConfig.windowSizeMs,
        ...this.metricsConfig,
      }
      try {
        // Fire-and-forget flush of old metrics before recreating
        this.metricsFeature.flush().catch((err) => {
          logger.warn('Metrics flush failed during bootstrap:', err)
        })
      } catch (error) {
        logger.warn('Metrics flush failed during bootstrap:', error)
      }
      this.metricsFeature.stop()
      this.metricsFeature = this.createMetricsFeature()
    }

    if (response.breakers && response.breakers.length > 0) {
      const breakers: TBreaker[] = response.breakers.map((b) => ({
        id: b.id,
        slug: b.slug,
        state: b.state,
        retryAfter: b.retryAfter,
      }))
      this.breakersFeature.ingestBootstrap(response.system.id, breakers)
    }
  }

  private scheduleBootstrapRetry(attempt: number): void {
    if (this.isShuttingDown || this.bootstrapAbortController?.signal.aborted) return

    const delay = Math.min(1000 * Math.pow(2, attempt), BOOTSTRAP_RETRY_CAP_MS)
    this.bootstrapRetryTimer = setTimeout(async () => {
      this.bootstrapRetryTimer = undefined
      if (this.isShuttingDown || this.bootstrapAbortController?.signal.aborted) return

      try {
        const response = await this.authApi.bootstrap(this.systemSlug, {
          instanceId: this.instanceId,
          signal: this.bootstrapAbortController?.signal,
          timeoutMs: this.bootstrapTimeoutMs,
          maxAttempts: this.bootstrapMaxAttempts,
        })
        this.applyBootstrapResponse(response)
        logger.warn('Bootstrap retry succeeded.')
        try {
          await this.onBootstrapComplete()
        } catch (hookError) {
          logger.warn('Post-bootstrap hook failed:', hookError)
        }
      } catch (error) {
        if (error instanceof AuthError) {
          logger.warn('Bootstrap retry failed with AuthError, stopping retries.', error)
          return
        }
        if (this.bootstrapAbortController?.signal.aborted) return
        logger.warn(`Bootstrap retry ${attempt + 1} failed, scheduling next retry.`, error)
        this.scheduleBootstrapRetry(attempt + 1)
      }
    }, delay)
    // Don't keep the process alive for bootstrap retries
    if (
      this.bootstrapRetryTimer &&
      typeof this.bootstrapRetryTimer === 'object' &&
      'unref' in this.bootstrapRetryTimer
    ) {
      this.bootstrapRetryTimer.unref()
    }
  }

  private cancelBootstrapRetry(): void {
    if (this.bootstrapRetryTimer) {
      clearTimeout(this.bootstrapRetryTimer)
      this.bootstrapRetryTimer = undefined
    }
  }

  /**
   * Returns a promise that resolves when the current bootstrap attempt completes.
   * Resolves immediately if bootstrap is not in progress.
   *
   * @remarks Not required for normal usage. The SDK is usable immediately after
   * calling {@link bootstrap}. Use this only when you need to guarantee that
   * bootstrap has finished (e.g., in tests or health-check endpoints).
   *
   * @example
   * ```typescript
   * client.bootstrap()
   * await client.whenReady()
   * // bootstrap has completed (or was never started)
   * ```
   */
  public whenReady(): Promise<void> {
    return this.pendingBootstrap ?? Promise.resolve()
  }

  /**
   * Hook called after a successful bootstrap. Override in subclasses to run
   * additional setup (e.g., reconfiguring the transport URL).
   * Errors thrown here are caught and logged. They do not break bootstrap.
   */
  protected async onBootstrapComplete(): Promise<void> {}

  /**
   * Checks whether a breaker is currently **open** (blocking traffic).
   *
   * @remarks For automatic metrics, timeouts, and fallback handling, prefer {@link withBreaker}.
   * On errors (API unreachable, not bootstrapped), returns `false` (fail-open).
   *
   * @param breakerSlug - The breaker's slug as configured in the dashboard.
   * @returns `true` if open, `false` if closed, half-open, or state unknown.
   *
   * @example
   * ```typescript
   * if (await client.isOpen('stripe-api')) {
   *   return cachedResponse
   * }
   * ```
   */
  public async isOpen(breakerSlug: string): Promise<boolean> {
    try {
      const state = await this.fetchBreakerStateWithBudget(breakerSlug)
      return state === 'open'
    } catch (error) {
      this.handleFailOpen('isOpen', breakerSlug, error)
      return false
    }
  }

  /**
   * Checks whether a breaker is currently **closed** (allowing traffic).
   *
   * @remarks For automatic metrics, timeouts, and fallback handling, prefer {@link withBreaker}.
   * On errors (API unreachable, not bootstrapped), returns `true` (fail-open).
   *
   * @param breakerSlug - The breaker's slug as configured in the dashboard.
   * @returns `true` if closed or state unknown, `false` if open or half-open.
   *
   * @example
   * ```typescript
   * if (await client.isClosed('stripe-api')) {
   *   await processPayment()
   * }
   * ```
   */
  public async isClosed(breakerSlug: string): Promise<boolean> {
    try {
      const state = await this.fetchBreakerStateWithBudget(breakerSlug)
      return state === 'closed'
    } catch (error) {
      this.handleFailOpen('isClosed', breakerSlug, error)
      return true
    }
  }

  /**
   * Fetches the full {@link TBreaker} object for a given slug, including current state,
   * retry-after timestamp, and metadata.
   *
   * @param breakerSlug - The breaker's slug as configured in the dashboard.
   * @param signal - Optional {@link AbortSignal} for cancellation.
   * @returns The breaker object, or `null` if not found, not bootstrapped, or the
   *   request exceeded the internal time budget.
   *
   * @example
   * ```typescript
   * const breaker = await client.getBreaker('stripe-api')
   * if (breaker?.state === 'open') {
   *   console.log(`Retry after: ${breaker.retryAfter}`)
   * }
   * ```
   */
  public async getBreaker(breakerSlug: string, signal?: AbortSignal): Promise<TBreaker | null> {
    try {
      const promise = this.breakersFeature.getBreakerBySlug(this.getSystemId(), breakerSlug, signal)
      return await raceWithTimeout(promise, STATE_FETCH_BUDGET_MS, () => {
        logger.warn(
          `getBreaker("${breakerSlug}") exceeded ${STATE_FETCH_BUDGET_MS}ms budget, returning null.`,
        )
        return null
      })
    } catch (error) {
      this.handleFailOpen('getBreaker', breakerSlug, error)
      return null
    }
  }

  /**
   * Fetches all {@link TBreaker} objects for the configured system.
   *
   * @returns All breakers with their current state, or `[]` if not bootstrapped
   *   or the request fails.
   */
  public async listBreakers(): Promise<TBreaker[]> {
    if (!this.bootstrapData) {
      this.handleFailOpen(
        'listBreakers',
        null,
        new ConfigurationError('Call bootstrap() before using the SDK'),
      )
      return []
    }
    try {
      return await raceWithTimeout(
        this.breakersFeature.listBreakers(this.bootstrapData.system.id),
        STATE_FETCH_BUDGET_MS,
        () => {
          logger.warn(
            `listBreakers() exceeded ${STATE_FETCH_BUDGET_MS}ms budget, returning empty list.`,
          )
          return []
        },
      )
    } catch (error) {
      logger.warn('listBreakers() failed, returning empty list:', error)
      return []
    }
  }

  private getSystemId(): string {
    if (!this.bootstrapData) {
      throw new ConfigurationError('Call bootstrap() before using the SDK')
    }
    return this.bootstrapData.system.id
  }

  private handleFailOpen(method: string, breakerSlug: string | null, error: unknown): void {
    if (error instanceof ConfigurationError) {
      if (!this.bootstrapWarningLogged) {
        logger.warn(
          'SDK used before bootstrap completed. Operating in fail-open mode. Ensure bootstrap() is called at startup.',
        )
        this.bootstrapWarningLogged = true
      }
      return
    }
    if (error instanceof NotFoundError && breakerSlug) {
      if (
        this.notFoundWarnings.size < MAX_NOT_FOUND_WARNINGS &&
        !this.notFoundWarnings.has(breakerSlug)
      ) {
        this.notFoundWarnings.add(breakerSlug)
        logger.warn(`Breaker "${breakerSlug}" not found. Operating in fail-open mode.`)
      }
      return
    }
    const target = breakerSlug ? `("${breakerSlug}")` : '()'
    logger.warn(`${method}${target} failed, operating in fail-open mode:`, error)
  }

  private async fetchBreakerState(breakerSlug: string): Promise<TBreakerStateValue> {
    return await this.breakersFeature.getBreakerStateBySlug(this.getSystemId(), breakerSlug)
  }

  /**
   * Wraps fetchBreakerState with a 500ms budget for withBreaker().
   * The underlying fetch continues in background (updates cache), only this caller gives up.
   */
  private async fetchBreakerStateWithBudget(breakerSlug: string): Promise<TBreakerStateValue> {
    return raceWithTimeout(this.fetchBreakerState(breakerSlug), STATE_FETCH_BUDGET_MS, () => {
      throw new TimeoutError('State fetch budget exceeded')
    })
  }

  /**
   * Wraps a function call with circuit breaker protection and automatic metrics.
   *
   * Checks the breaker state, executes `fn` if traffic is allowed, and records
   * the outcome (success / failure / timeout) along with latency.
   *
   * Behavior by breaker state:
   * - **Closed / Half-open**: executes `fn` normally.
   * - **Open**: calls `onOpen` fallback if provided, otherwise throws {@link CircuitOpenError}.
   * - **Unknown** (state fetch failed): calls `onUnknown` if provided, otherwise executes `fn` (fail-open).
   *
   * @typeParam T - The return type of `fn` (and fallbacks).
   * @param breakerSlug - The breaker's slug as configured in the dashboard.
   * @param fn - The protected function. Receives an {@link AbortSignal} that fires on
   *   `timeout` expiry or `signal` cancellation.
   * @param options.timeout - Max execution time for `fn` in ms.
   * @param options.onOpen - Called instead of `fn` when the breaker is open.
   *   If omitted, throws {@link CircuitOpenError}.
   * @param options.onUnknown - Called instead of `fn` when the breaker state cannot be
   *   determined. If omitted, `fn` executes anyway (fail-open).
   * @param options.signal - {@link AbortSignal} for external cancellation.
   * @returns The return value of `fn`, `onOpen`, or `onUnknown`.
   * @throws {@link CircuitOpenError} When the breaker is open and no `onOpen` is provided.
   * @throws {@link TimeoutError} When `fn` exceeds `timeout`.
   *
   * @example
   * ```typescript
   * const charge = await client.withBreaker('stripe-api', async (signal) => {
   *   return stripe.charges.create({ amount: 1000 }, { signal })
   * }, {
   *   timeout: 5000,
   *   onOpen: () => ({ queued: true }),
   * })
   * ```
   */
  public async withBreaker<T>(
    breakerSlug: string,
    fn: (signal: AbortSignal) => Promise<T> | T,
    options?: TWithBreakerOptions<T>,
  ): Promise<T> {
    const { timeout, onOpen, onUnknown, signal } = options ?? {}

    let state: TBreakerStateValue | null = null
    try {
      state = await this.fetchBreakerStateWithBudget(breakerSlug)
    } catch (error) {
      this.handleFailOpen('withBreaker', breakerSlug, error)
      if (onUnknown) return await onUnknown()
      // fail-open: fall through to execute fn()
    }

    if (state === 'open') {
      if (onOpen) return await onOpen()
      throw new CircuitOpenError(`Breaker is open: ${breakerSlug}`)
    }

    // state is closed, half-open, or null (unknown, fail-open)
    const startTime = performance.now()

    try {
      const result = await executeWithTimeout(fn, timeout, signal)
      const latencyMs = performance.now() - startTime
      try {
        this.metricsFeature.recordExecution(breakerSlug, 'success', latencyMs)
      } catch (metricsError) {
        logger.warn('Metrics recording failed:', metricsError)
      }
      return result
    } catch (err) {
      const latencyMs = performance.now() - startTime
      try {
        const outcome = err instanceof TimeoutError ? 'timeout' : 'failure'
        this.metricsFeature.recordExecution(breakerSlug, outcome, latencyMs)
      } catch (metricsError) {
        logger.warn('Metrics recording failed:', metricsError)
      }
      throw err
    }
  }

  /**
   * Clears all cached breaker data, flushes pending metrics, and resets API health tracking.
   * Call this after external changes to breaker configuration (e.g., adding/removing breakers
   * in the dashboard) to force the SDK to re-fetch fresh data.
   */
  public async invalidate(): Promise<void> {
    try {
      await this.metricsFeature.flush()
    } catch (error) {
      logger.warn('Metrics flush failed during invalidation:', error)
    }
    this.metricsFeature.stop()
    this.apiHealthTracker.reset()
    this.notFoundWarnings.clear()

    const breakersApi = new BreakersApi({ transport: this.transport })
    this.breakersFeature = new BreakersFeature({
      api: breakersApi,
      apiHealth: this.apiHealthTracker,
    })

    this.metricsFeature = this.createMetricsFeature()
  }

  /**
   * Sends all buffered metrics to the Openfuse backend immediately.
   *
   * @remarks Prefer {@link shutdown} for full graceful teardown. Use this standalone
   *   when you want to flush without stopping the metrics worker.
   */
  public async flushMetrics(): Promise<void> {
    try {
      await this.metricsFeature.flush()
    } catch (error) {
      logger.warn('Metrics flush failed:', error)
    }
  }

  /**
   * Stops the background metrics flush timer. The timer restarts automatically
   * on the next {@link withBreaker} call, so this is safe to call temporarily.
   *
   * @remarks For permanent shutdown, use {@link shutdown} instead.
   */
  public stopMetrics(): void {
    try {
      this.metricsFeature.stop()
    } catch (error) {
      logger.warn('Metrics stop failed:', error)
    }
  }

  /**
   * Gracefully shuts down the SDK: flushes pending metrics, stops the metrics worker,
   * and cancels any in-progress bootstrap retries.
   *
   * @param options.timeoutMs - Maximum time to wait for the metrics flush (default: 5000).
   *   If exceeded, shutdown completes but some metrics may be lost.
   *
   * @example
   * ```typescript
   * process.on('SIGTERM', async () => {
   *   await client.shutdown()
   *   process.exit(0)
   * })
   * ```
   */
  public async shutdown(options?: { timeoutMs?: number }): Promise<void> {
    this.isShuttingDown = true
    this.cancelBootstrapRetry()
    this.bootstrapAbortController?.abort()

    const timeoutMs = options?.timeoutMs ?? 5_000
    const timedOut = await raceWithTimeout(
      this.flushMetrics().then(() => false),
      timeoutMs,
      () => true,
    )

    if (timedOut) {
      logger.warn(`Shutdown timed out after ${timeoutMs}ms, some metrics may be lost`)
    }

    this.metricsFeature.teardown()
  }

  /**
   * Returns the unique instance ID for this SDK process. Auto-generated from
   * the platform environment (Lambda, ECS, K8s, etc.) or overridden via
   * {@link TOpenfuseOptions.instanceId}.
   */
  public getInstanceId(): string {
    return this.instanceId
  }

  private createMetricsFeature(): MetricsFeature {
    return new MetricsFeature({
      api: this.metricsApi,
      breakersFeature: this.breakersFeature,
      instanceId: this.instanceId,
      config: this.metricsConfig,
      getSystemId: () => this.bootstrapData?.system?.id ?? null,
    })
  }
}
