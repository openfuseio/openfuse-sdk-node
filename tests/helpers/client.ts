import { Openfuse, type TOpenfuseOptions } from '../../src/client/openfuse.ts'
import { TEST_CONFIG } from './constants.ts'

export type TCreateClientOptions = Partial<TOpenfuseOptions>

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
