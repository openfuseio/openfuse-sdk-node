import { vi } from 'vitest'
import { BreakersApi } from '../../../src/domains/breakers/breakers.api.ts'
import { MetricsApi } from '../../../src/domains/metrics/metrics.api.ts'
import { SystemsApi } from '../../../src/domains/system/system.api.ts'

export const setupAPISpies = () => ({
  systems: {
    getSystemBySlug: vi.spyOn(SystemsApi.prototype, 'getSystemBySlug'),
    bootstrapSystem: vi.spyOn(SystemsApi.prototype, 'bootstrapSystem'),
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
