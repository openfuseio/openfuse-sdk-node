import { InflightRequests, TTLCache } from '../../core/cache.ts'
import { APIError, NotFoundError, isServerOrNetworkError } from '../../core/errors.ts'
import type { ApiHealthTracker } from '../../core/api-health.ts'
import type { TBreaker, TBreakerStateValue } from '../../types/api.ts'
import type { TBreakersApi } from './breakers.api.ts'

const SLUG_MAPPING_TTL_MS = 10 * 60 * 1000
const STATE_CACHE_TTL_MS = 3_000
const BOOTSTRAP_STATE_CACHE_TTL_MS = 30_000
const NOT_FOUND_CACHE_TTL_MS = 60_000

type TBreakersFeatureOptions = {
  api: TBreakersApi
  apiHealth?: ApiHealthTracker
}

/**
 * Manages per-system breaker slug ↔ ID mapping and state retrieval.
 * All cache details are encapsulated and private.
 */
export class BreakersFeature {
  private static readonly MAX_LAST_KNOWN_ENTRIES = 10_000
  private mapSlugToBreakerId: TTLCache<string, string>
  private mapBreakerIdToState: TTLCache<string, TBreakerStateValue>
  private lastKnownState: Map<string, TBreakerStateValue> = new Map()
  private notFoundCache: TTLCache<string, boolean>
  private inflightRequests: InflightRequests<string, unknown>
  private api: TBreakersApi
  private apiHealth?: ApiHealthTracker

  constructor(options: TBreakersFeatureOptions) {
    this.api = options.api
    this.apiHealth = options.apiHealth
    this.mapSlugToBreakerId = new TTLCache<string, string>({ maximumEntries: 10_000 })
    this.mapBreakerIdToState = new TTLCache<string, TBreakerStateValue>({
      maximumEntries: 10_000,
    })
    this.notFoundCache = new TTLCache<string, boolean>({ maximumEntries: 10_000 })
    this.inflightRequests = new InflightRequests<string, unknown>()
  }

  private makeSlugKey(systemId: string, breakerSlug: string): string {
    return `${systemId}|${breakerSlug}`
  }

  private setMapping(
    systemId: string,
    breakers: TBreaker[],
    ttlMilliseconds: number = SLUG_MAPPING_TTL_MS,
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

  private setLastKnownState(breakerId: string, state: TBreakerStateValue): void {
    this.lastKnownState.set(breakerId, state)
    if (this.lastKnownState.size > BreakersFeature.MAX_LAST_KNOWN_ENTRIES) {
      const oldest = this.lastKnownState.keys().next().value
      if (oldest !== undefined) this.lastKnownState.delete(oldest)
    }
  }

  private async fetchAndCacheState(
    systemId: string,
    breakerId: string,
  ): Promise<TBreakerStateValue> {
    const breaker = await this.api.getBreaker(systemId, breakerId)
    this.mapBreakerIdToState.set(breakerId, breaker.state, STATE_CACHE_TTL_MS)
    this.setLastKnownState(breakerId, breaker.state)
    this.apiHealth?.recordSuccess()
    return breaker.state
  }

  private async getStateById(systemId: string, breakerId: string): Promise<TBreakerStateValue> {
    // 1. Fresh TTL cache hit → return immediately
    const cached = this.mapBreakerIdToState.get(breakerId)
    if (cached) return cached

    const stale = this.lastKnownState.get(breakerId)

    // 2. API degraded + stale exists → return stale immediately
    if (this.apiHealth && !this.apiHealth.shouldAttemptRequest()) {
      if (stale) return stale
      // 3. API degraded + no stale → throw (triggers fail-open upstream)
      throw new APIError('API degraded and no cached state available')
    }

    // 4. Stale exists → return stale, fire-and-forget background refresh
    if (stale) {
      this.inflightRequests
        .run(`state:${breakerId}`, () => this.fetchAndCacheState(systemId, breakerId))
        .catch((error) => {
          if (isServerOrNetworkError(error)) this.apiHealth?.recordFailure()
        })
      return stale
    }

    // 5. No stale → block on API call
    const inflightKey = `state:${breakerId}`
    try {
      const state = await this.inflightRequests.run(inflightKey, () =>
        this.fetchAndCacheState(systemId, breakerId),
      )
      return state as TBreakerStateValue
    } catch (error) {
      if (isServerOrNetworkError(error)) this.apiHealth?.recordFailure()
      throw error
    }
  }

  private async getBreakerById(
    systemId: string,
    breakerId: string,
    signal?: AbortSignal,
  ): Promise<TBreaker> {
    return this.api.getBreaker(systemId, breakerId, signal)
  }

  private async refreshMappingFromApi(systemId: string): Promise<void> {
    const breakers: TBreaker[] = await this.api.listBreakers(systemId)
    this.setMapping(systemId, breakers)
    this.apiHealth?.recordSuccess()
  }

  private async resolveOrRefreshMapping(systemId: string, breakerSlug: string): Promise<string> {
    const slugKey = this.makeSlugKey(systemId, breakerSlug)

    if (this.notFoundCache.hasFresh(slugKey)) {
      throw new NotFoundError(`Breaker not found: ${breakerSlug}`)
    }

    const cachedId: string | undefined = this.getIdFromSlug(systemId, breakerSlug)
    if (cachedId) return cachedId

    if (this.apiHealth && !this.apiHealth.shouldAttemptRequest()) {
      throw new NotFoundError(`Breaker not found: ${breakerSlug} (API degraded)`)
    }

    try {
      await this.inflightRequests.run(`mapping:${systemId}`, () =>
        this.refreshMappingFromApi(systemId),
      )
    } catch (error) {
      if (isServerOrNetworkError(error)) this.apiHealth?.recordFailure()
      throw error
    }

    const refreshedId: string | undefined = this.getIdFromSlug(systemId, breakerSlug)
    if (!refreshedId) {
      this.notFoundCache.set(slugKey, true, NOT_FOUND_CACHE_TTL_MS)
      throw new NotFoundError(`Breaker not found: ${breakerSlug}`)
    }
    return refreshedId
  }

  public ingestBootstrap(systemId: string, breakers: TBreaker[], ttlMilliseconds?: number): void {
    this.notFoundCache.clear()
    this.setMapping(systemId, breakers, ttlMilliseconds ?? SLUG_MAPPING_TTL_MS)
    // Seed state cache so the first isOpen/withBreaker call avoids an HTTP round-trip.
    // Uses a longer TTL than runtime refreshes since bootstrap data is fresh.
    for (const breaker of breakers) {
      if (breaker.state) {
        this.mapBreakerIdToState.set(breaker.id, breaker.state, BOOTSTRAP_STATE_CACHE_TTL_MS)
        this.setLastKnownState(breaker.id, breaker.state)
      }
    }
  }

  public async listBreakers(systemId: string, signal?: AbortSignal): Promise<TBreaker[]> {
    const breakers: TBreaker[] = await this.api.listBreakers(systemId, signal)
    this.setMapping(systemId, breakers)
    return breakers
  }

  public async getBreakerStateBySlug(
    systemId: string,
    breakerSlug: string,
  ): Promise<TBreakerStateValue> {
    const breakerId = await this.resolveOrRefreshMapping(systemId, breakerSlug)
    return this.getStateById(systemId, breakerId)
  }

  public async getBreakerBySlug(
    systemId: string,
    breakerSlug: string,
    signal?: AbortSignal,
  ): Promise<TBreaker> {
    const breakerId = await this.resolveOrRefreshMapping(systemId, breakerSlug)
    return this.getBreakerById(systemId, breakerId, signal)
  }

  /** Returns null instead of throwing if the breaker is not found. */
  public async resolveBreakerId(systemId: string, breakerSlug: string): Promise<string | null> {
    try {
      return await this.resolveOrRefreshMapping(systemId, breakerSlug)
    } catch {
      return null
    }
  }
}
