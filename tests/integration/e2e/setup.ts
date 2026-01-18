import { beforeAll, afterAll } from 'vitest'
import { Openfuse } from '../../../src/index.ts'

const REQUIRED_ENV_VARS = ['E2E_API_BASE', 'E2E_CLIENT_ID', 'E2E_CLIENT_SECRET'] as const

const OPTIONAL_ENV_VARS = [
  'E2E_ADMIN_TOKEN', // Optional: pre-generated admin token for resource management
] as const

function validateEnvironment(): void {
  const missingRequired: string[] = []
  const missingOptional: string[] = []

  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) missingRequired.push(envVar)
  }

  for (const envVar of OPTIONAL_ENV_VARS) {
    if (!process.env[envVar]) missingOptional.push(envVar)
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `E2E tests require the following environment variables:\n` +
        missingRequired.map((v) => `  - ${v}`).join('\n') +
        `\n\nPlease set them in your .env.test file.`,
    )
  }

  if (missingOptional.length > 0) {
    console.warn(
      `⚠️  Optional E2E environment variables not set (some tests may be skipped):\n` +
        missingOptional.map((v) => `  - ${v}`).join('\n'),
    )
  }
}

validateEnvironment()

export const E2E_CONFIG = {
  apiBase: process.env.E2E_API_BASE!,
  clientId: process.env.E2E_CLIENT_ID!,
  clientSecret: process.env.E2E_CLIENT_SECRET!,
  adminToken: process.env.E2E_ADMIN_TOKEN,
}

export type TTestSystem = {
  id: string
  slug: string
  name: string
}

export type TTestBreaker = {
  id: string
  slug: string
  name: string
  state: 'open' | 'closed' | 'half-open'
  retryAfter?: string | null
}

export type TTestMetric = {
  id: string
  slug: string
  name: string
  unit: string
  isStandard: boolean
}

export type TTestTripPolicyRule = {
  sortOrder: number
  metricId: string
  comparisonOperator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'
  thresholdValue: number
}

export type TTestTripPolicy = {
  id: string
  slug: string
  name: string
  evaluationWindowMs: number
  consecutiveWindows: number
  probeIntervalMs: number
  action: 'open-breaker' | 'half-open-breaker' | 'alert-only' | 'none'
  rulesOperator: 'and' | 'or'
}

export type TTestPolicyAssignment = {
  tripPolicyId: string
  isEnabled: boolean
  priority: number
  stopOnTrigger: boolean
}

export type TTestContext = {
  apiClient: TestAPIClient
  system: TTestSystem
  breakers: TTestBreaker[]
  createSDKClient: (systemSlug?: string) => Openfuse
}

/**
 * Admin API client for E2E test resource management.
 * Uses Basic Auth or admin token for authenticated requests.
 */
export class TestAPIClient {
  private apiBase: string
  private clientId: string
  private clientSecret: string
  private cachedToken: string | null = null

  constructor(apiBase: string, clientId: string, clientSecret: string) {
    this.apiBase = apiBase
    this.clientId = clientId
    this.clientSecret = clientSecret
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken) return this.cachedToken

    // Use admin token if provided
    if (E2E_CONFIG.adminToken) {
      this.cachedToken = E2E_CONFIG.adminToken
      return this.cachedToken
    }

    // Use token endpoint with Basic Auth to get an access token
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const response = await fetch(`${this.apiBase}/v1/sdk/auth/token`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${basicAuth}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to get token: ${response.status}`)
    }

    const result = (await response.json()) as { data: { accessToken: string } }
    this.cachedToken = result.data.accessToken
    return this.cachedToken
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken()
    const url = `${this.apiBase}/v1${path}`

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API request failed: ${response.status} ${text}`)
    }

    const json = (await response.json()) as { data: T }
    return json.data
  }

  async createSystem(data: {
    name: string
    slug: string
    description?: string
  }): Promise<TTestSystem> {
    return this.request<TTestSystem>('POST', '/systems', data)
  }

  async deleteSystem(systemId: string): Promise<void> {
    try {
      await this.request('DELETE', `/systems/${systemId}`)
    } catch {
      // Ignore - deletion might not be supported
    }
  }

  async createBreaker(
    systemId: string,
    data: { name: string; slug: string; description?: string; state?: 'open' | 'closed' },
  ): Promise<TTestBreaker> {
    return this.request<TTestBreaker>('POST', `/systems/${systemId}/breakers`, {
      ...data,
      state: data.state ?? 'closed',
      policyAssignments: [],
    })
  }

  async updateBreakerState(
    systemId: string,
    breakerId: string,
    state: 'open' | 'closed',
    reason?: string,
  ): Promise<TTestBreaker> {
    return this.request<TTestBreaker>('PUT', `/systems/${systemId}/breakers/${breakerId}/state`, {
      state,
      reason: reason ?? 'E2E test state change',
      probeIntervalMs: state === 'open' ? 30000 : null,
    })
  }

  async getBreaker(systemId: string, breakerId: string): Promise<TTestBreaker> {
    return this.request<TTestBreaker>('GET', `/systems/${systemId}/breakers/${breakerId}`)
  }

  async listBreakers(systemId: string): Promise<TTestBreaker[]> {
    return this.request<TTestBreaker[]>('GET', `/systems/${systemId}/breakers`)
  }

  async getSystemBySlug(slug: string): Promise<TTestSystem> {
    return this.request<TTestSystem>('GET', `/systems/by-slug/${slug}`)
  }

  async createTripPolicy(data: {
    name: string
    slug: string
    description?: string
    evaluationWindowMs: number
    evaluationIntervalMs: number
    consecutiveWindows: number
    probeIntervalMs: number
    action: 'open-breaker' | 'half-open-breaker' | 'alert-only' | 'none'
    rulesOperator: 'and' | 'or'
    rules: TTestTripPolicyRule[]
  }): Promise<TTestTripPolicy> {
    return this.request<TTestTripPolicy>('POST', '/trip-policies', data)
  }

  async deleteTripPolicy(policyId: string): Promise<void> {
    try {
      await this.request('DELETE', `/trip-policies/${policyId}`)
    } catch {
      // Ignore - deletion might fail if policy is in use
    }
  }

  async listMetrics(): Promise<TTestMetric[]> {
    return this.request<TTestMetric[]>('GET', '/metrics')
  }

  async getMetricBySlug(slug: string): Promise<TTestMetric | undefined> {
    const metrics = await this.listMetrics()
    return metrics.find((m) => m.slug === slug)
  }

  async createBreakerWithPolicy(
    systemId: string,
    data: {
      name: string
      slug: string
      description?: string
      state?: 'open' | 'closed'
      policyAssignments: TTestPolicyAssignment[]
    },
  ): Promise<TTestBreaker> {
    return this.request<TTestBreaker>('POST', `/systems/${systemId}/breakers`, {
      ...data,
      state: data.state ?? 'closed',
    })
  }

  async getBreakerWithRetryAfter(systemId: string, breakerId: string): Promise<TTestBreaker> {
    return this.request<TTestBreaker>('GET', `/systems/${systemId}/breakers/${breakerId}`)
  }
}

export function uniqueSlug(base: string): string {
  const random = Math.random().toString(36).substring(2, 8)
  return `${base}-${random}`
}

export function createSDKClient(systemSlug: string): Openfuse {
  return new Openfuse({
    baseUrl: E2E_CONFIG.apiBase,
    systemSlug,
    clientId: E2E_CONFIG.clientId,
    clientSecret: E2E_CONFIG.clientSecret,
    metrics: { windowSizeMs: 5_000, flushIntervalMs: 10_000 },
  })
}

export function setupE2ETest(options?: {
  breakerCount?: number
  breakerStates?: ('open' | 'closed')[]
}): TTestContext {
  const context: TTestContext = {
    apiClient: null!,
    system: null!,
    breakers: [],
    createSDKClient: () => null!,
  }

  const breakerCount = options?.breakerCount ?? 2
  const breakerStates = options?.breakerStates ?? ['closed', 'open']

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    context.apiClient = new TestAPIClient(
      E2E_CONFIG.apiBase,
      E2E_CONFIG.clientId,
      E2E_CONFIG.clientSecret,
    )

    const systemSlug = uniqueSlug('e2e-sys')
    context.system = await context.apiClient.createSystem({
      name: `E2E ${systemSlug}`,
      slug: systemSlug,
      description: 'Auto-created for E2E tests',
    })

    for (let i = 0; i < breakerCount; i++) {
      const breakerSlug = uniqueSlug(`e2e-brk${i}`)
      const targetState = breakerStates[i % breakerStates.length] ?? 'closed'
      const breaker = await context.apiClient.createBreaker(context.system.id, {
        name: `E2E Breaker ${i}`,
        slug: breakerSlug,
        description: 'Auto-created for E2E tests',
        state: targetState,
      })
      context.breakers.push(breaker)
    }

    context.createSDKClient = (systemSlug?: string) =>
      createSDKClient(systemSlug ?? context.system.slug)
  })

  afterAll(async () => {
    // Cleanup optional - we use unique slugs per run
  })

  return context
}

export function setupE2ETestWithExistingData(options: { systemSlug: string }): TTestContext {
  const context: TTestContext = {
    apiClient: null!,
    system: null!,
    breakers: [],
    createSDKClient: () => null!,
  }

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    context.apiClient = new TestAPIClient(
      E2E_CONFIG.apiBase,
      E2E_CONFIG.clientId,
      E2E_CONFIG.clientSecret,
    )
    context.system = await context.apiClient.getSystemBySlug(options.systemSlug)
    context.breakers = await context.apiClient.listBreakers(context.system.id)
    context.createSDKClient = (systemSlug?: string) =>
      createSDKClient(systemSlug ?? context.system.slug)
  })

  return context
}

export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options?: { timeout?: number; interval?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 5000
  const interval = options?.interval ?? 100
  const start = Date.now()

  while (Date.now() - start < timeout) {
    if (await condition()) return
    await sleep(interval)
  }

  throw new Error(`waitFor timed out after ${timeout}ms`)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function hasBackendCredentials(): boolean {
  return !!(E2E_CONFIG.clientId && E2E_CONFIG.clientSecret && E2E_CONFIG.apiBase)
}

export {
  E2E_FIXTURES,
  hasFailureRateFixtures,
  getFailureRateFixtures,
  hasLatencyFixtures,
  getLatencyFixtures,
  hasLifecycleFixtures,
  getLifecycleFixtures,
} from './fixtures.ts'
export type { TFixtureConfig, TRequiredFixtureConfig, TFixtures } from './fixtures.ts'
