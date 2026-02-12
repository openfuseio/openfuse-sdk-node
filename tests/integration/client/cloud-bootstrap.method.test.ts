import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpenfuseCloud } from '../../../src/client/openfuse-cloud.ts'
import { installFetchMock } from '../../helpers/mocks/fetch.mock.ts'
import { makeSdkBootstrapResponse, makeBreaker, makeSystem } from '../../helpers/factories.ts'

describe('OpenfuseCloud URL routing', () => {
  let fetchMock: ReturnType<typeof installFetchMock>

  const system = makeSystem()
  const breaker = makeBreaker({ state: 'closed' })

  const bootstrapResponse = makeSdkBootstrapResponse({
    system,
    breakers: [breaker],
  })
  bootstrapResponse.environment.slug = 'prod'
  bootstrapResponse.company.slug = 'acme'

  function createClient() {
    return new OpenfuseCloud({
      systemSlug: system.slug,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    })
  }

  beforeEach(() => {
    fetchMock = installFetchMock()
  })

  afterEach(() => {
    fetchMock.restore()
  })

  it('bootstrap calls POST https://api.openfuse.io/v1/sdk/auth/bootstrap', async () => {
    fetchMock.pushJson({ data: bootstrapResponse })

    const client = createClient()
    client.bootstrap()
    await client.whenReady()

    expect(fetchMock.calls).toHaveLength(1)
    expect(fetchMock.calls[0].url).toBe('https://api.openfuse.io/v1/sdk/auth/bootstrap')
    expect(fetchMock.calls[0].init?.method).toBe('POST')
  })

  it('after bootstrap, getBreaker calls the environment-specific URL', async () => {
    fetchMock.pushJson({ data: bootstrapResponse })
    fetchMock.pushJson({ data: breaker })

    const client = createClient()
    client.bootstrap()
    await client.whenReady()
    await client.getBreaker(breaker.slug)

    expect(fetchMock.calls).toHaveLength(2)
    expect(fetchMock.calls[1].url).toBe(
      `https://prod-acme.api.openfuse.io/v1/systems/${bootstrapResponse.system.id}/breakers/${breaker.id}`,
    )
  })

  it('after bootstrap, isOpen calls the environment-specific URL', async () => {
    // Bootstrap without breakers so state must be fetched from API
    fetchMock.pushJson({ data: { ...bootstrapResponse, breakers: [] } })
    fetchMock.pushJson({ data: [breaker] }) // listBreakers for slug→id mapping
    fetchMock.pushJson({ data: breaker }) // getBreaker for state

    const client = createClient()
    client.bootstrap()
    await client.whenReady()
    await client.isOpen(breaker.slug)

    expect(fetchMock.calls).toHaveLength(3)
    // Both post-bootstrap calls should use environment-specific URL
    expect(fetchMock.calls[1].url).toContain('https://prod-acme.api.openfuse.io/v1/systems/')
    expect(fetchMock.calls[2].url).toContain('https://prod-acme.api.openfuse.io/v1/systems/')
  })

  it('after bootstrap, listBreakers calls the environment-specific URL', async () => {
    fetchMock.pushJson({ data: bootstrapResponse })
    fetchMock.pushJson({ data: [breaker] })

    const client = createClient()
    client.bootstrap()
    await client.whenReady()
    await client.listBreakers()

    expect(fetchMock.calls).toHaveLength(2)
    expect(fetchMock.calls[1].url).toBe(
      `https://prod-acme.api.openfuse.io/v1/systems/${bootstrapResponse.system.id}/breakers`,
    )
  })

  it('after bootstrap, metrics ingest calls the environment-specific URL', async () => {
    const metricsResponse = makeSdkBootstrapResponse({
      system,
      breakers: [breaker],
      metricsConfig: { flushIntervalMs: 100, windowSizeMs: 50 },
    })
    metricsResponse.environment.slug = 'prod'
    metricsResponse.company.slug = 'acme'

    fetchMock.pushJson({ data: metricsResponse })
    // listMetrics (state is cached from bootstrap, no getBreaker call needed)
    fetchMock.pushJson({ data: [] })
    // metrics ingest
    fetchMock.pushJson({ data: { ingested: 1 } })

    const client = new OpenfuseCloud({
      systemSlug: system.slug,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      metrics: { flushIntervalMs: 100, windowSizeMs: 50 },
    })
    client.bootstrap()
    await client.whenReady()

    // Trigger a metric recording via withBreaker
    await client.withBreaker(breaker.slug, () => 'ok')

    // Wait for the flush interval to fire
    await new Promise((r) => setTimeout(r, 250))

    const metricsCall = fetchMock.calls.find((c) => c.url.includes('/v1/metrics'))
    expect(metricsCall).toBeDefined()
    expect(metricsCall?.url).toMatch(/^https:\/\/prod-acme\.api\.openfuse\.io\/v1\/metrics/)

    await client.shutdown()
  })
})
