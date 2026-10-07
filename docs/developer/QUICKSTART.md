# FloFi for Developers — Quickstart

This guide takes a **server** application from an API key to a reconciled, evidenced execution that the end user approved and
signed in FloFi. It uses the TypeScript SDK ([`packages/developer-sdk`](../../packages/developer-sdk/README.md)); every call also
has a plain HTTP form (shown with `curl`). The endpoint reference is [API.md](API.md), the notification guide
[WEBHOOKS.md](WEBHOOKS.md).

> Your API key has **zero financial authority**. Your server composes, validates, simulates and asks for approval. Only the end
> user, in FloFi, with their own wallet, can run the authoritative simulation, approve the Strategy Manifest and sign.

```
your server ── SDK ──► FloFi Developer API ──► approval link ──► end user in FloFi: wallet proof → fresh simulation
     ▲                                                              → Strategy Manifest Review → wallet signature → reconciliation
     └──────── signed webhooks · approval status · execution status · Evidence Bundle (only what the user shares) ◄────────┘
```

## 0. Before you start

- A FloFi deployment with the Developer API enabled (its operator follows [deploy/DEVELOPER.md](../deploy/DEVELOPER.md)).
- A **sandbox** key (`flofi_sk_test_…`) from that operator. Store it in your server's secret store. Never put it in a web page, a
  mobile app or a URL: FloFi refuses any request that carries an `Origin` or `Sec-Fetch-Site` header (`BROWSER_ORIGIN_FORBIDDEN`).
- Node.js 20 or later (or any runtime with `fetch` and Web Crypto).

```ts
import { FloFi, FloFiError, verifyWebhook } from '@defi-workflow-engine/developer-sdk';

const flofi = new FloFi({ apiKey: process.env.FLOFI_API_KEY!, baseUrl: 'https://<your FloFi deployment>' });
```

The SDK is a private workspace package in this repository today (npm publication is not authorized yet). It has no runtime
dependency and contains no FloFi logic: FloFi decides everything.

## 1. Check your key

Any call proves the key. A missing, malformed, unknown or revoked key — or a disabled project — fails with `401 UNAUTHORIZED`;
these cases are deliberately indistinguishable.

```bash
curl -s https://<deployment>/api/developer/v1/capabilities -H "Authorization: Bearer $FLOFI_API_KEY"
```

## 2. Discover what FloFi can do here

```ts
const { data } = await flofi.capabilities.list({ network: 'base-sepolia', action: 'bridge' });
const row = data.find(r => r.destinationNetwork === 'arbitrum-sepolia');
// row.operations: { compose, simulate, approve: { available, reason }, execute: { available: false, reason: 'OWNER_WALLET_IN_FLOFI_ONLY' } }
// row.availability: { supportedByCode, enabledByDeployment, enabledByPolicy, demonstratedEvidence, mockedHarness }
// row.exampleStrategy: a valid strategy for this row
```

Pick a row whose `operations.approve.available` is `true`. When it is `false`, `reason` says why (for example
`FLOW_NOT_ENABLED_IN_DEPLOYMENT`). `execute` is never available to your key: execution happens only in FloFi, with the owner's
wallet. `mockedHarness: true` means this deployment runs the flow against MOCKED chains, and evidence will say `MOCKED`.

## 3. Create an immutable strategy

A strategy is FloFi's **StrategySpec**: a version 1 object for one action, or `{ version: 2, steps: [...] }`.

```ts
const strategy = await flofi.strategies.create({ strategy: {
  action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' } });
strategy.id;            // str_…
strategy.workflowHash;  // 0x… — the same hash FloFi's app and MCP compute for this strategy
strategy.executionPlan; // { kind: 'SINGLE_FLOW' | 'COMPOSITE_FLOW' | 'NOT_EXECUTABLE', reason, steps }
strategy.validation;    // { valid, summary, findings, blockers, preExecution }
strategy.availability;  // { approvable, reason, … }
```

```bash
curl -s https://<deployment>/api/developer/v1/strategies -H "Authorization: Bearer $FLOFI_API_KEY" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"strategy":{"action":"bridge","sourceNetwork":"base-sepolia","destinationNetwork":"arbitrum-sepolia","asset":"USDC","amount":"5"}}'
```

FloFi stores the **canonical, normalized** strategy and never changes it. To change anything, create a new strategy: it gets a new
id and a new hash. Amounts are decimal strings. A schema error is `400 INVALID_STRATEGY` with `issues` (`{path, rule}`, never your
values). A strategy that touches a mainnet is refused at creation with `403 MAINNET_DISABLED` (sandbox keys are test-funds only).

The Base Sepolia lending composition (`supply` → `borrow` → `swap`) is recognized as one executable `COMPOSITE_FLOW`. Other
multi-step lists are composed, validated and reviewed, but they cannot be approved yet (`MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`).

## 4. Re-validate before handing off

```ts
const check = await flofi.strategies.validate(strategy.id);
if (!check.availability.approvable) throw new Error(check.availability.reason ?? 'NOT_APPROVABLE');
```

Validation re-composes the stored strategy with FloFi's **current** engine and deployment. `409 STRATEGY_STALE` means the engine no
longer reproduces the stored hash (for example after an engine upgrade): create the strategy again. `availability.reason` of
`REVIEW_BLOCKED` means FloFi's Strategy Review has a blocking finding (listed in `validation.blockers`).

## 5. Simulate (a preview, never an authorization)

```ts
const preview = await flofi.strategies.simulate(strategy.id, { simulationSubject: userAddress });
// { kind, provenance, facts, evidenceLevel: 'MOCKED_SIMULATION_PREVIEW' | 'SIMULATION_PREVIEW_NOT_EXECUTION',
//   preview: true, persisted: false, authorizable: false, authority: 'NONE' }
```

`simulationSubject` is the **public** address whose balances and allowances the read-only simulation reads. It is not
authenticated, not an owner and grants nothing; nothing is stored for it. The user's authoritative simulation runs again in
FloFi before they review and sign.

## 6. Register a webhook endpoint (once)

```ts
const endpoint = await flofi.webhookEndpoints.create({ url: 'https://api.example.com/flofi/webhooks' });
await secrets.put('FLOFI_WEBHOOK_SECRET', endpoint.secret!); // whsec_… — shown once
```

The URL must be HTTPS on port 443 to a public host. A project has at most five active endpoints. See [WEBHOOKS.md](WEBHOOKS.md).

## 7. Create the approval and send the link to your user

```ts
const approval = await flofi.approvals.create({ strategy }); // or { strategyId, workflowHash }
// { id: 'apr_…', status: 'PENDING', approvalUrl: 'https://<deployment>/approve#flofi_dhs_…', expiresAt, authority: 'NONE',
//   statusShared: false, requires: ['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review',
//   'Explicit wallet signature'] }
```

Send `approvalUrl` to your user (in your app, by email, as a button…). The secret is in the URL **fragment**: it never reaches a
server log. The link is open for 15 minutes. FloFi does not store it and never returns it again; an idempotent replay of the same
request returns a fresh 5-minute session link for the same approval instead. A different `workflowHash` than the strategy's is
`409 STRATEGY_CHANGED`; a review blocker is `422 REVIEW_BLOCKED`; more than 100 open approvals per project is `429 RATE_LIMITED`
(`PENDING_APPROVALS`).

Many users may approve the same strategy: each `approvals.create` call is a separate approval and never replaces another.

## 8. The user decides, in FloFi

On the link the user sees your project's name ("Created by *Acme Wallet*, a third-party app registered with FloFi, not by
FloFi"), proves their wallet (EIP-4361 or Sign-In With Solana) and loads the proposal into their own FloFi workflow. FloFi then
runs its unchanged flow: a fresh simulation, the Strategy Manifest Review, the user's explicit approval and their wallet
signature for each transaction, then recovery, reconciliation and the Evidence Bundle.

A checkbox, **off by default**, asks whether to share this execution's status and evidence with your project. Without it you see
the approval's states only (claimed, applied, ended) — never the wallet, runs or evidence. The user can change it later.

## 9. Follow progress: webhooks or polling

```ts
// In your webhook handler — use the RAW request body:
const event = await verifyWebhook({ payload: rawBody, headers: request.headers, secret: process.env.FLOFI_WEBHOOK_SECRET! });
if (await seen(event.id)) return; // deduplicate on webhook-id
switch (event.type) { case 'approval.claimed': case 'approval.applied': case 'approval.ended':
  case 'execution.started': case 'execution.failed': case 'execution.reconciled': /* fetch the resource for current state */ }
```

Or poll — always fresh, never cached:

```ts
const progress = await flofi.approvals.get(approval.id);
// status: PENDING | CLAIMED | APPLIED | EXPIRED | SUPERSEDED | REVOKED | STALE
// executions: [{ id, status, reconciled, terminal, errorCode, evidence: { environment, outcome, bundleHash } }] (only while shared)
```

## 10. Read the execution and its evidence

```ts
const execution = await flofi.executions.get(progress.executions[0]!.id);
// { status, provenance, reconciled, terminal, owner, attempts: [{ step, state, transactionHash, reconciled }],
//   accessBasis: 'OWNER_SHARED_WITH_PROJECT' }
const { evidence } = await flofi.executions.evidence(execution.id);
// { environment: 'MOCKED' | 'TESTNET_EXECUTED' | …, outcome, bundleHash, canonical, bundle }
```

`evidence.environment` states exactly what was proven, copied from FloFi's Evidence Bundle and never upgraded: `MOCKED` is not a
testnet execution. An execution that was not shared with your project, never existed or belongs to another project is
`404 NOT_FOUND` — the three cases look identical.

## Errors and retries

Every error is `{ "error": { code, reason, message, issues?, requestId } }`; the SDK throws `FloFiError` with the same fields
plus `status` and `retryAfter`. The SDK retries only what is safe — GETs and POSTs that carry an `Idempotency-Key` (it adds one to
every creating POST and reuses it across its own retries) — after network errors, `429`, `502`, `503` and `504`, honouring
`Retry-After`. Quote `requestId` when you contact the deployment's operator. The full table is in [API.md](API.md#errors).
