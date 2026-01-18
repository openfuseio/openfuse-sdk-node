import { faker } from '@faker-js/faker'
import type {
  TSdkBootstrapResponse,
  TBreakerStateValue,
  TBreakerStateResponse,
  TSdkTokenRefreshResponse,
} from '../../src/types/api.ts'

export type TTestSystem = {
  id: string
  slug: string
  name: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type TTestBreaker = {
  id: string
  slug: string
  state: TBreakerStateValue
  retryAfter: string | null
}

export function makeSystem(overrides?: Partial<TTestSystem>): TTestSystem {
  const now = new Date().toISOString()
  const name = faker.airline.airplane().name

  return {
    id: overrides?.id ?? faker.string.uuid(),
    name: overrides?.name ?? name,
    slug: overrides?.slug ?? faker.helpers.slugify(name).toLowerCase(),
    createdBy: overrides?.createdBy ?? faker.string.uuid(),
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  }
}

export function makeBreaker(overrides?: Partial<TTestBreaker>): TTestBreaker {
  const name = faker.hacker.noun()

  return {
    id: overrides?.id ?? faker.string.uuid(),
    slug: overrides?.slug ?? faker.helpers.slugify(name).toLowerCase(),
    state:
      overrides?.state ?? faker.helpers.arrayElement(['open', 'closed'] as TBreakerStateValue[]),
    retryAfter: overrides?.retryAfter ?? null,
  }
}

export function makeState(overrides?: Partial<TBreakerStateResponse>): TBreakerStateResponse {
  return {
    state:
      overrides?.state ?? faker.helpers.arrayElement(['open', 'closed'] as TBreakerStateValue[]),
  }
}

export function makeSdkBootstrapResponse(overrides?: {
  system?: Partial<TTestSystem>
  breakers?: Partial<TTestBreaker>[]
  metricsConfig?: { flushIntervalMs?: number; windowSizeMs?: number }
  accessToken?: string
  expiresIn?: number
}): TSdkBootstrapResponse {
  const system = makeSystem(overrides?.system)

  const breakers: TTestBreaker[] = []
  if (overrides?.breakers) {
    for (const breakerOverrides of overrides.breakers) {
      breakers.push(makeBreaker(breakerOverrides))
    }
  }

  return {
    sdkClientId: faker.string.uuid(),
    company: {
      id: faker.string.uuid(),
      slug: faker.helpers.slugify(faker.company.name()).toLowerCase(),
    },
    environment: {
      id: faker.string.uuid(),
      slug: 'prod',
    },
    system: {
      id: system.id,
      slug: system.slug,
      name: system.name,
      createdBy: system.createdBy,
      createdAt: system.createdAt,
      updatedAt: system.updatedAt,
    },
    breakers: breakers.map((b) => ({
      id: b.id,
      slug: b.slug,
      state: b.state,
      retryAfter: b.retryAfter,
    })),
    serverTime: new Date().toISOString(),
    metricsConfig: {
      flushIntervalMs: overrides?.metricsConfig?.flushIntervalMs ?? 15000,
      windowSizeMs: overrides?.metricsConfig?.windowSizeMs ?? 10000,
    },
    accessToken: overrides?.accessToken ?? `test-token-${faker.string.alphanumeric(32)}`,
    tokenType: 'Bearer',
    expiresIn: overrides?.expiresIn ?? 3600,
  }
}

export function makeTokenRefreshResponse(
  overrides?: Partial<TSdkTokenRefreshResponse>,
): TSdkTokenRefreshResponse {
  return {
    accessToken: overrides?.accessToken ?? `test-token-${faker.string.alphanumeric(32)}`,
    tokenType: overrides?.tokenType ?? 'Bearer',
    expiresIn: overrides?.expiresIn ?? 3600,
  }
}

export type TMetricDefinition = {
  id: string
  slug: string
  name: string
  unit: string
}

export const STANDARD_METRIC_DEFINITIONS: TMetricDefinition[] = [
  { id: 'metric-success-id', slug: 'success', name: 'Success Count', unit: 'count' },
  { id: 'metric-failure-id', slug: 'failure', name: 'Failure Count', unit: 'count' },
  { id: 'metric-timeout-id', slug: 'timeout', name: 'Timeout Count', unit: 'count' },
  { id: 'metric-total-id', slug: 'total', name: 'Total Count', unit: 'count' },
  { id: 'metric-p50-id', slug: 'latency-p50', name: 'Latency P50', unit: 'ms' },
  { id: 'metric-p95-id', slug: 'latency-p95', name: 'Latency P95', unit: 'ms' },
  { id: 'metric-p99-id', slug: 'latency-p99', name: 'Latency P99', unit: 'ms' },
]
