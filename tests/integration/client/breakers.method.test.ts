import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapClient,
  createTestClient,
  makeBreaker,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.breakers', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('API calls and mapping hydration', () => {
    it('calls API and returns list; mapping is hydrated for subsequent state reads elsewhere', async () => {
      const breaker = makeBreaker()
      const { bootstrapResponse, client } = await bootstrapClient(mockAPI, { seedBreakers: false })
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([breaker])

      const list = await client.breakers()
      expect(list).toEqual([breaker])
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(
        bootstrapResponse.system.id,
        undefined,
      )
    })

    it('does not cache the list itself: consecutive calls hit API each time', async () => {
      const a = makeBreaker()
      const b = makeBreaker()

      const { client } = await bootstrapClient(mockAPI, { seedBreakers: false })
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([a]).mockResolvedValueOnce([b])

      const first = await client.breakers()
      const second = await client.breakers()

      expect(first).toEqual([a])
      expect(second).toEqual([b])
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledTimes(2)
    })
  })

  describe('before init', () => {
    it('returns empty array when called before init() (fail-open)', async () => {
      const client = createTestClient()
      const result = await client.breakers()
      expect(result).toEqual([])
    })
  })
})
