import { AbortOperationError, APIError, AuthError } from './errors.ts'
import { calculateBackoff, sleep } from './retry.ts'
import { USER_AGENT } from './sdk-info.ts'
import type {
  TAPIResponse,
  TAuthProvider,
  THttpMethod,
  TRequestOptions,
  TRetryPolicy,
} from './types.ts'
import {
  createTimeoutSignal,
  extractResponseErrorDetail,
  normalizeBaseUrl,
  resolveFetch,
} from './utils.ts'

const DEFAULT_RETRY_POLICY: TRetryPolicy = {
  attempts: 3,
  baseDelayInMilliseconds: 100,
  maximumDelayInMilliseconds: 1000,
}
const DEFAULT_TIMEOUT_IN_MILLISECONDS = 1500

export type TTransportOptions = {
  baseUrl: string
  authProvider: TAuthProvider
  retryPolicy?: TRetryPolicy
  fetchImplementation?: typeof fetch | undefined
}

export class Transport {
  private baseUrl: string
  private authProvider: TAuthProvider
  private retryPolicy: TRetryPolicy
  private userAgent: string = USER_AGENT
  private fetchImplementation?: typeof fetch

  constructor(options: TTransportOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.authProvider = options.authProvider
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY
    this.fetchImplementation = resolveFetch(options.fetchImplementation)
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = normalizeBaseUrl(baseUrl)
  }

  async request<TResponse>(
    httpMethod: THttpMethod,
    path: string,
    requestOptions: TRequestOptions = {},
  ): Promise<TResponse> {
    const urlObject: URL = new URL(this.baseUrl + path)

    if (requestOptions.queryString) {
      for (const [queryKey, queryValue] of Object.entries(requestOptions.queryString)) {
        if (queryValue !== undefined) urlObject.searchParams.set(queryKey, String(queryValue))
      }
    }

    const timeoutInMilliseconds: number =
      requestOptions.timeoutInMilliseconds ?? DEFAULT_TIMEOUT_IN_MILLISECONDS
    const retryPolicy = requestOptions.retryPolicy ?? this.retryPolicy

    if (!this.fetchImplementation)
      throw new APIError('No fetch implementation available in this runtime')

    let lastError: unknown
    let hasRetriedAuth = false

    for (let attemptIndex = 0; attemptIndex < retryPolicy.attempts; attemptIndex++) {
      if (requestOptions.signal?.aborted) {
        throw lastError ?? new AbortOperationError()
      }

      const { signal: attemptSignal, cleanup } = createTimeoutSignal(
        timeoutInMilliseconds,
        requestOptions.signal,
      )

      try {
        const authHeaders = await this.authProvider.getAuthHeaders(attemptSignal)
        const httpResponse: Response = await this.fetchImplementation(urlObject, {
          method: httpMethod,
          headers: {
            'user-agent': this.userAgent,
            ...(requestOptions.body ? { 'content-type': 'application/json' } : {}),
            ...authHeaders,
            ...(requestOptions.headers ?? {}),
          },
          body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
          signal: attemptSignal,
        } as RequestInit)

        if (httpResponse.status === 401 || httpResponse.status === 403) {
          if (!hasRetriedAuth && this.authProvider.onAuthFailure) {
            hasRetriedAuth = true
            this.authProvider.onAuthFailure()
            continue
          }
          throw new AuthError(`Authentication failed with status ${httpResponse.status}`)
        }

        if (!httpResponse.ok) {
          if (
            httpResponse.status >= 500 &&
            httpResponse.status <= 599 &&
            attemptIndex < retryPolicy.attempts - 1
          ) {
            await sleep(
              calculateBackoff(
                attemptIndex,
                retryPolicy.baseDelayInMilliseconds,
                retryPolicy.maximumDelayInMilliseconds,
              ),
              requestOptions.signal,
            )
            continue
          }
          const errorDetail = await extractResponseErrorDetail(httpResponse)
          throw new APIError(
            `HTTP ${httpResponse.status} for ${httpMethod} ${path}${errorDetail}`,
            httpResponse.status,
          )
        }

        if (httpResponse.status === 204) return undefined as unknown as TResponse
        const parsedJson = (await httpResponse.json()) as TAPIResponse<TResponse>
        return parsedJson.data
      } catch (caughtError) {
        lastError = caughtError
        if (caughtError instanceof APIError || caughtError instanceof AuthError) throw caughtError
        if (caughtError instanceof SyntaxError) {
          throw new APIError(`Invalid JSON response for ${httpMethod} ${path}`)
        }
        if (requestOptions.signal?.aborted) throw caughtError
        if (attemptIndex < retryPolicy.attempts - 1) {
          await sleep(
            calculateBackoff(
              attemptIndex,
              retryPolicy.baseDelayInMilliseconds,
              retryPolicy.maximumDelayInMilliseconds,
            ),
            requestOptions.signal,
          )
          continue
        }
        throw caughtError
      } finally {
        cleanup()
      }
    }
    throw lastError
  }
}
