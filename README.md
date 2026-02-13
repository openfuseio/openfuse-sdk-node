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
  system: 'checkout',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
})

client.init()

const recommendations = await client
  .breaker('recommendations')
  .protect(() => fetchRecommendations(userId), { fallback: () => [] })
```

If `recommendations` breaker is open, `fallback` returns an empty array immediately, no network call attempted.

## Breaker States

- **Closed** — Requests flow through normally
- **Open** — Requests blocked, fallback triggered
- **Half-Open** — Probe requests allowed to test recovery

## API Reference

### Lifecycle

| Method    | Description                                           |
| --------- | ----------------------------------------------------- |
| `init()`  | Fetch breaker configuration. Call once at startup.    |
| `ready()` | Resolves when init completes. Optional.               |
| `close()` | Flush metrics and clean up. Call before process exit. |
| `reset()` | Clear cached state and flush metrics.                 |

### Breaker Handle

| Method                            | Description                               |
| --------------------------------- | ----------------------------------------- |
| `breaker(slug).protect(fn, opts)` | Execute function with breaker protection. |
| `breaker(slug).isOpen()`          | Returns `true` if breaker is open.        |
| `breaker(slug).isClosed()`        | Returns `true` if breaker is closed.      |
| `breaker(slug).status(signal?)`   | Returns full breaker details.             |
| `breakers()`                      | Returns all breakers for the system.      |

### protect Options

```ts
await client.breaker('my-breaker').protect(() => doSomething(), {
  fallback: () => fallbackValue, // Called when breaker is open
  timeout: 5000, // Timeout in ms for the wrapped function
  signal: abortController.signal, // AbortSignal for cancellation
})
```

## Self-Hosted

```ts
import { Openfuse } from '@openfuseio/sdk'

const client = new Openfuse({
  baseUrl: 'https://openfuse.internal.mycompany.com',
  system: 'checkout',
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
})

client.init()
```

## License

[Elastic License 2.0](LICENSE)
