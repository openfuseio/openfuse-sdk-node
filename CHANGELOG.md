# Changelog

All notable changes to this project will be documented in this file.

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
