import { APIError, AuthError } from '../../core/errors.ts'
import { SDK_NAME, SDK_VERSION, USER_AGENT } from '../../core/sdk-info.ts'
import type {
  TSdkBootstrapRequest,
  TSdkBootstrapResponse,
  TSdkClientMeta,
  TSdkTokenRefreshResponse,
} from '../../types/api.ts'

export type TAuthApiOptions = {
  /** Base API URL (e.g., https://api.openfuse.io/v1) */
  baseUrl: string
  /** SDK client ID */
  clientId: string
  /** SDK client secret */
  clientSecret: string
  /** Optional fetch implementation for testing */
  fetchImplementation?: typeof fetch
}

export type TBootstrapOptions = {
  clientMeta?: TSdkClientMeta
  instanceId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export type TRefreshTokenOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Low-level API client for authentication endpoints.
 * Handles POST /sdk/bootstrap and POST /sdk/token/refresh.
 */
export class AuthApi {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly fetchImpl: typeof fetch

  constructor(options: TAuthApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.fetchImpl =
      options.fetchImplementation ?? (globalThis as unknown as { fetch?: typeof fetch }).fetch!
  }

  /**
   * Calls POST /v1/sdk/auth/bootstrap with Basic Auth.
   * Returns system config, breakers, metrics config, and an access token.
   */
  async bootstrap(systemSlug: string, options?: TBootstrapOptions): Promise<TSdkBootstrapResponse> {
    const url = `${this.baseUrl}/v1/sdk/auth/bootstrap`
    const timeoutMs = options?.timeoutMs ?? 10_000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const combinedSignal = options?.signal
      ? this.combineSignals(controller.signal, options.signal)
      : controller.signal

    try {
      const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

      const clientMeta: TSdkClientMeta = {
        sdkName: SDK_NAME,
        sdkVersion: SDK_VERSION,
        runtime: 'node',
        runtimeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        instanceId: options?.instanceId,
        ...options?.clientMeta,
      }

      const body: TSdkBootstrapRequest = {
        systemSlug,
        clientMeta,
      }

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      } as RequestInit)

      if (response.status === 401 || response.status === 403) {
        throw new AuthError(`Authentication failed: invalid client credentials`)
      }

      if (!response.ok) {
        const errorDetail = await this.extractErrorDetail(response)
        throw new APIError(`Bootstrap failed with HTTP ${response.status}${errorDetail}`)
      }

      const result = (await response.json()) as { data: TSdkBootstrapResponse }
      return result.data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Calls GET /v1/sdk/auth/token with Basic Auth.
   * Returns a fresh access token.
   */
  async refreshToken(options?: TRefreshTokenOptions): Promise<TSdkTokenRefreshResponse> {
    const url = `${this.baseUrl}/v1/sdk/auth/token`
    const timeoutMs = options?.timeoutMs ?? 10_000

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    const combinedSignal = options?.signal
      ? this.combineSignals(controller.signal, options.signal)
      : controller.signal

    try {
      const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')

      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'User-Agent': USER_AGENT,
        },
        signal: combinedSignal,
      } as RequestInit)

      if (response.status === 401 || response.status === 403) {
        throw new AuthError(`Authentication failed: invalid client credentials`)
      }

      if (!response.ok) {
        const errorDetail = await this.extractErrorDetail(response)
        throw new APIError(`Token refresh failed with HTTP ${response.status}${errorDetail}`)
      }

      const result = (await response.json()) as { data: TSdkTokenRefreshResponse }
      return result.data
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private async extractErrorDetail(response: Response): Promise<string> {
    try {
      const errorBody = (await response.json()) as { message?: string }
      if (errorBody.message) {
        return `: ${errorBody.message}`
      }
    } catch {
      // JSON parse failed
    }
    return ''
  }

  private combineSignals(primary: AbortSignal, secondary: AbortSignal): AbortSignal {
    const controller = new AbortController()
    const abort = () => controller.abort()

    if (primary.aborted || secondary.aborted) {
      controller.abort()
    }

    primary.addEventListener('abort', abort, { once: true })
    secondary.addEventListener('abort', abort, { once: true })

    return controller.signal
  }
}
