import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapClient,
  createTestClient,
  makeBreaker,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.breaker(slug).isOpen', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('cache vs API', () => {
    it('miss -> calls API and caches; hit -> served from cache (no new API call)', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'open',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      expect(await client.breaker(breaker.slug).isOpen()).toBe(true)
      expect(await client.breaker(breaker.slug).isOpen()).toBe(true)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })

    it('after reset -> mapping is rebuilt (listBreakers) and state API called again', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'open',
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(makeBreaker({ ...breaker, state: 'open' }))

      expect(await client.breaker(breaker.slug).isOpen()).toBe(true)

      await client.reset()

      expect(await client.breaker(breaker.slug).isOpen()).toBe(true)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(bootstrapResponse.system.id)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('signal isolation', () => {
    it('getBreaker is called without AbortSignal (coalesced call is signal-isolated)', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'open',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      await client.breaker(breaker.slug).isOpen()
      // Signal is NOT forwarded to the coalesced getBreaker work (signal isolation)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('API down + cache', () => {
    it('serves from cache when API fails after one successful fetch', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        breakerState: 'open',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(makeBreaker({ ...breaker, state: 'open' }))

      expect(await client.breaker(breaker.slug).isOpen()).toBe(true)

      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.breaker(breaker.slug).isOpen()).toBe(true)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('returns false (fail-open) when API fails and no cached state exists', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))

      expect(await client.breaker(breaker.slug).isOpen()).toBe(false)
    })
  })

  describe('before init', () => {
    it('returns false (fail-open) when called before init', async () => {
      const client = createTestClient()
      expect(await client.breaker('any-breaker').isOpen()).toBe(false)
    })
  })
})
