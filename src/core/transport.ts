import { AbortOperationError, APIError, AuthError } from './errors.ts'
import { USER_AGENT } from './sdk-info.ts'
import type {
  TAPIResponse,
  THttpMethod,
  TRequestOptions,
  TRetryPolicy,
  TTokenProvider,
} from './types.ts'

const DEFAULT_RETRY_POLICY: TRetryPolicy = {
  attempts: 3,
  baseDelayInMilliseconds: 100,
  maximumDelayInMilliseconds: 1000,
}
const DEFAULT_TIMEOUT_IN_MILLISECONDS = 1500

function sleep(milliseconds: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(resolve, milliseconds)
    if (abortSignal) {
      const onAbort = () => {
        clearTimeout(timeoutId)
        reject(new AbortOperationError())
      }
      if (abortSignal.aborted) onAbort()
      abortSignal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function calculateBackoffDelay(
  currentAttemptIndex: number,
  baseDelayInMilliseconds: number,
  maximumDelayInMilliseconds: number,
): number {
  const exponential: number = Math.min(
    maximumDelayInMilliseconds,
    baseDelayInMilliseconds * Math.pow(2, currentAttemptIndex),
  )
  const jitter: number = Math.random() * 0.25 * exponential
  return exponential + jitter
}

function combineAbortSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
  if (!secondary) return primary
  const controller: AbortController = new AbortController()
  const propagate = () => controller.abort()
  if (primary.aborted || secondary.aborted) controller.abort()
  primary.addEventListener('abort', propagate)
  secondary.addEventListener('abort', propagate)
  return controller.signal
}

export type TTransportOptions = {
  baseUrl: string
  tokenProvider: TTokenProvider
  retryPolicy?: TRetryPolicy
  fetchImplementation?: typeof fetch | undefined
}

export class Transport {
  private baseUrl: string
  private tokenProvider: TTokenProvider
  private retryPolicy: TRetryPolicy
  private userAgent: string = USER_AGENT
  private fetchImplementation?: typeof fetch

  constructor(options: TTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.tokenProvider = options.tokenProvider
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY
    this.fetchImplementation =
      options.fetchImplementation ?? (globalThis as unknown as { fetch?: typeof fetch }).fetch
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
    const timeoutController: AbortController = new AbortController()
    const timeoutId: NodeJS.Timeout = setTimeout(
      () => timeoutController.abort(),
      timeoutInMilliseconds,
    )
    const combinedSignal: AbortSignal = requestOptions.signal
      ? combineAbortSignals(timeoutController.signal, requestOptions.signal)
      : timeoutController.signal

    if (!this.fetchImplementation)
      throw new APIError('No fetch implementation available in this runtime')

    try {
      let lastError: unknown
      let hasRetriedAuth = false
      for (let attemptIndex = 0; attemptIndex < this.retryPolicy.attempts; attemptIndex++) {
        try {
          const bearerToken: string = await this.tokenProvider.getToken(combinedSignal)
          const httpResponse: Response = await this.fetchImplementation(urlObject, {
            method: httpMethod,
            headers: {
              authorization: `Bearer ${bearerToken}`,
              'user-agent': this.userAgent,
              ...(requestOptions.body ? { 'content-type': 'application/json' } : {}),
              ...(requestOptions.headers ?? {}),
            },
            body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
            signal: combinedSignal,
          } as RequestInit)

          if (httpResponse.status === 401 || httpResponse.status === 403) {
            if (!hasRetriedAuth) {
              hasRetriedAuth = true
              this.tokenProvider.clearCache?.()
              continue
            }
            throw new AuthError(`Authentication failed with status ${httpResponse.status}`)
          }

          if (!httpResponse.ok) {
            if (
              httpResponse.status >= 500 &&
              httpResponse.status <= 599 &&
              attemptIndex < this.retryPolicy.attempts - 1
            ) {
              await sleep(
                calculateBackoffDelay(
                  attemptIndex,
                  this.retryPolicy.baseDelayInMilliseconds,
                  this.retryPolicy.maximumDelayInMilliseconds,
                ),
                combinedSignal,
              )
              continue
            }
            let errorDetail = ''
            try {
              const body: unknown = await httpResponse.json()
              if (
                typeof body === 'object' &&
                body !== null &&
                'message' in body &&
                typeof body.message === 'string'
              ) {
                errorDetail = `: ${body.message}`
              }
            } catch {
              // JSON parse failed
            }
            throw new APIError(
              `HTTP ${httpResponse.status} for ${httpMethod} ${path}${errorDetail}`,
            )
          }

          if (httpResponse.status === 204) return undefined as unknown as TResponse
          const parsedJson = (await httpResponse.json()) as TAPIResponse<TResponse>
          return parsedJson.data
        } catch (caughtError) {
          lastError = caughtError
          if (caughtError instanceof APIError || caughtError instanceof AuthError) throw caughtError
          if (attemptIndex < this.retryPolicy.attempts - 1) {
            await sleep(
              calculateBackoffDelay(
                attemptIndex,
                this.retryPolicy.baseDelayInMilliseconds,
                this.retryPolicy.maximumDelayInMilliseconds,
              ),
              combinedSignal,
            )
            continue
          }
          throw caughtError
        }
      }
      throw lastError
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
