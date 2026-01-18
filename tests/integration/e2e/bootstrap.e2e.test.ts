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

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: bootstrap()', () => {
  const ctx = setupE2ETest({ breakerCount: 3 })

  describe('successful bootstrap', () => {
    it('should successfully initialize with valid credentials', async () => {
      const client = ctx.createSDKClient()

      // Bootstrap should complete without errors
      await expect(client.bootstrap()).resolves.not.toThrow()

      await client.shutdown()
    })

    it('should populate breaker cache after bootstrap', async () => {
      const client = ctx.createSDKClient()
      await client.bootstrap()

      // After bootstrap, listing breakers should return cached data
      const breakers = await client.listBreakers()

      expect(breakers).toBeInstanceOf(Array)
      expect(breakers.length).toBeGreaterThanOrEqual(ctx.breakers.length)

      // Verify our test breakers are present
      for (const testBreaker of ctx.breakers) {
        const found = breakers.find((b) => b.slug === testBreaker.slug)
        expect(found).toBeDefined()
        expect(found?.id).toBe(testBreaker.id)
      }

      await client.shutdown()
    })

    it('should allow state queries immediately after bootstrap', async () => {
      const client = ctx.createSDKClient()
      await client.bootstrap()

      // State queries should work immediately
      const testBreaker = ctx.breakers[0]
      const isOpen = await client.isOpen(testBreaker.slug)

      expect(typeof isOpen).toBe('boolean')
      expect(isOpen).toBe(testBreaker.state === 'open')

      await client.shutdown()
    })

    it('should resolve system slug to ID during bootstrap', async () => {
      const client = ctx.createSDKClient()
      await client.bootstrap()

      // Getting a breaker by slug should work (requires slug->ID resolution)
      const testBreaker = ctx.breakers[0]
      const breaker = await client.getBreaker(testBreaker.slug)

      expect(breaker.id).toBe(testBreaker.id)
      expect(breaker.slug).toBe(testBreaker.slug)

      await client.shutdown()
    })
  })

  describe('bootstrap with non-existent system', () => {
    it('should throw error for non-existent system slug', async () => {
      const nonExistentSlug = uniqueSlug('non-existent-system')
      const client = createSDKClient(nonExistentSlug)

      // Bootstrap with invalid system should fail
      await expect(client.bootstrap()).rejects.toThrow()

      await client.shutdown()
    })
  })

  describe('multiple bootstrap calls', () => {
    it('should be idempotent - multiple calls should succeed', async () => {
      const client = ctx.createSDKClient()

      // First bootstrap
      await client.bootstrap()
      const breakers1 = await client.listBreakers()

      // Second bootstrap (should refresh data)
      await client.bootstrap()
      const breakers2 = await client.listBreakers()

      expect(breakers1.length).toBe(breakers2.length)

      await client.shutdown()
    })
  })

  describe('bootstrap without prior authentication', () => {
    it('should authenticate automatically during bootstrap', async () => {
      // Create a fresh client with valid credentials
      const client = ctx.createSDKClient()

      // First API call (bootstrap) should trigger auth
      await client.bootstrap()

      // Subsequent calls should use cached token
      const breakers = await client.listBreakers()
      expect(breakers.length).toBeGreaterThan(0)

      await client.shutdown()
    })
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: bootstrap() - auth errors', () => {
  it('should throw AuthError with invalid credentials', async () => {
    const { Openfuse } = await import('../../../src/index.ts')

    const client = new Openfuse({
      baseUrl: E2E_CONFIG.apiBase,
      systemSlug: 'any-system',
      clientId: 'invalid-client-id',
      clientSecret: 'invalid-client-secret',
    })

    // Bootstrap with invalid credentials should fail with auth error
    await expect(client.bootstrap()).rejects.toThrow()

    await client.shutdown()
  })
})
