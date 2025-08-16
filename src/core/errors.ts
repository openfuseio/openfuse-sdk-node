// TODO: Create common SDKError class
// TODO: Convert constructor message to object

/** Indicates a configuration problem detected at construction time or during method validation. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}
/** Indicates an authentication or authorization failure returned by the identity or API service. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}
/** Indicates a non-successful HTTP response from the API service. */
export class APIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'APIError'
  }
}
/** Indicates an entity could not be found. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}
/** Indicates the circuit breaker is open and work must not proceed. */
export class CircuitOpenError extends Error {
  constructor(message = 'Breaker is open') {
    super(message)
    this.name = 'CircuitOpenError'
  }
}
/** Indicates an operation was aborted via AbortSignal. */
export class AbortOperationError extends Error {
  constructor(message = 'Operation aborted') {
    super(message)
    this.name = 'AbortOperationError'
  }
}
