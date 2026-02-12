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

      // Bootstrap without breakers so state must be fetched from API
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      expect(await client.isClosed(breaker.slug)).toBe(true)
      expect(await client.isClosed(breaker.slug)).toBe(true)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('signal isolation', () => {
    it('getBreaker is called without AbortSignal (coalesced call is signal-isolated)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      // Bootstrap without breakers so state must be fetched from API
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      await client.isClosed(breaker.slug)
      // Signal is NOT forwarded to the coalesced getBreaker work (signal isolation)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('API down + cache', () => {
    it('serves from cache when API fails after one successful fetch', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      // Bootstrap without breakers so state must be fetched from API
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      expect(await client.isClosed(breaker.slug)).toBe(true)
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.isClosed(breaker.slug)).toBe(true)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('returns true (fail-open) when API fails and no cached state exists', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      // Bootstrap without breakers so no state is cached
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      expect(await client.isClosed(breaker.slug)).toBe(true)
    })
  })

  describe('before bootstrap', () => {
    it('returns true (fail-open) when called before bootstrap', async () => {
      const client = createTestClient()
      expect(await client.isClosed('any-breaker')).toBe(true)
    })
  })
})
