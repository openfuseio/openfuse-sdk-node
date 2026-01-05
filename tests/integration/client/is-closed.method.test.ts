import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFuse } from '../../../src/client/openfuse.ts'
import type { TEndpointProvider, TTokenProvider } from '../../../src/core/types.ts'
import { makeBootstrap, makeBreaker, makeSystem } from '../../helpers/factories.ts'
import { setupAPISpies } from '../../helpers/mocks/api.mock.ts'

const endpointProvider: TEndpointProvider = { getApiBase: () => 'https://api.test' }
const tokenProvider: TTokenProvider = { getToken: async () => 'token-123' }

describe('OpenFuse.isClosed', () => {
  let mockAPI: ReturnType<typeof setupAPISpies>

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('cache vs API', () => {
    it('miss -> calls API and caches; hit -> served from cache', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      expect(await client.isClosed(breaker.slug)).toBe(true)
      expect(await client.isClosed(breaker.slug)).toBe(true)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, undefined)
    })

    it('without bootstrap mapping -> listBreakers then getBreaker; second call uses cached state', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      expect(await client.isClosed(breaker.slug)).toBe(true)
      expect(await client.isClosed(breaker.slug)).toBe(true)

      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, undefined)
    })
  })

  describe('signal', () => {
    it('forwards AbortSignal to getBreaker', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      const ac = new AbortController()
      await client.isClosed(breaker.slug, ac.signal)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, ac.signal)
    })
  })

  describe('API down + cache', () => {
    it('serves from cache when API fails after one successful fetch', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      expect(await client.isClosed(breaker.slug)).toBe(true)
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.isClosed(breaker.slug)).toBe(true)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('throws when API fails and no cached state exists', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })
      await client.bootstrap()

      await expect(client.isClosed(breaker.slug)).rejects.toThrow()
    })
  })
})
