import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, ConfigurationError } from '../../../src/core/errors.ts'
import { Openfuse } from '../../../src/client/openfuse.ts'
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
    client.bootstrap()
    await client.whenReady()

    expect(mockAPI.auth.bootstrap).toHaveBeenCalledWith(
      system.slug,
      expect.objectContaining({
        instanceId: expect.any(String),
      }),
    )
  })

  it('bootstrap seeds slug->id AND state so reads hit no API at all', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()
    const open = await client.isOpen(breaker.slug)
    const closed = await client.isClosed(breaker.slug)

    expect(open).toBe(false)
    expect(closed).toBe(true)
    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('calling bootstrap twice re-seeds mapping and state (no API on subsequent reads)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValue(bootstrapResponse)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()
    client.bootstrap()
    await client.whenReady()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('invalidate() clears mapping so the next state read refreshes via listBreakers', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValue(bootstrapResponse)
    mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
    mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()
    await client.invalidate()
    await client.isOpen(breaker.slug)

    expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(bootstrapResponse.system.id)
  })

  it('bootstrap with empty breakers does not clear existing mapping or state', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    const bootstrapWithBreakers = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    const bootstrapWithoutBreakers = makeSdkBootstrapResponse({ system, breakers: [] })

    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapWithBreakers)
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapWithoutBreakers)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()
    client.bootstrap()
    await client.whenReady()
    const open = await client.isOpen(breaker.slug)

    expect(open).toBe(false)
    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('duplicate slugs in bootstrap: last one wins', async () => {
    const system = makeSystem()
    const slug = 'shared-slug'
    const b1 = makeBreaker({ slug, state: 'open' })
    const b2 = makeBreaker({ slug, state: 'closed' })

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [b1, b2] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()
    // b2 (closed) should win over b1 (open)
    const open = await client.isOpen(slug)

    expect(open).toBe(false)
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('bootstrap() logs AuthError instead of throwing (fire-and-forget)', async () => {
    const system = makeSystem()
    mockAPI.auth.bootstrap.mockRejectedValueOnce(new AuthError('nope'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[openfuse]'),
      expect.stringContaining('invalid credentials'),
    )
    errorSpy.mockRestore()
  })

  it('concurrent state reads after bootstrap served from cache (no API calls)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()
    const [a, b, c] = await Promise.all([
      client.isOpen(breaker.slug),
      client.isClosed(breaker.slug),
      client.isOpen(breaker.slug),
    ])

    expect(a).toBe(false)
    expect(b).toBe(true)
    expect(c).toBe(false)
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('getBreaker is called without AbortSignal (coalesced call is signal-isolated)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    // Bootstrap without breakers so state must be fetched from API
    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [] })
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)
    mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
    mockAPI.breakers.getBreaker.mockResolvedValueOnce(breaker)

    const client = createTestClient({ systemSlug: system.slug })
    client.bootstrap()
    await client.whenReady()

    await client.isOpen(breaker.slug)

    // Signal is NOT forwarded to the coalesced getBreaker work (signal isolation)
    expect(mockAPI.breakers.getBreaker).toHaveBeenCalledWith(
      bootstrapResponse.system.id,
      breaker.id,
    )
  })

  describe('constructor validation', () => {
    it('throws ConfigurationError for empty baseUrl', () => {
      expect(
        () =>
          new Openfuse({
            baseUrl: '',
            systemSlug: 'test',
            clientId: 'id',
            clientSecret: 'secret',
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError for empty systemSlug', () => {
      expect(
        () =>
          new Openfuse({
            baseUrl: 'https://api.test.com',
            systemSlug: '',
            clientId: 'id',
            clientSecret: 'secret',
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError for empty clientId', () => {
      expect(
        () =>
          new Openfuse({
            baseUrl: 'https://api.test.com',
            systemSlug: 'test',
            clientId: '',
            clientSecret: 'secret',
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError for empty clientSecret', () => {
      expect(
        () =>
          new Openfuse({
            baseUrl: 'https://api.test.com',
            systemSlug: 'test',
            clientId: 'id',
            clientSecret: '',
          }),
      ).toThrow(ConfigurationError)
    })
  })

  describe('bootstrap resilience', () => {
    it('transient error does not throw, SDK starts in fail-open mode', async () => {
      vi.useFakeTimers()
      const system = makeSystem()
      mockAPI.auth.bootstrap.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const client = createTestClient({ systemSlug: system.slug })
      // Should NOT throw
      client.bootstrap()
      await client.whenReady()

      // Should be in fail-open mode
      const open = await client.isOpen('any-breaker')
      expect(open).toBe(false) // fail-open

      await client.shutdown()
      vi.useRealTimers()
    })

    it('transient error triggers background retry that succeeds', async () => {
      vi.useFakeTimers()
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.auth.bootstrap
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(makeSdkBootstrapResponse({ system, breakers: [breaker] }))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      // Advance past the first retry delay (1s)
      await vi.advanceTimersByTimeAsync(1100)

      // After successful retry, SDK should work normally
      const open = await client.isOpen(breaker.slug)
      expect(open).toBe(false)

      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(2)
      await client.shutdown()
      vi.useRealTimers()
    })

    it('AuthError during bootstrap is logged without retry', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockAPI.auth.bootstrap.mockRejectedValueOnce(
        new AuthError('Authentication failed: invalid client credentials'),
      )

      const client = createTestClient()
      client.bootstrap()
      await client.whenReady()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[openfuse]'),
        expect.stringContaining('invalid credentials'),
      )
      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(1)
      errorSpy.mockRestore()
    })

    it('AuthError during retry stops further retries', async () => {
      vi.useFakeTimers()
      const system = makeSystem()

      mockAPI.auth.bootstrap
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new AuthError('invalid credentials'))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      // Advance past the first retry delay
      await vi.advanceTimersByTimeAsync(1100)

      // Advance past when a second retry would happen - should not fire
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(2)
      await client.shutdown()
      vi.useRealTimers()
    })

    it('shutdown cancels pending bootstrap retry', async () => {
      vi.useFakeTimers()
      const system = makeSystem()

      mockAPI.auth.bootstrap.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const client = createTestClient({ systemSlug: system.slug })
      client.bootstrap()
      await client.whenReady()

      await client.shutdown()

      // Advance past retry delay - should NOT trigger retry
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })

  describe('fail-safe cleanup before bootstrap', () => {
    it('shutdown() does not throw before bootstrap', async () => {
      const client = createTestClient()
      await expect(client.shutdown()).resolves.toBeUndefined()
    })

    it('flushMetrics() does not throw before bootstrap', async () => {
      const client = createTestClient()
      await expect(client.flushMetrics()).resolves.toBeUndefined()
    })

    it('stopMetrics() does not throw before bootstrap', () => {
      const client = createTestClient()
      expect(() => client.stopMetrics()).not.toThrow()
    })

    it('invalidate() does not throw before bootstrap', async () => {
      const client = createTestClient()
      await expect(client.invalidate()).resolves.toBeUndefined()
    })
  })
})
