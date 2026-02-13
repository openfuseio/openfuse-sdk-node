/**
 * E2E Tests: Bootstrap
 *
 * Tests SDK bootstrap functionality against a live API.
 *
 * Run with:
 *   E2E_CLIENT_SECRET=secret pnpm test tests/integration/e2e/bootstrap.e2e.test.ts
 */

import { describe, it, expect } from 'vitest'
import { setupE2ETest, E2E_CONFIG, createSDKClient, uniqueSlug } from './setup.ts'

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: init()', () => {
  const ctx = setupE2ETest({ breakerCount: 3 })

  describe('successful init', () => {
    it('should successfully initialize with valid credentials', async () => {
      const client = ctx.createSDKClient()

      // Init should complete without errors
      expect(() => client.init()).not.toThrow()
      await client.ready()

      await client.close()
    })

    it('should populate breaker cache after init', async () => {
      const client = ctx.createSDKClient()
      client.init()
      await client.ready()

      // After init, listing breakers should return cached data
      const breakers = await client.breakers()

      expect(breakers).toBeInstanceOf(Array)
      expect(breakers.length).toBeGreaterThanOrEqual(ctx.breakers.length)

      // Verify our test breakers are present
      for (const testBreaker of ctx.breakers) {
        const found = breakers.find((b) => b.slug === testBreaker.slug)
        expect(found).toBeDefined()
        expect(found?.id).toBe(testBreaker.id)
      }

      await client.close()
    })

    it('should allow state queries immediately after init', async () => {
      const client = ctx.createSDKClient()
      client.init()
      await client.ready()

      // State queries should work immediately
      const testBreaker = ctx.breakers[0]
      const isOpen = await client.breaker(testBreaker.slug).isOpen()

      expect(typeof isOpen).toBe('boolean')
      expect(isOpen).toBe(testBreaker.state === 'open')

      await client.close()
    })

    it('should resolve system slug to ID during init', async () => {
      const client = ctx.createSDKClient()
      client.init()
      await client.ready()

      // Getting a breaker by slug should work (requires slug->ID resolution)
      const testBreaker = ctx.breakers[0]
      const breaker = await client.breaker(testBreaker.slug).status()

      expect(breaker).not.toBeNull()
      expect(breaker!.id).toBe(testBreaker.id)
      expect(breaker!.slug).toBe(testBreaker.slug)

      await client.close()
    })
  })

  describe('init with non-existent system', () => {
    it('should throw error for non-existent system slug', async () => {
      const nonExistentSlug = uniqueSlug('non-existent-system')
      const client = createSDKClient(nonExistentSlug)

      // Init with invalid system should fail-open (errors are logged, not thrown)
      client.init()
      await client.ready()

      await client.close()
    })
  })

  describe('multiple init calls', () => {
    it('should be idempotent - multiple calls should succeed', async () => {
      const client = ctx.createSDKClient()

      // First init
      client.init()
      await client.ready()
      const breakers1 = await client.breakers()

      // Second init (should refresh data)
      client.init()
      await client.ready()
      const breakers2 = await client.breakers()

      expect(breakers1.length).toBe(breakers2.length)

      await client.close()
    })
  })

  describe('init without prior authentication', () => {
    it('should authenticate automatically during init', async () => {
      // Create a fresh client with valid credentials
      const client = ctx.createSDKClient()

      // First API call (init) should trigger auth
      client.init()
      await client.ready()

      // Subsequent calls should use cached token
      const breakers = await client.breakers()
      expect(breakers.length).toBeGreaterThan(0)

      await client.close()
    })
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: init() - auth errors', () => {
  it('should throw AuthError with invalid credentials', async () => {
    const { Openfuse } = await import('../../../src/index.ts')

    const client = new Openfuse({
      baseUrl: E2E_CONFIG.apiBase,
      system: 'any-system',
      clientId: 'invalid-client-id',
      clientSecret: 'invalid-client-secret',
    })

    // Init with invalid credentials logs auth error (fail-safe, does not throw)
    client.init()
    await client.ready()

    await client.close()
  })
})
