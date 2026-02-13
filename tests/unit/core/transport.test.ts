import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbortOperationError, APIError, AuthError } from '../../../src/core/errors.ts'
import { Transport } from '../../../src/core/transport.ts'
import type { TAuthProvider } from '../../../src/core/types.ts'
import { createMockFetch, createMockAuthProvider, TEST_CONFIG } from '../../helpers/index.ts'

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
    it('clears auth and retries once on 401', async () => {
      const authProvider = createMockAuthProvider()
      authProvider.getAuthHeaders = vi
        .fn()
        .mockResolvedValueOnce({ authorization: 'Bearer stale-token' })
        .mockResolvedValueOnce({ authorization: 'Bearer fresh-token' })

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
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      const result = await transport.request('GET', '/test')

      expect(authProvider.onAuthFailure).toHaveBeenCalledTimes(1)
      expect(authProvider.getAuthHeaders).toHaveBeenCalledTimes(2)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ success: true })
    })

    it('clears auth and retries once on 403', async () => {
      const authProvider = createMockAuthProvider()
      authProvider.getAuthHeaders = vi
        .fn()
        .mockResolvedValueOnce({ authorization: 'Bearer stale-token' })
        .mockResolvedValueOnce({ authorization: 'Bearer fresh-token' })

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
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      const result = await transport.request('GET', '/test')

      expect(authProvider.onAuthFailure).toHaveBeenCalledTimes(1)
      expect(authProvider.getAuthHeaders).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ success: true })
    })

    it('throws AuthError after retry still returns 401', async () => {
      const authProvider = createMockAuthProvider()

      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)
      await expect(transport.request('GET', '/test')).rejects.toThrow(
        'Authentication failed with status 401',
      )
      expect(authProvider.onAuthFailure).toHaveBeenCalled()
    })

    it('throws AuthError after retry still returns 403', async () => {
      const authProvider = createMockAuthProvider()

      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 })

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)
      await expect(transport.request('GET', '/test')).rejects.toThrow(
        'Authentication failed with status 403',
      )
    })

    it('only retries auth once per request', async () => {
      const authProvider = createMockAuthProvider()

      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 })

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)

      // onAuthFailure called once, not multiple times
      expect(authProvider.onAuthFailure).toHaveBeenCalledTimes(1)
      // getAuthHeaders called twice (initial + retry)
      expect(authProvider.getAuthHeaders).toHaveBeenCalledTimes(2)
    })

    it('throws immediately on 401 when authProvider has no onAuthFailure', async () => {
      const authProvider: TAuthProvider = {
        getAuthHeaders: vi.fn().mockResolvedValue({ authorization: 'Bearer token' }),
      }

      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 })
      global.fetch = fetchMock

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      await expect(transport.request('GET', '/test')).rejects.toThrow(AuthError)
      // Only one fetch call — no retry without onAuthFailure
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('successful requests', () => {
    it('returns data from successful response', async () => {
      const authProvider = createMockAuthProvider()
      global.fetch = createMockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: 1, name: 'test' } }),
      })

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      const result = await transport.request('GET', '/items/1')

      expect(result).toEqual({ id: 1, name: 'test' })
      expect(authProvider.getAuthHeaders).toHaveBeenCalledTimes(1)
    })

    it('sends authorization header from auth provider', async () => {
      const authProvider = createMockAuthProvider('my-jwt-token')
      const fetchMock = createMockFetch({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: {} }),
      })
      global.fetch = fetchMock

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
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
      const authProvider = createMockAuthProvider()
      global.fetch = createMockFetch({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Not found' }),
      })

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
      })

      await expect(transport.request('GET', '/missing')).rejects.toThrow(APIError)
      await expect(transport.request('GET', '/missing')).rejects.toThrow('HTTP 404')
    })

    it('retries on 5xx errors', async () => {
      const authProvider = createMockAuthProvider()
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
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
        retryPolicy: { attempts: 3, baseDelayInMilliseconds: 1, maximumDelayInMilliseconds: 10 },
      })

      const result = await transport.request('GET', '/flaky')

      expect(result).toEqual({ recovered: true })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('per-request retry policy', () => {
    it('uses per-request retryPolicy when provided', async () => {
      const authProvider = createMockAuthProvider()
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { ok: true } }),
        })
      global.fetch = fetchMock

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
        retryPolicy: { attempts: 1, baseDelayInMilliseconds: 1, maximumDelayInMilliseconds: 10 },
      })

      // Instance retryPolicy has 1 attempt (no retries), but per-request overrides to 2
      const result = await transport.request('GET', '/test', {
        retryPolicy: { attempts: 2, baseDelayInMilliseconds: 1, maximumDelayInMilliseconds: 10 },
      })

      expect(result).toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('abort signal early exit (Fix 3)', () => {
    it('does not burn through retry attempts when signal is already aborted', async () => {
      const authProvider = createMockAuthProvider()
      const fetchMock = vi.fn().mockRejectedValue(new Error('network error'))
      global.fetch = fetchMock

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
        retryPolicy: { attempts: 5, baseDelayInMilliseconds: 1, maximumDelayInMilliseconds: 10 },
      })

      const controller = new AbortController()
      controller.abort()

      await expect(
        transport.request('GET', '/test', { signal: controller.signal }),
      ).rejects.toThrow(AbortOperationError)

      // Should NOT have called fetch 5 times — aborted signal stops the loop early
      expect(fetchMock).toHaveBeenCalledTimes(0)
    })

    it('stops retrying after signal aborts mid-request', async () => {
      const authProvider = createMockAuthProvider()
      const controller = new AbortController()

      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // First call fails; signal aborts before retry
          controller.abort()
          return Promise.reject(new Error('network error'))
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: {} }),
        })
      })
      global.fetch = fetchMock

      const transport = new Transport({
        baseUrl: TEST_CONFIG.baseUrl,
        authProvider,
        retryPolicy: { attempts: 5, baseDelayInMilliseconds: 1, maximumDelayInMilliseconds: 10 },
      })

      await expect(
        transport.request('GET', '/test', { signal: controller.signal }),
      ).rejects.toThrow()

      // Should have only made 1 fetch call, not 5
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })
})
