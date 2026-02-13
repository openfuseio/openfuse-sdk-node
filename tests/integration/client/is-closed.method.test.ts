import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapClient,
  createTestClient,
  makeBreaker,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.breaker(slug).isClosed', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('cache vs API', () => {
    it('miss -> calls API and caches; hit -> served from cache', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      expect(await client.breaker(breaker.slug).isClosed()).toBe(true)
      expect(await client.breaker(breaker.slug).isClosed()).toBe(true)

      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
      )
    })
  })

  describe('signal isolation', () => {
    it('getBreaker is called without AbortSignal (coalesced call is signal-isolated)', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
        breakerState: 'closed',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      await client.breaker(breaker.slug).isClosed()
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
        breakerState: 'closed',
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValueOnce(
        makeBreaker({ ...breaker, state: 'closed' }),
      )

      expect(await client.breaker(breaker.slug).isClosed()).toBe(true)
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))
      expect(await client.breaker(breaker.slug).isClosed()).toBe(true)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
    })

    it('returns true (fail-open) when API fails and no cached state exists', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI, {
        seedBreakers: false,
      })
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockRejectedValueOnce(new Error('down'))

      expect(await client.breaker(breaker.slug).isClosed()).toBe(true)
    })
  })

  describe('before init', () => {
    it('returns true (fail-open) when called before init', async () => {
      const client = createTestClient()
      expect(await client.breaker('any-breaker').isClosed()).toBe(true)
    })
  })
})
