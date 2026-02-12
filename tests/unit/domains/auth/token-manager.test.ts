import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbortOperationError, AuthError } from '../../../../src/core/errors.ts'
import { TokenManager } from '../../../../src/domains/auth/token-manager.ts'
import { createMockAuthApi } from '../../../helpers/index.ts'

describe('TokenManager', () => {
  let authApi: ReturnType<typeof createMockAuthApi>
  let tokenManager: TokenManager

  beforeEach(() => {
    vi.useFakeTimers()
    authApi = createMockAuthApi()
    tokenManager = new TokenManager({
      authApi,
      refreshBufferMs: 30_000,
      retryAttempts: 3,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 2000,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('getToken - no token available', () => {
    it('throws AuthError when no token is set', async () => {
      await expect(tokenManager.getToken()).rejects.toThrow(AuthError)
      await expect(tokenManager.getToken()).rejects.toThrow('Call bootstrap() first')
    })
  })

  describe('getToken - cached token', () => {
    it('returns cached token when valid and not near expiry', async () => {
      tokenManager.setToken('valid-token', 3600) // 1 hour

      const token = await tokenManager.getToken()

      expect(token).toBe('valid-token')
      expect(authApi.refreshToken).not.toHaveBeenCalled()
    })

    it('returns cached token multiple times without refresh', async () => {
      tokenManager.setToken('valid-token', 3600)

      const token1 = await tokenManager.getToken()
      const token2 = await tokenManager.getToken()
      const token3 = await tokenManager.getToken()

      expect(token1).toBe('valid-token')
      expect(token2).toBe('valid-token')
      expect(token3).toBe('valid-token')
      expect(authApi.refreshToken).not.toHaveBeenCalled()
    })
  })

  describe('getToken - proactive refresh (non-blocking)', () => {
    it('returns old token immediately when within refresh buffer', async () => {
      tokenManager.setToken('old-token', 25) // 25 seconds (within 30s buffer)
      vi.mocked(authApi.refreshToken).mockResolvedValueOnce({
        accessToken: 'new-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      })

      const token = await tokenManager.getToken()

      // Returns old token immediately — refresh happens in background
      expect(token).toBe('old-token')
    })

    it('triggers background refresh when within refresh buffer', async () => {
      tokenManager.setToken('old-token', 25)
      vi.mocked(authApi.refreshToken).mockResolvedValueOnce({
        accessToken: 'new-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      })

      await tokenManager.getToken()

      // Let background refresh complete
      await vi.advanceTimersByTimeAsync(100)

      expect(authApi.refreshToken).toHaveBeenCalledTimes(1)

      // Next call should get the refreshed token
      const token2 = await tokenManager.getToken()
      expect(token2).toBe('new-token')
    })

    it('triggers refresh and blocks when token is fully expired', async () => {
      tokenManager.setToken('old-token', 3600)
      vi.advanceTimersByTime(3600 * 1000 + 1000) // Advance past expiry

      vi.mocked(authApi.refreshToken).mockResolvedValueOnce({
        accessToken: 'new-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      })

      const token = await tokenManager.getToken()

      expect(token).toBe('new-token')
      expect(authApi.refreshToken).toHaveBeenCalledTimes(1)
    })

    it('warns but does not throw on background refresh failures when token is not expired', async () => {
      tokenManager.setToken('old-token', 25)
      vi.mocked(authApi.refreshToken)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))

      const token = await tokenManager.getToken()
      expect(token).toBe('old-token')

      // Let background refresh complete (with failures)
      await vi.advanceTimersByTimeAsync(5000)

      // No crash, no thrown error
      expect(authApi.refreshToken).toHaveBeenCalled()
    })
  })

  describe('getToken - retry logic', () => {
    it('retries on transient failure and succeeds', async () => {
      tokenManager.setToken('old-token', 3600)
      vi.advanceTimersByTime(3600 * 1000 + 1000) // Fully expired

      vi.mocked(authApi.refreshToken)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          accessToken: 'new-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
        })

      const tokenPromise = tokenManager.getToken()

      // First retry delay
      await vi.advanceTimersByTimeAsync(150)
      // Second retry delay
      await vi.advanceTimersByTimeAsync(300)

      const token = await tokenPromise

      expect(token).toBe('new-token')
      expect(authApi.refreshToken).toHaveBeenCalledTimes(3)
    })

    it('does not retry on AuthError (invalid credentials)', async () => {
      tokenManager.setToken('old-token', 3600)
      vi.advanceTimersByTime(3600 * 1000 + 1000) // Fully expired

      vi.mocked(authApi.refreshToken).mockRejectedValueOnce(new AuthError('Invalid credentials'))

      await expect(tokenManager.getToken()).rejects.toThrow(AuthError)
      expect(authApi.refreshToken).toHaveBeenCalledTimes(1)
    })

    it('throws when refresh fails and token is fully expired', async () => {
      tokenManager.setToken('old-token', 3600)
      vi.advanceTimersByTime(3600 * 1000 + 1000) // Past expiry

      vi.mocked(authApi.refreshToken)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))

      // Handle the promise immediately to prevent unhandled rejection
      let result: string | undefined
      let caughtError: Error | undefined
      const tokenPromise = tokenManager.getToken().then(
        (token) => {
          result = token
        },
        (err) => {
          caughtError = err
        },
      )

      // Advance timers to complete all retries
      await vi.advanceTimersByTimeAsync(1200)
      await tokenPromise

      expect(result).toBeUndefined()
      expect(caughtError).toBeInstanceOf(Error)
      expect(caughtError?.message).toBe('Network error')
    })
  })

  describe('getToken - request coalescing', () => {
    it('coalesces concurrent refresh requests into single API call', async () => {
      tokenManager.setToken('old-token', 3600)
      vi.advanceTimersByTime(3600 * 1000 + 1000) // Fully expired

      vi.mocked(authApi.refreshToken).mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 100))
        return {
          accessToken: 'new-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
        }
      })

      // Start multiple concurrent requests
      const promise1 = tokenManager.getToken()
      const promise2 = tokenManager.getToken()
      const promise3 = tokenManager.getToken()

      await vi.advanceTimersByTimeAsync(150)

      const [token1, token2, token3] = await Promise.all([promise1, promise2, promise3])

      expect(token1).toBe('new-token')
      expect(token2).toBe('new-token')
      expect(token3).toBe('new-token')
      // Only one API call despite 3 concurrent requests
      expect(authApi.refreshToken).toHaveBeenCalledTimes(1)
    })

    it('allows subsequent refresh after coalesced refresh completes', async () => {
      tokenManager.setToken('old-token', 3600)
      vi.advanceTimersByTime(3600 * 1000 + 1000) // Fully expired

      vi.mocked(authApi.refreshToken)
        .mockResolvedValueOnce({
          accessToken: 'token-1',
          tokenType: 'Bearer',
          expiresIn: 15, // Short expiry to trigger another refresh
        })
        .mockResolvedValueOnce({
          accessToken: 'token-2',
          tokenType: 'Bearer',
          expiresIn: 3600,
        })

      const token1 = await tokenManager.getToken()
      expect(token1).toBe('token-1')

      // Advance time so new token is fully expired
      vi.advanceTimersByTime(16_000)

      const token2 = await tokenManager.getToken()
      expect(token2).toBe('token-2')

      expect(authApi.refreshToken).toHaveBeenCalledTimes(2)
    })
  })

  describe('getToken - abort signal', () => {
    it('throws when signal is already aborted', async () => {
      tokenManager.setToken('old-token', 10)

      const controller = new AbortController()
      controller.abort()

      await expect(tokenManager.getToken(controller.signal)).rejects.toThrow('aborted')
    })
  })

  describe('onAuthFailure', () => {
    it('after setToken + onAuthFailure, getToken attempts refresh instead of returning cached', async () => {
      tokenManager.setToken('valid-token', 3600)

      tokenManager.onAuthFailure()

      vi.mocked(authApi.refreshToken).mockResolvedValueOnce({
        accessToken: 'refreshed-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      })

      const token = await tokenManager.getToken()
      expect(token).toBe('refreshed-token')
      expect(authApi.refreshToken).toHaveBeenCalledTimes(1)
    })

    it('without prior setToken, onAuthFailure + getToken still throws bootstrap error', async () => {
      tokenManager.onAuthFailure()
      await expect(tokenManager.getToken()).rejects.toThrow(AuthError)
      await expect(tokenManager.getToken()).rejects.toThrow('Call bootstrap() first')
    })
  })

  describe('setToken', () => {
    it('stores token with correct expiry calculation', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      tokenManager.setToken('my-token', 3600)

      // Token should be valid immediately
      const token = await tokenManager.getToken()
      expect(token).toBe('my-token')

      // Advance to just before expiry buffer
      vi.advanceTimersByTime(3600 * 1000 - 30_000 - 1000)
      const token2 = await tokenManager.getToken()
      expect(token2).toBe('my-token')
      expect(authApi.refreshToken).not.toHaveBeenCalled()
    })
  })
})

describe('TokenManager - refresh timeout', () => {
  let authApi: ReturnType<typeof createMockAuthApi>

  beforeEach(() => {
    vi.useFakeTimers()
    authApi = createMockAuthApi()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('bounds refresh to refreshTimeoutMs when token is fully expired', async () => {
    const tokenManager = new TokenManager({
      authApi,
      refreshTimeoutMs: 500,
      retryAttempts: 3,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 2000,
    })

    tokenManager.setToken('old-token', 3600)
    vi.advanceTimersByTime(3600 * 1000 + 1000) // Fully expired

    // Each refresh call hangs until the signal is aborted
    vi.mocked(authApi.refreshToken).mockImplementation(
      ({ signal }: { signal?: AbortSignal } = {}) =>
        new Promise((_resolve, reject) => {
          const onAbort = () => reject(new Error('aborted'))
          if (signal?.aborted) return reject(new Error('aborted'))
          signal?.addEventListener('abort', onAbort, { once: true })
        }),
    )

    let caughtError: Error | undefined
    const tokenPromise = tokenManager.getToken().catch((err) => {
      caughtError = err
    })

    // Advance past the 500ms refresh timeout
    await vi.advanceTimersByTimeAsync(600)
    await tokenPromise

    expect(caughtError).toBeInstanceOf(AbortOperationError)
  })

  it('uses default refreshTimeoutMs of 5000ms', () => {
    const tokenManager = new TokenManager({ authApi })
    // Access the private field via bracket notation for testing
    expect((tokenManager as unknown as { refreshTimeoutMs: number }).refreshTimeoutMs).toBe(5000)
  })
})

describe('TokenManager - custom configuration', () => {
  it('respects custom refresh buffer', async () => {
    const authApi = createMockAuthApi()
    const tokenManager = new TokenManager({
      authApi,
      refreshBufferMs: 60_000, // 60 second buffer
    })

    // Token expires in 50 seconds - within 60s buffer but not fully expired
    tokenManager.setToken('old-token', 50)

    vi.mocked(authApi.refreshToken).mockResolvedValueOnce({
      accessToken: 'new-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    })

    // Non-blocking: returns old token immediately, triggers background refresh
    const token = await tokenManager.getToken()
    expect(token).toBe('old-token')
    // Background refresh was triggered
    expect(authApi.refreshToken).toHaveBeenCalledTimes(1)
  })

  it('respects custom retry attempts', async () => {
    vi.useFakeTimers()

    const authApi = createMockAuthApi()
    const tokenManager = new TokenManager({
      authApi,
      retryAttempts: 5,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 100,
    })

    tokenManager.setToken('old-token', 3600)
    vi.advanceTimersByTime(3600 * 1000 + 1000) // Fully expired

    vi.mocked(authApi.refreshToken)
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'))
      .mockRejectedValueOnce(new Error('fail 4'))
      .mockResolvedValueOnce({
        accessToken: 'new-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      })

    const tokenPromise = tokenManager.getToken()

    // Advance through all retries
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200)
    }

    const token = await tokenPromise
    expect(token).toBe('new-token')
    expect(authApi.refreshToken).toHaveBeenCalledTimes(5)

    vi.useRealTimers()
  })
})
