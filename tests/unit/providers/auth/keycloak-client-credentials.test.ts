import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, ConfigurationError } from '../../../../src/core/errors.ts'
import { KeycloakClientCredentialsProvider } from '../../../../src/providers/auth/keycloak-client-credentials.ts'

const VALID_OPTIONS = {
  keycloakUrl: 'https://auth.example.com',
  realm: 'test-realm',
  clientId: 'test-client',
  clientSecret: 'test-secret',
}

const TOKEN_ENDPOINT = 'https://auth.example.com/realms/test-realm/protocol/openid-connect/token'

function createTokenResponse(
  overrides: Partial<{ access_token: string; expires_in: number; token_type: string }> = {},
) {
  return {
    access_token: 'test-token-123',
    expires_in: 300,
    token_type: 'Bearer',
    ...overrides,
  }
}

function mockFetchSuccess(
  overrides: Partial<{ access_token: string; expires_in: number; token_type: string }> = {},
) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(createTokenResponse(overrides)),
  })
}

function mockFetchError(status: number, body: object | string = {}) {
  const isJson = typeof body === 'object'
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: isJson ? () => Promise.resolve(body) : () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  })
}

describe('KeycloakClientCredentialsProvider', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    vi.useFakeTimers()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('configuration validation', () => {
    it('throws ConfigurationError when keycloakUrl is missing', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, keycloakUrl: '' }),
      ).toThrow(ConfigurationError)
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, keycloakUrl: '' }),
      ).toThrow('keycloakUrl is required')
    })

    it('throws ConfigurationError when keycloakUrl is not a string', () => {
      expect(
        () =>
          new KeycloakClientCredentialsProvider({
            ...VALID_OPTIONS,
            keycloakUrl: 123 as unknown as string,
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError when keycloakUrl is not a valid URL', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, keycloakUrl: 'not-a-url' }),
      ).toThrow(ConfigurationError)
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, keycloakUrl: 'not-a-url' }),
      ).toThrow('Invalid keycloakUrl')
    })

    it('throws ConfigurationError when realm is missing', () => {
      expect(() => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, realm: '' })).toThrow(
        ConfigurationError,
      )
      expect(() => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, realm: '' })).toThrow(
        'realm is required',
      )
    })

    it('throws ConfigurationError when realm is not a string', () => {
      expect(
        () =>
          new KeycloakClientCredentialsProvider({
            ...VALID_OPTIONS,
            realm: null as unknown as string,
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError when clientId is missing', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, clientId: '' }),
      ).toThrow(ConfigurationError)
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, clientId: '' }),
      ).toThrow('clientId is required')
    })

    it('throws ConfigurationError when clientId is not a string', () => {
      expect(
        () =>
          new KeycloakClientCredentialsProvider({
            ...VALID_OPTIONS,
            clientId: undefined as unknown as string,
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError when clientSecret is missing', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, clientSecret: '' }),
      ).toThrow(ConfigurationError)
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, clientSecret: '' }),
      ).toThrow('clientSecret is required')
    })

    it('throws ConfigurationError when clientSecret is not a string', () => {
      expect(
        () =>
          new KeycloakClientCredentialsProvider({
            ...VALID_OPTIONS,
            clientSecret: 42 as unknown as string,
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError when refreshBufferMs is negative', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, refreshBufferMs: -1 }),
      ).toThrow(ConfigurationError)
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, refreshBufferMs: -1 }),
      ).toThrow('refreshBufferMs must be a non-negative number')
    })

    it('throws ConfigurationError when refreshBufferMs is not a number', () => {
      expect(
        () =>
          new KeycloakClientCredentialsProvider({
            ...VALID_OPTIONS,
            refreshBufferMs: 'fast' as unknown as number,
          }),
      ).toThrow(ConfigurationError)
    })

    it('allows refreshBufferMs of zero', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, refreshBufferMs: 0 }),
      ).not.toThrow()
    })

    it('throws ConfigurationError when timeoutMs is zero', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, timeoutMs: 0 }),
      ).toThrow(ConfigurationError)
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, timeoutMs: 0 }),
      ).toThrow('timeoutMs must be a positive number')
    })

    it('throws ConfigurationError when timeoutMs is negative', () => {
      expect(
        () => new KeycloakClientCredentialsProvider({ ...VALID_OPTIONS, timeoutMs: -100 }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError when timeoutMs is not a number', () => {
      expect(
        () =>
          new KeycloakClientCredentialsProvider({
            ...VALID_OPTIONS,
            timeoutMs: '10s' as unknown as number,
          }),
      ).toThrow(ConfigurationError)
    })

    it('strips trailing slashes from keycloakUrl', () => {
      global.fetch = mockFetchSuccess()
      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        keycloakUrl: 'https://auth.example.com///',
      })

      vi.setSystemTime(0)
      provider.getToken()

      expect(global.fetch).toHaveBeenCalledWith(TOKEN_ENDPOINT, expect.any(Object))
    })

    it('constructs correct token endpoint URL', () => {
      global.fetch = mockFetchSuccess()
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      provider.getToken()

      expect(global.fetch).toHaveBeenCalledWith(
        'https://auth.example.com/realms/test-realm/protocol/openid-connect/token',
        expect.any(Object),
      )
    })
  })

  describe('successful token fetch', () => {
    it('fetches token from Keycloak and returns access_token', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'my-jwt-token', expires_in: 300 })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      const token = await provider.getToken()

      expect(token).toBe('my-jwt-token')
    })

    it('sends correct request headers and body', async () => {
      global.fetch = mockFetchSuccess()
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await provider.getToken()

      expect(global.fetch).toHaveBeenCalledWith(
        TOKEN_ENDPOINT,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }),
      )

      const call = vi.mocked(global.fetch).mock.calls[0]
      const body = call[1]?.body as URLSearchParams
      expect(body.get('grant_type')).toBe('client_credentials')
      expect(body.get('client_id')).toBe('test-client')
      expect(body.get('client_secret')).toBe('test-secret')
    })
  })

  describe('token caching', () => {
    it('returns cached token on subsequent calls within validity period', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'cached-token', expires_in: 300 })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      const token1 = await provider.getToken()
      const token2 = await provider.getToken()
      const token3 = await provider.getToken()

      expect(token1).toBe('cached-token')
      expect(token2).toBe('cached-token')
      expect(token3).toBe('cached-token')
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('returns cached token until refresh buffer is reached', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'token-v1', expires_in: 300 })
      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 30_000, // 30 seconds
      })

      // t=0: fetch token (expires at 300s)
      vi.setSystemTime(0)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // t=100s: still valid (300s - 100s = 200s > 30s buffer)
      vi.setSystemTime(100_000)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // t=250s: still valid (300s - 250s = 50s > 30s buffer)
      vi.setSystemTime(250_000)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // t=269s: still valid (300s - 269s = 31s > 30s buffer)
      vi.setSystemTime(269_000)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('caches token based on expires_in from response', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'short-lived', expires_in: 60 })
      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 10_000,
      })

      // t=0: fetch token (expires at 60s)
      vi.setSystemTime(0)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // t=40s: still valid (60s - 40s = 20s > 10s buffer)
      vi.setSystemTime(40_000)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // t=51s: needs refresh (60s - 51s = 9s < 10s buffer)
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'new-token', expires_in: 60 }),
      } as Response)
      vi.setSystemTime(51_000)
      await provider.getToken()
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('token refresh', () => {
    it('fetches new token when within refresh buffer', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-v1', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-v2', expires_in: 300 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 30_000,
      })

      // t=0: fetch first token
      vi.setSystemTime(0)
      const token1 = await provider.getToken()
      expect(token1).toBe('token-v1')
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // t=271s: within refresh buffer (300s - 271s = 29s < 30s)
      vi.setSystemTime(271_000)
      const token2 = await provider.getToken()
      expect(token2).toBe('token-v2')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('fetches new token when token has expired', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-v1', expires_in: 60 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-v2', expires_in: 60 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 0,
      })

      // t=0: fetch first token
      vi.setSystemTime(0)
      const token1 = await provider.getToken()
      expect(token1).toBe('token-v1')

      // t=61s: token expired
      vi.setSystemTime(61_000)
      const token2 = await provider.getToken()
      expect(token2).toBe('token-v2')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('uses new token after refresh for subsequent calls', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'old-token', expires_in: 100 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'new-token', expires_in: 100 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 10_000,
      })

      vi.setSystemTime(0)
      await provider.getToken()

      // Trigger refresh
      vi.setSystemTime(91_000)
      const refreshedToken = await provider.getToken()
      expect(refreshedToken).toBe('new-token')

      // Subsequent call returns new cached token
      vi.setSystemTime(92_000)
      const cachedToken = await provider.getToken()
      expect(cachedToken).toBe('new-token')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('concurrent request coalescing', () => {
    it('coalesces multiple concurrent getToken calls into single fetch', async () => {
      let resolvePromise: (value: Response) => void
      const fetchPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve
      })
      global.fetch = vi.fn().mockReturnValue(fetchPromise)

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)

      // Start multiple concurrent requests
      const promise1 = provider.getToken()
      const promise2 = provider.getToken()
      const promise3 = provider.getToken()

      // Only one fetch should have been made
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Resolve the fetch
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ access_token: 'shared-token', expires_in: 300 }),
      } as Response)

      // All promises should resolve to the same token
      const [token1, token2, token3] = await Promise.all([promise1, promise2, promise3])
      expect(token1).toBe('shared-token')
      expect(token2).toBe('shared-token')
      expect(token3).toBe('shared-token')
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('allows new fetch after previous completes', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-1', expires_in: 10 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-2', expires_in: 10 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 0,
      })

      vi.setSystemTime(0)
      const token1 = await provider.getToken()
      expect(token1).toBe('token-1')

      // Token expired, should fetch again
      vi.setSystemTime(11_000)
      const token2 = await provider.getToken()
      expect(token2).toBe('token-2')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('clears pending request after fetch completes (success)', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'token', expires_in: 10 })
      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 0,
      })

      vi.setSystemTime(0)
      await provider.getToken()

      // Expire the token
      vi.setSystemTime(11_000)
      await provider.getToken()

      // Should have made 2 separate fetches
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('clears pending request after fetch fails', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'recovered', expires_in: 300 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)

      // First call fails
      await expect(provider.getToken()).rejects.toThrow(AuthError)

      // Second call should make a new fetch (not reuse failed pending)
      const token = await provider.getToken()
      expect(token).toBe('recovered')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('HTTP error handling', () => {
    it('throws AuthError with message on 401 Unauthorized', async () => {
      global.fetch = mockFetchError(401, {
        error: 'invalid_client',
        error_description: 'Invalid client credentials',
      })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Invalid client credentials')
    })

    it('throws AuthError with error field when error_description missing', async () => {
      global.fetch = mockFetchError(401, { error: 'unauthorized_client' })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(
        'Invalid client credentials: unauthorized_client',
      )
    })

    it('throws AuthError on 400 Bad Request', async () => {
      global.fetch = mockFetchError(400, { error_description: 'Missing grant_type' })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Invalid token request: Missing grant_type')
    })

    it('throws AuthError on 500 Server Error', async () => {
      global.fetch = mockFetchError(500, { error: 'internal_error' })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Keycloak server error (500)')
    })

    it('throws AuthError on 502 Bad Gateway', async () => {
      global.fetch = mockFetchError(502, 'Bad Gateway')
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Keycloak server error (502)')
    })

    it('throws AuthError on 503 Service Unavailable', async () => {
      global.fetch = mockFetchError(503, {})
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow('Keycloak server error (503)')
    })

    it('throws AuthError on other HTTP errors (e.g., 403)', async () => {
      global.fetch = mockFetchError(403, { error_description: 'Forbidden' })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Token request failed (403): Forbidden')
    })

    it('handles non-JSON error response body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('Internal Server Error'),
      })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(
        'Keycloak server error (500): Internal Server Error',
      )
    })

    it('handles error response with unreadable body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.reject(new Error('body stream already read')),
      })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow('Keycloak server error (500)')
    })
  })

  describe('invalid response handling', () => {
    it('throws AuthError when access_token is missing', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ expires_in: 300 }),
      })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Token response missing access_token')
    })

    it('throws AuthError when access_token is empty string', async () => {
      global.fetch = mockFetchSuccess({ access_token: '', expires_in: 300 })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow('Token response missing access_token')
    })

    it('throws AuthError when expires_in is missing', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token' }),
      })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Token response has invalid expires_in')
    })

    it('throws AuthError when expires_in is zero', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'token', expires_in: 0 })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow('Token response has invalid expires_in')
    })

    it('throws AuthError when expires_in is negative', async () => {
      global.fetch = mockFetchSuccess({ access_token: 'token', expires_in: -100 })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow('Token response has invalid expires_in')
    })

    it('throws AuthError when expires_in is not a number', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token', expires_in: '300' }),
      })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow('Token response has invalid expires_in')
    })
  })

  describe('network error handling', () => {
    it('throws AuthError on network failure (TypeError)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow(
        'Network error fetching token: fetch failed',
      )
    })

    it('throws AuthError on DNS resolution failure', async () => {
      global.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND auth.example.com'))
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Network error fetching token')
    })

    it('throws AuthError on connection refused', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('connect ECONNREFUSED'))
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(
        'Network error fetching token: connect ECONNREFUSED',
      )
    })

    it('wraps unknown errors in AuthError', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Something unexpected'))
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow(
        'Failed to fetch token: Something unexpected',
      )
    })

    it('handles non-Error thrown values', async () => {
      global.fetch = vi.fn().mockRejectedValue('string error')
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow(AuthError)
      await expect(provider.getToken()).rejects.toThrow('Failed to fetch token: Unknown error')
    })
  })

  describe('timeout handling', () => {
    it('throws AuthError when request times out', async () => {
      // Simulate timeout by having fetch reject with AbortError after being aborted
      const abortError = new Error('AbortError')
      abortError.name = 'AbortError'

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          const signal = options?.signal as AbortSignal
          if (signal) {
            signal.addEventListener('abort', () => reject(abortError))
          }
        })
      })

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        timeoutMs: 100,
      })

      vi.setSystemTime(0)

      // Capture rejection immediately to avoid unhandled rejection
      let caughtError: Error | null = null
      const promise = provider.getToken().catch((err) => {
        caughtError = err
      })

      // Advance time past timeout
      await vi.advanceTimersByTimeAsync(101)
      await promise

      expect(caughtError).toBeInstanceOf(AuthError)
      expect(caughtError!.message).toContain('timed out after 100ms')
    })

    it('uses default timeout of 10000ms', async () => {
      const abortError = new Error('AbortError')
      abortError.name = 'AbortError'

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          const signal = options?.signal as AbortSignal
          if (signal) {
            signal.addEventListener('abort', () => reject(abortError))
          }
        })
      })

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)

      // Capture rejection immediately to avoid unhandled rejection
      let caughtError: Error | null = null
      const promise = provider.getToken().catch((err) => {
        caughtError = err
      })

      // Advance time past default timeout
      await vi.advanceTimersByTimeAsync(10001)
      await promise

      expect(caughtError).toBeInstanceOf(AuthError)
      expect(caughtError!.message).toContain('timed out after 10000ms')
    })

    it('clears timeout when fetch succeeds', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      global.fetch = mockFetchSuccess()
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await provider.getToken()

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('clears timeout when fetch fails', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Network error'))
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow()

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })
  })

  describe('AbortSignal handling', () => {
    it('throws AuthError when external signal is aborted', async () => {
      const abortError = new Error('AbortError')
      abortError.name = 'AbortError'

      global.fetch = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          const signal = options?.signal as AbortSignal
          if (signal) {
            signal.addEventListener('abort', () => reject(abortError))
          }
        })
      })

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)
      const controller = new AbortController()

      vi.setSystemTime(0)
      const promise = provider.getToken(controller.signal)

      controller.abort()

      await expect(promise).rejects.toThrow(AuthError)
      await expect(promise).rejects.toThrow('Token request was cancelled')
    })

    it('throws AuthError with cancelled message when signal aborted before timeout', async () => {
      const abortError = new Error('AbortError')
      abortError.name = 'AbortError'
      global.fetch = vi.fn().mockRejectedValue(abortError)

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        timeoutMs: 30000,
      })
      const controller = new AbortController()
      controller.abort()

      vi.setSystemTime(0)
      await expect(provider.getToken(controller.signal)).rejects.toThrow(
        'Token request was cancelled',
      )
    })

    it('passes combined signal to fetch', async () => {
      global.fetch = mockFetchSuccess()
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)
      const controller = new AbortController()

      vi.setSystemTime(0)
      await provider.getToken(controller.signal)

      expect(global.fetch).toHaveBeenCalledWith(
        TOKEN_ENDPOINT,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      )
    })

    it('aborts on external signal even if timeout not reached', async () => {
      let fetchReject: (error: Error) => void
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            fetchReject = reject
          }),
      )

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        timeoutMs: 60000,
      })
      const controller = new AbortController()

      vi.setSystemTime(0)
      const promise = provider.getToken(controller.signal)

      // Abort externally
      controller.abort()
      const abortError = new Error('AbortError')
      abortError.name = 'AbortError'
      fetchReject!(abortError)

      await expect(promise).rejects.toThrow('Token request was cancelled')
    })
  })

  describe('clearCache', () => {
    it('clears cached token forcing next getToken to fetch', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-1', expires_in: 300 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-2', expires_in: 300 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      const token1 = await provider.getToken()
      expect(token1).toBe('token-1')
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Clear cache
      provider.clearCache()

      // Next call should fetch again
      const token2 = await provider.getToken()
      expect(token2).toBe('token-2')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('can be called multiple times safely', () => {
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      expect(() => {
        provider.clearCache()
        provider.clearCache()
        provider.clearCache()
      }).not.toThrow()
    })

    it('does not affect pending request', async () => {
      let resolvePromise: (value: Response) => void
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve
          }),
      )

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      const promise = provider.getToken()

      // Clear cache while request is pending
      provider.clearCache()

      // Resolve the pending request
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve({ access_token: 'pending-token', expires_in: 300 }),
      } as Response)

      const token = await promise
      expect(token).toBe('pending-token')
    })
  })

  describe('edge cases', () => {
    it('handles very short token expiry', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'short-token', expires_in: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'new-token', expires_in: 300 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 0,
      })

      vi.setSystemTime(0)
      const token1 = await provider.getToken()
      expect(token1).toBe('short-token')

      // Advance past 1 second expiry
      vi.setSystemTime(2000)
      const token2 = await provider.getToken()
      expect(token2).toBe('new-token')
    })

    it('handles token expiry exactly at refresh buffer boundary', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-1', expires_in: 100 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'token-2', expires_in: 100 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider({
        ...VALID_OPTIONS,
        refreshBufferMs: 30_000,
      })

      // t=0: fetch first token (expiresAt = 100s)
      vi.setSystemTime(0)
      await provider.getToken()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // t=69s: still valid (100s - 69s = 31s > 30s buffer)
      // Condition: 69000 < 100000 - 30000 = 69000 < 70000 = true (cached)
      vi.setSystemTime(69_000)
      await provider.getToken()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // t=70s: exactly at boundary (100s - 70s = 30s = buffer)
      // Condition: 70000 < 70000 = false (needs refresh)
      vi.setSystemTime(70_000)
      await provider.getToken()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('preserves AuthError type through the call stack', async () => {
      global.fetch = mockFetchError(401, { error_description: 'Bad credentials' })
      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)

      try {
        await provider.getToken()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError)
        expect((error as AuthError).name).toBe('AuthError')
      }
    })

    it('does not cache token after error', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'recovered', expires_in: 300 }),
        })
      global.fetch = fetchMock

      const provider = new KeycloakClientCredentialsProvider(VALID_OPTIONS)

      vi.setSystemTime(0)
      await expect(provider.getToken()).rejects.toThrow()

      // Should try again, not return cached error
      const token = await provider.getToken()
      expect(token).toBe('recovered')
    })
  })
})
