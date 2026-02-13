import { AbortOperationError, AuthError } from '../../core/errors.ts'
import { logger } from '../../core/logger.ts'
import { calculateBackoff, sleep } from '../../core/retry.ts'
import type { TAuthProvider } from '../../core/types.ts'
import { createTimeoutSignal } from '../../core/utils.ts'
import type { AuthApi } from './auth.api.ts'

const DEFAULT_REFRESH_BUFFER_MS = 30_000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 100
const DEFAULT_RETRY_MAX_DELAY_MS = 2000
const DEFAULT_REFRESH_TIMEOUT_MS = 5_000

export type TTokenManagerOptions = {
  authApi: AuthApi
  /** How many seconds before expiry to trigger refresh (default: 30) */
  refreshBufferMs?: number
  /** Number of retry attempts for token refresh (default: 3) */
  retryAttempts?: number
  /** Base delay in ms for exponential backoff (default: 100) */
  retryBaseDelayMs?: number
  /** Maximum delay in ms for exponential backoff (default: 2000) */
  retryMaxDelayMs?: number
  /** Maximum total time in ms for a coalesced refresh attempt (default: 5000) */
  refreshTimeoutMs?: number
}

type TCachedToken = {
  token: string
  expiresAtMs: number
}

/**
 * Manages access token lifecycle including caching, auto-refresh, and retry logic.
 *
 * Features:
 * - Proactive refresh before token expiry (30s buffer by default)
 * - Retry with exponential backoff on refresh failures
 * - Fallback to existing token if refresh fails and token not fully expired
 * - Request coalescing for concurrent refresh attempts
 * - Each caller gets independent abort handling
 */
export class TokenManager implements TAuthProvider {
  private readonly authApi: AuthApi
  private readonly refreshBufferMs: number
  private readonly retryAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly retryMaxDelayMs: number
  private readonly refreshTimeoutMs: number

  private cachedToken: TCachedToken | null = null
  private pendingRefresh: Promise<string> | null = null
  private hasBootstrapped = false

  constructor(options: TTokenManagerOptions) {
    this.authApi = options.authApi
    this.refreshBufferMs = options.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS
    this.retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS
  }

  setToken(accessToken: string, expiresIn: number): void {
    this.hasBootstrapped = true
    this.cachedToken = {
      token: accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000,
    }
  }

  async getAuthHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
    const token = await this.getToken(signal)
    return { authorization: `Bearer ${token}` }
  }

  onAuthFailure(): void {
    this.clearCache()
  }

  /**
   * Returns a valid access token, refreshing if near expiry.
   *
   * - If token is valid and not near expiry, returns immediately
   * - If token needs proactive refresh but is not expired, returns old token and refreshes in background
   * - If token is fully expired or missing, blocks until refresh completes
   */
  async getToken(signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new AbortOperationError('Token refresh aborted')
    }

    if (this.cachedToken && !this.needsRefresh()) {
      return this.cachedToken.token
    }

    if (!this.cachedToken) {
      if (!this.hasBootstrapped) {
        throw new AuthError('No access token available. Call bootstrap() first.')
      }
      return await this.refreshWithCoalescing(signal)
    }

    if (!this.isExpired()) {
      this.startBackgroundRefresh()
      return this.cachedToken.token
    }

    return await this.refreshWithCoalescing(signal)
  }

  private startBackgroundRefresh(): void {
    if (this.pendingRefresh) return

    const { signal, cleanup } = createTimeoutSignal(this.refreshTimeoutMs)
    this.pendingRefresh = this.doRefreshWithRetry(signal).finally(() => {
      cleanup()
      this.pendingRefresh = null
    })
    this.pendingRefresh.catch((error) => {
      logger.warn('Background token refresh failed:', error)
    })
  }

  private async refreshWithCoalescing(signal?: AbortSignal): Promise<string> {
    if (!this.pendingRefresh) {
      const { signal: timeoutSignal, cleanup } = createTimeoutSignal(this.refreshTimeoutMs)

      this.pendingRefresh = this.doRefreshWithRetry(timeoutSignal).finally(() => {
        cleanup()
        this.pendingRefresh = null
      })
      // Prevent unhandled rejection if all callers bail via abort
      this.pendingRefresh.catch(() => {})
    }

    if (signal?.aborted) {
      throw new AbortOperationError('Token refresh aborted')
    }

    if (!signal) {
      return await this.pendingRefresh
    }

    let abortHandler: (() => void) | undefined
    try {
      return await Promise.race([
        this.pendingRefresh,
        new Promise<never>((_, reject) => {
          const onAbort = () => reject(new AbortOperationError('Token refresh aborted'))
          if (signal.aborted) {
            onAbort()
            return
          }
          abortHandler = onAbort
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
    } finally {
      if (abortHandler) signal.removeEventListener('abort', abortHandler)
    }
  }

  private async doRefreshWithRetry(signal?: AbortSignal): Promise<string> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      if (signal?.aborted) {
        throw new AbortOperationError('Token refresh aborted')
      }

      try {
        const response = await this.authApi.refreshToken({ signal })

        this.cachedToken = {
          token: response.accessToken,
          expiresAtMs: Date.now() + response.expiresIn * 1000,
        }

        return this.cachedToken.token
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (error instanceof AuthError) throw error
        if (signal?.aborted) throw new AbortOperationError('Token refresh aborted')

        if (attempt < this.retryAttempts - 1) {
          const delay = calculateBackoff(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs)
          await sleep(delay, signal)
        }
      }
    }

    throw lastError ?? new AuthError('Token refresh failed after retries')
  }

  private needsRefresh(): boolean {
    if (!this.cachedToken) return true
    return Date.now() >= this.cachedToken.expiresAtMs - this.refreshBufferMs
  }

  private isExpired(): boolean {
    if (!this.cachedToken) return true
    return Date.now() >= this.cachedToken.expiresAtMs
  }

  private clearCache(): void {
    this.cachedToken = null
  }
}
