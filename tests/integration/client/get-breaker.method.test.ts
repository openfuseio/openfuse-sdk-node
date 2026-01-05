import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFuse } from '../../../src/client/openfuse.ts'
import type { TEndpointProvider, TTokenProvider } from '../../../src/core/types.ts'
import { makeBootstrap, makeBreaker, makeSystem } from '../../helpers/factories.ts'
import { setupAPISpies } from '../../helpers/mocks/api.mock.js'

const endpointProvider: TEndpointProvider = { getApiBase: () => 'https://api.test' }
const tokenProvider: TTokenProvider = { getToken: async () => 'token-123' }

describe('OpenFuse.getBreaker', () => {
  let mockAPI: ReturnType<typeof setupAPISpies>

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('mapping available (via bootstrap)', () => {
    it('calls API for the model and never calls listBreakers; repeated calls hit API again (no model cache)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

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

      const a = await client.getBreaker(breaker.slug)
      const b = await client.getBreaker(breaker.slug)

      expect(a).toEqual(breaker)
      expect(b).toEqual(breaker)

      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(2)
      expect(mockAPI.breakers.getBreaker).toHaveBeenNthCalledWith(
        1,
        system.id,
        breaker.id,
        undefined,
      )
      expect(mockAPI.breakers.getBreaker).toHaveBeenNthCalledWith(
        2,
        system.id,
        breaker.id,
        undefined,
      )
    })
  })

  describe('mapping missing (no bootstrap first)', () => {
    it('first resolves mapping via listBreakers, then fetches model; second call skips listBreakers but still hits getBreaker', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      const first = await client.getBreaker(breaker.slug)
      const second = await client.getBreaker(breaker.slug)

      expect(first).toEqual(breaker)
      expect(second).toEqual(breaker)

      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(2)
      expect(mockAPI.breakers.getBreaker).toHaveBeenNthCalledWith(
        1,
        system.id,
        breaker.id,
        undefined,
      )
      expect(mockAPI.breakers.getBreaker).toHaveBeenNthCalledWith(
        2,
        system.id,
        breaker.id,
        undefined,
      )
    })
  })

  describe('invalidate()', () => {
    it('drops mapping; next getBreaker rebuilds mapping (listBreakers) and calls API again', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      await client.bootstrap()

      await client.getBreaker(breaker.slug)
      await client.invalidate()

      const again = await client.getBreaker(breaker.slug)
      expect(again).toEqual(breaker)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(2)
    })
  })

  describe('signal', () => {
    it('forwards AbortSignal to getBreaker', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

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

      const model = await client.getBreaker(breaker.slug)
      expect(model).toEqual(breaker)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(system.id, breaker.id, undefined)
    })
  })

  describe('API down (no model cache fallback)', () => {
    it('throws when getBreaker fails (mapping available)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.systems.bootstrapSystem.mockResolvedValue(
        makeBootstrap({ system, breakers: [breaker] }),
      )
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('down'))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      await client.bootstrap()

      await expect(client.getBreaker(breaker.slug)).rejects.toThrow('down')
      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    })

    it('throws when getBreaker fails and mapping must be built first', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('down'))

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      await expect(client.getBreaker(breaker.slug)).rejects.toThrow('down')
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
    })
  })
})
