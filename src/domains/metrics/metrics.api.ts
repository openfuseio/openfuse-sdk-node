import { Transport } from '../../core/transport.ts'
import type { TIngestMetricsRequest, TIngestMetricsResponse, TMetric } from './types.ts'

export type TMetricsApiOptions = {
  transport: Transport
}

/** Thin HTTP client over the metrics endpoints. No caching or extra logic. */
export class MetricsApi {
  private transport: Transport

  constructor(options: TMetricsApiOptions) {
    this.transport = options.transport
  }

  /**
   * Send metrics data points to the backend
   */
  public async ingest(
    request: TIngestMetricsRequest,
    signal?: AbortSignal,
  ): Promise<TIngestMetricsResponse> {
    return await this.transport.request<TIngestMetricsResponse>('POST', '/metrics', {
      body: request,
      signal,
    })
  }

  /**
   * Fetch all metrics definitions for the current environment
   */
  public async listMetrics(signal?: AbortSignal): Promise<TMetric[]> {
    return await this.transport.request<TMetric[]>('GET', '/metrics', { signal })
  }
}
