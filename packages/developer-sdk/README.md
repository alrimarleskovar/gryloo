# FloFi Developer SDK (TypeScript)

A thin, dependency-free client for the FloFi Developer API v1. **Server-side only.**

> Developers build the experience. FloFi handles the DeFi workflow lifecycle.

Your API key lets your server compose, validate and simulate FloFi strategies and ask an end user for approval. It has **zero
financial authority**: it never signs, submits or approves anything. The end user opens the FloFi approval link, proves their own
wallet, runs a fresh simulation, reviews the Strategy Manifest and signs — or not.

```ts
import { FloFi, verifyWebhook } from '@defi-workflow-engine/developer-sdk';

const flofi = new FloFi({ apiKey: process.env.FLOFI_API_KEY!, baseUrl: 'https://<your FloFi deployment>' });
const strategy = await flofi.strategies.create({ strategy: {
  action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' } });
await flofi.strategies.validate(strategy.id);
const approval = await flofi.approvals.create({ strategy });
// Send approval.approvalUrl to your user. Then poll flofi.approvals.get(approval.id) or receive webhooks:
const event = await verifyWebhook({ payload: rawBody, headers: request.headers, secret: process.env.FLOFI_WEBHOOK_SECRET! });
```

- Errors are `FloFiError { status, code, reason, requestId, issues, retryAfter }`; webhook problems are `FloFiWebhookError`.
- Creating calls send an `Idempotency-Key` (yours, or a random one reused across the client's own retries).
- Only safe requests are retried (GETs and keyed POSTs; network errors, 429, 502, 503, 504; `Retry-After` honoured).
- Webhooks: verify the raw body, accept both secrets while rotating, and deduplicate on `webhook-id`.

Full guide: `docs/developer/QUICKSTART.md`; reference: `docs/developer/API.md` and `docs/developer/openapi.json`.
The package is private in this repository (npm publication is not authorized). Licensed under Apache-2.0.
