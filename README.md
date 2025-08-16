# OpenFuse SDK for Node.js

**Status:** MVP (read-only). **Zero runtime deps. Node LTS (22+).**

## Quickstart (Cloud)

```ts
import { OpenFuse } from '@openfuse/sdk'
import { CloudEndpoint } from '@openfuse/sdk/providers/endpoint/cloud-endpoint'
import { ApiKeySTSProvider } from '@openfuse/sdk/providers/auth/api-key-sts-provider'

const openFuse = new OpenFuse({
  endpointProvider: new CloudEndpoint('us'),
  tokenProvider: new ApiKeySTSProvider({ apiKey: process.env.OPENFUSE_API_KEY!, region: 'us' }),
  scope: { companySlug: 'acme', environmentSlug: 'prod', systemSlug: 'checkout' },
})

await openFuse.bootstrap() // Optional warm-up

const isPaymentOpen = await openFuse.isOpen('payment-gateway')

const result = await openFuse.withBreaker('payment-gateway', () => doPayment(), {
  onOpen: () => useFallback(),
  onUnknown: () => degradeGracefully(),
})
```

## Public API (MVP)

- `new OpenFuse({ endpointProvider, tokenProvider, scope })`
- `bootstrap()`
- `isOpen(breakerSlug: string)`
- `getBreaker(breakerSlug: string)`
- `listBreakers()`
- `withBreaker(breakerSlug: string, work, { onOpen?, onUnknown?, signal? })`
- `invalidate({ breakerSlug?, breakerId?, all? })`
