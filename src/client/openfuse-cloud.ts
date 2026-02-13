import type { TMetricsConfig } from '../domains/metrics/types.ts'
import { Openfuse } from './openfuse.ts'

const OPENFUSE_CLOUD_API_URL = 'https://api.openfuse.io'

export type TOpenfuseCloudOptions = {
  /** System slug that groups related breakers */
  system: string
  /** SDK client ID from Openfuse Cloud dashboard */
  clientId: string
  /** SDK client secret from Openfuse Cloud dashboard */
  clientSecret: string
  /** Optional metrics configuration (overrides server config) */
  metrics?: Partial<TMetricsConfig>
  /** Optional custom instance ID for metrics deduplication */
  instanceId?: string
}

/**
 * Openfuse client pre-configured for Openfuse Cloud.
 * Uses the standard Openfuse Cloud API endpoint.
 *
 * @example
 * ```typescript
 * const client = new OpenfuseCloud({
 *   system: 'payments',
 *   clientId: 'sdk_abc123',
 *   clientSecret: 'secret_xyz',
 * })
 *
 * await client.init()
 *
 * const isOpen = await client.breaker('external-api').isOpen()
 * ```
 */
export class OpenfuseCloud extends Openfuse {
  constructor(options: TOpenfuseCloudOptions) {
    super({
      baseUrl: OPENFUSE_CLOUD_API_URL,
      system: options.system,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      metrics: options.metrics,
      instanceId: options.instanceId,
    })
  }
}
