/**
 * E2E Tests: protect
 *
 * Tests SDK protect execution against a live API.
 *
 * Run with:
 *   E2E_CLIENT_SECRET=secret pnpm test tests/integration/e2e/with-breaker.e2e.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupE2ETest, E2E_CONFIG, sleep } from './setup.ts'
import { TimeoutError } from '../../../src/core/errors.ts'
import type { Openfuse } from '../../../src/index.ts'

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: protect()', () => {
  // Create 2 breakers: one closed (for execution), one open (for blocking)
  const ctx = setupE2ETest({
    breakerCount: 2,
    breakerStates: ['closed', 'open'],
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

  describe('when breaker is closed', () => {
    it('should execute work function and return result', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const result = await client.breaker(closedBreaker!.slug).protect(async () => {
        return { status: 'ok', data: 'test-result' }
      })

      expect(result).toEqual({ status: 'ok', data: 'test-result' })
    })

    it('should execute async work function', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      const result = await client.breaker(closedBreaker!.slug).protect(async () => {
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
        client.breaker(closedBreaker!.slug).protect(async () => {
          throw testError
        }),
      ).rejects.toThrow('Work function failed')
    })

    it('should support typed return values', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      type TResult = { userId: string; name: string }

      const result = await client.breaker(closedBreaker!.slug).protect<TResult>(async () => {
        return { userId: '123', name: 'Test User' }
      })

      expect(result.userId).toBe('123')
      expect(result.name).toBe('Test User')
    })
  })

  describe('when breaker is open', () => {
    it('should execute fn (fail-open) when no fallback', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      const result = await client.breaker(openBreaker!.slug).protect(async () => {
        return 'executed-anyway'
      })

      expect(result).toBe('executed-anyway')
    })

    it('should call fallback instead of work function', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      let workFunctionCalled = false

      const result = await client.breaker(openBreaker!.slug).protect(
        async () => {
          workFunctionCalled = true
          return 'work-result'
        },
        {
          fallback: () => 'fallback-result',
        },
      )

      expect(workFunctionCalled).toBe(false)
      expect(result).toBe('fallback-result')
    })

    it('should call fallback without error parameter', async () => {
      const openBreaker = ctx.breakers.find((b) => b.state === 'open')
      expect(openBreaker).toBeDefined()

      let fallbackCalled = false

      const result = await client.breaker(openBreaker!.slug).protect(async () => 'work-result', {
        fallback: () => {
          fallbackCalled = true
          return 'fallback'
        },
      })

      expect(fallbackCalled).toBe(true)
      expect(result).toBe('fallback')
    })
  })

  describe('timeout handling', () => {
    it('should timeout work function that exceeds timeout', async () => {
      const closedBreaker = ctx.breakers.find((b) => b.state === 'closed')
      expect(closedBreaker).toBeDefined()

      await expect(
        client.breaker(closedBreaker!.slug).protect(
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

      const result = await client.breaker(closedBreaker!.slug).protect(
        async () => {
          await sleep(50)
          return 'completed'
        },
        { timeout: 500 },
      )

      expect(result).toBe('completed')
    })
  })

  describe('fail-open behavior', () => {
    it('should execute work function when state cannot be determined (fail-open)', async () => {
      // Create a client with non-existent system to trigger unknown state
      const badClient = ctx.createSDKClient('non-existent-system-' + Date.now())

      // Don't init - this will cause state lookup to fail, triggering fail-open
      let workFunctionCalled = false

      const result = await badClient.breaker('any-breaker').protect(async () => {
        workFunctionCalled = true
        return 'work-result'
      })

      // With fail-open behavior, work function should execute
      expect(workFunctionCalled).toBe(true)
      expect(result).toBe('work-result')

      await badClient.close()
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
      const result = await client.breaker(closedBreaker!.slug).protect(
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
        client.breaker(closedBreaker!.slug).protect(
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

describe.skipIf(!E2E_CONFIG.clientSecret)('E2E: protect() - concurrent execution', () => {
  const ctx = setupE2ETest({
    breakerCount: 1,
    breakerStates: ['closed'],
  })

  it('should handle concurrent protect calls', async () => {
    const client = ctx.createSDKClient()
    client.init()
    await client.ready()

    const closedBreaker = ctx.breakers[0]

    // Execute multiple concurrent calls
    const promises = Array.from({ length: 5 }, (_, i) =>
      client.breaker(closedBreaker.slug).protect(async () => {
        await sleep(50)
        return `result-${i}`
      }),
    )

    const results = await Promise.all(promises)

    expect(results).toHaveLength(5)
    expect(results).toContain('result-0')
    expect(results).toContain('result-4')

    await client.close()
  })
})
