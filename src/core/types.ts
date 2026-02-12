export type TAuthProvider = {
  /** Returns auth headers (e.g. `{ authorization: 'Bearer ...' }`). */
  getAuthHeaders(signal?: AbortSignal): Promise<Record<string, string>>
  /** Called on 401/403 to allow token rotation. If absent, auth errors throw immediately without retry. */
  onAuthFailure?(): void
}

export type THttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type TRequestOptions = {
  queryString?: Record<string, string | number | boolean | undefined>
  body?: unknown
  signal?: AbortSignal
  timeoutInMilliseconds?: number
  headers?: Record<string, string>
  retryPolicy?: TRetryPolicy
}

export type TRetryPolicy = {
  attempts: number
  baseDelayInMilliseconds: number
  maximumDelayInMilliseconds: number
}

export type TAPIResponse<T> = { data: T }
