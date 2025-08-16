import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFuse } from '../../../src/client/openfuse.ts'
import { CircuitOpenError } from '../../../src/core/errors.ts'
import type { TEndpointProvider, TTokenProvider } from '../../../src/core/types.ts'
import { makeBootstrap, makeBreaker, makeState, makeSystem } from '../../helpers/factories.ts'
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
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'closed' }))

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
      expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(breaker.id, undefined)
    })

    it('forwards AbortSignal through isOpen → getBreakerState', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'closed' }))

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
      expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(breaker.id, ac.signal)
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
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'open' }))

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
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'open' }))

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
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'open' }))

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

  describe('UNKNOWN → onUnknown or rethrow (state errors only)', () => {
    it('state fetch error → uses onUnknown if provided; otherwise rethrows', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      const down = new Error('state down')
      mockAPI.breakers.getBreakerState.mockRejectedValue(down)

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

      await expect(client.withBreaker(breaker.slug, work)).rejects.toBe(down)
    })

    it('work throws → rethrows (do NOT use onUnknown for work failures)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'closed' }))

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

  describe('mapping & state cache', () => {
    it('with mapping from bootstrap: no listBreakers call', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const work = vi.fn(async () => 'ok')
      await client.withBreaker(breaker.slug, work)

      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledTimes(1)
    })

    it('without mapping: first call builds mapping via listBreakers', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreakerState.mockResolvedValue(makeState({ state: 'closed' }))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      const work = vi.fn(async () => 'ok')
      await client.withBreaker(breaker.slug, work)

      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
      expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(breaker.id, undefined)
    })

    it('coalesces concurrent calls (single getBreakerState due to inflight merging)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )

      mockAPI.breakers.getBreakerState.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 15))
        return makeState({ state: 'closed' })
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
      expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledTimes(1)
      expect(work).toHaveBeenCalledTimes(3)
    })
  })
})
