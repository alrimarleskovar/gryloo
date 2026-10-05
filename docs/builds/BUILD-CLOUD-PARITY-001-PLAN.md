# BUILD-CLOUD-PARITY-001 — Plan

Date: 2026-10-05. Branch `claude/build-cloud-parity-001` from `main` `92593cf` (PR #61, BUILD-ETHEREUM-001), verified against
`origin/main` before any change. Runtime and infrastructure only: no UI redesign, no new protocol, no new network, no mainnet
expansion. Codex is concurrently reworking the visual layer (PRODUCT-UX-001); this build stays out of components and CSS.

## Goal

> Flofi's WSL environment is a development/testing tool, not a product dependency.

Every user-facing capability must have a production-shaped path that runs from a Vercel deployment (Preview included) on
public testnet RPCs, a durable database and the user's own wallet, with no WSL, localhost, Anvil, `/tmp` journal, developer
shell or team key in the path.

## What the audit found (before any change)

The full inventory is in [BUILD-CLOUD-PARITY-001-MATRIX.md](BUILD-CLOUD-PARITY-001-MATRIX.md). The shared root causes:

| # | Root cause | Where | Effect on Vercel |
| --- | --- | --- | --- |
| R1 | The only durable runtime is the **remote** API (`API_BASE_URL` → Railway). Railway deploys `main` only, and there are no per-PR backend environments. | every `*-action.ts` | A Preview either forwards to the production API (running `main`, sharing its tenant and database) or falls back to local mode. A branch's backend changes can never be exercised from its own Preview. |
| R2 | Local mode silently uses the process filesystem: `GRYLOO_*_JOURNAL` directories, `os.tmpdir()` (Across demo), PID lock directories. | supply, transfer, swap, liquidity, Solana, router, lending, Across, CoW, bridge, fork actions | On a serverless instance these are ephemeral and per-instance: state written by one request is invisible to the next instance. Nothing refuses them on a hosted deployment. |
| R3 | The wallet-session MAC key falls back to a **random per-process key** when neither `FLOFI_SESSION_SECRET` nor `API_AUTH_TOKEN` is set and `API_BASE_URL` is absent. | `wallet-session.ts` | On Vercel every instance would have its own key: a sign-in on one instance is rejected by the next. |
| R4 | Session tokens are not bound to the origin that issued them, and the same secret is typically shared by Production and every Preview. | `wallet-session.ts` | A session token is accepted by any deployment holding the key (cookies are host-only, so only a copied token is affected). |
| R5 | Worker claims and the sweeper are **not tenant-scoped**. | `cloud-runtime/work-queue.ts` | Two deployments sharing a database (e.g. a Preview and Production) would process each other's runs with different code and configuration. |
| R6 | The schema check reads migration files from disk next to `import.meta.url`. | `cloud-runtime/migrations.ts` | Inside a bundled serverless function that directory does not exist; the check cannot run. |
| R7 | The Supply → Borrow → Swap lending composition was never moved onto the storage ports. | `lending-composition-service.ts` | `LOCAL_ONLY`: direct `fs` I/O, PID locks, no cloud flow. |
| R8 | Base Sepolia RPC overrides are inconsistent: `GRYLOO_BASE_SEPOLIA_RPC_URL` reaches the liquidity and Router-testnet clients only. The Aave Base Sepolia and Uniswap swap clients are hard-wired to `https://sepolia.base.org`, and the swap client is not chain-bound at the transport. | `supply-rpc.ts`, `public-testnet-rpc.ts` | An owner cannot move all Base Sepolia reads to one keyed endpoint (public endpoint 429s), and a misconfigured endpoint is only caught by the service's own chain check. |
| R9 | Copilot `replay` and Base observation `replay` read committed fixtures relative to the working directory; they are not traced into the serverless bundle. | `copilot-action.ts`, `base-rpc.ts` | `FLOFI_COPILOT=replay` answers `COPILOT_REPLAY_INVALID` on Vercel. |
| R10 | No non-secret way to see what a deployment is wired to. | — | Diagnosing a Preview requires the Vercel dashboard. |
| R11 | Previews (and the production `*.vercel.app` aliases other than the assigned domain) answer HTTP 302 to Vercel SSO. | Vercel project setting | No external user or automated check can reach a Preview without an owner setting. |

Already sound and kept as is: no `NEXT_PUBLIC_*` variable exists; no hardcoded `localhost:3000` or production hostname; CSP
`connect-src 'self'`; RPC clients are allowlisted, read-only, bounded by timeouts and chain-verified by their services; the
EIP-4361 domain is derived from the request host that Vercel sets; workers' transports cannot submit; PREPARED attempts are
never observed by workers; evidence bundles are part of the durable run log.

## Design

### 1. One flow call, three production-shaped runtimes (R1, R2)

A single server module, `src/server/flow-runtime.ts`, decides how every cloud-capable server action runs:

| Runtime | Selected when | Behaviour |
| --- | --- | --- |
| `remote` | `API_BASE_URL` is set | Unchanged BUILD-CLOUD-001 forwarding to the Flofi API (Production on Railway). |
| `embedded` | `DATABASE_URL` is set on a hosted deployment (`VERCEL=1`), or locally with `FLOFI_RUNTIME=embedded` | The **same** `createBackend` (flow registry, strict argument validation, ownership policy, PostgreSQL log/lease stores) runs inside the Vercel function. Every request may land on a different instance; all state is in PostgreSQL. |
| `unconfigured` | hosted deployment with neither | Every cloud flow fails closed with `CLOUD_RUNTIME_NOT_CONFIGURED`; capability probes answer `off`. Never `/tmp`. |
| `local` | not hosted, neither set | The existing development/test path (journals, MOCKED loopback harnesses), unchanged. |

The embedded runtime keeps one connection pool and one service map per function instance as a performance cache only. Each
instance verifies the schema once (fails closed on `SCHEMA_NOT_MIGRATED`) and ensures its tenant row exists.

No new persistence system: the embedded runtime is the existing `@defi-workflow-engine/cloud-runtime` package on the existing
schema.

### 2. Preview isolation (R4, R5)

* Tenant per deployment scope: Production and development keep `TENANT_ID` (default `default`); a Vercel Preview always uses
  `pv-<branch-slug>-<sha256(branch)[0..8]>`. Successive deployments of one branch share state (restart and redeploy
  survival); different branches are isolated. Every table is tenant-keyed already.
* Worker claims and the sweeper take an optional tenant scope; the Railway worker passes its `TENANT_ID`.
* Session tokens carry the issuing host and are accepted only on that host.
* Recommended deployment shape: a Preview database separate from Production (e.g. a Neon branch per Preview). Tenant scoping
  is the logical guarantee if the owner nevertheless shares one.

### 3. Hosted-deployment guards (R2, R3)

`src/server/deployment.ts` defines a hosted deployment (`VERCEL=1`, a Railway environment, or `FLOFI_DEPLOYMENT=hosted`).
On a hosted deployment: local journal directories and `os.tmpdir()` state are refused, MOCKED loopback harness gates are
ignored (the flow stays `off`), the filesystem evidence store is refused, and the wallet session requires a configured secret.

### 4. Schema check without a filesystem (R6)

`cloud-runtime` ships a migration identity manifest (version, name, SHA-256) checked against the SQL files by a unit test;
`assertSchemaCurrent` accepts it. Migrations stay explicit (`main.ts migrate`); the Vercel build can optionally apply them to a
Preview database when the owner sets `FLOFI_MIGRATE_ON_BUILD=preview` (never for Production).

### 5. Lending composition (R7) — plan revised during the audit

The first plan was to move only the service's I/O primitives onto the `ExecutionStorage` ports (the BUILD-CLOUD-001 pattern).
Measuring the run format before changing it showed that this is not safe: every lending log line is a full snapshot that
repeats every Review (the BUILD-013 pilot logged 15.9 MB by the first reconciled step and passed 100 MB by ROUTER_APPROVAL; the
local bound is 512 MiB), while a cloud log is capped at 16 MiB by code and schema and is re-validated from its first byte by
every cold serverless instance. With a 16 MiB bound the service's own capacity guard would refuse the second step of a real run.
A compact (delta or content-addressed) lending log is a change to the financial core's validators and needs its own reviewed
build. This build therefore keeps the composition local-only, makes it fail closed on hosted deployments
(`LENDING_CLOUD_RUNTIME_UNAVAILABLE`, before any read or wallet request) and documents the blocker in the matrix. BUILD-013's
separate public-provider blocker (sequential `eth_simulateV1` rate limits; keyed `GRYLOO_ALCHEMY_API_KEY`) is unchanged.

### 6. RPC parity (R8)

`GRYLOO_BASE_SEPOLIA_RPC_URL` (existing name) applies to every Base Sepolia read client; the swap transport becomes
chain-bound like the Ethereum Sepolia one. No new RPC variable.

### 7. Fixtures and diagnostics (R9, R10)

* The committed Copilot and observation replay files are traced into the server bundle.
* `GET /api/flofi/readiness`: runtime kind, database/schema state, tenant, per-flow mode, session and Copilot
  configuration, and an optional bounded chain-ID probe per supported network. Never a URL, key, credential or stack trace.

### 8. Remote verification

`scripts/cloud-preview-smoke.mjs <origin>` performs only reads (page, readiness, network probe). The Preview SSO gate (R11)
and the Preview environment variables are owner settings; the report states exactly what was and was not reachable.

## Non-goals

No component, CSS or layout change; no new protocol, bridge or network; no mainnet enablement; no change to evidence classes;
no server-side signing, key custody or automatic wallet approval; no removal or weakening of any test or CI gate.

## Validation

`pnpm check`; `pnpm test:postgres` (new embedded-runtime and tenant-scoping suites); a new browser suite on the embedded runtime
(`cloud-runtime.spec.ts`); existing browser suites for touched flows; governance-lite; a clean Vercel Preview build; the
production build served locally with hosted-Preview semantics against public testnets (read-only); read-only remote smoke where
reachable.
