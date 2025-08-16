import { Transport } from '../../core/transport.ts'
import type { TBreaker, TBreakerStateResponse } from '../../types/api.ts'

export type TBreakersApiOptions = {
  transport: Transport
}

/** Thin HTTP client over the breakers endpoints. No caching or extra logic. */
export interface TBreakersApi {
  listBreakers(systemId: string, signal?: AbortSignal): Promise<TBreaker[]>
  getBreaker(breakerId: string, signal?: AbortSignal): Promise<TBreaker>
  getBreakerState(breakerId: string, signal?: AbortSignal): Promise<TBreakerStateResponse>
}

export class BreakersApi implements TBreakersApi {
  private transport: Transport

  constructor(options: TBreakersApiOptions) {
    this.transport = options.transport
  }

  public async listBreakers(systemId: string, signal?: AbortSignal): Promise<TBreaker[]> {
    const breakers = await this.transport.request<TBreaker[]>(
      'GET',
      `/systems/${encodeURIComponent(systemId)}/breakers`,
      { signal },
    )
    return breakers
  }

  public async getBreaker(breakerId: string, signal?: AbortSignal): Promise<TBreaker> {
    const breaker = await this.transport.request<TBreaker>(
      'GET',
      `/breakers/${encodeURIComponent(breakerId)}`,
      { signal },
    )
    return breaker
  }

  public async getBreakerState(
    breakerId: string,
    signal?: AbortSignal,
  ): Promise<TBreakerStateResponse> {
    const state = await this.transport.request<TBreakerStateResponse>(
      'GET',
      `/breakers/${encodeURIComponent(breakerId)}/state`,
      { signal },
    )
    return state
  }
}
