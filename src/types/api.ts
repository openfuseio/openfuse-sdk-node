/**
 * Possible states of a circuit breaker.
 * - `'closed'`: traffic flows normally.
 * - `'open'`: traffic is blocked; the upstream dependency is considered unhealthy.
 * - `'half-open'`: a limited number of probe requests are allowed through to test recovery.
 */
export type TBreakerStateValue = 'open' | 'closed' | 'half-open'

/** A circuit breaker and its current state. */
export type TBreaker = {
  /** Unique breaker ID (server-assigned). */
  id: string
  /** Human-readable slug used in SDK methods (e.g., `'stripe-api'`). */
  slug: string
  /** Current breaker state. */
  state: TBreakerStateValue
  /** ISO-8601 timestamp of the last state change. */
  updatedAt?: string
  /** ISO-8601 timestamp after which the breaker may transition out of `open`. `null` if not applicable. */
  retryAfter?: string | null
}

/** Breaker state as returned by the state endpoint. */
export type TBreakerStateResponse = {
  state: TBreakerStateValue
  /** ISO-8601 timestamp of the last state change. */
  updatedAt?: string
}

// New SDK Bootstrap types (POST /sdk/bootstrap)

export type TSdkClientMeta = {
  sdkName?: string
  sdkVersion?: string
  runtime?: string
  runtimeVersion?: string
  platform?: string
  arch?: string
  instanceId?: string
}

export type TSdkBootstrapRequest = {
  systemSlug: string
  clientMeta?: TSdkClientMeta
}

export type TSdkBootstrapResponse = {
  sdkClientId: string
  company: {
    id: string
    slug: string
  }
  environment: {
    id: string
    slug: string
  }
  system: {
    id: string
    slug: string
    name: string
    createdBy: string
    createdAt: string
    updatedAt: string
  }
  breakers: Array<{
    id: string
    slug: string
    state: TBreakerStateValue
    retryAfter: string | null
  }>
  serverTime: string
  metricsConfig: {
    flushIntervalMs: number
    windowSizeMs: number
  }
  accessToken: string
  tokenType: string
  expiresIn: number
}

export type TSdkTokenRefreshResponse = {
  accessToken: string
  tokenType: string
  expiresIn: number
}
