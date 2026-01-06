import { CircuitOpenError, TimeoutError } from '../core/errors.ts'
import { generateInstanceId } from '../core/instance.ts'
import { Transport } from '../core/transport.ts'
import type {
  TCompanyEnvironmentSystemScope,
  TEndpointProvider,
  TTokenProvider,
} from '../core/types.ts'
import { BreakersApi } from '../domains/breakers/breakers.api.ts'
import { BreakersFeature } from '../domains/breakers/breakers.feature.ts'
import { MetricsApi } from '../domains/metrics/metrics.api.ts'
import { MetricsFeature } from '../domains/metrics/metrics.feature.ts'
import type { TMetricsConfig } from '../domains/metrics/types.ts'
import { SystemsApi } from '../domains/system/system.api.ts'
import { SystemFeature } from '../domains/system/system.feature.ts'
import type { TBreaker } from '../types/api.ts'

type TOpenfuseOptions = {
  endpointProvider: TEndpointProvider
  tokenProvider: TTokenProvider
  scope: TCompanyEnvironmentSystemScope
  /** Optional metrics configuration */
  metrics?: Partial<TMetricsConfig>
  /**
   * Optional custom instance ID for this SDK process.
   * If not provided, the SDK auto-detects the platform (Lambda, ECS, K8s, Cloud Run, etc.)
   * and uses the appropriate identifier, falling back to hostname-pid-random.
   *
   * Use this when you have a specific identifier for your infrastructure
   * that you want to use for metrics deduplication.
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
  private transport: Transport
  private systemFeature: SystemFeature
  private breakersFeature: BreakersFeature
  private metricsFeature: MetricsFeature
  private readonly instanceId: string
  private readonly metricsApi: MetricsApi
  private readonly metricsConfig?: Partial<TMetricsConfig>

  constructor(options: TOpenfuseOptions) {
    this.instanceId = options.instanceId ?? generateInstanceId()
    this.metricsConfig = options.metrics

    this.transport = new Transport({
      endpointProvider: options.endpointProvider,
      tokenProvider: options.tokenProvider,
    })

    const breakersApi = new BreakersApi({ transport: this.transport })
    const systemsApi = new SystemsApi({ transport: this.transport })
    this.metricsApi = new MetricsApi({ transport: this.transport })

    this.systemFeature = new SystemFeature({ scope: options.scope, api: systemsApi })
    this.breakersFeature = new BreakersFeature({ api: breakersApi })
    this.metricsFeature = new MetricsFeature({
      api: this.metricsApi,
      breakersFeature: this.breakersFeature,
      systemFeature: this.systemFeature,
      instanceId: this.instanceId,
      config: this.metricsConfig,
    })
  }

  /**
   * Initialize the SDK by fetching system configuration and breaker definitions.
   * Call this once at application startup for optimal performance.
   */
  public async bootstrap(): Promise<void> {
    const systemId: string = await this.systemFeature.resolveSystemId()

    const boot = await this.systemFeature.bootstrapSystem(systemId)
    if (boot.breakers && boot.breakers.length > 0) {
      this.breakersFeature.ingestBootstrap(systemId, boot.breakers)
      return
    }
  }

  /**
   * Check if a breaker is open (blocking traffic).
   * Prefer `withBreaker()` for automatic metrics and fallback handling.
   */
  public async isOpen(breakerSlug: string, signal?: AbortSignal): Promise<boolean> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    const state = await this.breakersFeature.getBreakerStateBySlug(systemId, breakerSlug, signal)
    return state === 'open'
  }

  /**
   * Check if a breaker is closed (allowing traffic).
   * Prefer `withBreaker()` for automatic metrics and fallback handling.
   */
  public async isClosed(breakerSlug: string, signal?: AbortSignal): Promise<boolean> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    const state = await this.breakersFeature.getBreakerStateBySlug(systemId, breakerSlug, signal)
    return state === 'closed'
  }

  /** Fetch breaker details by slug. */
  public async getBreaker(breakerSlug: string): Promise<TBreaker> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    return await this.breakersFeature.getBreakerBySlug(systemId, breakerSlug)
  }

  /** Fetch all breakers for the configured system. */
  public async listBreakers(): Promise<TBreaker[]> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    return await this.breakersFeature.listBreakers(systemId)
  }

  /**
   * Executes a function protected by a circuit breaker.
   *
   * Behavior:
   * - CLOSED: executes the function, records metrics (success/failure/timeout + latency)
   * - OPEN: calls `onOpen` fallback or throws `CircuitOpenError`
   * - UNKNOWN (state fetch failed): calls `onUnknown`, then `onOpen`, or throws `CircuitOpenError`
   *
   * The fail-open strategy ensures protected operations don't run when state is uncertain.
   *
   * @param breakerSlug - Breaker identifier
   * @param fn - Function to execute when breaker is closed
   * @param options.timeout - Max execution time in ms. Throws `TimeoutError` if exceeded.
   * @param options.onOpen - Fallback when breaker is open or state unknown
   * @param options.onUnknown - Fallback specifically for state fetch failures (takes precedence over onOpen)
   * @param options.signal - AbortSignal for cancellation
   *
   * @example
   * ```typescript
   * const result = await openfuse.withBreaker(
   *   'payment-gateway',
   *   () => paymentService.charge(amount),
   *   {
   *     timeout: 5000,
   *     onOpen: () => ({ status: 'queued' }),
   *   },
   * )
   * ```
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
      // Fail-open: treat unknown state as open to avoid running potentially dangerous operations
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
      systemFeature: this.systemFeature,
      instanceId: this.instanceId,
      config: this.metricsConfig,
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
