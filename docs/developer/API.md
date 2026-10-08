# FloFi Developer API v1 — Reference

Base path: `https://<deployment>/api/developer/v1`. The machine-readable contract is [openapi.json](openapi.json) (OpenAPI 3.1,
generated from the server's own TypeBox schemas; a unit test fails if it drifts). Walkthrough: [QUICKSTART.md](QUICKSTART.md).
Notifications: [WEBHOOKS.md](WEBHOOKS.md).

> An API key authenticates an **integration**, never a wallet and never a person. No endpoint signs, submits, approves a
> Review or moves funds, because no such endpoint exists. Execution needs the end user, in FloFi, with their own wallet.

## Conventions

- **Server-side only.** A request with an `Origin` or `Sec-Fetch-Site` header is refused (`403 FORBIDDEN`,
  `BROWSER_ORIGIN_FORBIDDEN`) before the key is read. No CORS headers are ever sent.
- **JSON** in and out (`Content-Type: application/json`); bodies at most 64 KiB (`413`). Request schemas are closed: an unknown
  field, an unknown or repeated query parameter, a body on a route that takes none, or a query on a POST is `400 INVALID_REQUEST`.
- **Amounts** are decimal strings. **Ids** are typed: `str_`, `apr_`, `whe_`, `evt_`, `req_` + 26 base32 characters. Execution ids
  are FloFi run ids.
- Every response carries `request-id: req_…`, `cache-control: no-store` and `x-content-type-options: nosniff`.
- Strategies, simulations and approvals carry `authority: "NONE"`.
- **Versioning:** breaking changes go to `/v2`; fields may be added to v1 responses. Ignore fields you do not know.

## Authentication

```
Authorization: Bearer flofi_sk_test_<43 base64url characters>
```

Keys are issued by the deployment's operator (no self-service in this release) and are shown once. FloFi stores only an HMAC
digest. The key is looked up on every request, so revocation and project disabling take effect immediately. Missing, malformed,
unknown, revoked and disabled-project keys all answer `401 UNAUTHORIZED` with `WWW-Authenticate: Bearer realm="flofi-developer"`.

## Environments

| Environment | Key prefix | In this release |
| --- | --- | --- |
| `sandbox` | `flofi_sk_test_` | Issued. Test-funds strategies only; every mainnet is off. A strategy touching a mainnet is refused at creation (`403 MAINNET_DISABLED`, `SANDBOX_TEST_FUNDS_ONLY`). |
| `production` | `flofi_sk_live_` | Reserved. Live keys cannot be issued and are refused (`403 FORBIDDEN`, `LIVE_MODE_DISABLED`). |

Responses carry `environment`. When a deployment runs a flow against MOCKED chains, capabilities and validations report
`mockedHarness: true`, simulations `provenance: "MOCKED"`, and evidence `environment: "MOCKED"`.

## Scopes

| Scope | Routes |
| --- | --- |
| *(any valid key)* | `GET /capabilities` |
| `strategies` | `POST /strategies`, `POST /strategies/{id}/validate`, `POST /strategies/{id}/simulate` |
| `approvals` | `POST /approvals`, `GET /approvals/{id}` |
| `executions` | `GET /executions/{id}`, `GET /executions/{id}/evidence` |
| `webhooks` | `POST /webhook-endpoints`, `DELETE /webhook-endpoints/{id}` |

A new key gets all four scopes unless the operator narrows it. A missing scope is `403 FORBIDDEN` (`INSUFFICIENT_SCOPE`). No scope
can execute, sign, submit or approve a Review.

## Endpoints

| Method and path | Scope | Success | Purpose |
| --- | --- | --- | --- |
| `GET /capabilities?network=&action=` | any | 200 `list` of `capability` | What FloFi can compose, simulate and hand off per action × network on this deployment, and why not |
| `POST /strategies` | `strategies` | 201 `strategy` | Store an immutable canonical StrategySpec; returns hash, plan, inline validation and availability |
| `POST /strategies/{id}/validate` | `strategies` | 200 `strategy_validation` | Re-check against the current engine and deployment |
| `POST /strategies/{id}/simulate` | `strategies` | 200 `simulation` | FloFi's read-only simulation preview |
| `POST /approvals` | `approvals` | 201 `approval` | Hand the strategy to its owner: returns the FloFi approval link |
| `GET /approvals/{id}` | `approvals` | 200 `approval` | The approval's current state and the executions the owner shares |
| `GET /executions/{id}` | `executions` | 200 `execution` | A shared execution's status and attempts |
| `GET /executions/{id}/evidence` | `executions` | 200 `evidence` | Its canonical Evidence Bundle |
| `POST /webhook-endpoints` | `webhooks` | 201 `webhook_endpoint` | Register a signed endpoint; the secret is returned once |
| `DELETE /webhook-endpoints/{id}` | `webhooks` | 200 `{ deleted: true }` | Retire an endpoint and its secret |

### `GET /capabilities`

Optional filters `network` (a FloFi network id such as `base-sepolia`) and `action` (`bridge`, `swap`, `supply`, …). Each row:
`action`, `network`, `destinationNetwork`, `fundsClass`, `networkEnvironment`, `executionPlan {kind, steps}`,
`operations {compose, simulate, approve}` each `{available, reason}`, `operations.execute` always
`{available: false, reason: "OWNER_WALLET_IN_FLOFI_ONLY"}`, `availability {supportedByCode, enabledByDeployment, enabledByPolicy,
demonstratedEvidence, mockedHarness}` and `exampleStrategy`. Internal flow names, adapters and editor commands are never exposed.

### `POST /strategies`

Body: `{ "strategy": <StrategySpec> }` — a version 1 strategy or `{ "version": 2, "steps": [ … ] }` (1–8 steps). This is the same
contract FloFi's app and MCP gateway use; there is no second strategy language.

Response fields: `id`, `strategy` (canonical, normalized — store this), `workflowHash`, `engineVersion`, `fundsClass`,
`networkEnvironment`, `executionPlan {kind, reason, steps[]}` (each step: `index`, `action`, `network`, `destinationNetwork`,
`kind`, `protocol`, `fundsClass`, `environment`, `stepWorkflowHash`), `validation {valid, summary {block, warning, information},
findings[] {level, code, source, message}, blockers[], preExecution[]}`, `availability {approvable, reason, supportedByCode,
enabledByDeployment, enabledByPolicy, demonstratedEvidence, mockedHarness}`, `summary`, `explanation[]`, `notes[]`, `createdAt`.

- The strategy is immutable: there is no update endpoint and the database refuses changes. A changed intent is a new strategy.
- `executionPlan.kind`: `SINGLE_FLOW` (one action, one FloFi flow), `COMPOSITE_FLOW` (the Base Sepolia lending composition),
  `NOT_EXECUTABLE` with its reason (general multi-step lists: `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`).
- `validation.preExecution` lists what FloFi's own flow does with the owner before anything can be signed (for example a fresh
  route quote); these are not blockers.
- Unreferenced strategies are deleted after 90 days.

### `POST /strategies/{id}/validate`

Body: `{}` or none. Re-composes the stored strategy with the current engine: `reproducible: true` and fresh `validation`,
`availability`, `executionPlan`, `checkedAt`. `409 STRATEGY_STALE` if the engine no longer reproduces the stored hash.

### `POST /strategies/{id}/simulate`

Body: `{ "simulationSubject": "<EVM address or Solana public key>" }`. The subject is the account whose public state the preview
reads; it is not authenticated and grants nothing. Response: `kind`, `provenance`, `observedAt`, `expiresAt`, `facts`,
`canonicalArtifacts`, `notes`, `evidenceLevel` (`MOCKED_SIMULATION_PREVIEW` or `SIMULATION_PREVIEW_NOT_EXECUTION`), and the
constants `preview: true`, `persisted: false`, `authorizable: false`,
`subjectRole: "SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION"`. One step at a time: a multi-step strategy is
`422 CAPABILITY_NOT_SUPPORTED` (`SIMULATE_ONE_STEP_AT_A_TIME`). Never calldata, unsigned transactions or signatures.

### `POST /approvals`

Body: `{ "strategyId": "str_…", "workflowHash": "0x…" }` (the SDK also accepts `{ strategy }`). FloFi re-composes the stored
strategy, requires the same hash (`409 STRATEGY_CHANGED` otherwise; `409 STRATEGY_STALE` if the engine changed), evaluates the
four availability facts (`422 CAPABILITY_NOT_SUPPORTED` with the reason) and the Strategy Review (`422 REVIEW_BLOCKED`, with each
blocker as an `issues` entry `{ "path": "/strategy", "rule": "<finding code>" }`).

Response: `id`, `strategyId`, `workflowHash`, `status`, `approvalUrl` (`https://<deployment>/approve#flofi_dhs_…`, secret in the
fragment), `approvalUrlExpiresAt`, `expiresAt` (15 minutes), `networkEnvironment`, `fundsClass`, `executionPlan`,
`walletNamespace` (`eip155` or `solana`), `requires[]`, `claimed`, `applied`, `statusShared`, `executions[]`,
`executionsVisible`, `note`, `createdAt`.

- FloFi never stores the link. `GET /approvals/{id}` returns `approvalUrl: null`. An idempotent replay returns a fresh 5-minute
  session link for the same open approval.
- Approvals for the same strategy never supersede each other (many users may share one strategy).
- At most 100 open (PENDING or CLAIMED) approvals per project and environment, and 60 created per hour.
- The database binds each approval to its strategy and exact workflow hash; the owner's FloFi workflow must hash exactly to it
  before the proposal is applied.

### `GET /approvals/{id}`

Always computed fresh (lapsed approvals are expired on read). `status`: `PENDING` → `CLAIMED` (a wallet proved ownership) →
`APPLIED` (the proposal is in the owner's FloFi workflow); terminal `EXPIRED`, `SUPERSEDED`, `REVOKED`, `STALE`. While the owner
shares status (`statusShared: true`, off by default), `executions[]` lists the runs whose reviewed workflow hashes **exactly** to
this approval's: `{id, status, reconciled, terminal, errorCode, evidence {environment, outcome, bundleHash} | null, updatedAt}`.
An execution of an edited workflow is never reported as this approval's.

### `GET /executions/{id}` and `GET /executions/{id}/evidence`

Only executions of your approvals that their owner shares. Absent, unshared and other projects' executions are all
`404 NOT_FOUND`. Execution: `status`, `provenance`, `reconciled`, `terminal`, `errorCode`, `attentionRequired`, `owner` (the wallet
that claimed and signed), `attempts[] {attemptId, step, state, transactionHash, reconciled, updatedAt}`, timestamps,
`accessBasis: "OWNER_SHARED_WITH_PROJECT"`. Evidence: `evidence {bundleHash, environment, outcome, canonical, bundle} | null`
with `reason: "NO_RECONCILED_EVIDENCE_YET"` until reconciliation. `environment` is copied from FloFi's Evidence Bundle and never
upgraded. Never calldata, nonces, Review commitments or journal internals.

### `POST /webhook-endpoints` and `DELETE /webhook-endpoints/{id}`

Body: `{ "url": "https://…", "events"?: [ … ] }` (omitted or empty = every type). The response includes `secret` (`whsec_…`)
**once**; an idempotent replay returns `secret: null, secretAlreadyIssued: true`. At most five active endpoints per project
(`403 FORBIDDEN`, `WEBHOOK_ENDPOINT_LIMIT`). URL rules, signatures and rotation: [WEBHOOKS.md](WEBHOOKS.md). Deleting an endpoint
stops its pending deliveries; its secret is never used again.

## Idempotency

Send `Idempotency-Key: <UUID>` on `POST /strategies`, `POST /approvals` and `POST /webhook-endpoints` (the SDK does this for you).
Keys are scoped to your project, environment and operation, and kept 24 hours.

| Case | Answer |
| --- | --- |
| Same key, same body | The stored response, with header `idempotent-replayed: true` |
| Same key, different body | `409 IDEMPOTENCY_CONFLICT` |
| Same key while the first request runs | `409 IDEMPOTENCY_IN_PROGRESS` with `Retry-After` (retryable) |
| The first request failed | The key is released; retry freely |

Secrets are never stored in idempotency records: approval links and webhook secrets are omitted, as described above.
`DELETE` is naturally idempotent.

## Limits (plan `free`)

| Limit | Value | When exceeded |
| --- | --- | --- |
| Requests per project and environment | 300 / minute | `429 RATE_LIMITED`, `REQUESTS_PER_MINUTE` |
| Simulations | 30 / hour, plus a per-instance concurrency cap shared by every FloFi surface | `429` `SIMULATIONS_PER_HOUR`; `503 SERVICE_UNAVAILABLE` `SIMULATION_BUSY` |
| Approval creations | 60 / hour | `429` `APPROVALS_PER_HOUR` |
| Open approvals | 100 | `429` `PENDING_APPROVALS` |
| Webhook endpoints | 5 active | `403` `WEBHOOK_ENDPOINT_LIMIT` |

Every `429` and `503 SIMULATION_BUSY` carries `Retry-After` (seconds).

## Errors

```json
{ "error": { "code": "STRATEGY_CHANGED", "reason": "WORKFLOW_HASH_MISMATCH", "message": "…", "requestId": "req_…" } }
```

`code` is a small, stable set. `reason` is the classified engine, gate or limit code behind it. `issues` (when present) are
`{path, rule}` pairs — never your values. Error bodies never contain stack traces, provider responses, SQL, host names, URLs or
secrets.

| HTTP | `code` | Typical `reason` |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | `SCHEMA_INVALID`, `MALFORMED_JSON`, `CONTENT_TYPE_NOT_JSON`, `QUERY_NOT_ALLOWED`, `BODY_NOT_ALLOWED`, `IDEMPOTENCY_KEY_INVALID`, `SIMULATION_SUBJECT_INVALID`, `WEBHOOK_URL_*` |
| 413 | `INVALID_REQUEST` | `REQUEST_TOO_LARGE` |
| 400 | `INVALID_STRATEGY` | `STRATEGY_SCHEMA_INVALID`, engine refusal codes |
| 401 | `UNAUTHORIZED` | `API_KEY_REQUIRED`, `API_KEY_INVALID` |
| 403 | `FORBIDDEN` | `BROWSER_ORIGIN_FORBIDDEN`, `INSUFFICIENT_SCOPE`, `LIVE_MODE_DISABLED`, `WEBHOOK_ENDPOINT_LIMIT` |
| 403 | `MAINNET_DISABLED` | `SANDBOX_TEST_FUNDS_ONLY`, `MAINNET_HANDOFF_DISABLED_BY_POLICY` |
| 404 | `NOT_FOUND` | `RESOURCE_NOT_FOUND`, `STRATEGY_NOT_FOUND`, `APPROVAL_NOT_FOUND`, `EXECUTION_NOT_FOUND`, `WEBHOOK_ENDPOINT_NOT_FOUND`, `ROUTE_NOT_FOUND`, `DEVELOPER_API_NOT_ENABLED` |
| 405 | `METHOD_NOT_ALLOWED` | — (with `Allow`) |
| 409 | `STRATEGY_CHANGED` | `WORKFLOW_HASH_MISMATCH` |
| 409 | `STRATEGY_STALE` | `STRATEGY_STALE` |
| 409 | `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS` | — |
| 410 | `APPROVAL_EXPIRED` | `APPROVAL_EXPIRED`, `APPROVAL_REVOKED`, `APPROVAL_STALE`, `APPROVAL_SUPERSEDED` |
| 422 | `CAPABILITY_NOT_SUPPORTED` | `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`, `OWNER_EXECUTION_NOT_IMPLEMENTED`, `FLOW_NOT_ENABLED_IN_DEPLOYMENT`, `SIMULATE_ONE_STEP_AT_A_TIME`, `SIMULATION_LOCAL_FORK_ONLY` |
| 422 | `REVIEW_BLOCKED` | `REVIEW_BLOCKED` (blockers in `issues`) |
| 422 | `SIMULATION_FAILED` | the flow's classified code |
| 429 | `RATE_LIMITED` | `REQUESTS_PER_MINUTE`, `SIMULATIONS_PER_HOUR`, `APPROVALS_PER_HOUR`, `PENDING_APPROVALS` |
| 500 | `INTERNAL_ERROR` | `INTERNAL_ERROR`, `OUTPUT_GUARD` |
| 503 | `SERVICE_UNAVAILABLE` | `DEVELOPER_STORE_UNAVAILABLE`, `DEVELOPER_CONFIGURATION_INVALID`, `CLOUD_RUNTIME_NOT_CONFIGURED`, `SIMULATION_BUSY` |

Absent ids and ids that belong to another project or deployment get the same `404` body (only `requestId` differs). A
malformed id answers like an absent resource.

## Not in v1 yet

Documented in the build plan and deferred: key introspection (`GET /me`), flat network and asset lists, strategy and approval
retrieval and listing, approval revocation and fresh links, event browsing, webhook endpoint listing, in-place secret rotation,
test events and delivery browsing, a usage API, production keys, OAuth client credentials and publishable keys. They will be
additive to v1.
