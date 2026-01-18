import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APIError, AuthError } from '../../../../src/core/errors.ts'
import { AuthApi } from '../../../../src/domains/auth/auth.api.ts'
import { createMockFetch, TEST_CONFIG } from '../../../helpers/index.ts'

describe('AuthApi', () => {
  const { baseUrl, clientId, clientSecret } = TEST_CONFIG

  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('bootstrap', () => {
    it('calls POST /v1/sdk/auth/bootstrap with Basic Auth', async () => {
      const fetchMock = createMockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              sdkClientId: 'sdk-123',
              system: { id: 'sys-1', slug: 'my-system', name: 'My System' },
              breakers: [],
              accessToken: 'token-123',
              tokenType: 'Bearer',
              expiresIn: 3600,
              metricsConfig: { flushIntervalMs: 10000, windowSizeMs: 5000 },
            },
          }),
      })
      global.fetch = fetchMock

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })
      const result = await authApi.bootstrap('my-system')

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/v1/sdk/auth/bootstrap`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
          }),
        }),
      )

      expect(result.accessToken).toBe('token-123')
      expect(result.system.slug).toBe('my-system')
    })

    it('includes client metadata in request body', async () => {
      const fetchMock = createMockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              accessToken: 'token',
              tokenType: 'Bearer',
              expiresIn: 3600,
              system: { id: 'sys-1', slug: 'test', name: 'Test' },
              breakers: [],
              metricsConfig: { flushIntervalMs: 10000, windowSizeMs: 5000 },
            },
          }),
      })
      global.fetch = fetchMock

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })
      await authApi.bootstrap('test-system', { instanceId: 'instance-123' })

      const callArgs = fetchMock.mock.calls[0]
      const body = JSON.parse(callArgs[1].body)

      expect(body.systemSlug).toBe('test-system')
      expect(body.clientMeta.instanceId).toBe('instance-123')
      expect(body.clientMeta.sdkName).toBe('openfuse-node')
      expect(body.clientMeta.runtime).toBe('node')
    })

    it('throws AuthError on 401', async () => {
      global.fetch = createMockFetch({ ok: false, status: 401 })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.bootstrap('test')).rejects.toThrow(AuthError)
      await expect(authApi.bootstrap('test')).rejects.toThrow('invalid client credentials')
    })

    it('throws AuthError on 403', async () => {
      global.fetch = createMockFetch({ ok: false, status: 403 })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.bootstrap('test')).rejects.toThrow(AuthError)
    })

    it('throws APIError on other errors with message', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' }),
      })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.bootstrap('test')).rejects.toThrow(APIError)
      await expect(authApi.bootstrap('test')).rejects.toThrow('Internal server error')
    })

    it('respects custom timeout', async () => {
      // Test that a short timeout aborts a long-running request
      const fetchMock = vi.fn().mockImplementation(
        (_url, options) =>
          new Promise((resolve, reject) => {
            // Simulate a slow server response
            const timeoutId = setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ data: {} }),
              })
            }, 5000)

            // Listen for abort signal
            options.signal?.addEventListener('abort', () => {
              clearTimeout(timeoutId)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      )
      global.fetch = fetchMock

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      // Use a very short timeout (50ms) - fetch is mocked to take 5s
      await expect(authApi.bootstrap('test', { timeoutMs: 50 })).rejects.toThrow()
    })
  })

  describe('refreshToken', () => {
    it('calls GET /v1/sdk/auth/token with Basic Auth', async () => {
      const fetchMock = createMockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              accessToken: 'new-token',
              tokenType: 'Bearer',
              expiresIn: 3600,
            },
          }),
      })
      global.fetch = fetchMock

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })
      const result = await authApi.refreshToken()

      expect(fetchMock).toHaveBeenCalledWith(
        `${baseUrl}/v1/sdk/auth/token`,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          }),
        }),
      )

      expect(result.accessToken).toBe('new-token')
      expect(result.expiresIn).toBe(3600)
    })

    it('throws AuthError on 401', async () => {
      global.fetch = createMockFetch({ ok: false, status: 401 })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.refreshToken()).rejects.toThrow(AuthError)
    })

    it('throws AuthError on 403', async () => {
      global.fetch = createMockFetch({ ok: false, status: 403 })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.refreshToken()).rejects.toThrow(AuthError)
    })

    it('throws APIError on other errors', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ message: 'Bad Gateway' }),
      })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.refreshToken()).rejects.toThrow(APIError)
      await expect(authApi.refreshToken()).rejects.toThrow('Bad Gateway')
    })

    it('respects abort signal', async () => {
      const fetchMock = vi.fn().mockImplementation(
        (_url, options) =>
          new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      )
      global.fetch = fetchMock

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })
      const controller = new AbortController()

      const refreshPromise = authApi.refreshToken({ signal: controller.signal })
      controller.abort()

      await expect(refreshPromise).rejects.toThrow()
    })
  })

  describe('baseUrl handling', () => {
    it('strips trailing slash from baseUrl', async () => {
      const fetchMock = createMockFetch({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { accessToken: 'token', tokenType: 'Bearer', expiresIn: 3600 },
          }),
      })
      global.fetch = fetchMock

      const authApi = new AuthApi({
        baseUrl: `${baseUrl}/`,
        clientId,
        clientSecret,
      })
      await authApi.refreshToken()

      expect(fetchMock).toHaveBeenCalledWith(`${baseUrl}/v1/sdk/auth/token`, expect.anything())
    })
  })
})
