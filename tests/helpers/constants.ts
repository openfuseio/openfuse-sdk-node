/**
 * Shared test constants for unit and integration tests.
 * Use these defaults across all tests for consistency.
 */
export const TEST_CONFIG = {
  baseUrl: 'https://api.test.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  system: 'test-system',
} as const

export type TTestConfig = typeof TEST_CONFIG
