import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError } from '../../../src/core/errors.ts'
import type { TIngestMetricsRequest } from '../../../src/domains/metrics/types.ts'
import {
  bootstrapClient,
  makeBreaker,
  setupAPISpies,
  STANDARD_METRIC_DEFINITIONS,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.breaker(slug).protect (enterprise semantics)', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('CLOSED -> runs work', () => {
    it('runs work when breaker is CLOSED (mapping and state seeded via bootstrap)', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })

      const work = vi.fn(async () => 'ok')
      const result = await client.breaker(breaker.slug).protect(work)

      expect(result).toBe('ok')
      expect(work).toHaveBeenCalledOnce()
      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
    })

    it('does not forward AbortSignal into coalesced getBreaker (signal isolation)', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const ac = new AbortController()
      const work = vi.fn(async () => 'ok')
      const result = await client.breaker(breaker.slug).protect(work, { signal: ac.signal })

      expect(result).toBe('ok')
      // Signal is NOT forwarded to the coalesced getBreaker work (signal isolation)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('OPEN -> fallback or fail-open', () => {
    it('calls fallback when breaker is OPEN', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'open' })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))

      const work = vi.fn(async () => 'ok')
      const fallback = vi.fn(async () => 'fallback')
      const result = await client.breaker(breaker.slug).protect(work, { fallback })

      expect(result).toBe('fallback')
      expect(work).not.toHaveBeenCalled()
      expect(fallback).toHaveBeenCalledOnce()
    })

    it('executes fn (fail-open) when OPEN and no fallback', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'open' })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))

      const work = vi.fn(async () => 'ok')
      const result = await client.breaker(breaker.slug).protect(work)

      expect(result).toBe('ok')
      expect(work).toHaveBeenCalledOnce()
    })

    it('if fallback throws, the error propagates', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'open' })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))

      const fallbackErr = new Error('fallback failed')

      const work = vi.fn(async () => 'ok')
      const fallback = vi.fn(async () => {
        throw fallbackErr
      })

      await expect(client.breaker(breaker.slug).protect(work, { fallback })).rejects.toBe(
        fallbackErr,
      )

      expect(work).not.toHaveBeenCalled()
    })
  })

  describe('UNKNOWN -> fail-open (state errors)', () => {
    it('state fetch error -> executes fn() (fail-open) when no callbacks at all', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { seedBreakers: false })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('state down'))

      const work = vi.fn(async () => 'ok')
      const res = await client.breaker(breaker.slug).protect(work)

      expect(res).toBe('ok')
      expect(work).toHaveBeenCalledOnce()
    })

    it('state fetch error -> executes fn() (fail-open) when fallback provided', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { seedBreakers: false })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('state down'))

      const work = vi.fn(async () => 'ok')
      const fallback = vi.fn(async () => 'fallback')
      const res = await client.breaker(breaker.slug).protect(work, { fallback })

      expect(res).toBe('ok')
      expect(work).toHaveBeenCalledOnce()
      expect(fallback).not.toHaveBeenCalled()
    })

    it('work throws -> rethrows', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const workErr = new Error('work failed')

      const workA = vi.fn(async () => {
        throw workErr
      })
      await expect(client.breaker(breaker.slug).protect(workA)).rejects.toBe(workErr)

      const workB = vi.fn(async () => {
        throw workErr
      })
      await expect(client.breaker(breaker.slug).protect(workB)).rejects.toBe(workErr)
    })
  })

  describe('timeout', () => {
    it('throws TimeoutError when work exceeds timeout', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const slowWork = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return 'ok'
      })

      await expect(
        client.breaker(breaker.slug).protect(slowWork, { timeout: 10 }),
      ).rejects.toBeInstanceOf(TimeoutError)

      expect(slowWork).toHaveBeenCalledOnce()
    })

    it('completes normally when work finishes before timeout', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const fastWork = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 'ok'
      })

      const result = await client.breaker(breaker.slug).protect(fastWork, { timeout: 1000 })

      expect(result).toBe('ok')
      expect(fastWork).toHaveBeenCalledOnce()
    })
  })

  describe('mapping & state cache', () => {
    it('with mapping and state from bootstrap: no listBreakers or getBreaker call', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })

      const work = vi.fn(async () => 'ok')
      await client.breaker(breaker.slug).protect(work)

      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
    })

    it('coalesces concurrent calls (single getBreaker due to inflight merging)', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])

      mockAPI.breakers.getBreaker.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 15))
        return breaker
      })

      const work = vi.fn(async () => 'ok')
      const handle = client.breaker(breaker.slug)
      const [a, b, c] = await Promise.all([
        handle.protect(work),
        handle.protect(work),
        handle.protect(work),
      ])

      expect(a).toBe('ok')
      expect(b).toBe('ok')
      expect(c).toBe('ok')
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(work).toHaveBeenCalledTimes(3)
    })
  })

  describe('metrics recording', () => {
    it('records success metric when work completes successfully', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        clientOverrides: { metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 } },
      })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const work = vi.fn(async () => 'ok')
      await client.breaker(breaker.slug).protect(work)

      // Wait for window to complete
      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      expect(mockAPI.metrics.ingest).toHaveBeenCalledTimes(1)
      const payload = mockAPI.metrics.ingest.mock.calls[0]![0] as TIngestMetricsRequest

      expect(payload.systemId).toBe(bootstrapResponse.system.id)
      expect(payload.breakers).toHaveLength(1)
      expect(payload.breakers[0]!.breakerId).toBe(breaker.id)

      const metrics = payload.breakers[0]!.metrics
      const successMetric = metrics.find((m) => m.metricId === 'metric-success-id')
      const failureMetric = metrics.find((m) => m.metricId === 'metric-failure-id')
      const totalMetric = metrics.find((m) => m.metricId === 'metric-total-id')

      expect(successMetric?.value).toBe(1)
      expect(failureMetric?.value).toBe(0)
      expect(totalMetric?.value).toBe(1)

      client.stopMetrics()
    })

    it('records failure metric when work throws', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        clientOverrides: { metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 } },
      })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const workErr = new Error('work failed')
      const work = vi.fn(async () => {
        throw workErr
      })

      await expect(client.breaker(breaker.slug).protect(work)).rejects.toBe(workErr)

      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      expect(mockAPI.metrics.ingest).toHaveBeenCalledTimes(1)
      const payload = mockAPI.metrics.ingest.mock.calls[0]![0] as TIngestMetricsRequest

      const metrics = payload.breakers[0]!.metrics
      const successMetric = metrics.find((m) => m.metricId === 'metric-success-id')
      const failureMetric = metrics.find((m) => m.metricId === 'metric-failure-id')
      const totalMetric = metrics.find((m) => m.metricId === 'metric-total-id')

      expect(successMetric?.value).toBe(0)
      expect(failureMetric?.value).toBe(1)
      expect(totalMetric?.value).toBe(1)

      client.stopMetrics()
    })

    it('records timeout metric when work exceeds timeout', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        clientOverrides: { metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 } },
      })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const slowWork = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return 'ok'
      })

      await expect(
        client.breaker(breaker.slug).protect(slowWork, { timeout: 10 }),
      ).rejects.toBeInstanceOf(TimeoutError)

      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      expect(mockAPI.metrics.ingest).toHaveBeenCalledTimes(1)
      const payload = mockAPI.metrics.ingest.mock.calls[0]![0] as TIngestMetricsRequest

      const metrics = payload.breakers[0]!.metrics
      const successMetric = metrics.find((m) => m.metricId === 'metric-success-id')
      const timeoutMetric = metrics.find((m) => m.metricId === 'metric-timeout-id')
      const totalMetric = metrics.find((m) => m.metricId === 'metric-total-id')

      expect(successMetric?.value).toBe(0)
      expect(timeoutMetric?.value).toBe(1)
      expect(totalMetric?.value).toBe(1)

      client.stopMetrics()
    })

    it('records latency percentiles on flush', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        clientOverrides: { metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 } },
      })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const work = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10))
        return 'ok'
      })
      await client.breaker(breaker.slug).protect(work)

      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      const payload = mockAPI.metrics.ingest.mock.calls[0]![0] as TIngestMetricsRequest
      const metrics = payload.breakers[0]!.metrics

      const p50 = metrics.find((m) => m.metricId === 'metric-p50-id')
      const p95 = metrics.find((m) => m.metricId === 'metric-p95-id')
      const p99 = metrics.find((m) => m.metricId === 'metric-p99-id')

      expect(p50).toBeDefined()
      expect(p95).toBeDefined()
      expect(p99).toBeDefined()
      expect(p50!.value).toBeGreaterThan(0)

      client.stopMetrics()
    })

    it('does not record metrics when breaker is open and fallback is used', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'open',
        clientOverrides: { metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 } },
      })
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const work = vi.fn(async () => 'ok')
      const fallback = vi.fn(async () => 'fallback')
      await client.breaker(breaker.slug).protect(work, { fallback })

      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      expect(mockAPI.metrics.ingest).not.toHaveBeenCalled()
      expect(work).not.toHaveBeenCalled()

      client.stopMetrics()
    })
  })

  describe('state fetch budget', () => {
    it('fails-open when state fetch exceeds 500ms budget', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])

      // Simulate slow API - takes 2 seconds
      mockAPI.breakers.getBreaker.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(breaker), 2000)),
      )

      const work = vi.fn(async () => 'ok')
      const result = await client.breaker(breaker.slug).protect(work)

      // Should fail-open and execute work
      expect(result).toBe('ok')
      expect(work).toHaveBeenCalledOnce()

      client.stopMetrics()
    })

    it('returns state normally when fetch completes within budget', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'open',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])

      // Fast API response
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const work = vi.fn(async () => 'ok')
      const fallback = vi.fn(async () => 'open-fallback')
      const result = await client.breaker(breaker.slug).protect(work, { fallback })

      // State was fetched successfully within budget, breaker is open -> fallback called
      expect(result).toBe('open-fallback')
      expect(fallback).toHaveBeenCalledOnce()
      expect(work).not.toHaveBeenCalled()

      client.stopMetrics()
    })
  })
})
