/** Thrown when the SDK is misconfigured (e.g., missing or invalid constructor options). */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

/** Thrown when authentication fails (invalid credentials or a rejected token refresh). */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

/** Thrown on non-auth HTTP errors from the Openfuse API (e.g., 4xx/5xx responses). */
export class APIError extends Error {
  readonly statusCode?: number
  constructor(message: string, statusCode?: number) {
    super(message)
    this.name = 'APIError'
    this.statusCode = statusCode
  }
}

/** Thrown when a breaker slug does not match any known breaker in the system. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Thrown when an operation is cancelled via an {@link AbortSignal}. */
export class AbortOperationError extends Error {
  constructor(message = 'Operation aborted') {
    super(message)
    this.name = 'AbortOperationError'
  }
}

/** Thrown when a function wrapped by {@link BreakerHandle.protect} exceeds its `timeout`. */
export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

/** Returns true for 5xx, network, and timeout errors. Returns false for 4xx and NotFoundError. */
export function isServerOrNetworkError(error: unknown): boolean {
  if (error instanceof APIError) return !error.statusCode || error.statusCode >= 500
  if (error instanceof NotFoundError) return false
  return true
}
