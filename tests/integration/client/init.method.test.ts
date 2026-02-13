import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, ConfigurationError } from '../../../src/core/errors.ts'
import { Openfuse } from '../../../src/client/openfuse.ts'
import {
  bootstrapClient,
  createTestClient,
  makeSdkBootstrapResponse,
  makeBreaker,
  makeSystem,
  setupAPISpies,
  type TAPISpies,
} from '../../helpers/index.ts'

describe('Openfuse.init', () => {
  let mockAPI: TAPISpies

  beforeEach(() => {
    mockAPI = setupAPISpies()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('init calls POST /sdk/bootstrap and stores token', async () => {
    const { system } = await bootstrapClient(mockAPI)

    expect(mockAPI.auth.bootstrap).toHaveBeenCalledWith(
      system.slug,
      expect.objectContaining({
        instanceId: expect.any(String),
      }),
    )
  })

  it('init seeds slug->id AND state so reads hit no API at all', async () => {
    const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })

    const isDown = await client.breaker(breaker.slug).isOpen()
    const isUp = await client.breaker(breaker.slug).isClosed()

    expect(isDown).toBe(false)
    expect(isUp).toBe(true)
    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('calling init twice re-seeds mapping and state (no API on subsequent reads)', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValue(bootstrapResponse)

    const client = createTestClient({ system: system.slug })
    client.init()
    await client.ready()
    client.init()
    await client.ready()
    await client.breaker(breaker.slug).isOpen()

    expect(mockAPI.breakers.listBreakers).not.toHaveBeenCalled()
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('reset() clears mapping so the next state read refreshes via listBreakers', async () => {
    const system = makeSystem()
    const breaker = makeBreaker()

    const bootstrapResponse = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    mockAPI.auth.bootstrap.mockResolvedValue(bootstrapResponse)
    mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
    mockAPI.breakers.getBreaker.mockResolvedValue(breaker)

    const client = createTestClient({ system: system.slug })
    client.init()
    await client.ready()
    await client.reset()
    await client.breaker(breaker.slug).isOpen()

    expect(mockAPI.breakers.listBreakers).toHaveBeenCalledWith(bootstrapResponse.system.id)
  })

  it('init with empty breakers does not clear existing mapping or state', async () => {
    const system = makeSystem()
    const breaker = makeBreaker({ state: 'closed' })

    const bootstrapWithBreakers = makeSdkBootstrapResponse({ system, breakers: [breaker] })
    const bootstrapWithoutBreakers = makeSdkBootstrapResponse({ system, breakers: [] })

    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapWithBreakers)
    mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapWithoutBreakers)

    const client = createTestClient({ system: system.slug })
    client.init()
    await client.ready()
    client.init()
    await client.ready()
    const isDown = await client.breaker(breaker.slug).isOpen()

    expect(isDown).toBe(false)
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

    const client = createTestClient({ system: system.slug })
    client.init()
    await client.ready()
    // b2 (closed) should win over b1 (open)
    const isDown = await client.breaker(slug).isOpen()

    expect(isDown).toBe(false)
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('init() logs AuthError instead of throwing (fire-and-forget)', async () => {
    const system = makeSystem()
    mockAPI.auth.bootstrap.mockRejectedValueOnce(new AuthError('nope'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = createTestClient({ system: system.slug })
    client.init()
    await client.ready()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[openfuse]'),
      expect.stringContaining('invalid credentials'),
    )
    errorSpy.mockRestore()
  })

  it('concurrent state reads after init served from cache (no API calls)', async () => {
    const { breaker, client } = await bootstrapClient(mockAPI, { breakerState: 'closed' })

    const handle = client.breaker(breaker.slug)
    const [a, b, c] = await Promise.all([handle.isOpen(), handle.isClosed(), handle.isOpen()])

    expect(a).toBe(false)
    expect(b).toBe(true)
    expect(c).toBe(false)
    expect(mockAPI.breakers.getBreaker).not.toHaveBeenCalled()
  })

  it('getBreaker is called without AbortSignal (coalesced call is signal-isolated)', async () => {
    // Bootstrap without breakers so state must be fetched from API
    const { breaker, bootstrapResponse, client } = await bootstrapClient(mockAPI, {
      breakerState: 'closed',
      seedBreakers: false,
    })
    mockAPI.breakers.listBreakers.mockResolvedValue([breaker])
    mockAPI.breakers.getBreaker.mockResolvedValueOnce(breaker)

    await client.breaker(breaker.slug).isOpen()

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
            system: 'test',
            clientId: 'id',
            clientSecret: 'secret',
          }),
      ).toThrow(ConfigurationError)
    })

    it('throws ConfigurationError for empty system', () => {
      expect(
        () =>
          new Openfuse({
            baseUrl: 'https://api.test.com',
            system: '',
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
            system: 'test',
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
            system: 'test',
            clientId: 'id',
            clientSecret: '',
          }),
      ).toThrow(ConfigurationError)
    })
  })

  describe('init resilience', () => {
    it('transient error does not throw, SDK starts in fail-open mode', async () => {
      vi.useFakeTimers()
      const system = makeSystem()
      mockAPI.auth.bootstrap.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const client = createTestClient({ system: system.slug })
      // Should NOT throw
      client.init()
      await client.ready()

      // Should be in fail-open mode
      const isDown = await client.breaker('any-breaker').isOpen()
      expect(isDown).toBe(false) // fail-open

      await client.close()
      vi.useRealTimers()
    })

    it('transient error triggers background retry that succeeds', async () => {
      vi.useFakeTimers()
      const system = makeSystem()
      const breaker = makeBreaker({ state: 'closed' })

      mockAPI.auth.bootstrap
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(makeSdkBootstrapResponse({ system, breakers: [breaker] }))

      const client = createTestClient({ system: system.slug })
      client.init()
      await client.ready()

      // Advance past the first retry delay (1s)
      await vi.advanceTimersByTimeAsync(1100)

      // After successful retry, SDK should work normally
      const isDown = await client.breaker(breaker.slug).isOpen()
      expect(isDown).toBe(false)

      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(2)
      await client.close()
      vi.useRealTimers()
    })

    it('AuthError during init is logged without retry', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockAPI.auth.bootstrap.mockRejectedValueOnce(
        new AuthError('Authentication failed: invalid client credentials'),
      )

      const client = createTestClient()
      client.init()
      await client.ready()

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

      const client = createTestClient({ system: system.slug })
      client.init()
      await client.ready()

      // Advance past the first retry delay
      await vi.advanceTimersByTimeAsync(1100)

      // Advance past when a second retry would happen - should not fire
      await vi.advanceTimersByTimeAsync(5000)

      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(2)
      await client.close()
      vi.useRealTimers()
    })

    it('close cancels pending init retry', async () => {
      vi.useFakeTimers()
      const system = makeSystem()

      mockAPI.auth.bootstrap.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const client = createTestClient({ system: system.slug })
      client.init()
      await client.ready()

      await client.close()

      // Advance past retry delay - should NOT trigger retry
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockAPI.auth.bootstrap).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })

  describe('fail-safe cleanup before init', () => {
    it('close() does not throw before init', async () => {
      const client = createTestClient()
      await expect(client.close()).resolves.toBeUndefined()
    })

    it('flushMetrics() does not throw before init', async () => {
      const client = createTestClient()
      await expect(client.flushMetrics()).resolves.toBeUndefined()
    })

    it('stopMetrics() does not throw before init', () => {
      const client = createTestClient()
      expect(() => client.stopMetrics()).not.toThrow()
    })

    it('reset() does not throw before init', async () => {
      const client = createTestClient()
      await expect(client.reset()).resolves.toBeUndefined()
    })
  })
})
