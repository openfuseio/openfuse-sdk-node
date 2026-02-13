/**
 * Configuration for the SDK's client-side metrics aggregation.
 * Pass a partial config via {@link TOpenfuseOptions.metrics} to override server defaults.
 */
export type TMetricsConfig = {
  /** Size of aggregation windows in milliseconds (default: 10s) */
  windowSizeMs: number
  /** How often to flush metrics to the backend (default: 15s) */
  flushIntervalMs: number
  /** Max latency samples per window for percentile calculation (default: 1000) */
  maxLatencySamples: number
  /** Whether metrics collection is enabled (default: true) */
  enabled: boolean
}

export const DEFAULT_METRICS_CONFIG: TMetricsConfig = {
  windowSizeMs: 10_000,
  flushIntervalMs: 15_000,
  maxLatencySamples: 1_000,
  enabled: true,
}

export type TExecutionOutcome = 'success' | 'failure' | 'timeout'

export type TBreakerWindowMetrics = {
  successCount: number
  failureCount: number
  timeoutCount: number
  latencySamples: number[]
}

export type TBreakerMetricsPayload = {
  breakerId: string
  metrics: Array<{ metricId: string; value: number }>
}

export type TIngestMetricsRequest = {
  instanceId: string
  systemId: string | null
  windowStart: string
  windowEnd: string
  breakers: TBreakerMetricsPayload[]
}

export type TIngestMetricsResponse = {
  accepted: number
  duplicates: number
}

export type TMetric = {
  id: string
  slug: string
  name: string
  unit: string
}
