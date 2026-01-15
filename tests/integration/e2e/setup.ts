import { beforeAll, afterAll } from 'vitest'
import {
  Openfuse,
  KeycloakClientCredentialsProvider,
  type TTokenProvider,
} from '../../../src/index.ts'

const REQUIRED_ENV_VARS = [
  'E2E_API_BASE',
  'E2E_KEYCLOAK_URL',
  'E2E_KEYCLOAK_REALM',
  'E2E_CLIENT_ID',
  'E2E_CLIENT_SECRET',
  'E2E_COMPANY_SLUG',
  'E2E_ENVIRONMENT_SLUG',
] as const

const OPTIONAL_ENV_VARS = [
  'E2E_BACKEND_CLIENT_ID',
  'E2E_BACKEND_CLIENT_SECRET',
  'E2E_TEST_CLIENT_ID',
  'E2E_TEST_CLIENT_SECRET',
  'E2E_ROOT_USER_EMAIL',
  'E2E_ROOT_USER_PASSWORD',
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
  keycloakUrl: process.env.E2E_KEYCLOAK_URL!,
  keycloakRealm: process.env.E2E_KEYCLOAK_REALM!,
  clientId: process.env.E2E_CLIENT_ID!,
  clientSecret: process.env.E2E_CLIENT_SECRET!,
  companySlug: process.env.E2E_COMPANY_SLUG!,
  environmentSlug: process.env.E2E_ENVIRONMENT_SLUG!,
  backendClientId: process.env.E2E_BACKEND_CLIENT_ID,
  backendClientSecret: process.env.E2E_BACKEND_CLIENT_SECRET,
  e2eTestClientId: process.env.E2E_TEST_CLIENT_ID,
  e2eTestClientSecret: process.env.E2E_TEST_CLIENT_SECRET,
  rootUserEmail: process.env.E2E_ROOT_USER_EMAIL,
  rootUserPassword: process.env.E2E_ROOT_USER_PASSWORD,
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
  tokenProvider: TTokenProvider
  apiClient: TestAPIClient
  system: TTestSystem
  breakers: TTestBreaker[]
  createSDKClient: (systemSlug?: string) => Openfuse
}

export class TestAPIClient {
  private tokenProvider: TTokenProvider
  private apiBase: string

  constructor(tokenProvider: TTokenProvider, apiBase: string) {
    this.tokenProvider = tokenProvider
    this.apiBase = apiBase
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.tokenProvider.getToken()
    const url = `${this.apiBase}${path}`

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

export function createTokenProvider(): TTokenProvider {
  return new KeycloakClientCredentialsProvider({
    keycloakUrl: E2E_CONFIG.keycloakUrl,
    realm: E2E_CONFIG.keycloakRealm,
    clientId: E2E_CONFIG.clientId,
    clientSecret: E2E_CONFIG.clientSecret,
  })
}

export function createBackendTokenProvider(): TTokenProvider {
  if (!E2E_CONFIG.backendClientId || !E2E_CONFIG.backendClientSecret) {
    throw new Error(
      'Backend authentication requires E2E_BACKEND_CLIENT_ID and E2E_BACKEND_CLIENT_SECRET',
    )
  }

  return new KeycloakClientCredentialsProvider({
    keycloakUrl: E2E_CONFIG.keycloakUrl,
    realm: E2E_CONFIG.keycloakRealm,
    clientId: E2E_CONFIG.backendClientId,
    clientSecret: E2E_CONFIG.backendClientSecret,
  })
}

export function createUserTokenProvider(): TTokenProvider {
  const missing: string[] = []
  if (!E2E_CONFIG.e2eTestClientId) missing.push('E2E_TEST_CLIENT_ID')
  if (!E2E_CONFIG.e2eTestClientSecret) missing.push('E2E_TEST_CLIENT_SECRET')
  if (!E2E_CONFIG.rootUserEmail) missing.push('E2E_ROOT_USER_EMAIL')
  if (!E2E_CONFIG.rootUserPassword) missing.push('E2E_ROOT_USER_PASSWORD')

  if (missing.length > 0) {
    throw new Error(`User authentication requires: ${missing.join(', ')}`)
  }

  return new KeycloakPasswordGrantProvider({
    keycloakUrl: E2E_CONFIG.keycloakUrl,
    realm: E2E_CONFIG.keycloakRealm,
    clientId: E2E_CONFIG.e2eTestClientId!,
    clientSecret: E2E_CONFIG.e2eTestClientSecret!,
    username: E2E_CONFIG.rootUserEmail!,
    password: E2E_CONFIG.rootUserPassword!,
  })
}

class KeycloakPasswordGrantProvider implements TTokenProvider {
  private readonly config: {
    keycloakUrl: string
    realm: string
    clientId: string
    clientSecret: string
    username: string
    password: string
  }
  private token: string | null = null
  private tokenExpiry: number = 0

  constructor(config: {
    keycloakUrl: string
    realm: string
    clientId: string
    clientSecret: string
    username: string
    password: string
  }) {
    this.config = config
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 30_000) {
      return this.token
    }

    const tokenUrl = `${this.config.keycloakUrl}/realms/${this.config.realm}/protocol/openid-connect/token`

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        username: this.config.username,
        password: this.config.password,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to get token via password grant: ${response.status} ${text}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in: number }
    this.token = data.access_token
    this.tokenExpiry = Date.now() + data.expires_in * 1000

    return this.token
  }
}

export function createSDKClient(tokenProvider: TTokenProvider, systemSlug: string): Openfuse {
  return new Openfuse({
    endpointProvider: { getApiBase: () => E2E_CONFIG.apiBase },
    tokenProvider,
    scope: {
      companySlug: E2E_CONFIG.companySlug,
      environmentSlug: E2E_CONFIG.environmentSlug,
      systemSlug,
    },
    metrics: { windowSizeMs: 5_000, flushIntervalMs: 10_000 },
  })
}

export function setupE2ETest(options?: {
  breakerCount?: number
  breakerStates?: ('open' | 'closed')[]
}): TTestContext {
  const context: TTestContext = {
    tokenProvider: null!,
    apiClient: null!,
    system: null!,
    breakers: [],
    createSDKClient: () => null!,
  }

  const breakerCount = options?.breakerCount ?? 2
  const breakerStates = options?.breakerStates ?? ['closed', 'open']

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    context.tokenProvider = createTokenProvider()
    context.apiClient = new TestAPIClient(context.tokenProvider, E2E_CONFIG.apiBase)

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
      createSDKClient(context.tokenProvider, systemSlug ?? context.system.slug)
  })

  afterAll(async () => {
    // Cleanup optional - we use unique slugs per run
  })

  return context
}

export function setupE2ETestWithExistingData(options: { systemSlug: string }): TTestContext {
  const context: TTestContext = {
    tokenProvider: null!,
    apiClient: null!,
    system: null!,
    breakers: [],
    createSDKClient: () => null!,
  }

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    context.tokenProvider = createTokenProvider()
    context.apiClient = new TestAPIClient(context.tokenProvider, E2E_CONFIG.apiBase)
    context.system = await context.apiClient.getSystemBySlug(options.systemSlug)
    context.breakers = await context.apiClient.listBreakers(context.system.id)
    context.createSDKClient = (systemSlug?: string) =>
      createSDKClient(context.tokenProvider, systemSlug ?? context.system.slug)
  })

  return context
}

export function hasBackendCredentials(): boolean {
  return !!(E2E_CONFIG.backendClientId && E2E_CONFIG.backendClientSecret)
}

export function hasUserCredentials(): boolean {
  return !!(
    E2E_CONFIG.e2eTestClientId &&
    E2E_CONFIG.e2eTestClientSecret &&
    E2E_CONFIG.rootUserEmail &&
    E2E_CONFIG.rootUserPassword
  )
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
