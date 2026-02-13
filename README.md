# Openfuse SDK for Node.js

[![npm version](https://img.shields.io/npm/v/@openfuseio/sdk.svg)](https://www.npmjs.com/package/@openfuseio/sdk)
[![License](https://img.shields.io/badge/License-Elastic%202.0-blue.svg)](https://www.elastic.co/licensing/elastic-license)

Node.js client for the [Openfuse](https://openfuse.io) circuit breaker service. Zero runtime dependencies.

> **[Read the full documentation](https://www.openfuse.io/docs)**

## Installation

```bash
npm install @openfuseio/sdk
```

**Requirements:** Node.js >= 18.3 and an [Openfuse account](https://openfuse.io) with an SDK client configured.

## Quick start

```ts
import { OpenfuseCloud } from '@openfuseio/sdk'

const openfuse = new OpenfuseCloud({
  system: 'payments',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
})

openfuse.init()

const customer = await openfuse
  .breaker('stripe-get-customer')
  .protect(() => stripe.customers.retrieve(customerId), { fallback: () => cachedCustomer })
```

If the `stripe-get-customer` breaker is open, `fallback` returns immediately — no network call attempted.

## Documentation

- **[Quickstart](https://www.openfuse.io/docs/quickstart)** — Zero to a protected call in under 2 minutes
- **[Protecting calls](https://www.openfuse.io/docs/guides/protecting-calls)** — Timeouts, fallbacks, and cancellation
- **[Error handling](https://www.openfuse.io/docs/guides/error-handling)** — Which methods throw and how to handle them
- **[Configuration](https://www.openfuse.io/docs/guides/configuration)** — All client options for cloud and self-hosted
- **[API reference](https://www.openfuse.io/docs/reference/client)** — Full API reference

## Self-hosted

```ts
import { Openfuse } from '@openfuseio/sdk'

const openfuse = new Openfuse({
  baseUrl: 'https://openfuse.your-domain.com',
  system: 'payments',
  clientId: 'YOUR_CLIENT_ID',
  clientSecret: 'YOUR_CLIENT_SECRET',
})

openfuse.init()
```

## License

[Elastic License 2.0](LICENSE)
