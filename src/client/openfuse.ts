import { CircuitOpenError, TimeoutError } from '../core/errors.ts'
import { generateInstanceId } from '../core/instance.ts'
import { Transport } from '../core/transport.ts'
import { AuthApi } from '../domains/auth/auth.api.ts'
import { TokenManager } from '../domains/auth/token-manager.ts'
import { BreakersApi } from '../domains/breakers/breakers.api.ts'
import { BreakersFeature } from '../domains/breakers/breakers.feature.ts'
import { MetricsApi } from '../domains/metrics/metrics.api.ts'
import { MetricsFeature } from '../domains/metrics/metrics.feature.ts'
import type { TMetricsConfig } from '../domains/metrics/types.ts'
import type { TBreaker, TSdkBootstrapResponse } from '../types/api.ts'

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

export class Openfuse {
  private readonly transport: Transport
  private readonly authApi: AuthApi
  private readonly tokenManager: TokenManager
  private readonly baseUrl: string
  private readonly systemSlug: string
  private readonly instanceId: string
  private readonly metricsApi: MetricsApi

  private breakersFeature: BreakersFeature
  private metricsFeature: MetricsFeature
  private metricsConfig?: Partial<TMetricsConfig>
  private bootstrapData?: TSdkBootstrapResponse

  constructor(options: TOpenfuseOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.systemSlug = options.systemSlug
    this.instanceId = options.instanceId ?? generateInstanceId()
    this.metricsConfig = options.metrics

    // Auth API for bootstrap and token refresh
    this.authApi = new AuthApi({
      baseUrl: this.baseUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    })

    // Token manager handles caching, auto-refresh, and retry
    this.tokenManager = new TokenManager({
      authApi: this.authApi,
    })

    // Transport for authenticated API calls
    this.transport = new Transport({
      baseUrl: this.baseUrl,
      tokenProvider: this.tokenManager,
    })

    const breakersApi = new BreakersApi({ transport: this.transport })
    this.metricsApi = new MetricsApi({ transport: this.transport })

    this.breakersFeature = new BreakersFeature({ api: breakersApi })
    this.metricsFeature = new MetricsFeature({
      api: this.metricsApi,
      breakersFeature: this.breakersFeature,
      instanceId: this.instanceId,
      config: this.metricsConfig,
      getSystemId: () => this.getSystemId(),
    })
  }

  /**
   * Initialize the SDK by calling POST /sdk/bootstrap.
   * Returns system config, breakers, metrics configuration, and an access token.
   * Call this once at application startup.
   */
  public async bootstrap(): Promise<void> {
    const response = await this.authApi.bootstrap(this.systemSlug, {
      instanceId: this.instanceId,
    })

    this.bootstrapData = response

    // Store the access token for subsequent API calls
    this.tokenManager.setToken(response.accessToken, response.expiresIn)

    // Apply server-provided metrics config (user config takes precedence)
    if (response.metricsConfig) {
      this.metricsConfig = {
        flushIntervalMs: response.metricsConfig.flushIntervalMs,
        windowSizeMs: response.metricsConfig.windowSizeMs,
        ...this.metricsConfig,
      }
      this.metricsFeature = new MetricsFeature({
        api: this.metricsApi,
        breakersFeature: this.breakersFeature,
        instanceId: this.instanceId,
        config: this.metricsConfig,
        getSystemId: () => this.getSystemId(),
      })
    }

    // Ingest breakers
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

  /**
   * Check if a breaker is open (blocking traffic).
   * Prefer `withBreaker()` for automatic metrics and fallback handling.
   */
  public async isOpen(breakerSlug: string, signal?: AbortSignal): Promise<boolean> {
    const state = await this.breakersFeature.getBreakerStateBySlug(
      this.getSystemId(),
      breakerSlug,
      signal,
    )
    return state === 'open'
  }

  /**
   * Check if a breaker is closed (allowing traffic).
   * Prefer `withBreaker()` for automatic metrics and fallback handling.
   */
  public async isClosed(breakerSlug: string, signal?: AbortSignal): Promise<boolean> {
    const state = await this.breakersFeature.getBreakerStateBySlug(
      this.getSystemId(),
      breakerSlug,
      signal,
    )
    return state === 'closed'
  }

  /** Fetch breaker details by slug. */
  public async getBreaker(breakerSlug: string, signal?: AbortSignal): Promise<TBreaker> {
    return await this.breakersFeature.getBreakerBySlug(this.getSystemId(), breakerSlug, signal)
  }

  /** Fetch all breakers for the configured system. */
  public async listBreakers(): Promise<TBreaker[]> {
    return await this.breakersFeature.listBreakers(this.getSystemId())
  }

  /** Get system ID from bootstrap data */
  private getSystemId(): string {
    if (!this.bootstrapData) {
      throw new Error('Call bootstrap() before using the SDK')
    }
    return this.bootstrapData.system.id
  }

  /**
   * Executes a function protected by a circuit breaker.
   *
   * Behavior:
   * - CLOSED: executes the function, records metrics (success/failure/timeout + latency)
   * - OPEN: calls `onOpen` fallback or throws `CircuitOpenError`
   * - UNKNOWN (state fetch failed): calls `onUnknown`, then `onOpen`, or throws `CircuitOpenError`
   *
   * @param breakerSlug - Breaker identifier
   * @param fn - Function to execute when breaker is closed
   * @param options.timeout - Max execution time in ms. Throws `TimeoutError` if exceeded.
   * @param options.onOpen - Fallback when breaker is open or state unknown
   * @param options.onUnknown - Fallback specifically for state fetch failures
   * @param options.signal - AbortSignal for cancellation
   */
  public async withBreaker<T>(
    breakerSlug: string,
    fn: () => Promise<T> | T,
    options?: TWithBreakerOptions<T>,
  ): Promise<T> {
    const { timeout, onOpen, onUnknown, signal } = options ?? {}

    let isBreakerOpen: boolean
    try {
      isBreakerOpen = await this.isOpen(breakerSlug, signal)
    } catch {
      if (onUnknown) return await onUnknown()
      if (onOpen) return await onOpen()
      throw new CircuitOpenError(`Breaker state unknown (failed to fetch): ${breakerSlug}`)
    }

    if (isBreakerOpen) {
      if (onOpen) return await onOpen()
      throw new CircuitOpenError(`Breaker is open: ${breakerSlug}`)
    }

    const startTime = performance.now()

    try {
      const result = await this.executeWithTimeout(fn, timeout)
      const latencyMs = performance.now() - startTime
      this.metricsFeature.recordExecution(breakerSlug, 'success', latencyMs)
      return result
    } catch (err) {
      const latencyMs = performance.now() - startTime
      const outcome = err instanceof TimeoutError ? 'timeout' : 'failure'
      this.metricsFeature.recordExecution(breakerSlug, outcome, latencyMs)
      throw err
    }
  }

  /** Clear cached breaker data. Call after external changes to breaker configuration. */
  public async invalidate(): Promise<void> {
    await this.metricsFeature.flush()
    this.metricsFeature.stop()

    const breakersApi = new BreakersApi({ transport: this.transport })
    this.breakersFeature = new BreakersFeature({ api: breakersApi })

    this.metricsFeature = new MetricsFeature({
      api: this.metricsApi,
      breakersFeature: this.breakersFeature,
      instanceId: this.instanceId,
      config: this.metricsConfig,
      getSystemId: () => this.getSystemId(),
    })
  }

  /** Flush pending metrics to backend. Call before graceful shutdown. */
  public async flushMetrics(): Promise<void> {
    await this.metricsFeature.flush()
  }

  /** Stop background metrics flush. Recording continues but won't auto-flush. */
  public stopMetrics(): void {
    this.metricsFeature.stop()
  }

  /** Graceful shutdown: flush metrics and stop the worker. */
  public async shutdown(): Promise<void> {
    await this.flushMetrics()
    this.stopMetrics()
  }

  /** Returns unique instance ID for this SDK process. */
  public getInstanceId(): string {
    return this.instanceId
  }

  private async executeWithTimeout<T>(fn: () => Promise<T> | T, timeout?: number): Promise<T> {
    if (timeout === undefined) {
      return await fn()
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TimeoutError(`Operation timed out after ${timeout}ms`))
      }, timeout)

      Promise.resolve(fn())
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timeoutId)
          reject(err)
        })
    })
  }
}
