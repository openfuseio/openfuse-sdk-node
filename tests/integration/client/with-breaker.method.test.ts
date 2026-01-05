import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFuse } from '../../../src/client/openfuse.ts'
import { CircuitOpenError, TimeoutError } from '../../../src/core/errors.ts'
import type { TEndpointProvider, TTokenProvider } from '../../../src/core/types.ts'
import type { TIngestMetricsRequest } from '../../../src/domains/metrics/types.ts'
import {
  makeBootstrap,
  makeBreaker,
  makeSystem,
  STANDARD_METRIC_DEFINITIONS,
} from '../../helpers/factories.ts'
import { setupAPISpies } from '../../helpers/mocks/api.mock.ts'

const endpointProvider: TEndpointProvider = { getApiBase: () => 'https://api.test' }
const tokenProvider: TTokenProvider = { getToken: async () => 'token-123' }

describe('OpenFuse.withBreaker (enterprise semantics)', () => {
  let mockAPI: ReturnType<typeof setupAPISpies>

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('CLOSED → runs work', () => {
    it('runs work when breaker is CLOSED (mapping seeded via bootstrap)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const result = await client.withBreaker(breaker.slug, work)

      expect(result).toBe('ok')
      expect(work).toHaveBeenCalledOnce()
      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, undefined)
    })

    it('forwards AbortSignal through isOpen → getBreaker', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      await client.bootstrap()

      const ac = new AbortController()
      const work = vi.fn(async () => 'ok')
      const result = await client.withBreaker(breaker.slug, work, { signal: ac.signal })

      expect(result).toBe('ok')
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, ac.signal)
    })
  })

  describe('OPEN → onOpen or CircuitOpenError (do NOT fall back to onUnknown)', () => {
    it('calls onOpen when breaker is OPEN', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const onOpen = vi.fn(async () => 'fallback')
      const result = await client.withBreaker(breaker.slug, work, { onOpen })

      expect(result).toBe('fallback')
      expect(work).not.toHaveBeenCalled()
      expect(onOpen).toHaveBeenCalledOnce()
    })

    it('throws CircuitOpenError when OPEN and no onOpen, even if onUnknown is provided', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const onUnknown = vi.fn(async () => 'unknown')

      await expect(client.withBreaker(breaker.slug, work, { onUnknown })).rejects.toBeInstanceOf(
        CircuitOpenError,
      )

      expect(onUnknown).not.toHaveBeenCalled()
      expect(work).not.toHaveBeenCalled()
    })

    it('if onOpen throws, the error propagates (do NOT route to onUnknown)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const onOpenErr = new Error('onOpen failed')

      const work = vi.fn(async () => 'ok')
      const onOpen = vi.fn(async () => {
        throw onOpenErr
      })
      const onUnknown = vi.fn(async () => 'unknown')

      await expect(client.withBreaker(breaker.slug, work, { onOpen, onUnknown })).rejects.toBe(
        onOpenErr,
      )

      expect(onUnknown).not.toHaveBeenCalled()
      expect(work).not.toHaveBeenCalled()
    })
  })

  describe('UNKNOWN → fail-open (state errors)', () => {
    it('state fetch error → uses onUnknown if provided', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('state down'))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const onUnknown = vi.fn(async () => 'unknown')
      const r = await client.withBreaker(breaker.slug, work, { onUnknown })

      expect(r).toBe('unknown')
      expect(onUnknown).toHaveBeenCalledOnce()
      expect(work).not.toHaveBeenCalled()
    })

    it('state fetch error -> falls back to onOpen if no onUnknown', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('state down'))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const onOpen = vi.fn(async () => 'fallback')
      const res = await client.withBreaker(breaker.slug, work, { onOpen })

      expect(res).toBe('fallback')
      expect(onOpen).toHaveBeenCalledOnce()
      expect(work).not.toHaveBeenCalled()
    })

    it('state fetch error → throws CircuitOpenError if no callbacks (fail-open)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('state down'))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')

      await expect(client.withBreaker(breaker.slug, work)).rejects.toBeInstanceOf(CircuitOpenError)
      expect(work).not.toHaveBeenCalled()
    })

    it('work throws → rethrows (do NOT use onUnknown for work failures)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const workErr = new Error('work failed')

      const workA = vi.fn(async () => {
        throw workErr
      })
      const onUnknown = vi.fn(async () => 'unknown')
      await expect(client.withBreaker(breaker.slug, workA, { onUnknown })).rejects.toBe(workErr)
      expect(onUnknown).not.toHaveBeenCalled()

      const workB = vi.fn(async () => {
        throw workErr
      })
      await expect(client.withBreaker(breaker.slug, workB)).rejects.toBe(workErr)
    })
  })

  describe('timeout', () => {
    it('throws TimeoutError when work exceeds timeout', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const slowWork = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return 'ok'
      })

      await expect(
        client.withBreaker(breaker.slug, slowWork, { timeout: 10 }),
      ).rejects.toBeInstanceOf(TimeoutError)

      expect(slowWork).toHaveBeenCalledOnce()
    })

    it('completes normally when work finishes before timeout', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const fastWork = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 'ok'
      })

      const result = await client.withBreaker(breaker.slug, fastWork, { timeout: 1000 })

      expect(result).toBe('ok')
      expect(fastWork).toHaveBeenCalledOnce()
    })
  })

  describe('mapping & state cache', () => {
    it('with mapping from bootstrap: no listBreakers call', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      await client.withBreaker(breaker.slug, work)

      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('without mapping: first call builds mapping via listBreakers', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      const work = vi.fn(async () => 'ok')
      await client.withBreaker(breaker.slug, work)

      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, undefined)
    })

    it('coalesces concurrent calls (single getBreaker due to inflight merging)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )

      mockAPI.breakers.getBreaker.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 15))
        return breaker
      })

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const [a, b, c] = await Promise.all([
        client.withBreaker(breaker.slug, work),
        client.withBreaker(breaker.slug, work),
        client.withBreaker(breaker.slug, work),
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
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
        metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      await client.withBreaker(breaker.slug, work)

      // Wait for window to complete
      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      expect(mockAPI.metrics.ingest).toHaveBeenCalledTimes(1)
      const payload = mockAPI.metrics.ingest.mock.calls[0]![0] as TIngestMetricsRequest

      expect(payload.systemId).toBe(system.id)
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
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
        metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 },
      })
      await client.bootstrap()

      const workErr = new Error('work failed')
      const work = vi.fn(async () => {
        throw workErr
      })

      await expect(client.withBreaker(breaker.slug, work)).rejects.toBe(workErr)

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
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
        metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 },
      })
      await client.bootstrap()

      const slowWork = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return 'ok'
      })

      await expect(
        client.withBreaker(breaker.slug, slowWork, { timeout: 10 }),
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
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'closed' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
        metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 },
      })
      await client.bootstrap()

      const work = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10))
        return 'ok'
      })
      await client.withBreaker(breaker.slug, work)

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

    it('does not record metrics when breaker is open', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ state: 'open' }))
      mockAPI.metrics.listMetrics.mockResolvedValue(STANDARD_METRIC_DEFINITIONS)
      mockAPI.metrics.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
        metrics: { windowSizeMs: 100, flushIntervalMs: 10_000 },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      const onOpen = vi.fn(async () => 'fallback')
      await client.withBreaker(breaker.slug, work, { onOpen })

      await new Promise((r) => setTimeout(r, 150))
      await client.flushMetrics()

      expect(mockAPI.metrics.ingest).not.toHaveBeenCalled()
      expect(work).not.toHaveBeenCalled()

      client.stopMetrics()
    })
  })
})
