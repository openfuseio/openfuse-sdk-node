/**
 * E2E Tests: Breaker State
 *
 * Tests SDK breaker state operations against a live API.
 *
 * Run with:
 *   E2E_CLIENT_SECRET=secret pnpm test tests/integration/e2e/breaker-state.e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupE2ETest, E2E_CONFIG, uniqueSlug } from './setup.ts'
import { NotFoundError } from '../../../src/core/errors.ts'
import type { Openfuse } from '../../../src/index.ts'

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: breaker state operations', () => {
  // Create 2 breakers: one closed, one open
  const ctx = setupE2ETest({
    breakerCount: 2,
    breakerStates: ['closed', 'open'],
  })

  let client: Openfuse

  beforeEach(async () => {
    client = ctx.createSDKClient()
    await client.bootstrap()
  })

  afterEach(async () => {
    await client.shutdown()
  })

  describe('isOpen()', () => {
    it('should return true for open breaker', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      const isOpen = await client.isOpen(openBreaker!.slug)
      expect(isOpen).toBe(true)
    })

    it('should return false for closed breaker', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const isOpen = await client.isOpen(closedBreaker!.slug)
      expect(isOpen).toBe(false)
    })

    it('should throw NotFoundError for non-existent breaker', async () => {
      const nonExistentSlug = uniqueSlug('non-existent-breaker')

      await expect(client.isOpen(nonExistentSlug)).rejects.toThrow(NotFoundError)
    })

    it('should support AbortSignal', async () => {
      const breaker = ctx.breakers[0]
      const controller = new AbortController()

      // Abort immediately
      controller.abort()

      await expect(client.isOpen(breaker.slug, controller.signal)).rejects.toThrow()
    })
  })

  describe('isClosed()', () => {
    it('should return true for closed breaker', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const isClosed = await client.isClosed(closedBreaker!.slug)
      expect(isClosed).toBe(true)
    })

    it('should return false for open breaker', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      const isClosed = await client.isClosed(openBreaker!.slug)
      expect(isClosed).toBe(false)
    })

    it('should return inverse of isOpen()', async () => {
      const breaker = ctx.breakers[0]

      const isOpen = await client.isOpen(breaker.slug)
      const isClosed = await client.isClosed(breaker.slug)

      expect(isClosed).toBe(!isOpen)
    })
  })

  describe('getBreaker()', () => {
    it('should return full breaker entity', async () => {
      const testBreaker = ctx.breakers[0]

      const breaker = await client.getBreaker(testBreaker.slug)

      expect(breaker).toMatchObject({
        id: testBreaker.id,
        slug: testBreaker.slug,
        state: testBreaker.state,
      })
    })

    it('should include all required fields', async () => {
      const testBreaker = ctx.breakers[0]

      const breaker = await client.getBreaker(testBreaker.slug)

      expect(breaker).toHaveProperty('id')
      expect(breaker).toHaveProperty('slug')
      expect(breaker).toHaveProperty('state')
      expect(typeof breaker.id).toBe('string')
      expect(typeof breaker.slug).toBe('string')
      expect(['open', 'closed']).toContain(breaker.state)
    })

    it('should throw NotFoundError for non-existent breaker', async () => {
      const nonExistentSlug = uniqueSlug('non-existent-breaker')

      await expect(client.getBreaker(nonExistentSlug)).rejects.toThrow(NotFoundError)
    })
  })

  describe('listBreakers()', () => {
    it('should return all system breakers', async () => {
      const breakers = await client.listBreakers()

      expect(breakers).toBeInstanceOf(Array)
      expect(breakers.length).toBeGreaterThanOrEqual(ctx.breakers.length)
    })

    it('should include all test breakers', async () => {
      const breakers = await client.listBreakers()

      for (const testBreaker of ctx.breakers) {
        const found = breakers.find((b) => b.id === testBreaker.id)
        expect(found).toBeDefined()
        expect(found?.slug).toBe(testBreaker.slug)
      }
    })

    it('should return breakers with required fields', async () => {
      const breakers = await client.listBreakers()

      for (const breaker of breakers) {
        expect(breaker).toHaveProperty('id')
        expect(breaker).toHaveProperty('slug')
        expect(breaker).toHaveProperty('state')
      }
    })
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: state changes via API', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  it('should reflect state changes made via API', async () => {
    const client = ctx.createSDKClient()
    await client.bootstrap()

    const testBreaker = ctx.breakers[0]

    // Initial state should be closed
    let isOpen = await client.isOpen(testBreaker.slug)
    expect(isOpen).toBe(false)

    // Change state via API
    await ctx.apiClient.updateBreakerState(ctx.system.id, testBreaker.id, 'open')

    // Invalidate cache to force refresh
    await client.invalidate()

    // State should now be open
    isOpen = await client.isOpen(testBreaker.slug)
    expect(isOpen).toBe(true)

    // Restore original state
    await ctx.apiClient.updateBreakerState(ctx.system.id, testBreaker.id, 'closed')

    await client.shutdown()
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: cache behavior', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  it('should cache state queries for performance', async () => {
    const client = ctx.createSDKClient()
    await client.bootstrap()

    const testBreaker = ctx.breakers[0]

    // Multiple rapid calls should use cache
    const start = Date.now()
    for (let i = 0; i < 10; i++) {
      await client.isOpen(testBreaker.slug)
    }
    const elapsed = Date.now() - start

    // 10 calls should be fast if cached (< 100ms typical)
    // We use a generous threshold for CI variability
    expect(elapsed).toBeLessThan(2000)

    await client.shutdown()
  })

  it('should refresh cache after invalidate()', async () => {
    const client = ctx.createSDKClient()
    await client.bootstrap()

    const testBreaker = ctx.breakers[0]

    // First query
    await client.isOpen(testBreaker.slug)

    // Invalidate cache
    client.invalidate()

    // Next query should fetch fresh data
    const isOpen = await client.isOpen(testBreaker.slug)
    expect(typeof isOpen).toBe('boolean')

    await client.shutdown()
  })
})
