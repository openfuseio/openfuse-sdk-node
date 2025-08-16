import { TTLCache } from '../../core/cache.ts'
import { NotFoundError } from '../../core/errors.ts'
import type { TCompanyEnvironmentSystemScope } from '../../core/types.ts'
import type { TBootstrapResponse } from '../../types/api.ts'
import type { TSystemsApi } from './system.api.ts'

export type TSystemFeatureOptions = {
  scope: TCompanyEnvironmentSystemScope
  api: TSystemsApi
}

/**
 * Resolves system slug to ID for a fixed scope and performs per-system bootstrap orchestration.
 * Caching is private to this feature.
 */
export class SystemFeature {
  private scope: TCompanyEnvironmentSystemScope
  private api: TSystemsApi
  private systemIdCache: TTLCache<string, string>

  constructor(options: TSystemFeatureOptions) {
    this.scope = options.scope
    this.api = options.api
    this.systemIdCache = new TTLCache<string, string>({ maximumEntries: 128 })
  }

  /**
   * Resolves the configured system slug to an ID. Cached for ~10 minutes keyed by
   * company/environment/system to remain safe if the same slug exists elsewhere.
   */
  public async resolveSystemId(signal?: AbortSignal): Promise<string> {
    const cacheKey: `${string}/${string}/${string}` = `${this.scope.companySlug}/${this.scope.environmentSlug}/${this.scope.systemSlug}`

    const cachedSystemId: string | undefined = this.systemIdCache.get(cacheKey)
    if (cachedSystemId) return cachedSystemId

    const system = await this.api.getSystemBySlug(this.scope.systemSlug, signal)
    if (!system || !system.id) {
      throw new NotFoundError(`System not found: ${this.scope.systemSlug}`)
    }

    this.systemIdCache.set(cacheKey, system.id, 10 * 60 * 1000)
    return system.id
  }

  /**
   * Calls the system bootstrap endpoint and converts the response to a slug -> id map.
   * Mapping is returned to the caller; cache of breaker mapping is owned by BreakersFeature.
   */
  public async bootstrapSystem(
    systemId: string,
    signal?: AbortSignal,
  ): Promise<{
    map: Map<string, string>
    etag?: string
    breakers?: TBootstrapResponse['breakers']
  }> {
    const response: TBootstrapResponse = await this.api.bootstrapSystem(systemId, signal)

    const mapping: Map<string, string> = new Map()
    for (const breaker of response.breakers) {
      mapping.set(breaker.slug, breaker.id)
    }

    return { map: mapping, breakers: response.breakers }
  }
}
