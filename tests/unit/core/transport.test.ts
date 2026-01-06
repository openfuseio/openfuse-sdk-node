import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APIError, AuthError } from '../../../src/core/errors.ts'
import { Transport } from '../../../src/core/transport.ts'
import type { TTokenProvider } from '../../../src/core/types.ts'

function createMockTokenProvider(
  token = 'test-token',
): TTokenProvider & { clearCache: ReturnType<typeof vi.fn> } {
  return {
    getToken: vi.fn().mockResolvedValue(token),
    clearCache: vi.fn(),
  }
}

function createMockFetch(response: Partial<Response> & { ok: boolean; status: number }) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ data: {} }),
    text: () => Promise.resolve(''),
    ...response,
  })
}

describe('Transport', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('auth retry on 401/403', () => {
    it('clears token cache and retries once on 401', async () => {
      const tokenProvider = createMockTokenProvider()
      tokenProvider.getToken = vi
        .fn()
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce('fresh-token')

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { success: true } }),
        })
      global.fetch = fetchMock

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      const result = await transport.request('GET', '/test')

      expect(tokenProvider.clearCache).toHaveBeenCalledTimes(1)
      expect(tokenProvider.getToken).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ success: true })
    })

    it('clears token cache and retries once on 403', async () => {
      const tokenProvider = createMockTokenProvider()
      tokenProvider.getToken = vi
        .fn()
        .mockResolvedValueOnce('stale-token')
        .mockResolvedValueOnce('fresh-token')

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 403 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { success: true } }),
        })
      global.fetch = fetchMock

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      const result = await transport.request('GET', '/test')

      expect(tokenProvider.clearCache).toHaveBeenCalledTimes(1)
      expect(tokenProvider.getToken).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ success: true })
    })

    it('throws AuthError after retry still returns 401', async () => {
      const tokenProvider = createMockTokenProvider()

      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)
      await expect(transport.request('GET', '/test')).rejects.toThrow(
        'Authentication failed with status 401',
      )
      expect(tokenProvider.clearCache).toHaveBeenCalled()
    })

    it('throws AuthError after retry still returns 403', async () => {
      const tokenProvider = createMockTokenProvider()

      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)
      await expect(transport.request('GET', '/test')).rejects.toThrow(
        'Authentication failed with status 403',
      )
    })

    it('only retries auth once per request', async () => {
      const tokenProvider = createMockTokenProvider()

      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)

      // clearCache called once, not multiple times
      expect(tokenProvider.clearCache).toHaveBeenCalledTimes(1)
      // getToken called twice (initial + retry)
      expect(tokenProvider.getToken).toHaveBeenCalledTimes(2)
    })

    it('works when tokenProvider does not implement clearCache', async () => {
      const tokenProvider: TTokenProvider = {
        getToken: vi.fn().mockResolvedValue('token'),
      }

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { result: 'ok' } }),
        })
      global.fetch = fetchMock

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      const result = await transport.request('GET', '/test')
      expect(result).toEqual({ result: 'ok' })
    })
  })

  describe('successful requests', () => {
    it('returns data from successful response', async () => {
      const tokenProvider = createMockTokenProvider()
      global.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: 1, name: 'test' } }),
      })

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      const result = await transport.request('GET', '/items/1')

      expect(result).toEqual({ id: 1, name: 'test' })
      expect(tokenProvider.getToken).toHaveBeenCalledTimes(1)
    })

    it('sends authorization header with bearer token', async () => {
      const tokenProvider = createMockTokenProvider('my-jwt-token')
      const fetchMock = createMockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: {} }),
      })
      global.fetch = fetchMock

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      await transport.request('GET', '/test')

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer my-jwt-token',
          }),
        }),
      )
    })
  })

  describe('error handling', () => {
    it('throws APIError on 4xx errors (non-auth)', async () => {
      const tokenProvider = createMockTokenProvider()
      global.fetch = createMockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Not found' }),
      })

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
      })

      await expect(transport.request('GET', '/missing')).rejects.toThrow(APIError)
      await expect(transport.request('GET', '/missing')).rejects.toThrow('HTTP 404')
    })

    it('retries on 5xx errors', async () => {
      const tokenProvider = createMockTokenProvider()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: false, status: 502 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { recovered: true } }),
        })
      global.fetch = fetchMock

      const transport = new Transport({
        endpointProvider: { getApiBase: () => 'https://api.example.com' },
        tokenProvider,
        retryPolicy: { attempts: 3, baseDelayInMilliseconds: 1, maximumDelayInMilliseconds: 10 },
      })

      const result = await transport.request('GET', '/flaky')

      expect(result).toEqual({ recovered: true })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })
})
