import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError } from '../../../src/core/errors.ts'
import {
  createTestClient,
  makeSdkBootstrapResponse,
  makeBreaker,
  makeSystem,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.bootstrap', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bootstrap calls POST /sdk/bootstrap and stores token', async () => {
    const system = makeSystem()
    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()

    expect(mockAPI.auth.bootstrap).toHaveBeenCalledWith(
      system.slug,
      expect.objectContaining({
        instanceId: expect.any(String),
      }),
    )
  })

  it('bootstrap seeds slug→id so state reads do not refresh mapping', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
    mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()
    await client.isOpen(breaker.slug)
    await client.isClosed(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
      bootstrapResponse.system.id,
      breaker.id,
      undefined,
    )
  })

  it('calling bootstrap twice re-seeds mapping (no listBreakers on subsequent state reads)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValue(bootstrapResponse)
    mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()
    await client.bootstrap()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
  })

  it('invalidate() clears mapping so the next state read refreshes via listBreakers', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValue(bootstrapResponse)
    mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
    mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()
    await client.invalidate()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(
      bootstrapResponse.system.id,
      undefined,
    )
  })

  it('bootstrap with empty breakers does not clear existing mapping', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapWithBreakers = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    const bootstrapWithoutBreakers = makeSdkBootstrapResponse({ system, breakers: [] })

    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapWithBreakers)
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapWithoutBreakers)
    mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()
    await client.bootstrap()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
      bootstrapWithBreakers.system.id,
      breaker.id,
      undefined,
    )
  })

  it('duplicate slugs in bootstrap: last one wins', async () => {
    const system = makeSystem()
    const slug = 'shared-slug'
    const b1 = makeBreaker({ slug })
    const b2 = makeBreaker({ slug })

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [b1, b2] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
    mockAPI.breakers.getBreaker.mockResolvedValue(b2)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()
    await client.isOpen(slug)

    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
      bootstrapResponse.system.id,
      b2.id,
      undefined,
    )
  })

  it('bootstrap() propagates AuthError from API', async () => {
    const system = makeSystem()
    mockAPI.auth.bootstrap.mockRejectedValueOnce(new AuthError('nope'))

    const client = createTestClient({ systemSlug: system.slug })
    await expect(client.bootstrap()).rejects.toBeInstanceOf(AuthError)
  })

  it('coalesces concurrent state reads after bootstrap (single getBreaker call)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)

    mockAPI.breakers.getBreaker.mockImplementationOnce(async () => {
      await new Promise((res) => setTimeout(res, 15))
      return breaker
    })

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()
    await Promise.all([
      client.isOpen(breaker.slug),
      client.isClosed(breaker.slug),
      client.isOpen(breaker.slug),
    ])

    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledTimes(1)
  })

  it('passes AbortSignal through to getBreaker when provided', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
    mockAPI.breakers.getBreaker.mockResolvedValueOnce(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    await client.bootstrap()

    const ac = new AbortController()
    await client.isOpen(breaker.slug, ac.signal)

    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
      bootstrapResponse.system.id,
      breaker.id,
      ac.signal,
    )
  })
})
