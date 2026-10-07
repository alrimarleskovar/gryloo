# FloFi Developer API — operator guide (BUILD-DEVELOPER-001)

The Developer API (`/api/developer/v1`) lets third-party **server** applications compose, validate and simulate FloFi strategies
and hand them to end users for approval in FloFi. It adds no execution path: a developer key never signs, submits or approves,
and the end user's own wallet signs in FloFi's unchanged flows. Integrator documentation: [docs/developer](../developer/README.md).

It runs in the same Next.js deployment as the app (no new service, no model key) and keeps its state in the deployment's
PostgreSQL. It is **off unless enabled**, and it fails closed: every configuration error disables it.

## 1. Requirements

- The **embedded runtime**: `DATABASE_URL` set, `API_BASE_URL` unset ([ENVIRONMENT.md §1](ENVIRONMENT.md)). On the remote
  runtime every request answers `503 SERVICE_UNAVAILABLE` (`DEVELOPER_STORE_UNAVAILABLE`); it never falls back to memory or files.
- Migrations `0006_approval_requesters` and `0007_developer_platform`, applied by the deployment build like the earlier ones.
- `FLOFI_PUBLIC_ORIGIN`: the exact public origin approval links point to (shared with MCP).
- The testnet flows you want developers to hand off, enabled as usual (`GRYLOO_ROUTER_TESTNET=live`, `GRYLOO_SUPPLY_TESTNET=live`,
  …). Capability discovery reports what is enabled; nothing else is.

## 2. Enable it (server-side variables, never `NEXT_PUBLIC_*`)

| Variable | Value |
| --- | --- |
| `FLOFI_DEVELOPER` | `enabled` (otherwise `404 DEVELOPER_API_NOT_ENABLED`) |
| `FLOFI_DEVELOPER_SECRET` | `openssl rand -hex 32` (32–512 characters). Dedicated: refused if equal to `API_AUTH_TOKEN`, `FLOFI_SESSION_SECRET`, `FLOFI_MCP_OAUTH_SECRET` or `FLOFI_CHANNEL_SECRET` |
| `FLOFI_PUBLIC_ORIGIN` | `https://<deployment>` with no trailing slash |
| `FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256` | optional: SHA-256 hex of the scheduler's bearer token (§5) |
| `FLOFI_DEVELOPER_WEBHOOK_LOOPBACK` | **never on a hosted deployment** (refused there). `ALLOW_LOCAL_ONLY` lets local tests use `http://127.0.0.1` webhook endpoints |

Three HKDF keys are derived from `FLOFI_DEVELOPER_SECRET` (`flofi/developer/{api-key,handoff,webhook}/v1`): API-key digests,
`flofi_dhs_` approval-link digests and webhook signing secrets. **Rotating it** therefore invalidates every developer API key, every
open developer approval link and every webhook secret at once: re-issue keys and have integrators recreate their endpoints.

Check after a redeploy: `GET https://<deployment>/api/developer/v1/capabilities` without a key answers `401` with
`WWW-Authenticate: Bearer realm="flofi-developer"`; with `Origin: https://example.com` it answers `403 BROWSER_ORIGIN_FORBIDDEN`.

## 3. Projects and keys (operator CLI)

There is no self-service portal. The operator manages projects and sandbox keys with a CLI that runs on plain Node 24 against the
deployment's database:

```bash
export DATABASE_URL='postgres://…'            # the deployment's database
export FLOFI_DEVELOPER_SECRET='…'             # the deployment's developer secret (a key only authenticates where it matches)
CLI='node apps/reference-dapp/backend/developer-admin.ts'

$CLI create-project --name 'Acme Wallet' --tenant default          # → { tenantId, projectId: "prj_…" }
$CLI create-key --project prj_… --key-file ./acme.key --tenant default
$CLI list-keys --project prj_… --tenant default                    # ids, last-4 hints, scopes, status — never a key
$CLI revoke-key --key key_… --tenant default
$CLI disable-project --project prj_… --tenant default              # all keys stop; open approvals are revoked
$CLI deliveries --project prj_… --tenant default [--limit 50]      # read-only webhook delivery state
```

- **Tenant:** `--tenant default` for production and local; `--preview-branch <git branch>` for a Vercel Preview (each Preview
  branch is its own tenant, as for MCP). Exactly one is required.
- **Keys** are sandbox keys (`flofi_sk_test_…`) with all four scopes unless `--scopes strategies,approvals,…` narrows them.
  A key is shown **once**: with `--key-file` it is written to a new mode-0600 file (never overwriting an existing one); without
  it, it is printed to your terminal. Hand it to the integrator through a secret channel. Production keys cannot be issued.
- **The project name** is shown to end users on `/approve` ("Created by *name*, a third-party app registered with FloFi"). Set it
  to the integrator's verified product name: it is a phishing surface.
- Errors print a fixed code (for example `TENANT_REQUIRED`, `KEY_FILE_EXISTS`), never a stack, connection string or secret.
  The CLI refuses a database whose schema is behind the shipped migrations.

## 4. What end users see

`/approve` serves developer approvals beside MCP ones. The page names the project, states that FloFi did not create the
proposal and that it is not financial advice, requires a wallet proof (EIP-4361 or Sign-In With Solana), and places the
re-composed proposal into FloFi's existing flow, where the user simulates, reviews and signs. Sharing run status and evidence with
the project is a checkbox, **off by default**. A claim also requires the project to be active and the approval to be sandbox.

## 5. Webhook delivery and the scheduler

The embedded runtime has no background worker. Events are derived from durable state and delivered after Developer API requests
(a bounded sweep for that project) and after `/approve` transitions. Without a scheduler, an `execution.*` notification waits for
the integrator's next request or the next `/approve` action; `GET /approvals/{id}` is always current.

To deliver promptly, give the deployment a scheduler (an **owner action**; this build adds no cron entry):

1. Choose a random token (at least 16 characters, e.g. `openssl rand -hex 24`).
2. Set `FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256` to `printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1`.
3. Call `GET` (or `POST`) `https://<deployment>/api/developer/v1/internal/dispatch` with `Authorization: Bearer $TOKEN` every
   minute or so. With Vercel Cron on production, set `CRON_SECRET` to the token: Vercel sends it as that bearer. Vercel Cron does
   not run on Previews.

Each call runs one bounded sweep for the whole deployment (up to 50 approvals synced and 50 deliveries attempted) and answers
`{ object: "dispatch", approvalsSynced, deliveries }`. Without the variable the route does not exist (`404`).

Deliveries go only to `https://` URLs on port 443 that resolve to public addresses, re-checked at every attempt, through a pinned
socket with no redirects and a 10-second timeout. Failed deliveries are retried for about two days (ten attempts), then marked
`DEAD`; the `deliveries` CLI command shows their state, attempts, last HTTP status and last error code.

## 6. Limits (plan `free`, per project and environment)

300 requests per minute; 30 simulations per hour (plus the per-instance simulation concurrency cap shared with every surface);
60 approval creations per hour; 100 open approvals; 5 webhook endpoints. The project row carries a `plan` column; `pro` and
`enterprise` are reserved with the same values. Usage is metered write-side (`developer_usage`, daily counters: strategies,
simulations, approvals, reconciled executions, webhook deliveries). There is no usage API or billing in this build.

## 7. Operations

- **Logs** (`flofi-developer`): request id, tenant, project, key id, environment, route template, status, code, duration. Never
  the `Authorization` header, bodies, query values, addresses, approval URLs, webhook URLs or secrets. Integrators quote the
  `request-id` header.
- **Compromised key:** `revoke-key` (effective on the next request; there is no cache). **Abusive integrator:**
  `disable-project` (every key stops and open approvals are revoked).
- **Retention:** events 30 days; unreferenced strategies 90 days; abuse-limit windows one day; idempotency records 24 hours.
- **Mainnet:** not reachable. Sandbox keys are test-funds only (strategies touching a mainnet are refused at creation), and live
  keys are refused. Enabling production developer access would need a separate build: live keys, a per-project mainnet policy,
  the flows' owner-execution switches and the owner's legal review.
- **Evidence honesty:** on a deployment whose flows run against MOCKED harnesses, every developer-facing fact says so
  (`mockedHarness`, `provenance: MOCKED`, evidence `MOCKED`).
