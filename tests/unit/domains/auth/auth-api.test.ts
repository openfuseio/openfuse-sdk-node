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

      const [calledUrl, calledInit] = fetchMock.mock.calls[0]
      expect(calledUrl.toString()).toBe(`${baseUrl}/v1/sdk/auth/bootstrap`)
      expect(calledInit.method).toBe('POST')
      expect(calledInit.headers).toEqual(
        expect.objectContaining({
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'content-type': 'application/json',
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
    })

    it('throws AuthError on 403', async () => {
      global.fetch = createMockFetch({ ok: false, status: 403 })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.bootstrap('test')).rejects.toThrow(AuthError)
    })

    it('throws APIError on 5xx after retries', async () => {
      global.fetch = createMockFetch({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' }),
      })

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      await expect(authApi.bootstrap('test', { maxAttempts: 1 })).rejects.toThrow(APIError)
    })

    it('respects custom timeout', async () => {
      const fetchMock = vi.fn().mockImplementation(
        (_url: URL, options: RequestInit) =>
          new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ data: {} }),
              })
            }, 5000)

            options.signal?.addEventListener('abort', () => {
              clearTimeout(timeoutId)
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      )
      global.fetch = fetchMock

      const authApi = new AuthApi({ baseUrl, clientId, clientSecret })

      // Use a very short timeout (50ms) - fetch is mocked to take 5s
      await expect(authApi.bootstrap('test', { timeoutMs: 50, maxAttempts: 1 })).rejects.toThrow()
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

      const [calledUrl, calledInit] = fetchMock.mock.calls[0]
      expect(calledUrl.toString()).toBe(`${baseUrl}/v1/sdk/auth/token`)
      expect(calledInit.method).toBe('GET')
      expect(calledInit.headers).toEqual(
        expect.objectContaining({
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
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
    })

    it('respects abort signal', async () => {
      const fetchMock = vi.fn().mockImplementation(
        (_url: URL, options: RequestInit) =>
          new Promise((_, reject) => {
            if (options.signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
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

      const calledUrl = fetchMock.mock.calls[0][0]
      expect(calledUrl.toString()).toBe(`${baseUrl}/v1/sdk/auth/token`)
    })
  })
})
