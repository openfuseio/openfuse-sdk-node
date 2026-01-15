import { Transport } from '../../core/transport.ts'
import type { TBreaker } from '../../types/api.ts'

export type TBreakersApiOptions = {
  transport: Transport
}

export interface TBreakersApi {
  listBreakers(systemId: string, signal?: AbortSignal): Promise<TBreaker[]>
  getBreaker(systemId: string, breakerId: string, signal?: AbortSignal): Promise<TBreaker>
}

export class BreakersApi implements TBreakersApi {
  private transport: Transport

  constructor(options: TBreakersApiOptions) {
    this.transport = options.transport
  }

  public async listBreakers(systemId: string, signal?: AbortSignal): Promise<TBreaker[]> {
    return this.transport.request<TBreaker[]>(
      'GET',
      `/systems/${encodeURIComponent(systemId)}/breakers`,
      { signal },
    )
  }

  public async getBreaker(
    systemId: string,
    breakerId: string,
    signal?: AbortSignal,
  ): Promise<TBreaker> {
    return this.transport.request<TBreaker>(
      'GET',
      `/systems/${encodeURIComponent(systemId)}/breakers/${encodeURIComponent(breakerId)}`,
      { signal },
    )
  }
}
