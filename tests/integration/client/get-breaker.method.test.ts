import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestClient,
  makeSdkBootstrapResponse,
  makeBreaker,
  makeSystem,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.getBreaker', () => {
  let mockAPI: TAPISpies

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

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      const a = await client.getBreaker(breaker.slug)
      const b = await client.getBreaker(breaker.slug)

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

  describe('invalidate()', () => {
    it('drops mapping; next getBreaker rebuilds mapping (listBreakers) and calls API again', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      await client.getBreaker(breaker.slug)
      await client.invalidate()

      const again = await client.getBreaker(breaker.slug)
      expect(again).toEqual(breaker)
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        undefined,
      )
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(2)
    })
  })

  describe('signal', () => {
    it('forwards AbortSignal to getBreaker', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      const ac = new AbortController()
      const model = await client.getBreaker(breaker.slug, ac.signal)
      expect(model).toEqual(breaker)
      expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        breaker.id,
        ac.signal,
      )
    })
  })

  describe('API down (no model cache fallback)', () => {
    it('throws when getBreaker fails (mapping available)', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.getBreaker.mockRejectedValue(new Error('down'))

      const client = createTestClient({ systemSlug: system.slug })
      await client.bootstrap()

      await expect(client.getBreaker(breaker.slug)).rejects.toThrow('down')
      expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    })
  })
})
