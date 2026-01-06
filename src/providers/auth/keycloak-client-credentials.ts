import { AuthError, ConfigurationError } from '../../core/errors.ts'
import type { TTokenProvider } from '../../core/types.ts'

const DEFAULT_REFRESH_BUFFER_MS = 30_000
const DEFAULT_TIMEOUT_MS = 10_000

export type TKeycloakClientCredentialsOptions = {
  /** Keycloak server URL (e.g., 'https://auth.example.com'). */
  keycloakUrl: string
  /** Keycloak realm name. */
  realm: string
  /** OAuth2 client ID. */
  clientId: string
  /** OAuth2 client secret. */
  clientSecret: string
  /** Time in ms before expiry to trigger refresh. @default 30000 */
  refreshBufferMs?: number
  /** Request timeout in ms. @default 10000 */
  timeoutMs?: number
}

type TKeycloakTokenResponse = {
  access_token: string
  expires_in: number
  token_type: string
  scope?: string
}

type TCachedToken = {
  token: string
  expiresAtMs: number
}

/**
 * Token provider using OAuth2 Client Credentials flow against Keycloak.
 * Tokens are cached and refreshed automatically before expiry.
 */
export class KeycloakClientCredentialsProvider implements TTokenProvider {
  private readonly keycloakUrl: string
  private readonly realm: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly refreshBufferMs: number
  private readonly timeoutMs: number
  private readonly tokenEndpoint: string

  private cachedToken: TCachedToken | null = null
  private pendingTokenRequest: Promise<string> | null = null

  constructor(options: TKeycloakClientCredentialsOptions) {
    this.validateOptions(options)

    this.keycloakUrl = options.keycloakUrl.replace(/\/+$/, '')
    this.realm = options.realm
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.refreshBufferMs = options.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.tokenEndpoint = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`
  }

  /** Returns a valid access token, fetching or refreshing as needed. */
  async getToken(signal?: AbortSignal): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs - this.refreshBufferMs) {
      return this.cachedToken.token
    }

    // Coalesce concurrent requests
    if (this.pendingTokenRequest) {
      return this.pendingTokenRequest
    }

    this.pendingTokenRequest = this.fetchToken(signal)

    try {
      return await this.pendingTokenRequest
    } finally {
      this.pendingTokenRequest = null
    }
  }

  /** Clears cached token, forcing next getToken() to fetch fresh. */
  clearCache(): void {
    this.cachedToken = null
  }

  private async fetchToken(signal?: AbortSignal): Promise<string> {
    const now = Date.now()

    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs)

    const combinedSignal = signal
      ? this.combineAbortSignals(signal, timeoutController.signal)
      : timeoutController.signal

    try {
      const response = await fetch(this.tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        signal: combinedSignal,
      })

      if (!response.ok) {
        await this.handleErrorResponse(response)
      }

      const data = (await response.json()) as TKeycloakTokenResponse

      if (!data.access_token) {
        throw new AuthError('Token response missing access_token')
      }

      if (typeof data.expires_in !== 'number' || data.expires_in <= 0) {
        throw new AuthError('Token response has invalid expires_in')
      }

      this.cachedToken = {
        token: data.access_token,
        expiresAtMs: now + data.expires_in * 1000,
      }

      return this.cachedToken.token
    } catch (error) {
      if (error instanceof AuthError) {
        throw error
      }

      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) {
          throw new AuthError('Token request was cancelled')
        }
        throw new AuthError(`Token request timed out after ${this.timeoutMs}ms`)
      }

      if (error instanceof TypeError) {
        throw new AuthError(`Network error fetching token: ${error.message}`)
      }

      throw new AuthError(
        `Failed to fetch token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorDetail = ''

    try {
      const body = (await response.json()) as { error?: string; error_description?: string }
      errorDetail = body.error_description ?? body.error ?? ''
    } catch {
      try {
        errorDetail = await response.text()
      } catch {
        // Ignore
      }
    }

    const statusMessage = errorDetail ? `: ${errorDetail}` : ''

    if (response.status === 401) {
      throw new AuthError(`Invalid client credentials${statusMessage}`)
    }

    if (response.status === 400) {
      throw new AuthError(`Invalid token request${statusMessage}`)
    }

    if (response.status >= 500) {
      throw new AuthError(`Keycloak server error (${response.status})${statusMessage}`)
    }

    throw new AuthError(`Token request failed (${response.status})${statusMessage}`)
  }

  private combineAbortSignals(primary: AbortSignal, secondary: AbortSignal): AbortSignal {
    const controller = new AbortController()
    const abort = () => controller.abort()

    if (primary.aborted || secondary.aborted) {
      controller.abort()
      return controller.signal
    }

    primary.addEventListener('abort', abort, { once: true })
    secondary.addEventListener('abort', abort, { once: true })

    return controller.signal
  }

  private validateOptions(options: TKeycloakClientCredentialsOptions): void {
    if (!options.keycloakUrl || typeof options.keycloakUrl !== 'string') {
      throw new ConfigurationError('keycloakUrl is required')
    }

    if (!options.realm || typeof options.realm !== 'string') {
      throw new ConfigurationError('realm is required')
    }

    if (!options.clientId || typeof options.clientId !== 'string') {
      throw new ConfigurationError('clientId is required')
    }

    if (!options.clientSecret || typeof options.clientSecret !== 'string') {
      throw new ConfigurationError('clientSecret is required')
    }

    try {
      new URL(options.keycloakUrl)
    } catch {
      throw new ConfigurationError(`Invalid keycloakUrl: "${options.keycloakUrl}"`)
    }

    if (options.refreshBufferMs !== undefined) {
      if (typeof options.refreshBufferMs !== 'number' || options.refreshBufferMs < 0) {
        throw new ConfigurationError('refreshBufferMs must be a non-negative number')
      }
    }

    if (options.timeoutMs !== undefined) {
      if (typeof options.timeoutMs !== 'number' || options.timeoutMs <= 0) {
        throw new ConfigurationError('timeoutMs must be a positive number')
      }
    }
  }
}
