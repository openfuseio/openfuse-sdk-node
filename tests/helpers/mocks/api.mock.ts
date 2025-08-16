import { vi } from 'vitest'
import { BreakersApi } from '../../../src/domains/breakers/breakers.api.ts'
import { SystemsApi } from '../../../src/domains/system/system.api.ts'

export const setupAPISpies = () => ({
  systems: {
    getSystemBySlug: vi.spyOn(SystemsApi.prototype, 'getSystemBySlug'),
    bootstrapSystem: vi.spyOn(SystemsApi.prototype, 'bootstrapSystem'),
  },
  breakers: {
    listBreakers: vi.spyOn(BreakersApi.prototype, 'listBreakers'),
    getBreaker: vi.spyOn(BreakersApi.prototype, 'getBreaker'),
    getBreakerState: vi.spyOn(BreakersApi.prototype, 'getBreakerState'),
  },
})

export type TAPISpies = ReturnType<typeof setupAPISpies>
