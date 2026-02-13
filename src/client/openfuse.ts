import { TTLCache } from '../core/cache.ts'
import { AuthError, ConfigurationError, NotFoundError, TimeoutError } from '../core/errors.ts'
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
import { BreakerHandle, type TBreakerOperations, type TProtectOptions } from './breaker-handle.ts'

const STATE_FETCH_BUDGET_MS = 500
const BOOTSTRAP_RETRY_CAP_MS = 30_000
const NOT_FOUND_WARNING_TTL_MS = 5 * 60 * 1_000
const NOT_FOUND_WARNING_MAX_ENTRIES = 1_000

export type TOpenfuseOptions = {
  /** API base URL (e.g., https://prod-acme.api.openfuse.io) */
  baseUrl: string
  /** System slug that groups related breakers */
  system: string
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

/**
 * Openfuse SDK client. Manages remote circuit breakers and records execution metrics.
 *
 * Typical lifecycle:
 * 1. Create the client with your credentials.
 * 2. Call {@link init} once at startup to authenticate and pre-cache breaker state.
 * 3. Wrap downstream calls with {@link BreakerHandle.protect} for automatic state checks,
 *    metrics, timeouts, and fallback handling.
 * 4. Call {@link close} on process exit to flush pending metrics.
 *
 * The SDK is **fail-open**: if the Openfuse API is unreachable or init hasn't
 * completed yet, breakers default to closed and your code executes normally.
 *
 * @example
 * ```typescript
 * const client = new Openfuse({
 *   baseUrl: 'https://prod-acme.api.openfuse.io',
 *   system: 'payments',
 *   clientId: 'sdk_abc123',
 *   clientSecret: 'secret_xyz',
 * })
 *
 * client.init()
 *
 * const charge = await client.breaker('stripe-api').protect(async (signal) => {
 *   return stripe.charges.create({ amount: 1000 }, { signal })
 * }, {
 *   timeout: 5000,
 *   fallback: () => ({ queued: true }),
 * })
 * ```
 */
export class Openfuse {
  protected readonly transport: Transport
  private readonly authApi: AuthApi
  private readonly tokenManager: TokenManager
  protected readonly baseUrl: string
  private readonly system: string
  private readonly _instanceId: string
  private readonly metricsApi: MetricsApi
  private readonly apiHealthTracker: ApiHealthTracker

  private breakersFeature: BreakersFeature
  private metricsFeature: MetricsFeature
  private metricsConfig?: Partial<TMetricsConfig>
  private pendingBootstrap: Promise<void> | null = null
  private bootstrapWarningLogged = false
  private notFoundWarnings = new TTLCache<string, true>({
    maximumEntries: NOT_FOUND_WARNING_MAX_ENTRIES,
  })
  protected bootstrapData?: TSdkBootstrapResponse

  private bootstrapRetryTimer: ReturnType<typeof setTimeout> | undefined
  private bootstrapAbortController: AbortController | null = null
  private bootstrapTimeoutMs?: number
  private bootstrapMaxAttempts?: number
  private isShuttingDown = false

  private _breakerOps: TBreakerOperations | undefined

  constructor(options: TOpenfuseOptions) {
    validateRequiredStrings(options, ['baseUrl', 'system', 'clientId', 'clientSecret'])

    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.system = options.system
    this._instanceId = options.instanceId ?? generateInstanceId()
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
   * @param options.maxAttempts - Max retries for the init HTTP call (default: 3).
   *
   * @example
   * ```typescript
   * const client = new Openfuse({ ... })
   * client.init()
   * // SDK methods are usable immediately
   * ```
   */
  public init(options?: { timeoutMs?: number; maxAttempts?: number }): void {
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
      const response = await this.authApi.bootstrap(this.system, {
        instanceId: this._instanceId,
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
        const response = await this.authApi.bootstrap(this.system, {
          instanceId: this._instanceId,
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
   * Returns a promise that resolves when the current init attempt completes.
   * Resolves immediately if init is not in progress.
   *
   * @remarks Not required for normal usage. The SDK is usable immediately after
   * calling {@link init}. Use this only when you need to guarantee that
   * init has finished (e.g., in tests or health-check endpoints).
   *
   * @example
   * ```typescript
   * client.init()
   * await client.ready()
   * // init has completed (or was never started)
   * ```
   */
  public ready(): Promise<void> {
    return this.pendingBootstrap ?? Promise.resolve()
  }

  /**
   * Hook called after a successful bootstrap. Override in subclasses to run
   * additional setup (e.g., reconfiguring the transport URL).
   * Errors thrown here are caught and logged. They do not break bootstrap.
   */
  protected async onBootstrapComplete(): Promise<void> {}

  /**
   * Returns a {@link BreakerHandle} bound to the given slug.
   *
   * The handle is a thin proxy — no API call, no caching. All methods on the
   * handle delegate back to this client's internal implementation.
   *
   * @param slug - The breaker's slug as configured in the dashboard.
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
  public breaker(slug: string): BreakerHandle {
    return new BreakerHandle(slug, this.breakerOps)
  }

  private get breakerOps(): TBreakerOperations {
    if (!this._breakerOps) {
      this._breakerOps = {
        protect: (slug, fn, opts) => this.executeProtected(slug, fn, opts),
        isOpen: (slug) => this.checkIsOpen(slug),
        isClosed: (slug) => this.checkIsClosed(slug),
        fetchStatus: (slug, signal) => this.fetchBreakerStatus(slug, signal),
      }
    }
    return this._breakerOps
  }

  /**
   * Returns all {@link TBreaker} objects for the configured system.
   *
   * @returns All breakers with their current state, or `[]` if not initialized
   *   or the request fails.
   */
  public async breakers(): Promise<TBreaker[]> {
    if (!this.bootstrapData) {
      this.handleFailOpen(
        'breakers',
        null,
        new ConfigurationError('Call init() before using the SDK'),
      )
      return []
    }
    try {
      return await raceWithTimeout(
        this.breakersFeature.listBreakers(this.bootstrapData.system.id),
        STATE_FETCH_BUDGET_MS,
        () => {
          logger.warn(
            `breakers() exceeded ${STATE_FETCH_BUDGET_MS}ms budget, returning empty list.`,
          )
          return []
        },
      )
    } catch (error) {
      logger.warn('breakers() failed, returning empty list:', error)
      return []
    }
  }

  private getSystemId(): string {
    if (!this.bootstrapData) {
      throw new ConfigurationError('Call init() before using the SDK')
    }
    return this.bootstrapData.system.id
  }

  private handleFailOpen(method: string, breakerSlug: string | null, error: unknown): void {
    if (error instanceof ConfigurationError) {
      if (!this.bootstrapWarningLogged) {
        logger.warn(
          'SDK used before init completed. Operating in fail-open mode. Ensure init() is called at startup.',
        )
        this.bootstrapWarningLogged = true
      }
      return
    }
    if (error instanceof NotFoundError && breakerSlug) {
      if (!this.notFoundWarnings.hasFresh(breakerSlug)) {
        this.notFoundWarnings.set(breakerSlug, true, NOT_FOUND_WARNING_TTL_MS)
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
   * Wraps fetchBreakerState with a 500ms budget for protect().
   * The underlying fetch continues in background (updates cache), only this caller gives up.
   */
  private async fetchBreakerStateWithBudget(breakerSlug: string): Promise<TBreakerStateValue> {
    return raceWithTimeout(this.fetchBreakerState(breakerSlug), STATE_FETCH_BUDGET_MS, () => {
      throw new TimeoutError('State fetch budget exceeded')
    })
  }

  private async checkIsOpen(breakerSlug: string): Promise<boolean> {
    try {
      const state = await this.fetchBreakerStateWithBudget(breakerSlug)
      return state === 'open'
    } catch (error) {
      this.handleFailOpen('isOpen', breakerSlug, error)
      return false
    }
  }

  private async checkIsClosed(breakerSlug: string): Promise<boolean> {
    try {
      const state = await this.fetchBreakerStateWithBudget(breakerSlug)
      return state === 'closed'
    } catch (error) {
      this.handleFailOpen('isClosed', breakerSlug, error)
      return true
    }
  }

  private async fetchBreakerStatus(
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<TBreaker | null> {
    try {
      const promise = this.breakersFeature.getBreakerBySlug(this.getSystemId(), breakerSlug, signal)
      return await raceWithTimeout(promise, STATE_FETCH_BUDGET_MS, () => {
        logger.warn(
          `status("${breakerSlug}") exceeded ${STATE_FETCH_BUDGET_MS}ms budget, returning null.`,
        )
        return null
      })
    } catch (error) {
      this.handleFailOpen('status', breakerSlug, error)
      return null
    }
  }

  private async executeProtected<T>(
    breakerSlug: string,
    fn: (signal: AbortSignal) => Promise<T> | T,
    options?: TProtectOptions<T>,
  ): Promise<T> {
    const { timeout, fallback, signal } = options ?? {}

    let state: TBreakerStateValue | null = null
    try {
      state = await this.fetchBreakerStateWithBudget(breakerSlug)
    } catch (error) {
      this.handleFailOpen('protect', breakerSlug, error)
      // fail-open: fall through to execute fn()
    }

    if (state === 'open') {
      if (fallback) return await fallback()
      logger.warn(
        `Breaker "${breakerSlug}" is open and no fallback was provided. Executing anyway (fail-open).`,
      )
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
  public async reset(): Promise<void> {
    try {
      await this.metricsFeature.flush()
    } catch (error) {
      logger.warn('Metrics flush failed during reset:', error)
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
   * @remarks Prefer {@link close} for full graceful teardown. Use this standalone
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
   * on the next {@link BreakerHandle.protect} call, so this is safe to call temporarily.
   *
   * @remarks For permanent shutdown, use {@link close} instead.
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
   * and cancels any in-progress init retries.
   *
   * @param options.timeoutMs - Maximum time to wait for the metrics flush (default: 5000).
   *   If exceeded, shutdown completes but some metrics may be lost.
   *
   * @example
   * ```typescript
   * process.on('SIGTERM', async () => {
   *   await client.close()
   *   process.exit(0)
   * })
   * ```
   */
  public async close(options?: { timeoutMs?: number }): Promise<void> {
    this.isShuttingDown = true
    this.cancelBootstrapRetry()
    this.bootstrapAbortController?.abort()

    try {
      const timeoutMs = options?.timeoutMs ?? 5_000
      const timedOut = await raceWithTimeout(
        this.flushMetrics().then(() => false),
        timeoutMs,
        () => true,
      )

      if (timedOut) {
        logger.warn(`Shutdown timed out after ${timeoutMs}ms, some metrics may be lost`)
      }
    } catch (error) {
      logger.warn('Error during shutdown:', error)
    } finally {
      this.metricsFeature.teardown()
    }
  }

  /**
   * The unique instance ID for this SDK process. Auto-generated from
   * the platform environment (Lambda, ECS, K8s, etc.) or overridden via
   * {@link TOpenfuseOptions.instanceId}.
   */
  public get instanceId(): string {
    return this._instanceId
  }

  private createMetricsFeature(): MetricsFeature {
    return new MetricsFeature({
      api: this.metricsApi,
      breakersFeature: this.breakersFeature,
      instanceId: this._instanceId,
      config: this.metricsConfig,
      getSystemId: () => this.bootstrapData?.system?.id ?? null,
    })
  }
}
