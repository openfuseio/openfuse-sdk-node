import { TTLCache } from '../../core/cache.ts'
import type { MetricsApi } from './metrics.api.ts'
import type { BreakersFeature } from '../breakers/breakers.feature.ts'
import type { SystemFeature } from '../system/system.feature.ts'
import type {
  TMetricsConfig,
  TBreakerWindowMetrics,
  TExecutionOutcome,
  TMetric,
  TBreakerMetricsPayload,
} from './types.ts'
import { DEFAULT_METRICS_CONFIG } from './types.ts'

type TWindowKey = string
type TBreakerSlug = string
type TMetricsBuffer = Map<TWindowKey, Map<TBreakerSlug, TBreakerWindowMetrics>>

export type TMetricsFeatureOptions = {
  api: MetricsApi
  breakersFeature: BreakersFeature
  systemFeature: SystemFeature
  instanceId: string
  config?: Partial<TMetricsConfig>
}

const STANDARD_METRICS = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  TIMEOUT: 'timeout',
  TOTAL: 'total',
  LATENCY_P50: 'latency-p50',
  LATENCY_P95: 'latency-p95',
  LATENCY_P99: 'latency-p99',
} as const

/** Max windows to keep in buffer to prevent unbounded memory growth */
const MAX_BUFFERED_WINDOWS = 100

export class MetricsFeature {
  private buffer: TMetricsBuffer = new Map()
  private metricSlugToId: TTLCache<string, string>
  private metricsCache: TMetric[] | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private config: TMetricsConfig
  private isFlushing = false

  private readonly api: MetricsApi
  private readonly breakersFeature: BreakersFeature
  private readonly systemFeature: SystemFeature
  private readonly instanceId: string

  private static readonly METRIC_CACHE_TTL_MS = 600_000

  constructor(options: TMetricsFeatureOptions) {
    this.api = options.api
    this.breakersFeature = options.breakersFeature
    this.systemFeature = options.systemFeature
    this.instanceId = options.instanceId
    this.config = { ...DEFAULT_METRICS_CONFIG, ...options.config }
    this.metricSlugToId = new TTLCache({ maximumEntries: 1000 })

    if (this.config.enabled) {
      this.startFlushWorker()
    }
  }

  /** @internal Called by withBreaker() after each execution. */
  public recordExecution(breakerSlug: string, outcome: TExecutionOutcome, latencyMs: number): void {
    if (!this.config.enabled) return

    const timestamp = Date.now()
    const windowKey = this.computeWindowKey(timestamp)

    let windowBucket = this.buffer.get(windowKey)
    if (!windowBucket) {
      windowBucket = new Map()
      this.buffer.set(windowKey, windowBucket)
    }

    let metrics = windowBucket.get(breakerSlug)
    if (!metrics) {
      metrics = {
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        latencySamples: [],
      }
      windowBucket.set(breakerSlug, metrics)
    }

    switch (outcome) {
      case 'success':
        metrics.successCount++
        break
      case 'failure':
        metrics.failureCount++
        break
      case 'timeout':
        metrics.timeoutCount++
        break
    }

    if (metrics.latencySamples.length < this.config.maxLatencySamples) {
      metrics.latencySamples.push(latencyMs)
    } else {
      // Reservoir sampling: replace random element with decreasing probability
      const totalSamples = metrics.successCount + metrics.failureCount + metrics.timeoutCount
      const replaceIndex = Math.floor(Math.random() * totalSamples)
      if (replaceIndex < this.config.maxLatencySamples) {
        metrics.latencySamples[replaceIndex] = latencyMs
      }
    }

    // Evict oldest windows if buffer is too large (prevents unbounded memory growth)
    this.evictOldestWindowsIfNeeded()
  }

  private evictOldestWindowsIfNeeded(): void {
    if (this.buffer.size <= MAX_BUFFERED_WINDOWS) return

    // Sort window keys chronologically and remove oldest
    const sortedKeys = [...this.buffer.keys()].sort()
    const keysToRemove = sortedKeys.slice(0, this.buffer.size - MAX_BUFFERED_WINDOWS)
    for (const key of keysToRemove) {
      this.buffer.delete(key)
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing) return
    this.isFlushing = true

    try {
      const now = Date.now()
      const currentWindowKey = this.computeWindowKey(now)

      // Only flush completed windows, not the current one still receiving data
      const completedWindows = [...this.buffer.entries()].filter(
        ([key]) => key !== currentWindowKey,
      )

      if (completedWindows.length === 0) return

      await this.ensureMetricsLoaded()
      const systemId = await this.systemFeature.resolveSystemId()

      for (const [windowKey, breakerMetrics] of completedWindows) {
        const { windowStart, windowEnd } = this.parseWindowKey(windowKey)

        const breakers = await Promise.all(
          [...breakerMetrics.entries()].map(async ([breakerSlug, metrics]) => {
            const breakerId = await this.breakersFeature.resolveBreakerId(systemId, breakerSlug)
            if (!breakerId) return null

            const total = metrics.successCount + metrics.failureCount + metrics.timeoutCount
            if (total === 0) return null

            const { p50, p95, p99 } = this.computePercentiles(metrics.latencySamples)

            const metricValues: Array<{ metricId: string; value: number }> = []

            const addMetric = (slug: string, value: number) => {
              const metricId = this.resolveMetricId(slug)
              if (metricId && value > 0) {
                metricValues.push({ metricId, value })
              }
            }

            // Server needs counts (even if 0) for rate calculations
            const successId = this.resolveMetricId(STANDARD_METRICS.SUCCESS)
            const failureId = this.resolveMetricId(STANDARD_METRICS.FAILURE)
            const timeoutId = this.resolveMetricId(STANDARD_METRICS.TIMEOUT)
            const totalId = this.resolveMetricId(STANDARD_METRICS.TOTAL)

            if (successId) metricValues.push({ metricId: successId, value: metrics.successCount })
            if (failureId) metricValues.push({ metricId: failureId, value: metrics.failureCount })
            if (timeoutId) metricValues.push({ metricId: timeoutId, value: metrics.timeoutCount })
            if (totalId) metricValues.push({ metricId: totalId, value: total })

            if (metrics.latencySamples.length > 0) {
              addMetric(STANDARD_METRICS.LATENCY_P50, p50)
              addMetric(STANDARD_METRICS.LATENCY_P95, p95)
              addMetric(STANDARD_METRICS.LATENCY_P99, p99)
            }

            if (metricValues.length === 0) return null
            return { breakerId, metrics: metricValues }
          }),
        )

        const validBreakers = breakers.filter((b): b is TBreakerMetricsPayload => b !== null)

        if (validBreakers.length === 0) {
          this.buffer.delete(windowKey)
          continue
        }

        try {
          await this.api.ingest({
            instanceId: this.instanceId,
            systemId,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            breakers: validBreakers,
          })
          // Only delete window after successful ingest
          this.buffer.delete(windowKey)
        } catch {
          // Keep window in buffer for retry on next flush cycle
        }
      }
    } finally {
      this.isFlushing = false
    }
  }

  public stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private computeWindowKey(timestamp: number): TWindowKey {
    const windowStart = Math.floor(timestamp / this.config.windowSizeMs) * this.config.windowSizeMs
    return new Date(windowStart).toISOString()
  }

  private parseWindowKey(key: TWindowKey): { windowStart: Date; windowEnd: Date } {
    const windowStart = new Date(key)
    const windowEnd = new Date(windowStart.getTime() + this.config.windowSizeMs)
    return { windowStart, windowEnd }
  }

  private computePercentiles(samples: number[]): { p50: number; p95: number; p99: number } {
    if (samples.length === 0) {
      return { p50: 0, p95: 0, p99: 0 }
    }

    const sorted = [...samples].sort((a, b) => a - b)

    const percentile = (p: number): number => {
      const index = (p / 100) * (sorted.length - 1)
      const lower = Math.floor(index)
      const upper = Math.ceil(index)
      const weight = index - lower

      const lastValue = sorted[sorted.length - 1]
      if (lastValue === undefined || upper >= sorted.length) {
        return lastValue ?? 0
      }

      const lowerValue = sorted[lower]
      const upperValue = sorted[upper]
      if (lowerValue === undefined) return 0
      if (lower === upper || upperValue === undefined) return lowerValue

      return lowerValue * (1 - weight) + upperValue * weight
    }

    return {
      p50: Math.round(percentile(50)),
      p95: Math.round(percentile(95)),
      p99: Math.round(percentile(99)),
    }
  }

  private startFlushWorker(): void {
    this.flushTimer = setInterval(() => {
      void this.flush()
    }, this.config.flushIntervalMs)
  }

  private async ensureMetricsLoaded(): Promise<void> {
    if (this.metricsCache !== null && this.metricsCache.length > 0) return

    try {
      this.metricsCache = await this.api.listMetrics()
      for (const metric of this.metricsCache) {
        this.metricSlugToId.set(metric.slug, metric.id, MetricsFeature.METRIC_CACHE_TTL_MS)
      }
    } catch {
      this.metricsCache = null
    }
  }

  private resolveMetricId(metricSlug: string): string | null {
    return this.metricSlugToId.get(metricSlug) ?? null
  }
}
