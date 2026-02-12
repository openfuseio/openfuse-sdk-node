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

      // Bootstrap without breakers so state must be fetched from API
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      expect(await client.isOpen(breaker.slug)).toBe(true)
      expect(await client.isOpen(breaker.slug)).toBe(true)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
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
      client.bootstrap()
      await client.whenReady()

      expect(await client.isOpen(breaker.slug)).toBe(true)

      await client.invalidate()

      expect(await client.isOpen(breaker.slug)).toBe(true)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(bootstrapResponse.system.id)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('signal isolation', () => {
    it('getBreaker is called without AbortSignal (coalesced call is signal-isolated)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'open' })

      // Bootstrap without breakers so state must be fetched from API
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      await client.isOpen(breaker.slug)
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
      const breaker = makeBreaker({ state: 'open' })

      // Bootstrap without breakers so state must be fetched from API
      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      expect(await client.isOpen(breaker.slug)).toBe(true)

      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.isOpen(breaker.slug)).toBe(true)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('returns false (fail-open) when API fails and no cached state exists', async () => {
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

      expect(await client.isOpen(breaker.slug)).toBe(false)
    })
  })

  describe('before bootstrap', () => {
    it('returns false (fail-open) when called before bootstrap', async () => {
      const client = createTestClient()
      expect(await client.isOpen('any-breaker')).toBe(false)
    })
  })
})
