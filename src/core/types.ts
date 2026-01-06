export type TRegion = 'us'

export type TEndpointProvider = {
  /** Returns the API base URL such as https://api.us.openfuse.io */
  getApiBase(): string
}

export type TTokenProvider = {
  /** Returns a bearer token. Implementations may cache and rotate tokens. */
  getToken(signal?: AbortSignal): Promise<string>
  /** Clears any cached token, forcing the next getToken() to fetch fresh. */
  clearCache?(): void
}

export type TCompanyEnvironmentSystemScope = {
  /** Company slug configured in the Openfuse Cloud */
  companySlug: string
  /** Environment slug under the company */
  environmentSlug: string
  /** System slug is required and is fixed for the lifetime of the client */
  systemSlug: string
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
