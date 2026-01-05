import { InflightRequests, TTLCache } from '../../core/cache.ts'
import { NotFoundError } from '../../core/errors.ts'
import type { TBreaker, TBreakerStateValue } from '../../types/api.ts'
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
  private mapBreakerIdToState: TTLCache<string, TBreakerStateValue>
  private inflightRequests: InflightRequests<string, unknown>
  private api: TBreakersApi

  constructor(options: TBreakersFeatureOptions) {
    this.api = options.api
    this.mapSlugToBreakerId = new TTLCache<string, string>({ maximumEntries: 10_000 })
    this.mapBreakerIdToState = new TTLCache<string, TBreakerStateValue>({
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
    systemId: string,
    breakerId: string,
    signal?: AbortSignal,
  ): Promise<TBreakerStateValue> {
    const cached = this.mapBreakerIdToState.get(breakerId)
    if (cached) return cached

    const inflightKey = `state:${breakerId}`
    const state = await this.inflightRequests.run(inflightKey, async () => {
      const breaker = await this.api.getBreaker(systemId, breakerId, signal)
      this.mapBreakerIdToState.set(breakerId, breaker.state, 3_000)
      return breaker.state
    })
    return state as TBreakerStateValue
  }

  private async getBreakerById(
    systemId: string,
    breakerId: string,
    signal?: AbortSignal,
  ): Promise<TBreaker> {
    return this.api.getBreaker(systemId, breakerId, signal)
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
  ): Promise<TBreakerStateValue> {
    const breakerId = await this.resolveOrRefreshMapping(systemId, breakerSlug, signal)
    return this.getStateById(systemId, breakerId, signal)
  }

  /** Resolves slug -> id and returns the breaker model. */
  public async getBreakerBySlug(
    systemId: string,
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<TBreaker> {
    const breakerId = await this.resolveOrRefreshMapping(systemId, breakerSlug, signal)
    return this.getBreakerById(systemId, breakerId, signal)
  }

  /**
   * Resolves a breaker slug to its ID.
   * Returns null if the breaker is not found (does not throw).
   * Used by MetricsFeature for resolving breaker slugs.
   */
  public async resolveBreakerId(
    systemId: string,
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      return await this.resolveOrRefreshMapping(systemId, breakerSlug, signal)
    } catch {
      return null
    }
  }
}
