import { faker } from '@faker-js/faker'

export type TExposedSystemDTO = {
  id: string
  name: string
  slug: string
  description: string | null
  createdBy: string
  createdAt: string
  updatedAt: string | null
}

export type TExposedBreakerDTO = {
  id: string
  name: string
  slug: string
  state: 'open' | 'closed'
  description: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export type TBootstrapResponse = { system: TExposedSystemDTO; breakers: TExposedBreakerDTO[] }
export type TBreakerStateResponse = { state: TExposedBreakerDTO['state'] }

export function makeSystem(overrides?: Partial<TExposedSystemDTO>): TExposedSystemDTO {
  const now = new Date().toISOString()
  const name = faker.airline.airplane().name

  return {
    id: overrides?.id ?? faker.string.uuid(),
    name: overrides?.name ?? name,
    slug: overrides?.slug ?? faker.helpers.slugify(name).toLowerCase(),
    description: overrides?.description ?? faker.lorem.sentence(),
    createdBy: overrides?.createdBy ?? faker.string.uuid(),
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  }
}

export function makeBreaker(overrides?: Partial<TExposedBreakerDTO>): TExposedBreakerDTO {
  const now = new Date().toISOString()
  const name = faker.hacker.noun()

  return {
    id: overrides?.id ?? faker.string.uuid(),
    name: overrides?.name ?? name,
    slug: overrides?.slug ?? faker.helpers.slugify(name).toLowerCase(),
    state: overrides?.state ?? faker.helpers.arrayElement(['open', 'closed']),
    description: overrides?.description ?? faker.lorem.sentence(),
    createdBy: overrides?.createdBy ?? faker.string.uuid(),
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  }
}

export function makeState(overrides?: Partial<TBreakerStateResponse>): TBreakerStateResponse {
  return {
    state: overrides?.state ?? faker.helpers.arrayElement(['open', 'closed']),
  }
}

export function makeBootstrap({
  system,
  breakers,
}: {
  system: Partial<TExposedSystemDTO>
  breakers: Partial<TExposedBreakerDTO>[]
}): TBootstrapResponse {
  const madeSystem = makeSystem(system)

  const madeBreakers: TExposedBreakerDTO[] = []

  if (breakers) {
    for (const overrides of breakers) {
      madeBreakers.push(makeBreaker(overrides))
    }
  } else {
    const breakersCount = faker.helpers.rangeToNumber({ min: 1, max: 10 })
    for (let i = 0; i < breakersCount; i++) {
      madeBreakers.push(makeBreaker())
    }
  }
  return { system: madeSystem, breakers: madeBreakers }
}
