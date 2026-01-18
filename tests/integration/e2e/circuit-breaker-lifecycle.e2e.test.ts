import { describe, it, expect, beforeAll } from 'vitest'
import {
  E2E_CONFIG,
  TestAPIClient,
  createSDKClient,
  uniqueSlug,
  sleep,
  waitFor,
  hasBackendCredentials,
  hasFailureRateFixtures,
  getFailureRateFixtures,
  hasLatencyFixtures,
  getLatencyFixtures,
  type TTestSystem,
  type TTestBreaker,
  type TTestTripPolicyRule,
} from './setup.ts'
import { CircuitOpenError } from '../../../src/core/errors.ts'

const TIMING = {
  TRIP_WAIT_MS: 35_000,
  HALF_OPEN_WAIT_MS: 20_000,
  POLL_INTERVAL_MS: 2_000,
  TEST_TIMEOUT_MS: 120_000,
}

type TTestMode = 'fixtures' | 'dynamic' | 'skip'
type TMetricType = 'failure-rate' | 'latency-p95'

type TTestSetup = {
  apiClient: TestAPIClient
  system: TTestSystem
  breaker: TTestBreaker
}

function getTestMode(metricType: TMetricType): TTestMode {
  const hasFixtures =
    metricType === 'failure-rate' ? hasFailureRateFixtures() : hasLatencyFixtures()
  if (hasFixtures) return 'fixtures'
  if (hasBackendCredentials()) return 'dynamic'
  return 'skip'
}

function canRunTests(metricType: TMetricType): boolean {
  return getTestMode(metricType) !== 'skip'
}

async function setupTest(metricType: TMetricType): Promise<TTestSetup> {
  const mode = getTestMode(metricType)
  console.log(`Running ${metricType} test in ${mode} mode`)

  const apiClient = new TestAPIClient(
    E2E_CONFIG.apiBase,
    E2E_CONFIG.clientId,
    E2E_CONFIG.clientSecret,
  )

  if (mode === 'fixtures') {
    const fixtures = metricType === 'failure-rate' ? getFailureRateFixtures() : getLatencyFixtures()

    // Look up system and breaker by slug
    const system = await apiClient.getSystemBySlug(fixtures.systemSlug)
    const breakers = await apiClient.listBreakers(system.id)
    let breaker = breakers.find((b) => b.slug === fixtures.breakerSlug)

    if (!breaker) {
      throw new Error(
        `Breaker with slug "${fixtures.breakerSlug}" not found in system "${fixtures.systemSlug}"`,
      )
    }

    console.log(`Using fixture breaker: ${breaker.slug} (${breaker.state})`)

    if (breaker.state !== 'closed') {
      console.log('Resetting breaker to closed state...')
      await apiClient.updateBreakerState(system.id, breaker.id, 'closed', 'E2E test reset')
      // Re-fetch breaker after state update
      breaker = await apiClient.getBreaker(system.id, breaker.id)
    }

    return { apiClient, system, breaker }
  }

  // Dynamic creation mode

  const prefix = metricType === 'failure-rate' ? 'e2e-fr' : 'e2e-lat'
  const systemSlug = uniqueSlug(prefix)
  const system = await apiClient.createSystem({
    name: `E2E ${systemSlug}`,
    slug: systemSlug,
  })

  const metric = await apiClient.getMetricBySlug(metricType)
  if (!metric) {
    throw new Error(`${metricType} metric not found`)
  }

  const policyConfig =
    metricType === 'failure-rate'
      ? { threshold: 0.5, probeIntervalMs: 10_000 }
      : { threshold: 100, probeIntervalMs: 30_000 }

  const rules: TTestTripPolicyRule[] = [
    {
      sortOrder: 0,
      metricId: metric.id,
      comparisonOperator: 'gt',
      thresholdValue: policyConfig.threshold,
    },
  ]

  const policySlug = uniqueSlug(`${prefix}-pol`)
  const tripPolicy = await apiClient.createTripPolicy({
    name: `E2E ${policySlug}`,
    slug: policySlug,
    evaluationWindowMs: 5_000,
    evaluationIntervalMs: 5_000,
    consecutiveWindows: 1,
    probeIntervalMs: policyConfig.probeIntervalMs,
    action: 'open-breaker',
    rulesOperator: 'and',
    rules,
  })

  const breakerSlug = uniqueSlug(`${prefix}-brk`)
  const breaker = await apiClient.createBreakerWithPolicy(system.id, {
    name: `E2E ${breakerSlug}`,
    slug: breakerSlug,
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

  return { apiClient, system, breaker }
}

async function waitForTrip(
  client: ReturnType<typeof createSDKClient>,
  breakerSlug: string,
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < TIMING.TRIP_WAIT_MS) {
    client.invalidate()
    const isOpen = await client.isOpen(breakerSlug)
    if (isOpen) {
      console.log(`Breaker tripped after ${(Date.now() - startTime) / 1000}s`)
      return true
    }
    await sleep(TIMING.POLL_INTERVAL_MS)
  }

  return false
}

async function triggerFailures(
  client: ReturnType<typeof createSDKClient>,
  breakerSlug: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await expect(
      client.withBreaker(breakerSlug, async () => {
        throw new Error('Simulated failure')
      }),
    ).rejects.toThrow('Simulated failure')
  }
}

describe.skipIf(!canRunTests('failure-rate'))('E2E: Circuit Breaker Lifecycle', () => {
  let apiClient: TestAPIClient
  let system: TTestSystem
  let breaker: TTestBreaker

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    const setup = await setupTest('failure-rate')
    apiClient = setup.apiClient
    system = setup.system
    breaker = setup.breaker
  }, TIMING.TEST_TIMEOUT_MS)

  it(
    'should trip breaker when failure rate exceeds threshold',
    async () => {
      const client = createSDKClient(system.slug)
      await client.bootstrap()

      try {
        expect(await client.isOpen(breaker.slug)).toBe(false)

        await client.withBreaker(breaker.slug, async () => 'success')
        await triggerFailures(client, breaker.slug, 4)

        await sleep(6_000)
        await client.flushMetrics()

        const tripped = await waitForTrip(client, breaker.slug)
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
      const client = createSDKClient(system.slug)
      await client.bootstrap()

      try {
        client.invalidate()
        let isOpen = await client.isOpen(breaker.slug)

        if (!isOpen) {
          await apiClient.updateBreakerState(system.id, breaker.id, 'open', 'E2E test setup')
          client.invalidate()
          isOpen = await client.isOpen(breaker.slug)
          expect(isOpen).toBe(true)
        }

        const breakerState = await apiClient.getBreakerWithRetryAfter(system.id, breaker.id)
        console.log('Breaker state:', {
          state: breakerState.state,
          retryAfter: breakerState.retryAfter,
        })

        const startTime = Date.now()
        let transitioned = false

        while (Date.now() - startTime < TIMING.HALF_OPEN_WAIT_MS) {
          const current = await apiClient.getBreakerWithRetryAfter(system.id, breaker.id)
          if (current.state === 'half-open') {
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
      const client = createSDKClient(system.slug)
      await client.bootstrap()

      try {
        await apiClient.updateBreakerState(system.id, breaker.id, 'closed', 'E2E test reset')
        client.invalidate()

        expect(await client.isClosed(breaker.slug)).toBe(true)

        const result = await client.withBreaker(breaker.slug, async () => 'success after reset')
        expect(result).toBe('success after reset')
        expect(await client.isClosed(breaker.slug)).toBe(true)
      } finally {
        await client.shutdown()
      }
    },
    TIMING.TEST_TIMEOUT_MS,
  )
})

describe.skipIf(!canRunTests('failure-rate'))('E2E: Circuit Breaker - onOpen fallback', () => {
  let system: TTestSystem
  let breaker: TTestBreaker

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    const setup = await setupTest('failure-rate')
    system = setup.system
    breaker = setup.breaker
  }, TIMING.TEST_TIMEOUT_MS)

  it(
    'should call onOpen fallback when breaker trips',
    async () => {
      const client = createSDKClient(system.slug)
      await client.bootstrap()

      try {
        await triggerFailures(client, breaker.slug, 5)

        await sleep(6_000)
        await client.flushMetrics()

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
})

describe.skipIf(!canRunTests('latency-p95'))('E2E: Circuit Breaker - Latency p95 trip', () => {
  let system: TTestSystem
  let breaker: TTestBreaker

  beforeAll(async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    const setup = await setupTest('latency-p95')
    system = setup.system
    breaker = setup.breaker
  }, TIMING.TEST_TIMEOUT_MS)

  it(
    'should trip breaker when latency p95 exceeds threshold',
    async () => {
      const client = createSDKClient(system.slug)
      await client.bootstrap()

      try {
        expect(await client.withBreaker(breaker.slug, async () => 'fast')).toBe('fast')

        for (let i = 0; i < 5; i++) {
          await client.withBreaker(breaker.slug, async () => {
            await sleep(200)
            return 'slow'
          })
        }

        await sleep(6_000)
        await client.flushMetrics()

        let tripDetected = false
        const startTime = Date.now()

        while (Date.now() - startTime < TIMING.TRIP_WAIT_MS && !tripDetected) {
          client.invalidate()

          const result = await client.withBreaker(breaker.slug, async () => 'work-executed', {
            onOpen: () => {
              tripDetected = true
              return 'breaker-open'
            },
          })

          if (result === 'breaker-open') {
            console.log(`Breaker tripped after ${(Date.now() - startTime) / 1000}s`)
            break
          }

          await sleep(TIMING.POLL_INTERVAL_MS)
        }

        expect(tripDetected).toBe(true)

        let workExecuted = false
        const finalResult = await client.withBreaker(
          breaker.slug,
          async () => {
            workExecuted = true
            return 'should-not-run'
          },
          { onOpen: () => 'blocked' },
        )

        expect(workExecuted).toBe(false)
        expect(finalResult).toBe('blocked')
      } finally {
        await client.shutdown()
      }
    },
    TIMING.TEST_TIMEOUT_MS,
  )
})

describe.skipIf(!canRunTests('failure-rate'))(
  'E2E: Circuit Breaker - Pure withBreaker() flow',
  () => {
    let system: TTestSystem
    let breaker: TTestBreaker

    beforeAll(async () => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      const setup = await setupTest('failure-rate')
      system = setup.system
      breaker = setup.breaker
    }, TIMING.TEST_TIMEOUT_MS)

    it(
      'should block calls after failures trip the breaker',
      async () => {
        const client = createSDKClient(system.slug)
        await client.bootstrap()

        try {
          expect(await client.withBreaker(breaker.slug, async () => 'initial-success')).toBe(
            'initial-success',
          )

          for (let i = 0; i < 5; i++) {
            try {
              await client.withBreaker(breaker.slug, async () => {
                throw new Error('simulated-failure')
              })
            } catch {
              // Expected
            }
          }

          await sleep(6_000)
          await client.flushMetrics()

          let tripDetected = false
          const startTime = Date.now()

          while (Date.now() - startTime < TIMING.TRIP_WAIT_MS && !tripDetected) {
            client.invalidate()

            const result = await client.withBreaker(breaker.slug, async () => 'work-executed', {
              onOpen: () => {
                tripDetected = true
                return 'breaker-open'
              },
            })

            if (result === 'breaker-open') {
              console.log(`Breaker tripped after ${(Date.now() - startTime) / 1000}s`)
              break
            }

            await sleep(TIMING.POLL_INTERVAL_MS)
          }

          expect(tripDetected).toBe(true)

          let workExecuted = false
          const finalResult = await client.withBreaker(
            breaker.slug,
            async () => {
              workExecuted = true
              return 'should-not-run'
            },
            { onOpen: () => 'blocked' },
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
