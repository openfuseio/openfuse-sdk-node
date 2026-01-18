export type TTokenProvider = {
  /** Returns a bearer token. Implementations may cache and rotate tokens. */
  getToken(signal?: AbortSignal): Promise<string>
  /** Clears any cached token, forcing the next getToken() to fetch fresh. */
  clearCache?(): void
}

export type THttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type TRequestOptions = {
  queryString?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
  timeoutInMilliseconds?: number
  headers?: Record<string, string>
}

export type TRetryPolicy = {
  attempts: number
  baseDelayInMilliseconds: number
  maximumDelayInMilliseconds: number
}

export type TAPIResponse<T> = { data: T }
