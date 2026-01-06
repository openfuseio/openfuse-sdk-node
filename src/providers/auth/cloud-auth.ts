import type { TRegion, TTokenProvider } from '../../core/types.ts'
import {
  KeycloakClientCredentialsProvider,
  type TKeycloakClientCredentialsOptions,
} from './keycloak-client-credentials.ts'

const CLOUD_AUTH_CONFIG: Record<TRegion, { keycloakUrl: string; realm: string }> = {
  us: { keycloakUrl: 'https://auth.openfuse.io', realm: 'openfuse-tenants' },
}

export type TCloudAuthOptions = {
  region: TRegion
  clientId: string
  clientSecret: string
  refreshBufferMs?: number
  timeoutMs?: number
}

/**
 * Authentication provider for Openfuse Cloud.
 * For self-hosted deployments, use `KeycloakClientCredentialsProvider` instead.
 */
export class CloudAuth implements TTokenProvider {
  private readonly provider: KeycloakClientCredentialsProvider

  constructor(options: TCloudAuthOptions) {
    const config = CLOUD_AUTH_CONFIG[options.region]
    if (!config) {
      const validRegions = Object.keys(CLOUD_AUTH_CONFIG).join(', ')
      throw new Error(`Invalid region: "${options.region}". Valid regions: ${validRegions}`)
    }

    const keycloakOptions: TKeycloakClientCredentialsOptions = {
      keycloakUrl: config.keycloakUrl,
      realm: config.realm,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      refreshBufferMs: options.refreshBufferMs,
      timeoutMs: options.timeoutMs,
    }

    this.provider = new KeycloakClientCredentialsProvider(keycloakOptions)
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    return this.provider.getToken(signal)
  }

  clearCache(): void {
    this.provider.clearCache()
  }
}
