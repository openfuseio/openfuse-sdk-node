import { Transport } from '../../core/transport.ts'
import type { TIngestMetricsRequest, TIngestMetricsResponse, TMetric } from './types.ts'

export type TMetricsApiOptions = {
  transport: Transport
}

export class MetricsApi {
  private transport: Transport

  constructor(options: TMetricsApiOptions) {
    this.transport = options.transport
  }

  public async ingest(
    request: TIngestMetricsRequest,
    signal?: AbortSignal,
  ): Promise<TIngestMetricsResponse> {
    return await this.transport.request<TIngestMetricsResponse>('POST', '/v1/metrics', {
      body: request,
      signal,
    })
  }

  public async listMetrics(signal?: AbortSignal): Promise<TMetric[]> {
    return await this.transport.request<TMetric[]>('GET', '/v1/metrics', { signal })
  }
}
