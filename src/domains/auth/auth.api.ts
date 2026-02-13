import { SDK_NAME, SDK_VERSION } from '../../core/sdk-info.ts'
import { Transport } from '../../core/transport.ts'
import { normalizeBaseUrl, resolveFetch } from '../../core/utils.ts'
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
  maxAttempts?: number
}

export type TRefreshTokenOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

const BOOTSTRAP_RETRY_ATTEMPTS = 3
const BOOTSTRAP_RETRY_BASE_DELAY_MS = 200
const BOOTSTRAP_RETRY_MAX_DELAY_MS = 2000

/**
 * Low-level API client for authentication endpoints.
 * Handles POST /sdk/auth/bootstrap and GET /sdk/auth/token.
 * Uses Transport internally with Basic Auth (no token rotation on 401).
 */
export class AuthApi {
  private readonly transport: Transport

  constructor(options: TAuthApiOptions) {
    const basicAuth = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')

    this.transport = new Transport({
      baseUrl: normalizeBaseUrl(options.baseUrl),
      authProvider: {
        getAuthHeaders: async () => ({ authorization: `Basic ${basicAuth}` }),
      },
      fetchImplementation: resolveFetch(options.fetchImplementation),
    })
  }

  /**
   * Calls POST /v1/sdk/auth/bootstrap with Basic Auth.
   * Returns system config, breakers, metrics config, and an access token.
   * Retries on 5xx and network errors with exponential backoff.
   */
  async bootstrap(systemSlug: string, options?: TBootstrapOptions): Promise<TSdkBootstrapResponse> {
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

    const body: TSdkBootstrapRequest = { systemSlug, clientMeta }

    return this.transport.request<TSdkBootstrapResponse>('POST', '/v1/sdk/auth/bootstrap', {
      body,
      signal: options?.signal,
      timeoutInMilliseconds: options?.timeoutMs ?? 5_000,
      retryPolicy: {
        attempts: options?.maxAttempts ?? BOOTSTRAP_RETRY_ATTEMPTS,
        baseDelayInMilliseconds: BOOTSTRAP_RETRY_BASE_DELAY_MS,
        maximumDelayInMilliseconds: BOOTSTRAP_RETRY_MAX_DELAY_MS,
      },
    })
  }

  /**
   * Calls GET /v1/sdk/auth/token with Basic Auth.
   * Returns a fresh access token.
   */
  async refreshToken(options?: TRefreshTokenOptions): Promise<TSdkTokenRefreshResponse> {
    return this.transport.request<TSdkTokenRefreshResponse>('GET', '/v1/sdk/auth/token', {
      signal: options?.signal,
      timeoutInMilliseconds: options?.timeoutMs ?? 10_000,
      retryPolicy: { attempts: 1, baseDelayInMilliseconds: 0, maximumDelayInMilliseconds: 0 },
    })
  }
}
