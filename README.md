# Openfuse SDK for Node.js

**Status:** MVP (read-only). **Zero runtime deps. Node LTS (22+).**

## Quickstart (Cloud)

```ts
import { OpenfuseCloud } from '@openfuse/sdk'

const client = new OpenfuseCloud({
  region: 'us',
  company: 'acme',
  environment: 'prod',
  systemSlug: 'checkout',
  clientId: process.env.OPENFUSE_CLIENT_ID!,
  clientSecret: process.env.OPENFUSE_CLIENT_SECRET!,
})

await client.bootstrap()

const isPaymentOpen = await client.isOpen('payment-gateway')

const result = await client.withBreaker('payment-gateway', () => doPayment(), {
  onOpen: () => useFallback(),
  onUnknown: () => degradeGracefully(),
})
```

## Self-hosted / Advanced

```ts
import { Openfuse, KeycloakClientCredentialsProvider } from '@openfuse/sdk'

const client = new Openfuse({
  endpointProvider: { getApiBase: () => 'https://api.mycompany.com/v1' },
  tokenProvider: new KeycloakClientCredentialsProvider({
    keycloakUrl: 'https://auth.mycompany.com',
    realm: 'my-realm',
    clientId: '...',
    clientSecret: '...',
  }),
  scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: 'checkout' },
})
```

## Public API

- `bootstrap()` - Initialize SDK, fetch system config
- `isOpen(breakerSlug)` - Check if breaker is open
- `isClosed(breakerSlug)` - Check if breaker is closed
- `getBreaker(breakerSlug)` - Fetch breaker details
- `listBreakers()` - List all breakers
- `withBreaker(slug, fn, options)` - Execute with circuit breaker protection
- `invalidate()` - Clear cached breaker data
- `shutdown()` - Graceful shutdown
