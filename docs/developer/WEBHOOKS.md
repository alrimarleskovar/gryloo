# FloFi Developer API — Webhooks

FloFi tells your server when an approval or a shared execution changes, with signed HTTPS `POST`s that follow
[Standard Webhooks](https://www.standardwebhooks.com/). Webhooks are **notifications, never inputs**: no FloFi state depends on
a delivery or on your response. A failing endpoint never blocks or alters an approval, a claim, a run or an API answer.

## Events

| Type | When | `data` (beyond `approvalId`, `strategyId`, `workflowHash`) |
| --- | --- | --- |
| `approval.claimed` | a wallet proved ownership and claimed the approval in FloFi | `status: "CLAIMED"` |
| `approval.applied` | the proposal is in the owner's FloFi workflow (Review and signature still ahead) | `status: "APPLIED"` |
| `approval.ended` | the approval ended without (further) use | `status`: `EXPIRED`, `SUPERSEDED`, `REVOKED` or `STALE` |
| `execution.started` | a run of this approval was first seen (only while the owner shares status) | `executionId` |
| `execution.failed` | that run ended with an error, unreconciled | `executionId`, `status`, `errorCode` |
| `execution.reconciled` | that run reconciled | `executionId`, `status`, `evidence {environment, outcome, bundleHash}` |

`execution.*` events exist only while the end user shares this execution's status with your project (off by default). Payloads
carry ids, states and evidence facts: never a wallet address, a secret, calldata or a transaction.

## Envelope

```json
{ "id": "evt_…", "object": "event", "type": "execution.reconciled", "apiVersion": "v1", "environment": "sandbox",
  "createdAt": "2026-10-07T12:00:00.000Z",
  "data": { "approvalId": "apr_…", "strategyId": "str_…", "workflowHash": "0x…", "executionId": "…", "status": "RECONCILED",
            "evidence": { "environment": "MOCKED", "outcome": "RECONCILED", "bundleHash": "0x…" } } }
```

`data` is a hint. Ordering is **not** guaranteed: fetch the resource (`GET /approvals/{id}`, `GET /executions/{id}`) for its
current state. `evidence.environment` is copied from FloFi's Evidence Bundle and never upgraded (`MOCKED` is not a testnet
execution).

## Request headers

| Header | Value |
| --- | --- |
| `webhook-id` | the event id (`evt_…`): **the same on every retry and every endpoint** — deduplicate on it |
| `webhook-timestamp` | Unix seconds of this attempt |
| `webhook-signature` | `v1,<base64 HMAC-SHA-256(secret, "<webhook-id>.<webhook-timestamp>.<raw body>")>` |
| `flofi-delivery-id` | this delivery (`whd_…`) |
| `flofi-delivery-attempt` | 1, 2, … |
| `content-type`, `user-agent` | `application/json`, `FloFi-Webhooks/1` |

## Verifying a delivery

Always verify the **raw** request body (before any JSON parsing or re-serialization), reject timestamps more than five minutes
away from your clock, and deduplicate on `webhook-id`.

With the SDK:

```ts
import { verifyWebhook, FloFiWebhookError } from '@defi-workflow-engine/developer-sdk';

try {
  const event = await verifyWebhook({ payload: rawBody, headers: request.headers, secret: process.env.FLOFI_WEBHOOK_SECRET! });
  if (await alreadyProcessed(event.id)) return respond(200);
  await handle(event);
  return respond(200);
} catch (error) {
  if (error instanceof FloFiWebhookError) return respond(400); // WEBHOOK_SIGNATURE_INVALID, WEBHOOK_TIMESTAMP_OUT_OF_RANGE, …
  throw error;
}
```

`secret` may be an array (both secrets during a rotation). `toleranceSeconds` defaults to 300.

Without the SDK (Node.js):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, headers: Record<string, string>, secret: string): boolean {
  const id = headers['webhook-id'], timestamp = headers['webhook-timestamp'], signatures = headers['webhook-signature'] ?? '';
  if (!id || !/^\d+$/.test(timestamp ?? '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signatures.split(' ').filter(s => s.startsWith('v1,')).some(s => {
    const offered = Buffer.from(s.slice(3), 'base64');
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  });
}
```

## Endpoint URLs

- `https://` on the default port 443, to a public host name or public IP address.
- No user name, password or fragment; at most 2048 characters.
- FloFi re-resolves the host at **every** delivery and refuses any non-public address, so a DNS change cannot redirect deliveries
  into a private network. Redirects are not followed. Each attempt times out after 10 seconds, and at most 1 KiB of your response
  is read, then discarded.
- Plain `http://127.0.0.1` exists only on a local, non-hosted test deployment whose operator enabled it.

## Retries

Any `2xx` is success. Anything else (another status, a timeout, a connection error) is retried after 30 s, 2 min, 10 min, 30 min,
1 h, 3 h, 6 h, 12 h and 24 h, each ±20 % jitter: ten attempts in about two days. Then the delivery is marked `DEAD` (the operator
can see delivery state). Deliveries are leased, so one attempt is never sent twice concurrently; retries reuse the same
`webhook-id` and body with a new timestamp and signature.

Respond quickly (well under 10 seconds) and do slow work after acknowledging. Make your handler idempotent: a delivery can arrive
more than once.

## Latency

FloFi's serverless runtime has no background worker. Events are derived and delivered:

1. right after your own Developer API requests (a small bounded sweep for your project);
2. right after the end user's transitions on `/approve` (claim, apply, sharing changes);
3. whenever the deployment's scheduler calls FloFi's internal dispatch endpoint (an operator setting).

On a deployment without a scheduler, an `execution.*` event can therefore wait until your next API call. `GET /approvals/{id}`
always computes the current state, so polling it is a reliable fallback.

## Secrets and rotation

- The secret (`whsec_…`) is returned **once**, when the endpoint is created. FloFi derives it on demand and does not store it.
- Rotation in v1 is by replacement:
  1. create a new endpoint (same URL or another) and store its secret;
  2. make your receiver accept both secrets (`verifyWebhook({ secret: [oldSecret, newSecret] })`);
  3. delete the old endpoint (`DELETE /webhook-endpoints/{id}`): its pending deliveries stop and its secret is never used again.

  During the overlap both endpoints receive each event with the same `webhook-id`: deduplicate on it.
- A compromised secret: delete that endpoint immediately and create a new one.
- Events are kept 30 days.
