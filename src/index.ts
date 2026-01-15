// Main clients
export { OpenfuseCloud } from './client/openfuse-cloud.ts'
export type { TOpenfuseCloudOptions } from './client/openfuse-cloud.ts'
export { Openfuse } from './client/openfuse.ts'

// Providers - Endpoints (for self-hosted / advanced usage)
export { CloudEndpoint } from './providers/endpoint/cloud-endpoint.ts'

// Providers - Authentication (for self-hosted / advanced usage)
export { CloudAuth } from './providers/auth/cloud-auth.ts'
export type { TCloudAuthOptions } from './providers/auth/cloud-auth.ts'
export { KeycloakClientCredentialsProvider } from './providers/auth/keycloak-client-credentials.ts'
export type { TKeycloakClientCredentialsOptions } from './providers/auth/keycloak-client-credentials.ts'

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
export type {
  TRegion,
  TEndpointProvider,
  TTokenProvider,
  TCompanyEnvironmentSystemScope,
  THttpMethod,
  TRequestOptions,
  TRetryPolicy,
} from './core/types.ts'

export type {
  TBreaker,
  TBreakerStateValue,
  TBootstrapResponse,
  TBreakerStateResponse,
} from './types/api.ts'

export type { TMetricsConfig } from './domains/metrics/types.ts'
