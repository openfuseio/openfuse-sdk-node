import type { TMetricsConfig } from '../domains/metrics/types.ts'
import { Openfuse } from './openfuse.ts'

const OPENFUSE_CLOUD_API_URL = 'https://api.openfuse.io'

export type TOpenfuseCloudOptions = {
  /** System slug that groups related breakers */
  systemSlug: string
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
 *   systemSlug: 'payments',
 *   clientId: 'sdk_abc123',
 *   clientSecret: 'secret_xyz',
 * })
 *
 * await client.bootstrap()
 *
 * const isOpen = await client.isOpen('external-api')
 * ```
 */
export class OpenfuseCloud extends Openfuse {
  constructor(options: TOpenfuseCloudOptions) {
    super({
      baseUrl: OPENFUSE_CLOUD_API_URL,
      systemSlug: options.systemSlug,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      metrics: options.metrics,
      instanceId: options.instanceId,
    })
  }

  public override async bootstrap(): Promise<void> {
    await super.bootstrap()

    if (!this.bootstrapData) {
      throw new Error('Bootstrap response missing after bootstrap()')
    }

    const { environment, company } = this.bootstrapData
    const url = new URL(this.baseUrl)
    url.hostname = `${environment.slug}-${company.slug}.${url.hostname}`
    this.transport.setBaseUrl(url.origin)
  }
}
