/**
 * E2E Tests: Circuit Breaker Lifecycle
 *
 * Run with:
 *   E2E_CLIENT_SECRET=secret E2E_ROOT_USER_PASSWORD='password' pnpm test tests/integration/e2e/circuit-breaker-lifecycle.e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  E2E_CONFIG,
  TestAPIClient,
  createTokenProvider,
  createUserTokenProvider,
  createSDKClient,
  uniqueSlug,
  sleep,
  waitFor,
  type TTestSystem,
  type TTestBreaker,
  type TTestTripPolicy,
  type TTestMetric,
} from './setup.ts'
import { CircuitOpenError } from '../../../src/core/errors.ts'
import type { TTokenProvider } from '../../../src/index.ts'

const TIMING = {
  METRICS_PROCESSING_MS: 30_000,
  TRIP_WAIT_MS: 35_000,
  HALF_OPEN_WAIT_MS: 20_000,
  POLL_INTERVAL_MS: 2_000,
  TEST_TIMEOUT_MS: 120_000,
}

describe.skipIf(!E2E_CONFIG.clientSecret || !E2E_CONFIG.rootUserPassword)(
  'E2E: Circuit Breaker Lifecycle',
  () => {
    let sdkTokenProvider: TTokenProvider
    let userTokenProvider: TTokenProvider
    let apiClient: TestAPIClient
    let system: TTestSystem
    let tripPolicy: TTestTripPolicy
    let breaker: TTestBreaker
    let failureRateMetric: TTestMetric

    beforeAll(async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

      // User token for API client (trip policies require user auth), SDK token for SDK operations
      sdkTokenProvider = createTokenProvider()
      userTokenProvider = createUserTokenProvider()
      apiClient = new TestAPIClient(userTokenProvider, E2E_CONFIG.apiBase)

      const systemSlug = uniqueSlug('e2e-lcyl')
      system = await apiClient.createSystem({
        name: `E2E ${systemSlug}`,
        slug: systemSlug,
        description: 'E2E test for circuit breaker lifecycle',
      })

      const failureMetric = await apiClient.getMetricBySlug('failure-rate')
      if (!failureMetric) {
        throw new Error('failure-rate metric not found - ensure DB is bootstrapped')
      }
      failureRateMetric = failureMetric

      const policySlug = uniqueSlug('e2e-pol')
      tripPolicy = await apiClient.createTripPolicy({
        name: `E2E ${policySlug}`,
        slug: policySlug,
        description: 'Trip when failure rate exceeds 50%',
        evaluationWindowMs: 5_000,
        evaluationIntervalMs: 5_000,
        consecutiveWindows: 1,
        probeIntervalMs: 10_000,
        action: 'open-breaker',
        rulesOperator: 'and',
        rules: [
          {
            sortOrder: 0,
            metricId: failureRateMetric.id,
            comparisonOperator: 'gt',
            thresholdValue: 0.5,
          },
        ],
      })

      const breakerSlug = uniqueSlug('e2e-brk')
      breaker = await apiClient.createBreakerWithPolicy(system.id, {
        name: `E2E ${breakerSlug}`,
        slug: breakerSlug,
        description: 'E2E test breaker with trip policy',
        state: 'closed',
        policyAssignments: [
          {
            tripPolicyId: tripPolicy.id,
            isEnabled: true,
            priority: 0,
            stopOnTrigger: false,
          },
        ],
      })
    }, TIMING.TEST_TIMEOUT_MS)

    afterAll(async () => {})

    it(
      'should trip breaker when failure rate exceeds threshold',
      async () => {
        const client = createSDKClient(sdkTokenProvider, system.slug)
        await client.bootstrap()

        try {
          const initialState = await client.isOpen(breaker.slug)
          expect(initialState).toBe(false)

          // 1 success + 4 failures = 80% failure rate
          await client.withBreaker(breaker.slug, async () => 'success')

          for (let i = 0; i < 4; i++) {
            await expect(
              client.withBreaker(breaker.slug, async () => {
                throw new Error('Simulated failure')
              }),
            ).rejects.toThrow('Simulated failure')
          }

          // flushMetrics() only sends completed windows, wait for current window to complete
          console.log('Waiting 6s for metric window to complete...')
          await sleep(6_000)
          await client.flushMetrics()

          console.log(`Waiting ${TIMING.TRIP_WAIT_MS / 1000}s for breaker to trip...`)

          let tripped = false
          const startTime = Date.now()

          while (Date.now() - startTime < TIMING.TRIP_WAIT_MS) {
            client.invalidate()
            const isOpen = await client.isOpen(breaker.slug)
            if (isOpen) {
              tripped = true
              console.log(`Breaker tripped after ${(Date.now() - startTime) / 1000}s`)
              break
            }
            await sleep(TIMING.POLL_INTERVAL_MS)
          }

          expect(tripped).toBe(true)

          await expect(
            client.withBreaker(breaker.slug, async () => 'should not execute'),
          ).rejects.toThrow(CircuitOpenError)
        } finally {
          await client.shutdown()
        }
      },
      TIMING.TEST_TIMEOUT_MS,
    )

    it(
      'should transition to half-open after probe interval',
      async () => {
        const client = createSDKClient(sdkTokenProvider, system.slug)
        await client.bootstrap()

        try {
          client.invalidate()
          let isOpen = await client.isOpen(breaker.slug)

          if (!isOpen) {
            await apiClient.updateBreakerState(
              system.id,
              breaker.id,
              'open',
              'E2E test - opening for half-open test',
            )
            client.invalidate()
            isOpen = await client.isOpen(breaker.slug)
            expect(isOpen).toBe(true)
          }

          const breakerState = await apiClient.getBreakerWithRetryAfter(system.id, breaker.id)
          console.log('Breaker state:', {
            state: breakerState.state,
            retryAfter: breakerState.retryAfter,
          })

          console.log(`Waiting ${TIMING.HALF_OPEN_WAIT_MS / 1000}s for half-open transition...`)

          const startTime = Date.now()
          let transitioned = false

          while (Date.now() - startTime < TIMING.HALF_OPEN_WAIT_MS) {
            const currentBreaker = await apiClient.getBreakerWithRetryAfter(system.id, breaker.id)

            if (currentBreaker.state === 'half-open') {
              transitioned = true
              console.log(
                `Breaker transitioned to half-open after ${(Date.now() - startTime) / 1000}s`,
              )
              break
            }

            await sleep(TIMING.POLL_INTERVAL_MS)
          }

          console.log(`Half-open transition ${transitioned ? 'succeeded' : 'timed out'}`)

          if (transitioned) {
            client.invalidate()
            const result = await client.withBreaker(breaker.slug, async () => 'probe-success')
            expect(result).toBe('probe-success')
          }
        } finally {
          await client.shutdown()
        }
      },
      TIMING.TEST_TIMEOUT_MS,
    )

    it(
      'should close breaker after successful probe in half-open state',
      async () => {
        const client = createSDKClient(sdkTokenProvider, system.slug)
        await client.bootstrap()

        try {
          await apiClient.updateBreakerState(
            system.id,
            breaker.id,
            'closed',
            'E2E test - resetting for probe test',
          )
          client.invalidate()

          const isClosed = await client.isClosed(breaker.slug)
          expect(isClosed).toBe(true)

          const result = await client.withBreaker(breaker.slug, async () => 'success after reset')
          expect(result).toBe('success after reset')

          const stillClosed = await client.isClosed(breaker.slug)
          expect(stillClosed).toBe(true)
        } finally {
          await client.shutdown()
        }
      },
      TIMING.TEST_TIMEOUT_MS,
    )
  },
)

describe.skipIf(!E2E_CONFIG.clientSecret || !E2E_CONFIG.rootUserPassword)(
  'E2E: Circuit Breaker - onOpen fallback',
  () => {
    let sdkTokenProvider: TTokenProvider
    let userTokenProvider: TTokenProvider
    let apiClient: TestAPIClient
    let system: TTestSystem
    let tripPolicy: TTestTripPolicy
    let breaker: TTestBreaker

    beforeAll(async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

      sdkTokenProvider = createTokenProvider()
      userTokenProvider = createUserTokenProvider()
      apiClient = new TestAPIClient(userTokenProvider, E2E_CONFIG.apiBase)

      const systemSlug = uniqueSlug('e2e-fb')
      system = await apiClient.createSystem({
        name: `E2E ${systemSlug}`,
        slug: systemSlug,
        description: 'E2E test for fallback behavior',
      })

      const failureMetric = await apiClient.getMetricBySlug('failure-rate')
      if (!failureMetric) {
        throw new Error('failure-rate metric not found')
      }

      const policySlug = uniqueSlug('e2e-fbpol')
      tripPolicy = await apiClient.createTripPolicy({
        name: `E2E ${policySlug}`,
        slug: policySlug,
        description: 'Trip when failure rate exceeds 50%',
        evaluationWindowMs: 5_000,
        evaluationIntervalMs: 5_000,
        consecutiveWindows: 1,
        probeIntervalMs: 30_000,
        action: 'open-breaker',
        rulesOperator: 'and',
        rules: [
          {
            sortOrder: 0,
            metricId: failureMetric.id,
            comparisonOperator: 'gt',
            thresholdValue: 0.5,
          },
        ],
      })

      const breakerSlug = uniqueSlug('e2e-fbbrk')
      breaker = await apiClient.createBreakerWithPolicy(system.id, {
        name: `E2E ${breakerSlug}`,
        slug: breakerSlug,
        description: 'E2E test breaker for fallback behavior',
        state: 'closed',
        policyAssignments: [
          {
            tripPolicyId: tripPolicy.id,
            isEnabled: true,
            priority: 0,
            stopOnTrigger: false,
          },
        ],
      })
    }, TIMING.TEST_TIMEOUT_MS)

    it(
      'should call onOpen fallback when breaker trips',
      async () => {
        const client = createSDKClient(sdkTokenProvider, system.slug)
        await client.bootstrap()

        try {
          for (let i = 0; i < 5; i++) {
            await expect(
              client.withBreaker(breaker.slug, async () => {
                throw new Error('failure')
              }),
            ).rejects.toThrow()
          }

          // flushMetrics() only sends completed windows
          console.log('Waiting 6s for metric window to complete...')
          await sleep(6_000)
          await client.flushMetrics()

          console.log(`Waiting ${TIMING.TRIP_WAIT_MS / 1000}s for trip...`)

          await waitFor(
            async () => {
              client.invalidate()
              return client.isOpen(breaker.slug)
            },
            { timeout: TIMING.TRIP_WAIT_MS, interval: TIMING.POLL_INTERVAL_MS },
          )

          let fallbackCalled = false
          const result = await client.withBreaker(breaker.slug, async () => 'should not execute', {
            onOpen: () => {
              fallbackCalled = true
              return 'fallback-result'
            },
          })

          expect(fallbackCalled).toBe(true)
          expect(result).toBe('fallback-result')
        } finally {
          await client.shutdown()
        }
      },
      TIMING.TEST_TIMEOUT_MS,
    )
  },
)

/**
 * Latency p95 E2E test - trips breaker when latency exceeds threshold
 */
describe.skipIf(!E2E_CONFIG.clientSecret || !E2E_CONFIG.rootUserPassword)(
  'E2E: Circuit Breaker - Latency p95 trip',
  () => {
    let sdkTokenProvider: TTokenProvider
    let userTokenProvider: TTokenProvider
    let apiClient: TestAPIClient
    let system: TTestSystem
    let breaker: TTestBreaker

    beforeAll(async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

      sdkTokenProvider = createTokenProvider()
      userTokenProvider = createUserTokenProvider()
      apiClient = new TestAPIClient(userTokenProvider, E2E_CONFIG.apiBase)

      const systemSlug = uniqueSlug('e2e-lat')
      system = await apiClient.createSystem({
        name: `E2E ${systemSlug}`,
        slug: systemSlug,
        description: 'E2E test for latency p95 trip',
      })

      const latencyMetric = await apiClient.getMetricBySlug('latency-p95')
      if (!latencyMetric) {
        throw new Error('latency-p95 metric not found - ensure DB is bootstrapped')
      }

      const policySlug = uniqueSlug('e2e-latpol')
      const tripPolicy = await apiClient.createTripPolicy({
        name: `E2E ${policySlug}`,
        slug: policySlug,
        description: 'Trip when latency p95 exceeds 100ms',
        evaluationWindowMs: 5_000,
        evaluationIntervalMs: 5_000,
        consecutiveWindows: 1,
        probeIntervalMs: 30_000,
        action: 'open-breaker',
        rulesOperator: 'and',
        rules: [
          {
            sortOrder: 0,
            metricId: latencyMetric.id,
            comparisonOperator: 'gt',
            thresholdValue: 100, // 100ms threshold
          },
        ],
      })

      const breakerSlug = uniqueSlug('e2e-latbrk')
      breaker = await apiClient.createBreakerWithPolicy(system.id, {
        name: `E2E ${breakerSlug}`,
        slug: breakerSlug,
        description: 'E2E test breaker for latency p95 trip',
        state: 'closed',
        policyAssignments: [
          {
            tripPolicyId: tripPolicy.id,
            isEnabled: true,
            priority: 0,
            stopOnTrigger: false,
          },
        ],
      })
    }, TIMING.TEST_TIMEOUT_MS)

    it(
      'should trip breaker when latency p95 exceeds threshold',
      async () => {
        const client = createSDKClient(sdkTokenProvider, system.slug)
        await client.bootstrap()

        try {
          // Execute work that succeeds initially (fast)
          const initialResult = await client.withBreaker(breaker.slug, async () => 'fast')
          expect(initialResult).toBe('fast')

          // Execute slow operations (200ms each) - will push p95 above 100ms threshold
          for (let i = 0; i < 5; i++) {
            await client.withBreaker(breaker.slug, async () => {
              await sleep(200)
              return 'slow'
            })
          }

          // Wait for metric window to complete, then flush
          console.log('Waiting 6s for metric window to complete...')
          await sleep(6_000)
          await client.flushMetrics()

          // Wait for backend to process metrics and trip breaker
          console.log(`Waiting up to ${TIMING.TRIP_WAIT_MS / 1000}s for breaker to trip...`)

          let tripDetected = false
          const startTime = Date.now()

          while (Date.now() - startTime < TIMING.TRIP_WAIT_MS && !tripDetected) {
            client.invalidate()

            const result = await client.withBreaker(
              breaker.slug,
              async () => 'work-executed',
              {
                onOpen: () => {
                  tripDetected = true
                  return 'breaker-open'
                },
              },
            )

            if (result === 'breaker-open') {
              console.log(`Breaker tripped after ${(Date.now() - startTime) / 1000}s`)
              break
            }

            await sleep(TIMING.POLL_INTERVAL_MS)
          }

          expect(tripDetected).toBe(true)

          // Final assertion: subsequent calls are blocked
          let workExecuted = false
          const finalResult = await client.withBreaker(
            breaker.slug,
            async () => {
              workExecuted = true
              return 'should-not-run'
            },
            {
              onOpen: () => 'blocked',
            },
          )

          expect(workExecuted).toBe(false)
          expect(finalResult).toBe('blocked')
        } finally {
          await client.shutdown()
        }
      },
      TIMING.TEST_TIMEOUT_MS,
    )
  },
)

/**
 * Pure SDK E2E test - only withBreaker() calls, no state queries
 * This represents the typical SDK consumer experience
 */
describe.skipIf(!E2E_CONFIG.clientSecret || !E2E_CONFIG.rootUserPassword)(
  'E2E: Circuit Breaker - Pure withBreaker() flow',
  () => {
    let sdkTokenProvider: TTokenProvider
    let userTokenProvider: TTokenProvider
    let apiClient: TestAPIClient
    let system: TTestSystem
    let breaker: TTestBreaker

    beforeAll(async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

      sdkTokenProvider = createTokenProvider()
      userTokenProvider = createUserTokenProvider()
      apiClient = new TestAPIClient(userTokenProvider, E2E_CONFIG.apiBase)

      const systemSlug = uniqueSlug('e2e-pure')
      system = await apiClient.createSystem({
        name: `E2E ${systemSlug}`,
        slug: systemSlug,
        description: 'E2E test for pure withBreaker flow',
      })

      const failureMetric = await apiClient.getMetricBySlug('failure-rate')
      if (!failureMetric) {
        throw new Error('failure-rate metric not found')
      }

      const policySlug = uniqueSlug('e2e-purepol')
      const tripPolicy = await apiClient.createTripPolicy({
        name: `E2E ${policySlug}`,
        slug: policySlug,
        description: 'Trip when failure rate exceeds 50%',
        evaluationWindowMs: 5_000,
        evaluationIntervalMs: 5_000,
        consecutiveWindows: 1,
        probeIntervalMs: 30_000,
        action: 'open-breaker',
        rulesOperator: 'and',
        rules: [
          {
            sortOrder: 0,
            metricId: failureMetric.id,
            comparisonOperator: 'gt',
            thresholdValue: 0.5,
          },
        ],
      })

      const breakerSlug = uniqueSlug('e2e-purebrk')
      breaker = await apiClient.createBreakerWithPolicy(system.id, {
        name: `E2E ${breakerSlug}`,
        slug: breakerSlug,
        description: 'E2E test breaker for pure withBreaker flow',
        state: 'closed',
        policyAssignments: [
          {
            tripPolicyId: tripPolicy.id,
            isEnabled: true,
            priority: 0,
            stopOnTrigger: false,
          },
        ],
      })
    }, TIMING.TEST_TIMEOUT_MS)

    it(
      'should block calls after failures trip the breaker',
      async () => {
        const client = createSDKClient(sdkTokenProvider, system.slug)
        await client.bootstrap()

        try {
          // Execute work that succeeds initially
          const initialResult = await client.withBreaker(breaker.slug, async () => 'initial-success')
          expect(initialResult).toBe('initial-success')

          // Execute work that fails - 5 failures = 100% failure rate after first success window
          for (let i = 0; i < 5; i++) {
            try {
              await client.withBreaker(breaker.slug, async () => {
                throw new Error('simulated-failure')
              })
            } catch {
              // Expected - work function throws
            }
          }

          // Wait for metric window to complete, then flush
          console.log('Waiting 6s for metric window to complete...')
          await sleep(6_000)
          await client.flushMetrics()

          // Wait for backend to process metrics and trip breaker
          // Poll using only withBreaker with onOpen fallback
          console.log(`Waiting up to ${TIMING.TRIP_WAIT_MS / 1000}s for breaker to trip...`)

          let tripDetected = false
          const startTime = Date.now()

          while (Date.now() - startTime < TIMING.TRIP_WAIT_MS && !tripDetected) {
            client.invalidate()

            const result = await client.withBreaker(
              breaker.slug,
              async () => 'work-executed',
              {
                onOpen: () => {
                  tripDetected = true
                  return 'breaker-open'
                },
              },
            )

            if (result === 'breaker-open') {
              console.log(`Breaker tripped after ${(Date.now() - startTime) / 1000}s`)
              break
            }

            await sleep(TIMING.POLL_INTERVAL_MS)
          }

          expect(tripDetected).toBe(true)

          // Final assertion: subsequent calls are blocked
          let workExecuted = false
          const finalResult = await client.withBreaker(
            breaker.slug,
            async () => {
              workExecuted = true
              return 'should-not-run'
            },
            {
              onOpen: () => 'blocked',
            },
          )

          expect(workExecuted).toBe(false)
          expect(finalResult).toBe('blocked')
        } finally {
          await client.shutdown()
        }
      },
      TIMING.TEST_TIMEOUT_MS,
    )
  },
)
