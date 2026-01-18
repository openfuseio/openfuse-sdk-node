import { AuthError } from '../../core/errors.ts'
import type { TTokenProvider } from '../../core/types.ts'
import type { AuthApi } from './auth.api.ts'

const DEFAULT_REFRESH_BUFFER_MS = 30_000
const DEFAULT_RETRY_ATTEMPTS = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 100
const DEFAULT_RETRY_MAX_DELAY_MS = 2000

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
export class TokenManager implements TTokenProvider {
  private readonly authApi: AuthApi
  private readonly refreshBufferMs: number
  private readonly retryAttempts: number
  private readonly retryBaseDelayMs: number
  private readonly retryMaxDelayMs: number

  private cachedToken: TCachedToken | null = null
  private pendingRefresh: Promise<string> | null = null

  constructor(options: TTokenManagerOptions) {
    this.authApi = options.authApi
    this.refreshBufferMs = options.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS
    this.retryAttempts = options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
  }

  /**
   * Store a token received from bootstrap or refresh.
   */
  setToken(accessToken: string, expiresIn: number): void {
    this.cachedToken = {
      token: accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000,
    }
  }

  /**
   * Returns a valid access token, refreshing if near expiry.
   *
   * Behavior:
   * - If token is valid and not near expiry, returns immediately
   * - If token needs refresh, attempts refresh with retry logic
   * - If refresh fails but token isn't fully expired, returns old token
   * - If refresh fails and token is expired, throws AuthError
   */
  async getToken(signal?: AbortSignal): Promise<string> {
    // Check if already aborted
    if (signal?.aborted) {
      throw new AuthError('Token refresh aborted')
    }

    // If token is valid and not near expiry, return it
    if (this.cachedToken && !this.needsRefresh()) {
      return this.cachedToken.token
    }

    // No token at all - need to bootstrap first
    if (!this.cachedToken) {
      throw new AuthError('No access token available. Call bootstrap() first.')
    }

    // Token needs refresh - try to refresh with coalescing
    try {
      return await this.refreshWithCoalescing(signal)
    } catch (refreshError) {
      // Don't fall back on auth errors - credentials are invalid
      if (refreshError instanceof AuthError) {
        throw refreshError
      }

      // Refresh failed - fallback to old token if not fully expired
      if (this.cachedToken && !this.isExpired()) {
        return this.cachedToken.token
      }

      // Token is fully expired and refresh failed
      throw refreshError
    }
  }

  /**
   * Coalesces concurrent refresh requests into a single API call.
   * Each caller can still abort independently without affecting others.
   */
  private async refreshWithCoalescing(signal?: AbortSignal): Promise<string> {
    // If a refresh is already in progress, wait for it
    if (this.pendingRefresh) {
      try {
        return await this.pendingRefresh
      } catch {
        // If the shared refresh failed, try our own refresh
        // (the original caller's abort might have caused the failure)
        return await this.doRefreshWithRetry(signal)
      }
    }

    // Start a new refresh (without abort signal to avoid one caller aborting for all)
    this.pendingRefresh = this.doRefreshWithRetry()

    try {
      return await this.pendingRefresh
    } finally {
      this.pendingRefresh = null
    }
  }

  /**
   * Performs token refresh with exponential backoff retry.
   */
  private async doRefreshWithRetry(signal?: AbortSignal): Promise<string> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
      // Check if aborted before attempting
      if (signal?.aborted) {
        throw new AuthError('Token refresh aborted')
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

        // Don't retry on auth errors (invalid credentials)
        if (error instanceof AuthError) {
          throw error
        }

        // Don't retry if aborted
        if (signal?.aborted) {
          throw new AuthError('Token refresh aborted')
        }

        // Wait before retrying (unless this was the last attempt)
        if (attempt < this.retryAttempts - 1) {
          const delay = this.calculateBackoff(attempt)
          await this.sleep(delay, signal)
        }
      }
    }

    throw lastError ?? new AuthError('Token refresh failed after retries')
  }

  private calculateBackoff(attemptIndex: number): number {
    const exponential = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * Math.pow(2, attemptIndex),
    )
    const jitter = Math.random() * 0.25 * exponential
    return exponential + jitter
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(resolve, ms)

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeoutId)
          reject(new AuthError('Token refresh aborted'))
          return
        }

        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutId)
            reject(new AuthError('Token refresh aborted'))
          },
          { once: true },
        )
      }
    })
  }

  /**
   * Check if token needs proactive refresh (within buffer of expiry).
   */
  private needsRefresh(): boolean {
    if (!this.cachedToken) return true
    return Date.now() >= this.cachedToken.expiresAtMs - this.refreshBufferMs
  }

  /**
   * Check if token is fully expired (past expiry time).
   */
  private isExpired(): boolean {
    if (!this.cachedToken) return true
    return Date.now() >= this.cachedToken.expiresAtMs
  }

  /**
   * Clear the cached token. Called by Transport on 401 responses.
   */
  clearCache(): void {
    this.cachedToken = null
  }

  /**
   * Check if a token is currently cached.
   */
  hasToken(): boolean {
    return this.cachedToken !== null
  }
}
