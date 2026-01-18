export type TFixtureConfig = {
  systemSlug: string | undefined
  breakerSlug: string | undefined
}

export type TRequiredFixtureConfig = {
  systemSlug: string
  breakerSlug: string
}

export type TFixtures = {
  failureRate: TFixtureConfig
  latency: TFixtureConfig
}

export const E2E_FIXTURES: TFixtures = {
  failureRate: {
    systemSlug: process.env.E2E_FIXTURE_SYSTEM_SLUG,
    breakerSlug: process.env.E2E_FIXTURE_BREAKER_SLUG,
  },
  latency: {
    systemSlug: process.env.E2E_FIXTURE_LATENCY_SYSTEM_SLUG ?? process.env.E2E_FIXTURE_SYSTEM_SLUG,
    breakerSlug: process.env.E2E_FIXTURE_LATENCY_BREAKER_SLUG,
  },
}

function isComplete(config: TFixtureConfig): config is TRequiredFixtureConfig {
  return !!(config.systemSlug && config.breakerSlug)
}

export function hasFailureRateFixtures(): boolean {
  return isComplete(E2E_FIXTURES.failureRate)
}

export function getFailureRateFixtures(): TRequiredFixtureConfig {
  if (!hasFailureRateFixtures()) {
    throw new Error(
      'Failure-rate fixtures not configured. Check E2E_FIXTURE_* environment variables.',
    )
  }
  return E2E_FIXTURES.failureRate as TRequiredFixtureConfig
}

export function hasLatencyFixtures(): boolean {
  return isComplete(E2E_FIXTURES.latency)
}

export function getLatencyFixtures(): TRequiredFixtureConfig {
  if (!hasLatencyFixtures()) {
    throw new Error(
      'Latency fixtures not configured. Check E2E_FIXTURE_LATENCY_* environment variables.',
    )
  }
  return E2E_FIXTURES.latency as TRequiredFixtureConfig
}

// Aliases
export const hasLifecycleFixtures = hasFailureRateFixtures
export const getLifecycleFixtures = getFailureRateFixtures
