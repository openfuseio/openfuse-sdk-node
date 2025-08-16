import { CircuitOpenError } from '../core/errors.ts'
import { Transport } from '../core/transport.ts'
import type {
  TCompanyEnvironmentSystemScope,
  TEndpointProvider,
  TTokenProvider,
} from '../core/types.ts'
import { BreakersApi } from '../domains/breakers/breakers.api.ts'
import { BreakersFeature } from '../domains/breakers/breakers.feature.ts'
import { SystemsApi } from '../domains/system/system.api.ts'
import { SystemFeature } from '../domains/system/system.feature.ts'
import type { TBreaker } from '../types/api.ts'

type TOpenFuseOptions = {
  endpointProvider: TEndpointProvider
  tokenProvider: TTokenProvider
  scope: TCompanyEnvironmentSystemScope
}

/**
 * Public SDK surface for OpenFuse (cloud, read-only).
 * Cache mechanics are encapsulated within features; client exposes domain operations.
 */
export class OpenFuse {
  private transport: Transport
  private systemFeature: SystemFeature
  private breakersFeature: BreakersFeature

  constructor(options: TOpenFuseOptions) {
    this.transport = new Transport({
      endpointProvider: options.endpointProvider,
      tokenProvider: options.tokenProvider,
    })

    const breakersApi = new BreakersApi({ transport: this.transport })
    const systemsApi = new SystemsApi({ transport: this.transport })

    this.systemFeature = new SystemFeature({ scope: options.scope, api: systemsApi })
    this.breakersFeature = new BreakersFeature({ api: breakersApi })
  }

  /** Bootstraps the system-level slug→id mapping by calling a domain read. */
  public async bootstrap(): Promise<void> {
    const systemId: string = await this.systemFeature.resolveSystemId()

    const boot = await this.systemFeature.bootstrapSystem(systemId)
    if (boot.breakers && boot.breakers.length > 0) {
      this.breakersFeature.ingestBootstrap(systemId, boot.breakers)
      return
    }
  }

  /** Returns true if the breaker addressed by slug is open. */
  public async isOpen(breakerSlug: string, signal?: AbortSignal): Promise<boolean> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    const state = await this.breakersFeature.getBreakerStateBySlug(systemId, breakerSlug, signal)
    return state === 'open'
  }

  /** Returns true if the breaker addressed by slug is closed. */
  public async isClosed(breakerSlug: string, signal?: AbortSignal): Promise<boolean> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    const state = await this.breakersFeature.getBreakerStateBySlug(systemId, breakerSlug, signal)
    return state === 'closed'
  }

  /** Returns the breaker model addressed by slug. */
  public async getBreaker(breakerSlug: string): Promise<TBreaker> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    return await this.breakersFeature.getBreakerBySlug(systemId, breakerSlug)
  }

  /** Returns all breakers for the configured system (and hydrates mapping internally). */
  public async listBreakers(): Promise<TBreaker[]> {
    const systemId: string = await this.systemFeature.resolveSystemId()
    return await this.breakersFeature.listBreakers(systemId)
  }

  /**
   * Executes a function only if the breaker is CLOSED.
   * If the breaker is OPEN, either calls the provided onOpen fallback or throws.
   * If the state is unknown (e.g., network failure), either calls onUnknown or rethrows.
   */
  public async withBreaker<T>(
    breakerSlug: string,
    work: () => Promise<T> | T,
    options?: {
      onOpen?: () => Promise<T> | T
      onUnknown?: () => Promise<T> | T
      signal?: AbortSignal
    },
  ): Promise<T> {
    const { onOpen, onUnknown, signal } = options ?? {}

    let isBreakerOpen: boolean
    try {
      isBreakerOpen = await this.isOpen(breakerSlug, signal)
    } catch (err) {
      if (onUnknown) return await onUnknown()
      throw err
    }

    if (!isBreakerOpen) {
      return await work()
    }

    if (onOpen) return await onOpen()
    throw new CircuitOpenError(`Breaker is open: ${breakerSlug}`)
  }

  /**
   * Broad cache invalidation.
   * No cache APIs are exposed; resetting the feature instance discards caches.
   */
  public invalidate(): void {
    const breakersApi = new BreakersApi({ transport: this.transport })
    this.breakersFeature = new BreakersFeature({ api: breakersApi })
  }
}
