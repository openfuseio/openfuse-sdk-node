/**
 * E2E test script for local development.
 *
 * Prerequisites:
 * 1. Run `docker compose up` in openfuse-cloud
 * 2. Create a company, environment, system, and breaker via the API/UI
 * 3. Set the environment variables below
 *
 * Usage:
 *   npx tsx examples/local-e2e.ts
 */

import { OpenFuse } from '../src/client/openfuse.ts'
import type { TEndpointProvider, TTokenProvider } from '../src/core/types.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration - update these for your local setup
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  // API endpoint (environment-scoped URL pattern: env-slug--company-slug.api.openfuse.io)
  // For local: use lvh.me which resolves to 127.0.0.1
  // Include /v1 for the API version prefix
  apiBase: process.env.OPENFUSE_API_BASE ?? 'https://prod--acme.api.lvh.me:3000/v1',

  // Keycloak configuration
  // Default values match local docker-compose setup
  keycloakUrl: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
  keycloakRealm: process.env.KEYCLOAK_REALM ?? 'local-openfuse-tenants',
  // Client ID pattern: {realm-name}-sdk-client
  keycloakClientId: process.env.KEYCLOAK_CLIENT_ID ?? 'tzxcvw0e-clp0cabe-e2e-test-sdk',
  // Get this from KC_TENANTS_SDK_CLIENT_SECRET in your .env
  keycloakClientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',

  // Your test data
  companySlug: process.env.COMPANY_SLUG ?? 'acme',
  environmentSlug: process.env.ENVIRONMENT_SLUG ?? 'prod',
  systemSlug: process.env.SYSTEM_SLUG ?? 'system',
  breakerSlug: process.env.BREAKER_SLUG ?? 'stripe-payment-processor',
}

// ─────────────────────────────────────────────────────────────────────────────
// Local providers
// ─────────────────────────────────────────────────────────────────────────────

class LocalEndpointProvider implements TEndpointProvider {
  private apiBase: string

  constructor(apiBase: string) {
    this.apiBase = apiBase
  }

  getApiBase(): string {
    return this.apiBase
  }
}

class KeycloakTokenProvider implements TTokenProvider {
  private cachedToken?: { token: string; expiresAt: number }
  private keycloakUrl: string
  private realm: string
  private clientId: string
  private clientSecret: string

  constructor(keycloakUrl: string, realm: string, clientId: string, clientSecret: string) {
    this.keycloakUrl = keycloakUrl
    this.realm = realm
    this.clientId = clientId
    this.clientSecret = clientSecret
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt - 30_000) {
      return this.cachedToken.token
    }

    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Keycloak token error: ${response.status} - ${text}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in: number }
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    }

    return this.cachedToken.token
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 OpenFuse SDK E2E Test')
  console.log('─'.repeat(50))
  console.log(`API Base: ${CONFIG.apiBase}`)
  console.log(`Company: ${CONFIG.companySlug}`)
  console.log(`Environment: ${CONFIG.environmentSlug}`)
  console.log(`System: ${CONFIG.systemSlug}`)
  console.log(`Breaker: ${CONFIG.breakerSlug}`)
  console.log('─'.repeat(50))

  if (!CONFIG.keycloakClientSecret) {
    console.error('❌ KEYCLOAK_CLIENT_SECRET environment variable is required')
    console.error('   Use the value of KC_TENANTS_SDK_CLIENT_SECRET from openfuse-cloud/.env')
    console.error('')
    console.error('   Example:')
    console.error('     KEYCLOAK_CLIENT_SECRET=your-secret npx tsx examples/local-e2e.ts')
    process.exit(1)
  }

  const endpointProvider = new LocalEndpointProvider(CONFIG.apiBase)
  const tokenProvider = new KeycloakTokenProvider(
    CONFIG.keycloakUrl,
    CONFIG.keycloakRealm,
    CONFIG.keycloakClientId,
    CONFIG.keycloakClientSecret,
  )

  const client = new OpenFuse({
    endpointProvider,
    tokenProvider,
    scope: {
      companySlug: CONFIG.companySlug,
      environmentSlug: CONFIG.environmentSlug,
      systemSlug: CONFIG.systemSlug,
    },
    metrics: {
      windowSizeMs: 5_000, // 5 second windows for faster testing
      flushIntervalMs: 10_000,
    },
  })

  console.log(`\n📡 Instance ID: ${client.getInstanceId()}`)

  // Bootstrap
  console.log('\n⏳ Bootstrapping...')
  await client.bootstrap()
  console.log('✅ Bootstrap complete')

  // List breakers
  console.log('\n📋 Listing breakers...')
  const breakers = await client.listBreakers()
  console.log(`   Found ${breakers.length} breaker(s):`)
  for (const b of breakers) {
    console.log(`   - ${b.slug} (${b.state})`)
  }

  // Test withBreaker - success
  console.log(`\n🔒 Testing withBreaker (${CONFIG.breakerSlug}) - SUCCESS case...`)
  const result1 = await client.withBreaker(CONFIG.breakerSlug, async () => {
    await sleep(50) // Simulate some work
    return { status: 'ok', data: 'payment processed' }
  })
  console.log(`   Result: ${JSON.stringify(result1)}`)

  // Test withBreaker - failure
  console.log(`\n🔒 Testing withBreaker (${CONFIG.breakerSlug}) - FAILURE case...`)
  try {
    await client.withBreaker(CONFIG.breakerSlug, async () => {
      await sleep(30)
      throw new Error('Payment gateway timeout')
    })
  } catch (err) {
    console.log(`   Caught expected error: ${(err as Error).message}`)
  }

  // Test withBreaker - timeout
  console.log(`\n🔒 Testing withBreaker (${CONFIG.breakerSlug}) - TIMEOUT case...`)
  try {
    await client.withBreaker(
      CONFIG.breakerSlug,
      async () => {
        await sleep(500) // Will exceed timeout
        return 'should not reach here'
      },
      { timeout: 100 },
    )
  } catch (err) {
    console.log(`   Caught expected error: ${(err as Error).name} - ${(err as Error).message}`)
  }

  // Wait for metrics window to complete and flush
  console.log('\n⏳ Waiting for metrics window to complete...')
  await sleep(6_000)

  console.log('📤 Flushing metrics...')
  await client.flushMetrics()
  console.log('✅ Metrics flushed')

  // Shutdown
  await client.shutdown()
  console.log('\n✅ Done! Check your API/database for the metrics.')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('❌ Error:', err)
  process.exit(1)
})
