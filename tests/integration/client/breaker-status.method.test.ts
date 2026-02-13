import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapClient,
  createTestClient,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.breaker(slug).status', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('mapping available (via bootstrap)', () => {
    it('calls API for the model and never calls listBreakers; repeated calls hit API again (no model cache)', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI)
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const a = await client.breaker(breaker.slug).status()
      const b = await client.breaker(breaker.slug).status()

      expect(a).toEqual(breaker)
      expect(b).toEqual(breaker)

      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(2)
      expect(mockAPI.breakers.getBreaker).toHaveBeenNthCalledWith(
        1,
        bootstrapResponse.system.id,
        breaker.id,
        undefined,
      )
      expect(mockAPI.breakers.getBreaker).toHaveBeenNthCalledWith(
        2,
        bootstrapResponse.system.id,
        breaker.id,
        undefined,
      )
    })
  })

  describe('reset()', () => {
    it('drops mapping; next status rebuilds mapping (listBreakers) and calls API again', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      await client.breaker(breaker.slug).status()
      await client.reset()

      const again = await client.breaker(breaker.slug).status()
      expect(again).toEqual(breaker)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(bootstrapResponse.system.id)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(2)
    })
  })

  describe('signal', () => {
    it('forwards AbortSignal to getBreaker', async () => {
      const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI)
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const ac = new AbortController()
      const model = await client.breaker(breaker.slug).status(ac.signal)
      expect(model).toEqual(breaker)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
        ac.signal,
      )
    })
  })

  describe('API down (no model cache fallback)', () => {
    it('returns null when getBreaker fails (mapping available)', async () => {
      const { breaker, client } = await bootstrapClient(mockAPI)
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('down'))

      const result = await client.breaker(breaker.slug).status()
      expect(result).toBeNull()
      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    })
  })

  describe('before init', () => {
    it('returns null when called before init()', async () => {
      const client = createTestClient()
      const result = await client.breaker('any-breaker').status()
      expect(result).toBeNull()
    })
  })
})
