# BUILD-CLOUD-001 — Report

Date: 2026-10-03. Branch `claude/build-cloud-001`, stacked on `codex/build-brand-001-flofi`
(`64194874189795356c9f883493382bb85df73552`, PR #49, draft, unmerged). BUILD-013 (branch, worktree and
PR #48) was not touched.

**Status: IMPLEMENTATION COMPLETE — OWNER ACTION REQUIRED.** The durable, horizontally scalable execution
architecture is implemented and validated locally against a disposable PostgreSQL 18 and MOCKED in-process
chains. Nothing is deployed: no Railway, Vercel, Neon or object-storage credential exists in this environment.
No public or testnet transaction was made; that requires the owner's wallet.

## What changed

| Area | Change |
| --- | --- |
| Storage ports | `reference-executor/src/durable-storage.ts`: `DurableLogStore` (read / strict extend / exclusive create), `LeaseStore` (re-entrant exclusive section), `ExecutionStorage`. File implementations reproduce the previous paths, modes, fsync order and PID locks exactly. `reserveEconomicIntentIn` works through the port; `reserveEconomicIntent(directory, …)` is unchanged for callers. |
| Services | `robinhood-transfer-service.ts` and `supply-service.ts` accept optional `storage`; only their I/O primitives were rerouted (read, extend, create, lock). State machines, guards, validators, reconciliation and evidence are untouched. |
| Infrastructure | New private package `@defi-workflow-engine/cloud-runtime` (AGPL-3.0-only): PostgreSQL log store with same-transaction projections and outbox, fenced leases, work queue + sweeper, request idempotency, EvidenceStore (filesystem + S3-compatible SigV4 over `fetch`), worker loop, `node:http` boundary, redacted JSON telemetry with W3C trace context, environment config. |
| Schema | `packages/cloud-runtime/migrations/0001_execution_core.sql` (11 tables, composite tenant keys, CHECK constraints, partial indexes, append-only triggers). Explicit `migrate` command with advisory lock and checksums. |
| Backend | `apps/reference-dapp/backend/` (`main.ts api|worker|migrate|import-journal`, `app.ts`, `flows.ts`) run by Node 24's native TypeScript support — same code as the server actions, no new build step. |
| BFF | Robinhood and Supply server actions forward their identical contract to the API when `API_BASE_URL` is set (bearer token, idempotency key, bounded retry); otherwise unchanged. RPC clients were moved to `src/server/{robinhood,supply}-rpc.ts` with no behavior change. |
| Deployment | Digest-pinned `Dockerfile`, `deploy/railway/{api,worker}.railway.json`, `apps/reference-dapp/vercel.json` + `deploy/vercel/*.sh` (digest-verified toolchain), `docs/deploy/CLOUD.md`. |
| CI | Contracts job gains a digest-pinned loopback PostgreSQL service and an unconditional `pnpm test:postgres` step. Dependency inventory extended explicitly (lock hash, 247 → 262 packages, cloud-runtime manifest/importer, `pg`/`@types/pg` pins, nine-manifest SBOM). No check was removed or relaxed. |

## Guarantees and their evidence

| Guarantee | Mechanism | Test |
| --- | --- | --- |
| No stale overwrite (CAS) | strict byte extension under `FOR UPDATE`; explicit `extendAt` version check | `storage.pg` stale writer, explicit CAS, 4-way race |
| One economic intent per owner nonce / exact call | exclusive create = primary key insert | 12 concurrent creates; two API instances and two runs racing `begin` |
| Lease exclusivity and fencing | expiry-gated upsert, monotonic fence, per-write fence check | exclusivity, takeover → `EXECUTION_LEASE_LOST`, heartbeat beyond TTL |
| Durable work | projector inserts outbox rows in the snapshot transaction | outbox atomic with state, rollback enqueues nothing, sweeper restore |
| At-least-once delivery, exactly-once effect | `SKIP LOCKED` claims, lease tokens, run lease + read-only observe | duplicate delivery + crashed worker reclaim → one CONFIRMED, one transaction |
| Unknown submission never resubmitted | existing observe-only logic; workers have no send path | UNKNOWN → worker discovers by nonce → RECONCILED, 1 transaction |
| PREPARED never cancelled by a stale item | `needs_observation` re-checked under the run lease | stale item → PREPARED kept, handoff succeeds |
| API idempotency | `api_idempotency` with request hash | HTTP replay returns the same run; reused key → 409 |
| Fail closed on corrupt/tampered state | SHA-256/length verification, validators, append-only triggers | API `JOURNAL_CORRUPT`, worker DEAD, no transaction |
| Tenant isolation | tenant-bound stores, composite keys | logs, leases, idempotency, API status/list |
| Restart survival | all state in PostgreSQL | fresh API/worker instances per step; real OS-process smoke test |
| Evidence integrity | content-addressed objects, metadata in PostgreSQL | SigV4 AWS vector, tamper detection, verified evidence endpoint |

Process-level smoke test (local, MOCKED loopback harness): API process → simulate/review/begin/handoff, owner
"wallet" submission to the harness, report; API killed; separate worker process reconciled and archived evidence;
a new API process returned `RECONCILED` with integrity-verified evidence and a paginated journal.

## Validation results (local)

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schemas, unit) | pass — 1189 passed, 2 skipped (pre-existing env-gated suites) |
| `pnpm test:postgres` (PostgreSQL 18.6, loopback) | pass — 28 passed |
| Browser: robinhood-transfer | 7 passed |
| Browser: supply, supply-recovery, borrow, repay, withdraw | 44 passed |
| Browser: lending-composition (shared economic-intent code) | 17 passed |
| Browser: network-isolation, interface-honesty, robinhood-network | 7 passed |
| `bootstrap-ci.py --verify-dependencies` | pass — 262 verified, 16 reviewed exceptions (unchanged) |
| CI SBOM step (local run) | pass — 262 components |
| `pnpm audit --audit-level low` | no known vulnerabilities |
| `governance_lite.py` + self-tests, `git diff --check` | pass |

Not run locally: Anvil fork suites and visual screenshot specs (untouched code paths; visual baselines are known
to differ locally because of fonts). CI runs them.

## Owner-only remaining actions

1. Create a Neon project/database; provide pooled and direct connection strings to Railway.
2. Create a private S3-compatible bucket and a bucket-scoped key.
3. Create the Railway project from this branch with services `flofi-api` and `flofi-worker`
   (config paths in `deploy/railway/`), set the variables in `docs/deploy/CLOUD.md`, generate the API domain.
4. Import the repository in Vercel (root `apps/reference-dapp`), set `API_BASE_URL` and `API_AUTH_TOKEN`.
5. Perform the testnet acceptance with the owner wallet (Build → Simulate → Review → Execute → close tab →
   reopen elsewhere → Result + Evidence Bundle).

Until these are done the build must not be described as deployed. Remaining limitations: flows other than the
Robinhood transfer and the Aave Supply family remain file/local-only; tenancy is configuration-based (no
per-user authentication); Vercel's serverless runtime uses its Node 24.x, while the build and the backend use
the pinned 24.21.0.
