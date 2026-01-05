export type TBreakerStateValue = 'open' | 'closed'

export type TBreaker = {
  id: string
  slug: string
  state: TBreakerStateValue
  updated_at?: string
  version?: number
}

export type TBootstrapResponse = {
  system: { id: string; slug: string }
  breakers: TBreaker[]
}

export type TBreakerStateResponse = {
  state: TBreakerStateValue
  updated_at?: string
  version?: number
}
