# BUILD-CLOUD-001 — Durable, cloud-capable Flofi execution

Date: 2026-10-03. Branch `claude/build-cloud-001`, stacked on
`codex/build-brand-001-flofi` at `64194874189795356c9f883493382bb85df73552`
(PR #49, draft, unmerged). BUILD-013 (`codex/build-013-lending-composition`,
PR #48) and its worktree are out of scope and untouched.

This build changes where execution state lives and which process advances it.
It does not change what Flofi is allowed to do with money: every economic
action still originates from an explicit owner click in the owner's browser
wallet. The backend never holds keys, never signs and has no send path.

## 1. Current architecture (inventory, read from code)

**Process model.** A single Next.js 16 app (`apps/reference-dapp`). All
backend work runs inside Next server actions (`src/app/*-action.ts`,
`'use server'`). Each action module lazily builds one service
singleton (`src/server/*-service.ts`) in process memory. There is no separate
API or worker process and no background reconciliation: observation and
reconciliation run only when the browser calls `*Observe`.

**Financial core packages** (pure, tsc-built, no I/O except the file store):

| Package | Role |
| --- | --- |
| `workflow-contracts` | Typebox schemas, canonical hashing, journal hash chain (`hashJournalBytes`), Evidence Bundle schema, attempt state machine (`assertTransition`). |
| `reference-compiler` | Review/simulation builders, transaction payloads, RPC read helpers (`readTransferState`, `simulateSupply`, …). |
| `reference-executor` | Run/attempt models (`TransferRun`, `SupplyRun`, `LendingRun`, …), journal append, `classifyUnknownResult`, the append-only file store (`writeExtendingFile`, `readValidatedFile`) and `reserveEconomicIntent`. |
| `reference-reconciler` | Receipt/state reconciliation and Evidence Bundle builders. |
| `reference-linter`, `action-registry` | Authoring validation and pinned capability/network profiles. |

**Persistence.** Every execution service persists one *append-only JSONL
snapshot log per run* (`<journalDir>/<runId>.jsonl`). Each line is a complete
validated record; the service-specific `validate` re-checks the full history on
every write (prefix-preserving: journal entries, observations, attempt
identity, nonce, transaction, hash and evidence may only grow).
`writeExtendingFile` writes temp → fsync → rename → directory fsync and refuses
any write that is not a strict byte extension of the current file
(`JOURNAL_CORRUPT`). This is already a content-level compare-and-swap.

**Economic identity (“intent”) files.** `<owner>-<nonce>.intent`,
`economic-<hash>.intent`, `borrow-/withdraw-/repay-<hash>.intent` are created
with `open(…, 'wx')` (exclusive create) and are only ever extended, never
deleted. They are the durable guarantee that one owner nonce / one exact
economic call cannot be prepared by two runs; only a *proven pre-broadcast
refusal* lets a fresh Review re-own the same intent (`recoveryOf`).

**Locking.** `locked(key)` creates `<key>.lock/` with a `pid` file and reclaims it
when `process.kill(pid, 0)` reports the owner dead. Within one process,
`writeExtendingFile` also serializes per path. This is correct on one machine
and meaningless across machines (a PID on another host says nothing).

**Attempt lifecycle (Robinhood transfer and Aave Supply family).**
`simulate` (read-only, new run) → `review` (owner authorization bound to the
Review commitment) → `begin` (fresh state re-check, reserve nonce/intent,
persist PREPARED) → `handoff` (persist SUBMITTING *before* the wallet call) →
browser wallet `eth_sendTransaction` → `report(HASH | UNKNOWN | REJECTED)` or
`walletFailure` (only a proven refusal code marks `notSubmitted`) →
`observe` (read-only discovery by nonce, receipt reconciliation, evidence).
Unknown results are observation-only; there is no automatic resubmission
anywhere. `observe` on a PREPARED attempt treats it as never handed to the
wallet and cancels it — so observation must never race a live browser between
`begin` and `handoff`.

**Configuration.** `GRYLOO_*` environment variables enable each flow and name
its journal directory (`GRYLOO_SUPPLY_JOURNAL`, `GRYLOO_ROBINHOOD_JOURNAL`,
…). Robinhood live reads additionally require `NODE_ENV=development`. Some
mocked flows (Across) default to `os.tmpdir()`.

**Browser state.** `localStorage` holds only *pointers* (`gryloo:*` keys: run ID
and, for wallet-returned hashes, the hash so a reload can re-report it) and
canvas layout preferences. The bridge-swap MOCKED journal is the one flow that
keeps a whole run in the browser. The server journal is authoritative for
every public-testnet flow.

**Evidence.** Evidence Bundles (`evidence-bundle` schema, hash-linked to the
manifest, plan and journal head) are embedded in the final run snapshot. They
are downloadable from the UI. Historical evidence is committed under
`docs/builds/*` and is immutable.

**Frontend/network boundary.** CSP `connect-src 'self'`: the browser only talks
to its own origin; all RPC reads are server-side and method-allowlisted. The
wallet is reached only via the injected EIP-1193 provider.

**CI.** `contracts.yml` pins Node/pnpm by digest, verifies every lockfile entry
(integrity, license allowlist, ≥7 day release age, exactly 247 registry
packages, exact workspace importer set) and runs typecheck, lint, build,
schemas, unit, Anvil/fork and loopback browser suites. `governance.yml` runs
`scripts/governance_lite.py`.

## 2. Blockers for cloud operation

1. **Execution state on the local filesystem** (`journalDir`, intent files).
   A container's filesystem is ephemeral and not shared by N replicas.
2. **PID locks** cannot exclude a process on another machine; a stale lock on
   another machine could be reclaimed incorrectly or never.
3. **No asynchronous progress.** Reconciliation happens only while a browser is
   open and polling. Closing the tab stops progress.
4. **In-memory singletons** (service per action module) — harmless for logic,
   but RPC pacing queues and caches are per process.
5. **No API boundary separate from the UI process**, no request idempotency,
   no tenant attribution, no paginated history.
6. **Robinhood live reads are tied to `NODE_ENV=development`**, which a deployed
   backend never is.

## 3. Target architecture

```
Browser (Flofi UI, owner wallet signs)        ── same-origin only (CSP)
   │ server actions (unchanged contracts)
   ▼
Next.js on Vercel (stateless BFF) ── API_BASE_URL + bearer token ──┐
   (local mode: services in-process, file or PostgreSQL storage)    │
                                                                    ▼
                                   Stateless API (Railway, N replicas)
                                       │ short transactions
                                       ▼
                           PostgreSQL (Neon) — source of truth
                 execution logs · runs · attempts · journal · intents ·
                 leases (fenced) · work_items (outbox) · idempotency ·
                 evidence metadata
                                       ▲
                                       │ claim (SKIP LOCKED), fenced writes
                         Workers (Railway, N replicas): reconcile, evidence
                                       │
                         ┌─────────────┴─────────────┐
                    RPC (read-only, allowlisted)   EvidenceStore
                                                   (S3-compatible / filesystem)
```

A modular monolith: the same service code runs in the Next process (local
mode) or in the API/worker processes (`apps/reference-dapp/backend/main.ts`
`api | worker | migrate`), started by Node 24's native TypeScript execution so
no new bundler or build step is introduced. Infrastructure code lives in a new
package, `@defi-workflow-engine/cloud-runtime`, which the financial core never
imports.

## 4. Storage interfaces (ports)

Defined in `reference-executor/src/durable-storage.ts` (pure TypeScript, no
vendor or driver import):

* **`DurableLogStore`** — the existing persistence contract, made explicit:
  `read(name) → bytes | null`, `extend(name, next, validate)` (strict byte
  extension; validate prior and next; durable before resolving) and
  `create(name, bytes) → boolean` (exclusive create). It covers run snapshot
  logs (ExecutionStore), the embedded journal (JournalStore) and intent files.
* **`LeaseStore`** — `hold(key, action)`: durable exclusive section; throws the
  flow's existing `*_BUSY` code when another live owner holds it. Re-entrant in
  the same async context.
* **`ExecutionStorage`** = `{ log, leases }`, built per flow.

Implementations:

| Port | Local / test | Cloud |
| --- | --- | --- |
| `DurableLogStore` | `createFileLogStore(dir)` — byte-identical paths/files to today | `createPostgresLogStore` (`cloud-runtime`) |
| `LeaseStore` | `createFileLeaseStore(dir, busyCode)` — today's PID lock | `createPostgresLeaseStore` (TTL, heartbeat, fencing token) |
| `WorkQueue` | in-process test double | PostgreSQL `work_items` (transactional outbox + queue) |
| `EvidenceStore` | `createFilesystemEvidenceStore(dir)` | `createS3EvidenceStore` (SigV4 over `fetch`; S3, R2, MinIO, Railway buckets) |
| `RpcProvider` | existing per-flow read functions (method allowlist, pacing, bounded retry), extracted to `src/server/*-rpc.ts` | same |
| Chain adapters | existing compiler/reconciler adapters | unchanged |

Services gain an optional `storage` input; without it they construct the file
implementations from `journalDir`, so local mode and every existing test keep
their exact behavior. Service logic (state machines, guards, validators,
reconciliation) is not rewritten — only the five I/O primitives are routed
through the ports.

## 5. PostgreSQL schema (`packages/cloud-runtime/migrations/0001_execution_core.sql`)

All tables carry `tenant_id`; every primary/unique key starts with it.

| Table | Kind | Purpose |
| --- | --- | --- |
| `tenants` | reference | tenant registry (`default` seeded). |
| `execution_logs` | mutable aggregate | one row per log (run log or intent): `version` (CAS), `segment_count`, `byte_length`, `content_sha256`, `kind`. |
| `execution_log_segments` | append-only | the bytes, one row per extension (`seq`, `bytes`, `segment_sha256`, `content_sha256` of the whole log after it). A trigger rejects UPDATE/DELETE. |
| `workflows` | mutable aggregate | `(tenant_id, workflow_id)` first/last seen. |
| `execution_runs` | mutable projection | `(tenant_id, run_id)` → `workflow_id` FK, `flow`, `status`, `verdict`, `provenance`, `owner_account`, `recovery_of`, `needs_observation`, `version`. |
| `execution_attempts` | mutable projection | `(tenant_id, attempt_id)` → `run_id` FK, `step`, `state`, `nonce`, `transaction_hash`, `reconciled`. |
| `journal_entries` | append-only projection | `(tenant_id, run_id, sequence)` → level, entity, attempt, from/to state, recorded_at, entry hash (the journal's own hash chain; a trigger rejects UPDATE/DELETE and every write re-checks the stored chain). |
| `execution_leases` | mutable | `(tenant_id, lease_key)` → `owner_id`, `fence` (monotonic), `expires_at`. |
| `work_items` | queue/outbox | job kind, `dedupe_key`, payload, `state`, `available_at`, attempts, lease owner/token/expiry. Partial unique index: one *open* item per `(tenant, kind, dedupe_key)`. |
| `api_idempotency` | mutable | `(tenant_id, scope, idempotency_key)` → request hash, status, stored response. |
| `evidence_objects` | append-only | `(tenant_id, run_id, bundle_hash)` → content SHA-256, size, media type, object key, store id. |
| `schema_migrations` | reference | version, name, SHA-256 of the SQL, applied_at. |

Large data: run snapshots stay in PostgreSQL because they *are* the execution
state (bounded at 16 MiB per log, the same bound as the file store).
Evidence artifacts go to the EvidenceStore; PostgreSQL keeps only their hash,
size and reference.

Indexes follow query paths: run history by `(tenant_id, updated_at DESC,
run_id)` for keyset pagination; open work by `(available_at)` partial on open
states; observation sweep by partial index on `needs_observation`;
journal by `(tenant_id, run_id, sequence)` (PK). No partitioning now. Future
partition candidates: `execution_log_segments`, `journal_entries`,
`work_items` (by time, after DONE retention), `evidence_objects` — all keyed
so that `(tenant_id, …, created_at)` range partitioning remains possible.

## 6. Concurrency model

* Every mutation is a short transaction. **No transaction is open during an
  RPC call**; RPC happens under a *lease*, not a row lock.
* `extend` locks the log row (`FOR UPDATE`), verifies the strict byte
  extension against the stored bytes, re-runs the flow validator on prior and
  next, appends one segment, bumps `version`, writes projections and enqueues
  work — all atomically. A stale writer cannot overwrite: its bytes do not
  extend the current log (`JOURNAL_CORRUPT`, the existing code) or its version
  check fails (`EXECUTION_VERSION_CONFLICT` for explicit CAS callers).
* `create` is `INSERT … ON CONFLICT DO NOTHING` on the primary key: exactly one
  run can own an owner nonce / exact economic call, across all machines.

## 7. Lease model (fencing)

`hold(key)` acquires `execution_leases(tenant, key)` with an upsert that only
succeeds when the row is absent or expired, incrementing `fence`. Otherwise the
flow's existing `*_BUSY` error is thrown (same as today). While the action runs
a heartbeat extends `expires_at`; release sets `expires_at = now()` (the row
and its fence survive, so fences stay monotonic). The held `(key, fence)` pairs
are carried in `AsyncLocalStorage`; **every** `extend`/`create` inside the
section verifies in the same transaction that each held lease still has the
same fence and has not expired. A paused or partitioned worker whose lease was
taken over therefore fails with `EXECUTION_LEASE_LOST` before it can write.
TTL defaults: 30 s, heartbeat 10 s.

## 8. Idempotency model

* **Economic idempotency** is unchanged and now enforced by database keys:
  one attempt per run (validator), one owner+nonce intent, one exact
  economic-call intent; only a proven pre-broadcast refusal can extend an
  intent to a fresh Review.
* **API idempotency**: mutation endpoints accept `Idempotency-Key`. The first
  request inserts `IN_PROGRESS` with a SHA-256 of `(method, args)`; a repeat
  with the same hash returns the stored success; a different payload under the
  same key is `IDEMPOTENCY_KEY_REUSED`; a concurrent duplicate is
  `IDEMPOTENCY_IN_PROGRESS`. Failures release the key so a retry re-runs the
  (already guarded) operation. The BFF generates one key per server-action
  invocation and reuses it for its bounded transport retries.

## 9. Outbox / work dispatch

`work_items` is both the transactional outbox and the queue. The flow
projector decides, *inside the same transaction that persists the snapshot*,
whether the run needs observation (attempt in SUBMITTING,
SUBMISSION_RESULT_UNKNOWN or PENDING, verdict PENDING, not `notSubmitted`) and
inserts `reconcile:<runId>` if no open item exists; a reconciled run with
evidence enqueues `evidence.archive:<runId>`. A crash after commit cannot lose
work because the work *is* the commit. Workers claim with `FOR UPDATE SKIP
LOCKED`, get a lease token, and complete/reschedule only while holding that
token. Delivery is at-least-once; correctness relies on the run lease plus the
idempotent, read-only `observe`. A periodic sweeper re-creates missing items
for any `needs_observation` run (defense in depth). Backoff: 15 s → ×2 → 10
min cap; after 500 deliveries or 7 days an item is `DEAD` with the run marked
`attention_required` — never resubmitted. An item first queued while an attempt is SUBMITTING waits 60 s (the
owner's wallet prompt is usually open); a later, more urgent state such as a reported hash brings the same
item forward instead of creating a second one. A future SQS/PubSub adapter can
relay `work_items` rows; dedupe stays on `(kind, dedupe_key)` and the run lease.

## 10. Recovery model

Workers re-read everything from PostgreSQL on each job:

| Durable state | Meaning | Worker action |
| --- | --- | --- |
| PREPARED | intended, not handed to wallet | none (browser `observe` cancels after restart; the worker never touches PREPARED) |
| SUBMITTING / SUBMISSION_RESULT_UNKNOWN | possibly broadcast | read-only discovery by owner nonce; never resubmit |
| PENDING | hash known | receipt reconciliation |
| CONFIRMED+reconciled / DIVERGENT / REVERTED / notSubmitted | terminal or owner decision | complete the work item |

The worker re-checks `needs_observation` under the run lease before calling
`observe`, so a stale queue item cannot cancel a PREPARED attempt created
after it was enqueued.

## 11. Evidence model

Evidence Bundles are built exactly as today and stay embedded in the run log.
`evidence.archive` writes a canonical JSON export
(`{bundle, bundleHash, publicExecution, artifacts}`) to the EvidenceStore under
a content address `sha256/<hex>`, then records `evidence_objects`. Reads verify
SHA-256 and size before returning bytes. Writing is idempotent (same content →
same key). Historical evidence in `docs/builds` is not touched.

## 12. Tenant isolation

Every store instance is bound to one `tenant_id`; every SQL statement filters
on it; foreign keys are composite with `tenant_id`, so a run cannot reference
another tenant's workflow. Run IDs from clients are looked up only within the
caller's tenant. This build resolves the tenant from server configuration
(`TENANT_ID`, default `default`) behind a `TenantResolver` port; authentication
and per-user tenancy are future work and need no schema change.
Row-level security can be layered on later.

## 13. API / worker split

* **API** (`backend/main.ts api`): `node:http`, no framework. `POST
  /v1/flows/{flow}/{method}` mirrors the existing server-action contracts
  (`{ok, value} | {ok:false, code}`) with per-method argument validation;
  `GET /v1/runs` (keyset pagination), `GET /v1/runs/{id}`,
  `GET /v1/runs/{id}/journal?after=&limit=`, `GET /v1/runs/{id}/evidence`;
  `GET /healthz`, `GET /readyz`. Bearer token required (refuses to start in
  production without one). 1 MiB body limit. Bounded retry on `*_BUSY` for
  report/failure endpoints so a worker's short observation does not lose a
  wallet result.
* **Worker** (`backend/main.ts worker`): claim loop with backoff polling (idle
  1 s → 10 s), graceful SIGTERM (stop claiming, finish or release current
  item), sweeper every 60 s, unique `worker_id`.
* **Migrate** (`backend/main.ts migrate`): explicit; API/worker check the
  schema version and refuse to start if behind.

## 14. Deployment topology

| Component | Initial provider | Config |
| --- | --- | --- |
| Frontend/BFF | Vercel, root `apps/reference-dapp` | `vercel.json`; server-only `API_BASE_URL`, `API_AUTH_TOKEN` |
| API | Railway service (Dockerfile) | `deploy/railway/api.json`; pre-deploy `migrate` |
| Worker | Railway service (same image) | `deploy/railway/worker.json` |
| Database | Neon PostgreSQL | `DATABASE_URL` (pooled), `DATABASE_MIGRATION_URL` (direct) |
| Evidence | any S3-compatible bucket | `OBJECT_STORE_ENDPOINT`, `_BUCKET`, `_REGION`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` |

The design uses only transaction-scoped locks and no session state, so it works
behind PgBouncer-style transaction pooling (Neon pooled endpoint).

## 15. Security boundaries

* No private key, seed phrase, signing or `eth_sendTransaction` path on any
  server. RPC method allowlists are unchanged.
* The browser's records are never trusted: the API accepts only IDs, the
  workflow (re-validated by the linter) and wallet results; every state
  transition is validated server-side against the durable log.
* Logs are structured JSON with a redaction pass for secrets, tokens,
  authorization headers and signatures; RPC URLs with keys are not logged.
* The API is not an admin surface; there is no endpoint that mutates
  state outside the existing flow methods.
* Robinhood live reads in the backend require the explicit
  `GRYLOO_ROBINHOOD_TESTNET=live`; this replaces the `NODE_ENV=development`
  coupling only inside the separately deployed backend (owner-review item).
  Supply public reads in the backend require `GRYLOO_SUPPLY_TESTNET=live`.

## 16. Migration / compatibility

* File mode remains the default; every `GRYLOO_*` variable, journal path,
  intent filename and `gryloo.*` format is unchanged.
* PostgreSQL stores the *same bytes* as the JSONL files, so a file journal can
  be imported verbatim (`backend/main.ts import-journal`, validated by the same
  flow validator) and exported back byte-for-byte.
* No migration rewrites existing persisted state.

## 16a. Review against the implementation

Checked after implementation: every interface, table, constraint, flow and
failure-model row in this plan corresponds to code in `packages/cloud-runtime`,
`packages/reference-executor/src/durable-storage.ts` and
`apps/reference-dapp/backend`. Deviations found while building and now
reflected here: the log hash columns are named `content_sha256`; PostgreSQL's
regex repetition limit (255) required a length check for evidence object
keys; queued work is pulled forward by a more urgent state; the API retries a
flow's `*_BUSY` code (raised before any work) for every method, not only for
wallet reports. The two refactored services changed only their I/O
primitives; their full existing unit and browser suites pass unchanged in
file mode.

## 17. Testing strategy

* Existing unit/browser suites unchanged (file mode).
* New `*.pg.test.ts` suites run against an isolated, disposable database
  (`TEST_DATABASE_URL`, loopback only; each file creates and drops its own
  database). They are excluded from `pnpm test` and run by `pnpm test:postgres`
  in CI with a PostgreSQL service container, so they are never silently
  skipped.
* The Robinhood and Supply MOCKED loopback chains drive end-to-end API → worker
  → reconciliation scenarios in-process (no public network, no broadcasts).

## 18. Completion gates

Implementation: ports, file + PostgreSQL implementations, migrations, fenced
leases, outbox/queue, worker, API, BFF forwarding, EvidenceStore,
observability, deployment config, all suites green. Operational: services
deployed with owner credentials, public URL reachable, restart/refresh
survival demonstrated, and an owner-authorized testnet transaction reconciled
by the worker. The operational gates need owner credentials and an owner
wallet action and are reported separately.

## 19. Non-goals

No UI redesign, new protocol/chain, adapter rewrite, Kubernetes, microservices,
Redis, non-PostgreSQL source of truth, custody, relaxed tests/tolerances,
historical evidence change, BUILD-013 work, or PR #48/#49 merge. Flows other
than the Base Sepolia Uniswap v3 swap (added for the public online swap
acceptance gate), Robinhood transfer and the Aave Supply family
(Supply/Borrow/Repay/Withdraw) remain file/local-only in this build and are not exposed by the
cloud API; the BFF does not forward them.

## 20. Future migration path

* Railway → ECS/Fargate/Kubernetes: same container image, same commands.
* Neon → Aurora/any PostgreSQL ≥ 14: standard SQL, no extensions required
  (`gen_random_uuid()` is core since 13).
* `work_items` → SQS/PubSub: add a relay that publishes open items and a
  consumer adapter; leases and dedupe keys keep consumers idempotent.
* Object storage: any S3-compatible endpoint, or a new `EvidenceStore`
  implementation.
* Redis, if ever added, only for caching/rate limiting.

## 21. Failure model (what the code actually does)

| Failure | Behavior |
| --- | --- |
| API dies before response | Transaction either committed or not. Client retry with the same idempotency key returns the stored result or re-runs the guarded operation. |
| API dies after commit | State and any work item are durable; next request/worker continues. |
| Worker dies before action | Work item lease expires → reclaimed by another worker. |
| Worker dies during/after RPC | Nothing was written, or the write committed; observe is read-only and repeatable. |
| Worker dies after possible submission | Not applicable: workers never submit. A wallet-side unknown stays SUBMISSION_RESULT_UNKNOWN and is discovered by nonce. |
| Worker loses lease | Fenced writes fail with `EXECUTION_LEASE_LOST`; item is retried. |
| Two workers race | One holds the run lease; the other gets `*_BUSY` and reschedules. |
| Database unavailable | Operations fail closed with `*_SERVICE_UNAVAILABLE`/`STORAGE_UNAVAILABLE`; nothing proceeds without a durable PREPARED/SUBMITTING. |
| RPC unavailable / rate limited | Existing bounded retry; item rescheduled with backoff. |
| Object storage unavailable | `evidence.archive` retries; run state and embedded evidence are unaffected. |
| Duplicate / delayed delivery | Dedupe key + run lease + idempotent observe. |
| Browser disappears / reloads | Server state is authoritative; the worker keeps reconciling submitted attempts. |
| Wallet rejects | Existing proven-refusal path (`notSubmitted`). |
| Pending / replaced / reverted / inconsistent observation | Existing reconciler verdicts (PENDING → retry, mismatch → DIVERGENT, revert → REVERTED, INCONCLUSIVE → retry). |
