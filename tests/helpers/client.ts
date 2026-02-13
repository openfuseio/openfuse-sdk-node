import { OpenfuseCloud, type TOpenfuseCloudOptions } from '../../src/client/openfuse-cloud.ts'
import { Openfuse, type TOpenfuseOptions } from '../../src/client/openfuse.ts'
import type { TBreakerStateValue, TSdkBootstrapResponse } from '../../src/types/api.ts'
import { TEST_CONFIG } from './constants.ts'
import {
  makeBreaker,
  makeSdkBootstrapResponse,
  makeSystem,
  type TTestBreaker,
  type TTestSystem,
} from './factories.ts'
import type { TAPISpies } from './mocks/api.mock.ts'

export type TCreateClientOptions = Partial<TOpenfuseOptions>
export type TCreateCloudClientOptions = Partial<TOpenfuseCloudOptions>

/**
 * Creates an Openfuse client with test defaults.
 * All options can be overridden.
 */
export function createTestClient(overrides?: TCreateClientOptions): Openfuse {
  return new Openfuse({
    baseUrl: TEST_CONFIG.baseUrl,
    system: TEST_CONFIG.system,
    clientId: TEST_CONFIG.clientId,
    clientSecret: TEST_CONFIG.clientSecret,
    ...overrides,
  })
}

/**
 * Creates an OpenfuseCloud client with test defaults.
 * All options can be overridden.
 */
export function createTestCloudClient(overrides?: TCreateCloudClientOptions): OpenfuseCloud {
  return new OpenfuseCloud({
    system: TEST_CONFIG.system,
    clientId: TEST_CONFIG.clientId,
    clientSecret: TEST_CONFIG.clientSecret,
    ...overrides,
  })
}

export type TBootstrapClientOptions = {
  breakerState?: TBreakerStateValue
  /** If false, bootstrap response won't include breakers (for testing API-fetch paths). Default: true */
  seedBreakers?: boolean
  clientOverrides?: TCreateClientOptions
}

export type TBootstrapClientResult = {
  system: TTestSystem
  breaker: TTestBreaker
  bootstrapResponse: TSdkBootstrapResponse
  client: Openfuse
}

/**
 * Standard test bootstrap: creates fixtures, mocks the bootstrap API call,
 * creates a client, and calls init()/ready().
 *
 * Use `seedBreakers: false` to test code paths that fetch state from the API.
 */
export async function bootstrapClient(
  mockAPI: TAPISpies,
  opts?: TBootstrapClientOptions,
): Promise<TBootstrapClientResult> {
  const system = makeSystem()
  const breaker = makeBreaker({ state: opts?.breakerState })
  const seedBreakers = opts?.seedBreakers !== false

  const bootstrapResponse = makeSdkBootstrapResponse({
    system,
    breakers: seedBreakers ? [breaker] : [],
  })
  mockAPI.auth.bootstrap.mockResolvedValueOnce(bootstrapResponse)

  const client = createTestClient({ system: system.slug, ...opts?.clientOverrides })
  client.init()
  await client.ready()

  return { system, breaker, bootstrapResponse, client }
}
