# Openfuse SDK for Node.js

[![npm version](https://img.shields.io/npm/v/@openfuseio/sdk.svg)](https://www.npmjs.com/package/@openfuseio/sdk)
[![License](https://img.shields.io/badge/License-Elastic%202.0-blue.svg)](https://www.elastic.co/licensing/elastic-license)

Node.js client for the Openfuse circuit breaker service. Zero runtime dependencies.

## Installation

```bash
npm install @openfuseio/sdk
```

## Requirements

- Node.js >= 22.0.0
- [Openfuse account](https://openfuse.io) with an SDK client configured

## Usage

```ts
import { OpenfuseCloud } from '@openfuseio/sdk'

const client = new OpenfuseCloud({
  systemSlug: 'checkout',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
})

await client.bootstrap()

const recommendations = await client.withBreaker(
  'recommendations',
  () => fetchRecommendations(userId),
  { onOpen: () => [] },
)
```

If `recommendations` breaker is open, `onOpen` returns an empty array immediately, no network call attempted.

## Circuit Breaker States

- **Closed** — Requests flow through normally
- **Open** — Requests blocked, fallback triggered
- **Half-Open** — Probe requests allowed to test recovery

## API Reference

### Core Methods

| Method                        | Description                                           |
| ----------------------------- | ----------------------------------------------------- |
| `bootstrap()`                 | Fetch breaker configuration. Call once at startup.    |
| `withBreaker(slug, fn, opts)` | Execute function with circuit breaker protection.     |
| `shutdown()`                  | Flush metrics and clean up. Call before process exit. |

### State Methods

| Method                    | Description                           |
| ------------------------- | ------------------------------------- |
| `isOpen(slug, signal?)`   | Returns `true` if breaker is open.    |
| `isClosed(slug, signal?)` | Returns `true` if breaker is closed.  |
| `getBreaker(slug)`        | Returns breaker details.              |
| `listBreakers()`          | Returns all breakers for the system.  |
| `invalidate()`            | Clear cached state and flush metrics. |

### withBreaker Options

```ts
await client.withBreaker('my-breaker', () => doSomething(), {
  onOpen: () => fallbackValue, // Called when breaker is open
  onUnknown: () => degradedValue, // Called when state can't be determined
  timeout: 5000, // Timeout in ms for the wrapped function
  signal: abortController.signal, // AbortSignal for cancellation
})
```

## Self-Hosted

```ts
import { Openfuse } from '@openfuseio/sdk'

const client = new Openfuse({
  baseUrl: 'https://openfuse.internal.mycompany.com',
  systemSlug: 'checkout',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
})

await client.bootstrap()
```

## License

[Elastic License 2.0](LICENSE)
