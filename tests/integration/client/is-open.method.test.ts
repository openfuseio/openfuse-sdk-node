import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestClient,
  makeSdkBootstrapResponse,
  makeBreaker,
  makeSystem,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.isOpen', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('cache vs API', () => {
    it('miss -> calls API and caches; hit -> served from cache (no new API call)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      expect(await client.isOpen(breaker.slug)).toBe(true)
      expect(await client.isOpen(breaker.slug)).toBe(true)

      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
        undefined,
      )
    })

    it('after invalidate -> mapping is rebuilt (listBreakers) and state API called again', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      expect(await client.isOpen(breaker.slug)).toBe(true)

      await client.invalidate()

      expect(await client.isOpen(breaker.slug)).toBe(true)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        undefined,
      )
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
        undefined,
      )
    })
  })

  describe('signal', () => {
    it('forwards AbortSignal to getBreaker', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      const ac = new AbortController()
      await client.isOpen(breaker.slug, ac.signal)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
        ac.signal,
      )
    })
  })

  describe('API down + cache', () => {
    it('serves from cache when API fails after one successful fetch', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      expect(await client.isOpen(breaker.slug)).toBe(true)

      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.isOpen(breaker.slug)).toBe(true)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('throws when API fails and no cached state exists', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      await expect(client.isOpen(breaker.slug)).rejects.toThrow()
    })
  })
})
