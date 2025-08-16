import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenFuse } from '../../../src/client/openfuse.ts'
import { AuthError } from '../../../src/core/errors.ts'
import type { TEndpointProvider, TTokenProvider } from '../../../src/core/types.ts'
import { makeBootstrap, makeBreaker, makeState, makeSystem } from '../../helpers/factories.ts'
import { setupAPISpies } from '../../helpers/mocks/api.mock.ts'

const endpointProvider: TEndpointProvider = { getApiBase: () => 'https://api.test' }
const tokenProvider: TTokenProvider = { getToken: async () => 'token-123' }

describe('OpenFuse.bootstrap', () => {
  let mockAPI: ReturnType<typeof setupAPISpies>

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bootstrap resolves slug -> calls /bootstrap with system id', async () => {
    const system = makeSystem()
    mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(makeBootstrap({ system, breakers: [] }))

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()

    expect(mockAPI.systems.getSystemBySlug).toHaveBeenCalledWith(system.slug, undefined)
    expect(mockAPI.systems.bootstrapSystem).toHaveBeenCalledWith(system.id, undefined)
  })

  it('bootstrap seeds slug→id so state reads do not refresh mapping', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
      makeBootstrap({ system, breakers: [breaker] }),
    )
    mockAPI.breakers.getBreakerState.mockResolvedValue(makeState())

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()
    await client.isOpen(breaker.slug)
    await client.isClosed(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(breaker.id, undefined)
  })

  it('calling bootstrap twice re-seeds mapping (no listBreakers on subsequent state reads)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValue(
      makeBootstrap({ system, breakers: [breaker] }),
    )
    mockAPI.breakers.getBreakerState.mockResolvedValue(makeState())

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()
    await client.bootstrap()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledTimes(1)
  })

  it('invalidate() clears mapping so the next state read refreshes via listBreakers', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValue(
      makeBootstrap({ system, breakers: [breaker] }),
    )
    mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
    mockAPI.breakers.getBreakerState.mockResolvedValue(makeState())

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()
    client.invalidate()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(system.id, undefined)
  })

  it('bootstrap with empty breakers does not clear existing mapping', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    mockAPI.systems.getSystemBySlug.mockResolvedValue(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
      makeBootstrap({ system, breakers: [breaker] }),
    )

    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(makeBootstrap({ system, breakers: [] }))

    mockAPI.breakers.getBreakerState.mockResolvedValue(makeState())

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()
    await client.bootstrap()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(breaker.id, undefined)
  })

  it('duplicate slugs in bootstrap: last one wins', async () => {
    const system = makeSystem()
    const slug = 'shared-slug'
    const b1 = makeBreaker({ slug })
    const b2 = makeBreaker({ slug })

    mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
      makeBootstrap({ system, breakers: [b1, b2] }),
    )
    mockAPI.breakers.getBreakerState.mockResolvedValue(makeState())

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()
    await client.isOpen(slug)

    expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(b2.id, undefined)
  })

  it('bootstrap() propagates AuthError from API', async () => {
    const system = makeSystem()

    mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
    mockAPI.systems.bootstrapSystem.mockRejectedValueOnce(new AuthError('nope'))

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await expect(client.bootstrap()).rejects.toBeInstanceOf(AuthError)
  })

  it('coalesces concurrent state reads after bootstrap (single getBreakerState call)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
      makeBootstrap({ system, breakers: [breaker] }),
    )

    mockAPI.breakers.getBreakerState.mockImplementationOnce(async () => {
      await new Promise((res) => setTimeout(res, 15))
      return makeState()
    })

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()
    await Promise.all([
      client.isOpen(breaker.slug),
      client.isClosed(breaker.slug),
      client.isOpen(breaker.slug),
    ])

    expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledTimes(1)
  })

  it('passes AbortSignal through to getBreakerState when provided', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    mockAPI.systems.getSystemBySlug.mockResolvedValueOnce(system)
    mockAPI.systems.bootstrapSystem.mockResolvedValueOnce(
      makeBootstrap({ system, breakers: [breaker] }),
    )
    mockAPI.breakers.getBreakerState.mockResolvedValueOnce(makeState())

    const client = new OpenFuse({
      endpointProvider,
      tokenProvider,
      scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: system.slug },
    })

    await client.bootstrap()

    const ac = new AbortController()
    await client.isOpen(breaker.slug, ac.signal)

    expect(mockAPI.breakers.getBreakerState).toHaveBeenCalledWith(breaker.id, ac.signal)
  })
})
