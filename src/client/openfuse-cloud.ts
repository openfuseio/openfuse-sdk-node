import type { TRegion } from '../core/types.ts'
import type { TMetricsConfig } from '../domains/metrics/types.ts'
import { CloudAuth } from '../providers/auth/cloud-auth.ts'
import { CloudEndpoint } from '../providers/endpoint/cloud-endpoint.ts'
import { Openfuse } from './openfuse.ts'

export type TOpenfuseCloudOptions = {
  /** Openfuse Cloud region (e.g., 'us'). */
  region: TRegion
  /** Company slug as configured in Openfuse Cloud. */
  company: string
  /** Environment slug (e.g., 'prod', 'staging'). */
  environment: string
  /** System slug that groups related breakers. */
  systemSlug: string
  /** OAuth2 client ID from Openfuse Cloud. */
  clientId: string
  /** OAuth2 client secret from Openfuse Cloud. */
  clientSecret: string
  /** Optional metrics configuration. */
  metrics?: Partial<TMetricsConfig>
  /** Optional custom instance ID for metrics deduplication. */
  instanceId?: string
}

/**
 * Openfuse client pre-configured for Openfuse Cloud.
 * For self-hosted deployments, use the base `Openfuse` class instead.
 */
export class OpenfuseCloud extends Openfuse {
  constructor(options: TOpenfuseCloudOptions) {
    super({
      endpointProvider: new CloudEndpoint({
        region: options.region,
        company: options.company,
        environment: options.environment,
      }),
      tokenProvider: new CloudAuth({
        region: options.region,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      }),
      scope: {
        companySlug: options.company,
        environmentSlug: options.environment,
        systemSlug: options.systemSlug,
      },
      metrics: options.metrics,
      instanceId: options.instanceId,
    })
  }
}
