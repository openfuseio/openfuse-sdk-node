/**
 * E2E Tests: Metrics
 *
 * Tests SDK metrics collection and flushing against a live API.
 *
 * Run with:
 *   E2E_CLIENT_SECRET=secret pnpm test tests/integration/e2e/metrics.e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupE2ETest, E2E_CONFIG, sleep } from './setup.ts'
import type { Openfuse } from '../../../src/index.ts'

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: metrics collection', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  let client: Openfuse

  beforeEach(async () => {
    client = ctx.createSDKClient()
    client.init()
    await client.ready()
  })

  afterEach(async () => {
    await client.close()
  })

  describe('metrics recording via protect()', () => {
    it('should record success metrics without error', async () => {
      const breaker = ctx.breakers[0]

      // Execute successful operation - metrics are recorded internally
      const result = await client.breaker(breaker.slug).protect(async () => {
        await sleep(50)
        return 'success'
      })

      expect(result).toBe('success')
      // Metrics are buffered - flush should not throw
      await expect(client.flushMetrics()).resolves.not.toThrow()
    })

    it('should record failure metrics without error', async () => {
      const breaker = ctx.breakers[0]

      // Execute failing operation
      await expect(
        client.breaker(breaker.slug).protect(async () => {
          throw new Error('Test failure')
        }),
      ).rejects.toThrow('Test failure')

      // Metrics are buffered - flush should not throw
      await expect(client.flushMetrics()).resolves.not.toThrow()
    })

    it('should record timeout metrics without error', async () => {
      const breaker = ctx.breakers[0]

      // Execute timing out operation
      await expect(
        client.breaker(breaker.slug).protect(
          async () => {
            await sleep(200)
            return 'should timeout'
          },
          { timeout: 50 },
        ),
      ).rejects.toThrow()

      // Metrics are buffered - flush should not throw
      await expect(client.flushMetrics()).resolves.not.toThrow()
    })
  })

  describe('flushMetrics()', () => {
    it('should handle empty metrics buffer gracefully', async () => {
      // No operations - buffer should be empty
      await expect(client.flushMetrics()).resolves.not.toThrow()
    })

    it('should be idempotent - multiple flushes should succeed', async () => {
      // Multiple flush calls should all succeed
      await client.flushMetrics()
      await client.flushMetrics()
      await client.flushMetrics()
    })
  })

  describe('close()', () => {
    it('should complete without error', async () => {
      const shutdownClient = ctx.createSDKClient()
      shutdownClient.init()
      await shutdownClient.ready()

      const breaker = ctx.breakers[0]

      // Generate some metrics
      await shutdownClient.breaker(breaker.slug).protect(async () => 'test')

      // Shutdown should complete without error
      await expect(shutdownClient.close()).resolves.not.toThrow()
    })

    it('should allow operations after shutdown', async () => {
      const shutdownClient = ctx.createSDKClient()
      shutdownClient.init()
      await shutdownClient.ready()

      await shutdownClient.close()

      // After shutdown, state queries should still work
      const isOpen = await shutdownClient.breaker(ctx.breakers[0].slug).isOpen()
      expect(typeof isOpen).toBe('boolean')
    })
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: metrics - breaker not found', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  it('should handle flush gracefully', async () => {
    const client = ctx.createSDKClient()
    client.init()
    await client.ready()

    // Execute operation and flush - should not throw
    await client.breaker(ctx.breakers[0].slug).protect(async () => 'test')
    await expect(client.flushMetrics()).resolves.not.toThrow()

    await client.close()
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: metrics - instance ID', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  it('should use auto-generated instance ID', async () => {
    const client = ctx.createSDKClient()

    const instanceId = client.instanceId
    expect(instanceId).toBeDefined()
    expect(typeof instanceId).toBe('string')
    expect(instanceId.length).toBeGreaterThan(0)

    await client.close()
  })

  it('should use custom instance ID when provided', async () => {
    const { Openfuse } = await import('../../../src/index.ts')

    const customInstanceId = 'custom-test-instance-123'

    const client = new Openfuse({
      baseUrl: E2E_CONFIG.apiBase,
      system: ctx.system.slug,
      clientId: E2E_CONFIG.clientId,
      clientSecret: E2E_CONFIG.clientSecret,
      instanceId: customInstanceId,
    })

    expect(client.instanceId).toBe(customInstanceId)

    await client.close()
  })
})
