import { vi } from 'vitest'
import { AuthApi } from '../../../src/domains/auth/auth.api.ts'
import { BreakersApi } from '../../../src/domains/breakers/breakers.api.ts'
import { MetricsApi } from '../../../src/domains/metrics/metrics.api.ts'

export const setupAPISpies = () => ({
  auth: {
    bootstrap: vi.spyOn(AuthApi.prototype, 'bootstrap'),
    refreshToken: vi.spyOn(AuthApi.prototype, 'refreshToken'),
  },
  breakers: {
    listBreakers: vi.spyOn(BreakersApi.prototype, 'listBreakers'),
    getBreaker: vi.spyOn(BreakersApi.prototype, 'getBreaker'),
  },
  metrics: {
    ingest: vi.spyOn(MetricsApi.prototype, 'ingest'),
    listMetrics: vi.spyOn(MetricsApi.prototype, 'listMetrics'),
  },
})

export type TAPISpies = ReturnType<typeof setupAPISpies>

/**
 * Creates a mock fetch function for testing HTTP responses.
 * Use this in unit tests that need to mock global.fetch directly.
 */
export function createMockFetch(response: Partial<Response> & { ok: boolean; status: number }) {
  return vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ data: {} }),
    text: () => Promise.resolve(''),
    ...response,
  })
}

/**
 * Creates a mock AuthApi for testing TokenManager.
 */
export function createMockAuthApi() {
  return {
    bootstrap: vi.fn(),
    refreshToken: vi.fn(),
  } as unknown as AuthApi
}

/**
 * Creates a mock auth provider for testing Transport.
 */
export function createMockAuthProvider(token = 'test-token') {
  return {
    getAuthHeaders: vi.fn().mockResolvedValue({ authorization: `Bearer ${token}` }),
    onAuthFailure: vi.fn(),
  }
}
