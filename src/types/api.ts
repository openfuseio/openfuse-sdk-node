export type TBreakerStateValue = 'open' | 'closed' | 'half-open'

export type TBreaker = {
  id: string
  slug: string
  state: TBreakerStateValue
  updatedAt?: string
  retryAfter?: string | null
}

export type TBreakerStateResponse = {
  state: TBreakerStateValue
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
