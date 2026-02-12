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
  constructor(message: string) {
    super(message)
    this.name = 'APIError'
  }
}

/** Thrown when a breaker slug does not match any known breaker in the system. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * Thrown by {@link Openfuse.withBreaker} when the breaker is open and no `onOpen`
 * fallback was provided. Catch this to implement custom open-state handling.
 *
 * @example
 * ```typescript
 * try {
 *   await client.withBreaker('stripe-api', fn)
 * } catch (err) {
 *   if (err instanceof CircuitOpenError) {
 *     return fallbackResponse
 *   }
 *   throw err
 * }
 * ```
 */
export class CircuitOpenError extends Error {
  constructor(message = 'Breaker is open') {
    super(message)
    this.name = 'CircuitOpenError'
  }
}

/** Thrown when an operation is cancelled via an {@link AbortSignal}. */
export class AbortOperationError extends Error {
  constructor(message = 'Operation aborted') {
    super(message)
    this.name = 'AbortOperationError'
  }
}

/** Thrown when a function wrapped by {@link Openfuse.withBreaker} exceeds its `timeout`. */
export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}
