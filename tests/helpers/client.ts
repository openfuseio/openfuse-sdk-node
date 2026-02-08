import { OpenfuseCloud, type TOpenfuseCloudOptions } from '../../src/client/openfuse-cloud.ts'
import { Openfuse, type TOpenfuseOptions } from '../../src/client/openfuse.ts'
import { TEST_CONFIG } from './constants.ts'

export type TCreateClientOptions = Partial<TOpenfuseOptions>
export type TCreateCloudClientOptions = Partial<TOpenfuseCloudOptions>

/**
 * Creates an Openfuse client with test defaults.
 * All options can be overridden.
 */
export function createTestClient(overrides?: TCreateClientOptions): Openfuse {
  return new Openfuse({
    baseUrl: TEST_CONFIG.baseUrl,
    systemSlug: TEST_CONFIG.systemSlug,
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
    systemSlug: TEST_CONFIG.systemSlug,
    clientId: TEST_CONFIG.clientId,
    clientSecret: TEST_CONFIG.clientSecret,
    ...overrides,
  })
}
