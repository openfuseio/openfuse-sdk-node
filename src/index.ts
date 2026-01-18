// Main clients
export { OpenfuseCloud } from './client/openfuse-cloud.ts'
export type { TOpenfuseCloudOptions } from './client/openfuse-cloud.ts'
export { Openfuse } from './client/openfuse.ts'
export type { TOpenfuseOptions } from './client/openfuse.ts'

// Errors
export {
  ConfigurationError,
  AuthError,
  APIError,
  NotFoundError,
  CircuitOpenError,
  AbortOperationError,
  TimeoutError,
} from './core/errors.ts'

// Types
export type { TBreaker, TBreakerStateValue, TBreakerStateResponse } from './types/api.ts'

export type { TMetricsConfig } from './domains/metrics/types.ts'
