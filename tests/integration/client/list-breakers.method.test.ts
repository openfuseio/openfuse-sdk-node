import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestClient,
  makeSdkBootstrapResponse,
  makeBreaker,
  makeSystem,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.listBreakers', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('API calls and mapping hydration', () => {
    it('calls API and returns list; mapping is hydrated for subsequent state reads elsewhere', async () => {
      const system = makeSystem()
      const breaker = makeBreaker()

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([breaker])

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      const list = await client.listBreakers()
      expect(list).toEqual([breaker])
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        undefined,
      )
    })

    it('does not cache the list itself: consecutive calls hit API each time', async () => {
      const system = makeSystem()
      const a = makeBreaker()
      const b = makeBreaker()

      const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
      mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([a]).mockResolvedValueOnce([b])

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      const first = await client.listBreakers()
      const second = await client.listBreakers()

      expect(first).toEqual([a])
      expect(second).toEqual([b])
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledTimes(2)
    })
  })

  describe('before bootstrap', () => {
    it('returns empty array when called before bootstrap() (fail-open)', async () => {
      const client = createTestClient()
      const result = await client.listBreakers()
      expect(result).toEqual([])
    })
  })
})
