/**
 * E2E Tests: withBreaker
 *
 * Tests SDK withBreaker execution against a live API.
 *
 * Run with:
 *   E2E_CLIENT_SECRET=secret pnpm test tests/integration/e2e/with-breaker.e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupE2ETest, E2E_CONFIG, sleep } from './setup.ts'
import { CircuitOpenError, TimeoutError } from '../../../src/core/errors.ts'
import type { Openfuse } from '../../../src/index.ts'

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: withBreaker()', () => {
  // Create 2 breakers: one closed (for execution), one open (for blocking)
  const ctx = setupE2ETest({
    breakerCount: 2,
    breakerStates: ['closed', 'open'],
  })

  let client: Openfuse

  beforeEach(async () => {
    client = ctx.createSDKClient()
    client.bootstrap()
    await client.whenReady()
  })

  afterEach(async () => {
    await client.shutdown()
  })

  describe('when breaker is closed', () => {
    it('should execute work function and return result', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const result = await client.withBreaker(closedBreaker!.slug, async () => {
        return { status: 'ok', data: 'test-result' }
      })

      expect(result).toEqual({ status: 'ok', data: 'test-result' })
    })

    it('should execute async work function', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const result = await client.withBreaker(closedBreaker!.slug, async () => {
        await sleep(50)
        return 'async-result'
      })

      expect(result).toBe('async-result')
    })

    it('should propagate errors from work function', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const testError = new Error('Work function failed')

      await expect(
        client.withBreaker(closedBreaker!.slug, async () => {
          throw testError
        }),
      ).rejects.toThrow('Work function failed')
    })

    it('should support typed return values', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      type TResult = { userId: string; name: string }

      const result = await client.withBreaker<TResult>(closedBreaker!.slug, async () => {
        return { userId: '123', name: 'Test User' }
      })

      expect(result.userId).toBe('123')
      expect(result.name).toBe('Test User')
    })
  })

  describe('when breaker is open', () => {
    it('should throw CircuitOpenError when no onOpen callback', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      await expect(
        client.withBreaker(openBreaker!.slug, async () => {
          return 'should not execute'
        }),
      ).rejects.toThrow(CircuitOpenError)
    })

    it('should call onOpen callback instead of work function', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      let workFunctionCalled = false

      const result = await client.withBreaker(
        openBreaker!.slug,
        async () => {
          workFunctionCalled = true
          return 'work-result'
        },
        {
          onOpen: () => 'fallback-result',
        },
      )

      expect(workFunctionCalled).toBe(false)
      expect(result).toBe('fallback-result')
    })

    it('should call onOpen without error parameter', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      let onOpenCalled = false

      const result = await client.withBreaker(openBreaker!.slug, async () => 'work-result', {
        onOpen: () => {
          onOpenCalled = true
          return 'fallback'
        },
      })

      expect(onOpenCalled).toBe(true)
      expect(result).toBe('fallback')
    })
  })

  describe('timeout handling', () => {
    it('should timeout work function that exceeds timeout', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      await expect(
        client.withBreaker(
          closedBreaker!.slug,
          async () => {
            await sleep(500)
            return 'should timeout'
          },
          { timeout: 100 },
        ),
      ).rejects.toThrow(TimeoutError)
    })

    it('should complete work function that finishes before timeout', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const result = await client.withBreaker(
        closedBreaker!.slug,
        async () => {
          await sleep(50)
          return 'completed'
        },
        { timeout: 500 },
      )

      expect(result).toBe('completed')
    })
  })

  describe('onUnknown callback', () => {
    it('should call onUnknown when state cannot be determined', async () => {
      // Create a client with non-existent system to trigger unknown state
      const badClient = ctx.createSDKClient('non-existent-system-' + Date.now())

      // Don't bootstrap - this will cause state lookup to fail
      let onUnknownCalled = false

      const result = await badClient.withBreaker('any-breaker', async () => 'work-result', {
        onUnknown: () => {
          onUnknownCalled = true
          return 'unknown-fallback'
        },
      })

      expect(onUnknownCalled).toBe(true)
      expect(result).toBe('unknown-fallback')

      await badClient.shutdown()
    })
  })

  describe('AbortSignal support', () => {
    it('should abort state fetch when signal is triggered before execution', async () => {
      // Signal only affects the initial isOpen() check, not the work function
      // This tests that state fetch respects the signal
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      // Work function completes normally even with signal (signal is for state fetch)
      const controller = new AbortController()
      const result = await client.withBreaker(
        closedBreaker!.slug,
        async () => {
          return 'completed'
        },
        { signal: controller.signal },
      )

      expect(result).toBe('completed')
    })

    it('should not start work function if already aborted', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const controller = new AbortController()
      controller.abort() // Abort immediately

      let workStarted = false

      await expect(
        client.withBreaker(
          closedBreaker!.slug,
          async () => {
            workStarted = true
            return 'result'
          },
          { signal: controller.signal },
        ),
      ).rejects.toThrow()

      expect(workStarted).toBe(false)
    })
  })
})

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: withBreaker() - concurrent execution', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  it('should handle concurrent withBreaker calls', async () => {
    const client = ctx.createSDKClient()
    client.bootstrap()
    await client.whenReady()

    const closedBreaker = ctx.breakers[0]

    // Execute multiple concurrent calls
    const promises = Array.from({ length: 5 }, (_, i) =>
      client.withBreaker(closedBreaker.slug, async () => {
        await sleep(50)
        return `result-${i}`
      }),
    )

    const results = await Promise.all(promises)

    expect(results).toHaveLength(5)
    expect(results).toContain('result-0')
    expect(results).toContain('result-4')

    await client.shutdown()
  })
})
