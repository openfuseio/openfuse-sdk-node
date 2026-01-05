import { Transport } from '../../core/transport.ts'
import type { TBootstrapResponse } from '../../types/api.ts'

export type TSystemsApiOptions = {
  transport: Transport
}

/**
 * Minimal systems HTTP client. Mirrors API endpoints exactly.
 * No caching, no retries beyond Transport, no extra logic.
 */
export interface TSystemsApi {
  getSystemBySlug(systemSlug: string, signal?: AbortSignal): Promise<{ id: string; slug: string }>
  bootstrapSystem(systemId: string, signal?: AbortSignal): Promise<TBootstrapResponse>
}

export class SystemsApi implements TSystemsApi {
  private transport: Transport

  constructor(options: TSystemsApiOptions) {
    this.transport = options.transport
  }

  public async getSystemBySlug(
    systemSlug: string,
    signal?: AbortSignal,
  ): Promise<{ id: string; slug: string }> {
    return this.transport.request<{ id: string; slug: string }>(
      'GET',
      `/systems/by-slug/${encodeURIComponent(systemSlug)}`,
      { signal },
    )
  }

  public async bootstrapSystem(
    systemId: string,
    signal?: AbortSignal,
  ): Promise<TBootstrapResponse> {
    return this.transport.request<TBootstrapResponse>(
      'GET',
      `/systems/${encodeURIComponent(systemId)}`,
      { signal, queryString: { expand: 'breakers' } },
    )
  }
}
