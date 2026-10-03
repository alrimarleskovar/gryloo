# BUILD-CLOUD-001 — Report

Date: 2026-10-03. Branch `claude/build-cloud-001`, stacked on `codex/build-brand-001-flofi`
(`64194874189795356c9f883493382bb85df73552`, PR #49, draft, unmerged). BUILD-013 (branch, worktree and
PR #48) was not touched.

**Status: IMPLEMENTATION COMPLETE — OWNER ACTION REQUIRED.** The durable, horizontally scalable execution
architecture is implemented and validated locally against a disposable PostgreSQL 18 and MOCKED in-process
chains. Nothing is deployed: no Railway, Vercel, Neon or object-storage credential exists in this environment.
No public or testnet transaction was made; that requires the owner's wallet.

## Public online swap acceptance gate

Gate assessment when it was raised: the cloud architecture covered the Robinhood transfer and Aave Supply family, but
the repository's only real-network swap — the exact-profile Base Sepolia Uniswap v3 USDC/WETH path
(`public-testnet-service.ts`) — still persisted to one overwritten local file, locked in process memory and was
reachable only with `NODE_ENV=development`. The public swap journey was therefore **not** possible (state C).

Completed in this build:
* The swap service's async logic became a shared core. The local service keeps its exact file format, lock file and
  synchronous Review/report signatures (its 12 existing tests pass unchanged); `createDurablePublicTestnetService`
  runs the same core on the storage ports with an append-only, identity-preserving snapshot validator, every
  mutation under the fenced run lease.
* The backend exposes `base-sepolia-swap` (`prepare`, `refresh`, `review`, `begin`, `report`, `observe`, `status`),
  enabled by `GRYLOO_PUBLIC_TESTNET=record`; workers reconcile attempts that carry the owner's transaction hash and
  archive the Evidence Bundle; migration `0002` widens the attempt-state domain for the swap's states.
* The swap server actions forward to the API when `API_BASE_URL` is set; the UI is unchanged.
* A plain-Node entry-point test was added after a real process run exposed an extensionless import that would have
  crashed the deployed backend at startup (vitest and Next resolve such imports; Node does not).

Validated: PostgreSQL end-to-end test of approval → worker reconciliation after browser loss → new API instance →
refresh/Review → swap → worker reconciliation → verified evidence, exactly two owner-sent transactions, no duplicate
attempt (MOCKED in-process chain); and a **live read-only preflight** through the real API process against public
Base Sepolia (block 47,611,431, pinned pool verified, quote 2 USDC → 0.010393 WETH, run durable in PostgreSQL). No
wallet was used and no transaction was sent.

Not validated, because it needs the owner: a public frontend URL (the existing Vercel preview of this branch is behind
Vercel Authentication and has no `API_BASE_URL`), the Railway API/worker and Neon database, and the owner-signed
Base Sepolia swap with worker reconciliation and evidence from another computer.

## Capability migration (scope correction)

The full inventory and per-capability status are in [BUILD-CLOUD-001-CAPABILITIES.md](BUILD-CLOUD-001-CAPABILITIES.md).
After the scope correction every capability with a legitimate real-network execution path was moved onto the same
generic runtime (no per-protocol architecture), except BUILD-013's lending composition, which stays on its owner-open
PR #48:

* **Solana Devnet Orca swap and Jupiter mainnet-beta swap** (one shared service) and **Solana Devnet Orca liquidity**:
  only their I/O primitives moved to the storage ports (their 84 existing tests pass unchanged). The backend exposes
  `solana-devnet-swap`, `orca-liquidity` and `jupiter-swap`; the three server actions forward when `API_BASE_URL` is
  set. Migration `0003` widens projection domains for base58 owners/signatures, Devnet/mainnet provenance and
  `EXPIRED`. The storage port gained a bounded prefix `list` (Orca restart listing).
* Worker processes now get observer transports that reject every submission method; a test proves it.
* Validated: PostgreSQL end-to-end on the MOCKED Solana environments (lost submit response → worker reconciliation with
  one broadcast; OPEN with owner + position-mint signatures and durable position registry; Jupiter durable with
  real-funds execution off by default), and a live read-only Devnet check through the real API process (Devnet
  simulate persisted as `PUBLIC_READ_ONLY`, Orca pool at slot 506,833,584).

Final status by gate: **A. cloud platform — complete; B. capability migration — complete for all real-network
capabilities except BUILD-013 (blocked by its open PR); C. public capability validated — none yet (no deployment);
D. not yet public — all MOCKED/FORK_REPRODUCED capabilities, each with its missing step in the matrix.**

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
| `pnpm check` (typecheck, lint, build, schemas, unit) | pass — 1191 passed, 2 skipped (pre-existing env-gated suites) |
| `pnpm test:postgres` (PostgreSQL 18.6, loopback) | pass — 33 passed |
| Browser: robinhood-transfer | 7 passed |
| Browser: supply, supply-recovery, borrow, repay, withdraw | 44 passed |
| Browser: lending-composition (shared economic-intent code) | 17 passed |
| Browser: network-isolation, interface-honesty, robinhood-network | 7 passed |
| Browser: jupiter, solana-devnet, solana-liquidity (MOCKED loopback) | 9 + 13 passed |
| Browser: public-testnet, build-roundtrip, swap-authoring | 7 passed; 1 swap-authoring screenshot differs locally (known font-rendering difference, also on untouched main; CI is authoritative) |
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
Base Sepolia swap, the Robinhood transfer and the Aave Supply family remain file/local-only; tenancy is configuration-based (no
per-user authentication); Vercel's serverless runtime uses its Node 24.x, while the build and the backend use
the pinned 24.21.0.
