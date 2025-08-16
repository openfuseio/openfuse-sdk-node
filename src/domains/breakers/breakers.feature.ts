import { InflightRequests, TTLCache } from '../../core/cache.ts'
import { NotFoundError } from '../../core/errors.ts'
import type { TBreaker, TBreakerStateResponse } from '../../types/api.ts'
import type { TBreakersApi } from './breakers.api.ts'

type TBreakersFeatureOptions = {
  api: TBreakersApi
}

/**
 * Manages per-system breaker slug ↔ ID mapping and state retrieval.
 * All cache details are encapsulated and private.
 */
export class BreakersFeature {
  private mapSlugToBreakerId: TTLCache<string, string>
  private mapBreakerIdToState: TTLCache<string, TBreakerStateResponse>
  private inflightRequests: InflightRequests<string, unknown>
  private api: TBreakersApi

  constructor(options: TBreakersFeatureOptions) {
    this.api = options.api
    this.mapSlugToBreakerId = new TTLCache<string, string>({ maximumEntries: 10_000 })
    this.mapBreakerIdToState = new TTLCache<string, TBreakerStateResponse>({
      maximumEntries: 10_000,
    })
    this.inflightRequests = new InflightRequests<string, unknown>()
  }

  // ── Private cache helpers ───────────────────────────────────────────────────

  private makeSlugKey(systemId: string, breakerSlug: string): string {
    return `${systemId}|${breakerSlug}`
  }

  /** Seeds or refreshes the internal slug -> id mapping with a breakers list. */
  private setMapping(
    systemId: string,
    breakers: TBreaker[],
    ttlMilliseconds: number = 10 * 60 * 1000,
  ): void {
    for (const breaker of breakers) {
      this.mapSlugToBreakerId.set(
        this.makeSlugKey(systemId, breaker.slug),
        breaker.id,
        ttlMilliseconds,
      )
    }
  }

  private getIdFromSlug(systemId: string, breakerSlug: string): string | undefined {
    return this.mapSlugToBreakerId.get(this.makeSlugKey(systemId, breakerSlug))
  }

  private async getStateById(
    breakerId: string,
    signal?: AbortSignal,
  ): Promise<TBreakerStateResponse> {
    const cached: TBreakerStateResponse | undefined = this.mapBreakerIdToState.get(breakerId)
    if (cached) return cached

    const inflightKey: string = `state:${breakerId}`
    const stateResponse = await this.inflightRequests.run(inflightKey, async () => {
      const data = await this.api.getBreakerState(breakerId, signal)
      this.mapBreakerIdToState.set(breakerId, data, 3_000)
      return data
    })
    return stateResponse as TBreakerStateResponse
  }

  private async getBreakerById(breakerId: string, signal?: AbortSignal): Promise<TBreaker> {
    const breaker: TBreaker = await this.api.getBreaker(breakerId, signal)
    return breaker
  }

  private async refreshMappingFromApi(systemId: string, signal?: AbortSignal): Promise<void> {
    const breakers: TBreaker[] = await this.api.listBreakers(systemId, signal)
    this.setMapping(systemId, breakers)
  }

  private async resolveOrRefreshMapping(
    systemId: string,
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const cachedId: string | undefined = this.getIdFromSlug(systemId, breakerSlug)
    if (cachedId) return cachedId

    await this.refreshMappingFromApi(systemId, signal)

    const refreshedId: string | undefined = this.getIdFromSlug(systemId, breakerSlug)
    if (!refreshedId) {
      throw new NotFoundError(`Breaker not found: ${breakerSlug}`)
    }
    return refreshedId
  }

  // ── Public domain methods (no public cache surface) ─────────────────────────

  /** Domain entrypoint used by the client to apply bootstrap results. */
  public ingestBootstrap(systemId: string, breakers: TBreaker[], ttlMilliseconds?: number): void {
    this.setMapping(systemId, breakers, ttlMilliseconds ?? 10 * 60 * 1000)
  }

  /** Returns all breakers for the system. Mapping is refreshed internally. */
  public async listBreakers(systemId: string, signal?: AbortSignal): Promise<TBreaker[]> {
    const breakers: TBreaker[] = await this.api.listBreakers(systemId, signal)
    this.setMapping(systemId, breakers)
    return breakers
  }

  /** Returns the state value if the breaker addressed by slug is found. */
  public async getBreakerStateBySlug(
    systemId: string,
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<TBreakerStateResponse['state']> {
    const breakerId: string = await this.resolveOrRefreshMapping(systemId, breakerSlug, signal)
    const response: TBreakerStateResponse = await this.getStateById(breakerId, signal)
    return response.state
  }

  /** Resolves slug -> id and returns the breaker model. */
  public async getBreakerBySlug(
    systemId: string,
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<TBreaker> {
    const breakerId: string = await this.resolveOrRefreshMapping(systemId, breakerSlug, signal)
    return await this.getBreakerById(breakerId, signal)
  }
}
