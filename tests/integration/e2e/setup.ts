/**
 * E2E Test Setup
 *
 * Provides infrastructure for running SDK tests against a live API.
 *
 * Requirements:
 *   - API running via `docker compose up` in openfuse-cloud
 *   - Keycloak available with valid client credentials
 *
 * Environment variables:
 *   - E2E_CLIENT_SECRET (required) - Keycloak client secret
 *   - E2E_CLIENT_ID - Keycloak client ID (default: tzxcvw0e-clp0cabe-e2e-test-sdk)
 *   - E2E_API_BASE - API base URL (default: https://prod--acme.api.lvh.me:3000/v1)
 *   - E2E_KEYCLOAK_URL - Keycloak URL (default: http://localhost:8080)
 *   - E2E_KEYCLOAK_REALM - Keycloak realm (default: local-openfuse-tenants)
 *   - E2E_COMPANY_SLUG - Company slug (default: acme)
 *   - E2E_ENVIRONMENT_SLUG - Environment slug (default: prod)
 */

import { beforeAll, afterAll } from 'vitest'
import {
  Openfuse,
  KeycloakClientCredentialsProvider,
  type TTokenProvider,
} from '../../../src/index.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const E2E_CONFIG = {
  apiBase: process.env.E2E_API_BASE ?? 'https://prod--acme.api.lvh.me:3000/v1',
  keycloakUrl: process.env.E2E_KEYCLOAK_URL ?? 'http://localhost:8080',
  keycloakRealm: process.env.E2E_KEYCLOAK_REALM ?? 'local-openfuse-tenants',
  clientId: process.env.E2E_CLIENT_ID ?? 'tzxcvw0e-clp0cabe-e2e-test-sdk',
  clientSecret: process.env.E2E_CLIENT_SECRET ?? '',
  companySlug: process.env.E2E_COMPANY_SLUG ?? 'acme',
  environmentSlug: process.env.E2E_ENVIRONMENT_SLUG ?? 'prod',
  // Backend client credentials for creating resources that require user auth
  // The backend client has a service account that can create trip policies
  backendClientId: process.env.E2E_BACKEND_CLIENT_ID ?? 'local-openfuse-tenants-backend-client',
  backendClientSecret: process.env.E2E_BACKEND_CLIENT_SECRET ?? '',
  // E2E test client with password grant for user authentication
  // Used to create resources that require user auth (trip policies)
  e2eTestClientId: process.env.E2E_TEST_CLIENT_ID ?? 'local-openfuse-tenants-e2e-test',
  e2eTestClientSecret: process.env.E2E_TEST_CLIENT_SECRET ?? 'e2e-test-client-secret',
  // Root user credentials for password grant
  rootUserEmail: process.env.E2E_ROOT_USER_EMAIL ?? 'rodrigo@openfuse.io',
  rootUserPassword: process.env.E2E_ROOT_USER_PASSWORD ?? '',
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// API Client for Test Data Management
// ─────────────────────────────────────────────────────────────────────────────

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
    // Note: API may not have delete endpoint, so we use soft delete via update
    // For now, we'll skip cleanup and rely on unique slugs per test run
    try {
      await this.request('DELETE', `/systems/${systemId}`)
    } catch {
      // Ignore errors - deletion might not be supported
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
      // probeIntervalMs is only valid when opening a breaker
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Trip Policies
  // ─────────────────────────────────────────────────────────────────────────────

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
      // Ignore errors - deletion might fail if policy is in use
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────────────

  async listMetrics(): Promise<TTestMetric[]> {
    return this.request<TTestMetric[]>('GET', '/metrics')
  }

  async getMetricBySlug(slug: string): Promise<TTestMetric | undefined> {
    const metrics = await this.listMetrics()
    return metrics.find((m) => m.slug === slug)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Breakers with Policies
  // ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a unique slug for test isolation.
 * Uses short random suffix to avoid collisions while staying under slug limits.
 */
export function uniqueSlug(base: string): string {
  const random = Math.random().toString(36).substring(2, 8)
  return `${base}-${random}`
}

/**
 * Creates a token provider for E2E tests (SDK client credentials).
 */
export function createTokenProvider(): TTokenProvider {
  if (!E2E_CONFIG.clientSecret) {
    throw new Error('E2E_CLIENT_SECRET environment variable is required for E2E tests')
  }

  return new KeycloakClientCredentialsProvider({
    keycloakUrl: E2E_CONFIG.keycloakUrl,
    realm: E2E_CONFIG.keycloakRealm,
    clientId: E2E_CONFIG.clientId,
    clientSecret: E2E_CONFIG.clientSecret,
  })
}

/**
 * Creates a token provider for backend client (service account).
 * The backend client's service account can create resources that need user auth.
 */
export function createBackendTokenProvider(): TTokenProvider {
  if (!E2E_CONFIG.backendClientSecret) {
    throw new Error(
      'E2E_BACKEND_CLIENT_SECRET environment variable is required for backend authentication',
    )
  }

  return new KeycloakClientCredentialsProvider({
    keycloakUrl: E2E_CONFIG.keycloakUrl,
    realm: E2E_CONFIG.keycloakRealm,
    clientId: E2E_CONFIG.backendClientId,
    clientSecret: E2E_CONFIG.backendClientSecret,
  })
}

/**
 * Creates a token provider using password grant with user credentials.
 * This is required for creating resources that need user auth (e.g., trip policies).
 * Uses the E2E test client which has directAccessGrantsEnabled: true.
 */
export function createUserTokenProvider(): TTokenProvider {
  if (!E2E_CONFIG.rootUserPassword) {
    throw new Error(
      'E2E_ROOT_USER_PASSWORD environment variable is required for user authentication',
    )
  }

  return new KeycloakPasswordGrantProvider({
    keycloakUrl: E2E_CONFIG.keycloakUrl,
    realm: E2E_CONFIG.keycloakRealm,
    clientId: E2E_CONFIG.e2eTestClientId,
    clientSecret: E2E_CONFIG.e2eTestClientSecret,
    username: E2E_CONFIG.rootUserEmail,
    password: E2E_CONFIG.rootUserPassword,
  })
}

/**
 * Token provider that uses Keycloak's password grant (Resource Owner Password Credentials).
 * This authenticates as a real user and is required for operations that need user context.
 */
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
    // Return cached token if still valid (with 30s buffer)
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

/**
 * Creates an SDK client for testing.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets up E2E test environment with a fresh system and breakers.
 *
 * Usage:
 * ```ts
 * describe('My E2E tests', () => {
 *   const ctx = setupE2ETest()
 *
 *   it('should do something', async () => {
 *     const client = ctx.createSDKClient()
 *     await client.bootstrap()
 *     // ...
 *   })
 * })
 * ```
 */
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
    // Skip if no client secret (CI without credentials)
    if (!E2E_CONFIG.clientSecret) {
      console.warn('Skipping E2E setup: E2E_CLIENT_SECRET not set')
      return
    }

    // Disable TLS verification for local development
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    // Create token provider and API client
    context.tokenProvider = createTokenProvider()
    context.apiClient = new TestAPIClient(context.tokenProvider, E2E_CONFIG.apiBase)

    // Create test system with unique slug
    const systemSlug = uniqueSlug('e2e-sys')
    context.system = await context.apiClient.createSystem({
      name: `E2E ${systemSlug}`,
      slug: systemSlug,
      description: 'Auto-created for E2E tests',
    })

    // Create test breakers with specified states
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

    // Set up SDK client factory
    context.createSDKClient = (systemSlug?: string) =>
      createSDKClient(context.tokenProvider, systemSlug ?? context.system.slug)
  })

  afterAll(async () => {
    // Cleanup is optional since we use unique slugs
    // Uncomment if API supports deletion:
    // if (context.system?.id) {
    //   await context.apiClient.deleteSystem(context.system.id)
    // }
  })

  return context
}

/**
 * Sets up E2E test with existing data (no creation).
 * Uses pre-existing system and breakers from the local dev environment.
 *
 * This is useful when you want to test against stable fixtures
 * without creating new data each run.
 */
export function setupE2ETestWithExistingData(options: { systemSlug: string }): TTestContext {
  const context: TTestContext = {
    tokenProvider: null!,
    apiClient: null!,
    system: null!,
    breakers: [],
    createSDKClient: () => null!,
  }

  beforeAll(async () => {
    if (!E2E_CONFIG.clientSecret) {
      console.warn('Skipping E2E setup: E2E_CLIENT_SECRET not set')
      return
    }

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

    context.tokenProvider = createTokenProvider()
    context.apiClient = new TestAPIClient(context.tokenProvider, E2E_CONFIG.apiBase)

    // Fetch existing system
    context.system = await context.apiClient.getSystemBySlug(options.systemSlug)

    // Fetch existing breakers
    context.breakers = await context.apiClient.listBreakers(context.system.id)

    context.createSDKClient = (systemSlug?: string) =>
      createSDKClient(context.tokenProvider, systemSlug ?? context.system.slug)
  })

  return context
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Skips test if E2E environment is not configured.
 */
export function skipIfNoE2ECredentials(): void {
  if (!E2E_CONFIG.clientSecret) {
    console.warn('Skipping: E2E_CLIENT_SECRET not set')
  }
}

/**
 * Helper to wait for a condition with timeout.
 */
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

/**
 * Sleep helper.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
