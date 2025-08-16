import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFuse } from '../../../src/client/openfuse.ts'
import type { TEndpointProvider, TTokenProvider } from '../../../src/core/types.ts'
import { makeBreaker, makeSystem } from '../../helpers/factories.ts'
import { setupAPISpies } from '../../helpers/mocks/api.mock.ts'

const endpointProvider: TEndpointProvider = { getApiBase: () => 'https://api.test' }
const tokenProvider: TTokenProvider = { getToken: async () => 'token-123' }

describe('OpenFuse.listBreakers', () => {
  let mockAPI: ReturnType<typeof setupAPISpies>

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

      mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([breaker])

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      const list = await client.listBreakers()
      expect(list).toEqual([breaker])
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
    })

    it('does not cache the list itself: consecutive calls hit API each time', async () => {
      const system = makeSystem()
      const a = makeBreaker()
      const b = makeBreaker()

      mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
      mockAPI.breakers.listBreakers.mockResolvedValueOnce([a]).mockResolvedValueOnce([b])

      const client = new OpenFuse({
        endpointProvider,
        tokenProvider,
        scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
      })

      const first = await client.listBreakers()
      const second = await client.listBreakers()

      expect(first).toEqual([a])
      expect(second).toEqual([b])
      expect(mockAPI.breakers.listBreakers).toHaveBeenCalledTimes(2)
    })
  })
})
