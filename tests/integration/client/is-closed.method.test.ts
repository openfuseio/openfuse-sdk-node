import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestClient,
  makeSdkBootstrapResponse,
  makeBreaker,
  makeSystem,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.isClosed', () => {
  let mockAPI: TAPISpies

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

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      expect(await client.isClosed(breaker.slug)).toBe(true)
      expect(await client.isClosed(breaker.slug)).toBe(true)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
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
      const breaker = makeBreaker({ state: 'closed' })

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      const ac = new AbortController()
      await client.isClosed(breaker.slug, ac.signal)
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
      const breaker = makeBreaker({ state: 'closed' })

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      expect(await client.isClosed(breaker.slug)).toBe(true)
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.isClosed(breaker.slug)).toBe(true)
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

      await expect(client.isClosed(breaker.slug)).rejects.toThrow()
    })
  })
})
