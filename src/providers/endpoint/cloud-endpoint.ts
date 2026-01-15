import type { TEndpointProvider, TRegion } from '../../core/types.ts'

type TCloudEndpointOptions = {
  region: TRegion
  company: string
  environment: string
}

export class CloudEndpoint implements TEndpointProvider {
  private apiBaseUrl: string
  constructor(options: TCloudEndpointOptions) {
    const subdomain = `${options.environment}-${options.company}`
    this.apiBaseUrl = `https://${subdomain}.api.openfuse.io`
  }

  getApiBase(): string {
    return this.apiBaseUrl
  }
}
