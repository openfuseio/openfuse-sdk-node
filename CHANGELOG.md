# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-02-12

### Breaking Changes

- **Renamed constructor option:** `systemSlug` → `system` in both `Openfuse` and `OpenfuseCloud`
- **Renamed lifecycle methods:** `bootstrap()` → `init()`, `whenReady()` → `ready()`, `shutdown()` → `close()`, `invalidate()` → `reset()`
- **Renamed list method:** `listBreakers()` → `breakers()`
- **Replaced getter method:** `getInstanceId()` → `instanceId` (getter property)
- **New breaker access pattern:** `isOpen(slug)`, `isClosed(slug)`, `getBreaker(slug)`, and `withBreaker(slug, fn, opts)` replaced by `breaker(slug).isOpen()`, `.isClosed()`, `.status()`, and `.protect(fn, opts)` via the new `BreakerHandle` class
- **Renamed protect options:** `onOpen` → `fallback`; `onUnknown` removed (SDK always fail-opens)
- **Removed `CircuitOpenError`:** replaced by fail-open behavior — `protect()` no longer throws when breaker is open with no fallback; it logs a warning and executes the function
- **Removed `BreakerOpenError`:** dead export, never thrown by the SDK

### Added

- `BreakerHandle` class — stateless proxy returned by `client.breaker(slug)`
- `TProtectOptions` type export
- `APIError.statusCode` — optional numeric HTTP status code on API errors
- Smarter API health tracking: only 5xx/network/timeout errors mark the API as unhealthy (4xx no longer counts)
- TTL-based "not found" warning deduplication (re-warns after 5 min instead of permanent suppression)
- Non-retryable JSON parse errors in transport (wrapped as `APIError`)
- Environment-scoped URL rewrite moved to base `Openfuse` class (works for both cloud and self-hosted)

### Changed

- Minimum Node.js version lowered from 22.0.0 to 18.3.0
- Build target lowered from `node22` to `node18`
- `close()` now uses try/catch/finally to guarantee metrics teardown

## [0.2.0] - 2026-01-18

### Changed

- **BREAKING:** Simplified `OpenfuseCloud` constructor options

  Before:

  ```ts
  new OpenfuseCloud({
    region: 'us',
    company: 'acme',
    environment: 'prod',
    systemSlug: 'checkout',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
  })
  ```

  After:

  ```ts
  new OpenfuseCloud({
    systemSlug: 'checkout',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
  })
  ```

- **BREAKING:** Simplified `Openfuse` constructor options (self-hosted)

  Before:

  ```ts
  new Openfuse({
    endpointProvider: ...,
    tokenProvider: ...,
    scope: { company, environment, system },
  })
  ```

  After:

  ```ts
  new Openfuse({
    baseUrl: 'https://your-api.openfuse.io',
    systemSlug: 'checkout',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
  })
  ```

- **BREAKING:** Requires Openfuse Cloud API v1 endpoints

### Fixed

- SDK version in User-Agent header now stays in sync with package.json

## [0.1.1] - 2026-01-17

### Fixed

- CI: Updated npm publish to use OIDC instead of npm token

## [0.1.0] - 2026-01-17

### Added

- Initial release
- `Openfuse` client for self-hosted deployments
- `OpenfuseCloud` client for cloud deployments
- Circuit breaker state management (`isOpen`, `isClosed`, `getBreaker`, `listBreakers`)
- `withBreaker()` for protected function execution with fallbacks
- Automatic metrics collection and reporting
