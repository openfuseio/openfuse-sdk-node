/**
 * E2E test script.
 *
 * Local development:
 *   OPENFUSE_CLIENT_SECRET=secret OPENFUSE_LOCAL=1 pnpm e2e:local
 *
 * Cloud:
 *   OPENFUSE_CLIENT_SECRET=secret pnpm e2e:local
 */

if (process.env.OPENFUSE_LOCAL === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

import { Openfuse, OpenfuseCloud } from '../src/index.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const isLocal = process.env.OPENFUSE_LOCAL === '1'

const CONFIG = {
  system: process.env.OPENFUSE_SYSTEM ?? 'system',
  clientId: process.env.OPENFUSE_CLIENT_ID ?? 'tzxcvw0e-clp0cabe-e2e-test-sdk',
  clientSecret: process.env.OPENFUSE_CLIENT_SECRET ?? '',
  breakerSlug: process.env.OPENFUSE_BREAKER ?? 'stripe-payment-processor',
}

const LOCAL_CONFIG = {
  apiBase: process.env.OPENFUSE_API_BASE ?? 'https://prod-acme.lvh.me:3000',
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function createClient(): Openfuse {
  if (isLocal) {
    return new Openfuse({
      baseUrl: LOCAL_CONFIG.apiBase,
      system: CONFIG.system,
      clientId: CONFIG.clientId,
      clientSecret: CONFIG.clientSecret,
      metrics: { windowSizeMs: 5_000, flushIntervalMs: 10_000 },
    })
  }

  return new OpenfuseCloud({
    system: CONFIG.system,
    clientId: CONFIG.clientId,
    clientSecret: CONFIG.clientSecret,
    metrics: { windowSizeMs: 5_000, flushIntervalMs: 10_000 },
  })
}

async function main() {
  console.log('Openfuse SDK E2E Test')
  console.log('-'.repeat(50))
  console.log(`Mode: ${isLocal ? 'LOCAL' : 'CLOUD'}`)
  if (isLocal) console.log(`API Base: ${LOCAL_CONFIG.apiBase}`)
  console.log(`System: ${CONFIG.system}`)
  console.log(`Breaker: ${CONFIG.breakerSlug}`)
  console.log('-'.repeat(50))

  if (!CONFIG.clientSecret) {
    console.error('OPENFUSE_CLIENT_SECRET environment variable is required')
    process.exit(1)
  }

  const client = createClient()

  console.log(`\nInstance ID: ${client.instanceId}`)

  console.log('\nInitializing...')
  client.init()
  await client.ready()
  console.log('Init complete')

  console.log('\nListing breakers...')
  const allBreakers = await client.breakers()
  console.log(`Found ${allBreakers.length} breaker(s):`)
  for (const b of allBreakers) {
    console.log(`  - ${b.slug} (${b.state})`)
  }

  const handle = client.breaker(CONFIG.breakerSlug)

  console.log(`\nTesting protect (${CONFIG.breakerSlug}) - SUCCESS case...`)
  const result1 = await handle.protect(async () => {
    await sleep(50)
    return { status: 'ok', data: 'payment processed' }
  })
  console.log(`Result: ${JSON.stringify(result1)}`)

  console.log(`\nTesting protect (${CONFIG.breakerSlug}) - FAILURE case...`)
  try {
    await handle.protect(async () => {
      await sleep(30)
      throw new Error('Payment gateway timeout')
    })
  } catch (err) {
    console.log(`Caught expected error: ${(err as Error).message}`)
  }

  console.log(`\nTesting protect (${CONFIG.breakerSlug}) - TIMEOUT case...`)
  try {
    await handle.protect(
      async () => {
        await sleep(500)
        return 'should not reach here'
      },
      { timeout: 100 },
    )
  } catch (err) {
    console.log(`Caught expected error: ${(err as Error).name} - ${(err as Error).message}`)
  }

  console.log('\nWaiting for metrics window to complete...')
  await sleep(6_000)

  console.log('Flushing metrics...')
  await client.flushMetrics()
  console.log('Metrics flushed')

  await client.close()
  console.log('\nDone!')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
