# BUILD-CLOUD-PARITY-001 — Cloud parity matrix

Date: 2026-10-05. Audit of `main` `92593cf` (BUILD-ETHEREUM-001) before any change, then the state of this branch, verified through
the owner-configured Vercel Preview of commit `b09703b` (`https://flofi-git-claude-build-cloud-p-69135a-alrimarleskovars-projects.vercel.app`,
embedded runtime, tenant `pv-claude-build-cloud-parity-001-63fb69fb`, region `iad1`). Inventory sources: every `src/app/*-action.ts`,
`src/server/*`, `backend/flows.ts`, `src/state/*`, `docs/STATUS.md` and the build records. Evidence levels are copied from the
records and are **not** upgraded by this build.

## Vocabulary (separate from evidence levels)

This matrix does not change the canonical evidence vocabulary ([EVIDENCE_LEVELS.md](../EVIDENCE_LEVELS.md)). Its status column
answers one question — *can this run from a Vercel deployment with no WSL dependency?*:

| Status | Meaning |
| --- | --- |
| `CLOUD_READY` | Its production-shaped path runs on a cloud runtime (the remote API or the embedded Vercel runtime) with no localhost, `/tmp`, process-local durable state, local file persistence, Anvil, synthetic RPC, mock harness, developer shell, team key or server-side signing; proven by the cloud-runtime suites **and exercised through the Vercel Preview URL** on the public network. Not a claim of `TESTNET_EXECUTED`. |
| `PARTIAL` | Some of its path is cloud-ready; the rest is listed. |
| `LOCAL_ONLY` | A capability that cannot run on a hosted deployment; the exact blocker is given. Hosted deployments refuse it explicitly. |
| `BLOCKED_EXTERNAL` | Needs something outside this repository (owner credential, owner decision, provider capability). |
| `NOT_USER_FACING` | Test, rehearsal or MOCKED-demonstration infrastructure; never a product capability on a deployment. |

The rule this build keeps: **local fork success ≠ cloud ready; cloud ready ≠ testnet executed; testnet executed ≠ mainnet ready.**

"Remote Preview" is the outcome observed through the Preview URL by `scripts/cloud-preview-smoke.mjs` and
`pnpm test:cloud-remote` (2026-10-05T22:22–22:23Z, commit `b09703b`). Every call was a read, a quote or a Simulate for a public
address; nothing was reviewed, prepared, signed or sent. `SIMULATED ✓` = a durable run read back on a later request.

## Shared root causes found (before)

R1 only the remote API was durable and Railway runs `main` only; R2 local mode silently used process filesystems (`/tmp`,
journals, PID locks); R3 per-process session key on any deployment without a configured secret; R4 sessions not bound to their
host; R5 worker claims and sweeps not tenant-scoped; R6 schema check needs migration files on disk; R7 lending composition never
moved off the filesystem; R8 Base Sepolia RPC overrides inconsistent; R9 replay fixtures not deployed; R10 no non-secret
diagnostics; R11 Previews behind Vercel SSO. Found during remote validation: R12 the public Base Sepolia endpoint drops read
bursts from Vercel's shared egress (2 of 6 Simulates failed). Details and fixes: [plan](BUILD-CLOUD-PARITY-001-PLAN.md),
[report](BUILD-CLOUD-PARITY-001-REPORT.md).

## Networks (remote readiness probe through the Preview, 2026-10-05T22:22Z)

| Network | Capabilities on it | Cloud path | Remote probe (chain identity, block, latency) | Before → After |
| --- | --- | --- | --- | --- |
| Base Sepolia `eip155:84532` | Uniswap swap, Uniswap liquidity, Aave Supply family, lending composition, Router testnet source | embedded/remote runtime; one override `GRYLOO_BASE_SEPOLIA_RPC_URL` for every client; swap and liquidity paced | `REACHABLE` 84532, block 47,735,323, 177 ms (Aave endpoint 209 ms) | `PARTIAL` → `CLOUD_READY` |
| Ethereum Sepolia `eip155:11155111` | Aave V3 WBTC family, native transfer, Uniswap swap, Uniswap liquidity | same; `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL` | `REACHABLE` 11155111, block 11,851,691, 165 ms | `PARTIAL` → `CLOUD_READY` |
| Arbitrum Sepolia `eip155:421614` | Router testnet destination (observation only) | same; `GRYLOO_ARBITRUM_SEPOLIA_RPC_URL` | `REACHABLE` 421614, block 316,161,343 | `PARTIAL` → `CLOUD_READY` |
| Robinhood Chain Testnet `eip155:46630` | native self-transfer | same | `REACHABLE` 46630, block 129,493,774 | `PARTIAL` → `CLOUD_READY` |
| Solana Devnet | Orca swap, Orca liquidity | same; genesis-verified; `GRYLOO_SOLANA_DEVNET_RPC_URL` | `REACHABLE` (genesis `EtWTRABZ…`), height 495,123,908 | `PARTIAL` → `CLOUD_READY` |
| Base `eip155:8453` | Router mainnet (read-only), Base observation (recorded replay) | read-only; execution needs the owner's real-funds opt-in | `REACHABLE` 8453, block 52,224,793 | read-only `CLOUD_READY`; execution `BLOCKED_EXTERNAL` (owner real-funds decision; no mainnet expansion) |
| Arbitrum One `eip155:42161` | Router mainnet destination | read-only | `REACHABLE` 42161, block 512,057,513 | same as Base |
| Solana mainnet-beta | Jupiter (read-only) | read-only; genesis-verified | `REACHABLE` (genesis `5eykt4Us…`) | same as Base |

## EVM capabilities

| Capability | Local | Cloud | Remote Preview | Evidence (recorded) | Before → After |
| --- | --- | --- | --- | --- | --- |
| Native transfer — Robinhood Testnet | journal + MOCKED | flow `robinhood-transfer` | `SIMULATED ✓` `rhx-3224b6b2…` | `TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED` (RH-DEMO-001) | `PARTIAL` → `CLOUD_READY` |
| Native transfer — Ethereum Sepolia | journal + MOCKED | flow `robinhood-transfer` | `SIMULATED ✓` `rhx-e8772fc4…` (and smoke `rhx-556d499c…`) | `MOCKED`; `READY_FOR_OWNER_EXECUTION` | `PARTIAL` → `CLOUD_READY` |
| Uniswap v3 swap — Base Sepolia | journal + MOCKED | flow `base-sepolia-swap` (chain-bound, paced) | `SIMULATED ✓` `pub-1eedabee…` | `TESTNET_EXECUTED` (BUILD-011D-2) | `PARTIAL` → `CLOUD_READY` |
| Uniswap v3 swap — Ethereum Sepolia | journal + MOCKED | flow `base-sepolia-swap` | `SIMULATED ✓` `pub-d8d89047…` (one earlier sweep: `PUBLIC_RPC_RESPONSE_INVALID`, see report) | `MOCKED` | `PARTIAL` → `CLOUD_READY` |
| Uniswap v3 liquidity — Base Sepolia | journal + MOCKED | flow `uniswap-liquidity` (paced) | `SIMULATED ✓` `unilp-94f1e741…`; 8/8 repeated Simulates after pacing (4/6 before) | `PUBLIC_READ_ONLY` + `MOCKED` | `PARTIAL` → `CLOUD_READY` |
| Uniswap v3 liquidity — Ethereum Sepolia | journal + MOCKED | flow `uniswap-liquidity` | `UNISWAP_INSUFFICIENT_USDC` (the public owner address holds no Sepolia test USDC; 6/6 identical) | `MOCKED` | `PARTIAL` → `CLOUD_READY` |
| Aave V3 Supply / Borrow / Repay / Withdraw — Base Sepolia USDC | journal + MOCKED | flow `aave-supply` | Supply Simulate reached the balance gate: `SUPPLY_INSUFFICIENT_USDC` | Supply/Borrow `TESTNET_EXECUTED`; Repay/Withdraw `TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED` | `PARTIAL` → `CLOUD_READY` |
| Aave V3 Supply / Borrow / Repay / Withdraw — Ethereum Sepolia WBTC | journal + MOCKED | flow `aave-supply` | `SUPPLY_INSUFFICIENT_ASSET` (no test WBTC at the public owner address) | `MOCKED`; `READY_FOR_OWNER_EXECUTION` | `PARTIAL` → `CLOUD_READY` |
| Supply → Borrow → Swap composition (BUILD-013) | journal + MOCKED, 512 MiB run bound | **new** flow `lending-composition` on the Aave family's shared namespace; 16 MiB run capacity enforced before every wallet request | `LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED` (reaches the cloud runtime; the Preview has no keyed lending provider) | `MOCKED`; `PUBLIC_EXECUTION_BLOCKED` (BUILD-013) | `LOCAL_ONLY` → `CLOUD_READY` (path, capacity-bounded) + live use `BLOCKED_EXTERNAL` (owner `GRYLOO_ALCHEMY_API_KEY`) |
| CoW signed-intent swap (BUILD-005) | in-process scripted MOCKED orderbook | none — refused on hosted | `COW_OFF` | `MOCKED` | `LOCAL_ONLY` (explained below) |

**Lending composition.** Moved onto the storage ports with only its I/O primitives changed (the BUILD-CLOUD-001 pattern). It shares
the `aave-supply` namespace because locally it shares the Aave journal directory: owner-nonce and economic-intent reservations
must be common to both, or a composition and a single-step Aave run could reuse one owner nonce. A measured straight-through
MOCKED run ends at 8.9 MB (30 snapshots, last 547 KB); against the cloud store's 16 MiB bound the existing `begin()` guard (room
for 16 more snapshots) still admits the final SWAP (≈ 14.6 MB at that gate) and refuses a retry-heavy run **before** its next
wallet request (`LENDING_JOURNAL_CAPACITY_INSUFFICIENT`), never mid-transaction. Proven on PostgreSQL: five steps across
instances, worker recovery of a lost wallet result without resubmission, the shared reservation, the capacity guard. A compact
lending log (to lift the capacity limit) would change financial-core validators and needs its own reviewed build.

**CoW.** BUILD-005 is an in-process scripted orderbook (`fill`/`hold`/`ambiguous`/`expire`/`failure`) for the Base profile, with
no network client. There is nothing production-shaped to make durable: a real path is either the Base mainnet orderbook (real
funds, excluded) or a CoW testnet profile (a new network profile and protocol integration, excluded as new scope). Its
`CowOrderbookTransport` seam and the existing durable runtime (one flow definition, order UID / posting / cancellation /
settlement in the run log) are where a real orderbook would plug in.

## Cross-chain

| Capability | Local | Cloud | Remote Preview | Evidence | Before → After |
| --- | --- | --- | --- | --- | --- |
| Flofi Cross-chain Router — testnet (Base Sepolia → Arbitrum Sepolia USDC) | journal + MOCKED | flow `crosschain-router-testnet`, ownership bound to the host-bound session | without session `WALLET_SESSION_REQUIRED`; with a disposable signed-in wallet: session, ownership, chain reads and a **live provider quote** succeeded, then `ROUTER_INSUFFICIENT_USDC` (the quote precedes the balance check) | `MOCKED` + `PUBLIC_READ_ONLY`; no `TESTNET_EXECUTED` / `PERMISSIONLESS_EXECUTED` | `PARTIAL` → `CLOUD_READY` |
| LI.FI path / Across path (inside the Router) | MOCKED providers | server-side provider reads in the Router flow; outages fail closed | live quote reached (above) | as above | `CLOUD_READY` with the Router |
| Bridge lifecycle, recovery, reconciliation (Router) | MOCKED | durable run; request-driven `observe` (embedded) or worker (remote); never resubmits | run history per session `RUNS_0` (no run created: Simulate stopped at the balance gate) | `MOCKED` | `CLOUD_READY` |
| Router mainnet (Base → Arbitrum One) | MOCKED | read-only when `GRYLOO_ROUTER=live` | `ROUTER_NOT_ENABLED` (not enabled on the Preview) | `MOCKED` + `PUBLIC_READ_ONLY` | read-only `CLOUD_READY`; execution `BLOCKED_EXTERNAL` (owner real-funds decision) |
| LI.FI bridge demo (BUILD-008, MOCKED execution) | journal (`GRYLOO_BRIDGE=mocked`) | refused on hosted | `BRIDGE_OFF` | `CERTIFIED: MOCKED` | `NOT_USER_FACING` (MOCKED demo; real LI.FI is the Router) |
| Across direct demo (BUILD-010, simulated deposit/fill/refund) | `os.tmpdir()` journal, on by default | refused on hosted | `ACROSS_MOCKED_DEMO_LOCAL_ONLY` | `MOCKED` | was per-instance on Vercel → `NOT_USER_FACING` on hosted (real Across is the Router) |
| Bridge → swap demo (BUILD-009) | live LI.FI quotes, MOCKED execution, browser-local journal | stateless | — | `MOCKED` | `NOT_USER_FACING` (already stateless) |
| Cross-chain liquidity + recovery (BUILD-011C) | stateless MOCKED trace | stateless | — | `MOCKED` | `NOT_USER_FACING` (already stateless) |

## Solana

| Capability | Local | Cloud | Remote Preview | Evidence | Before → After |
| --- | --- | --- | --- | --- | --- |
| Orca Whirlpools swap (Devnet) | journal + MOCKED | flow `solana-devnet-swap`; owner-signed bytes verified and relayed once on the browser's explicit submit | `SIMULATED ✓` `orca-c0bd737c…` | `DEVNET_EXECUTED` (BUILD-DEMO-001) | `PARTIAL` → `CLOUD_READY` |
| Orca Whirlpools liquidity (Devnet) | journal + MOCKED | flow `orca-liquidity`; position-mint key generated in the browser, never sent | `SIMULATED ✓` `orcalp-148aa56d…` (OPEN around the live price, random public position-mint key) | `DEVNET_EXECUTED` (BUILD-015) | `PARTIAL` → `CLOUD_READY` |
| Jupiter swap (mainnet-beta) | journal + MOCKED | flow `jupiter-swap`, Simulate/Review only when `GRYLOO_JUPITER=live` | `JUPITER_PUBLIC_MAINNET_NOT_ENABLED` (not enabled on the Preview) | `MOCKED` + `PUBLIC_READ_ONLY` | read-only `CLOUD_READY`; execution `BLOCKED_EXTERNAL` (owner real-funds decision); no Devnet→mainnet fallback (genesis check) |

## Core Flofi

| Capability | Where it runs | Remote Preview | Before → After |
| --- | --- | --- | --- |
| Canonical Workflow IR, authoring (chat/canvas), Strategy Manifest | browser + stateless server validation | every sweep workflow authored with the app's own editor was accepted by the deployment's validators | `CLOUD_READY` |
| Simulation | each flow's service on the cloud runtime, bound to workflow + wallet + network + quote/state | 8 durable Simulates read back on later requests | `PARTIAL` → `CLOUD_READY` |
| Review | each flow, bound to the durable simulation commitment; stale state fails closed | not exercised remotely (owner action) | `PARTIAL` → `CLOUD_READY` (MOCKED PostgreSQL + browser suites) |
| Wallet ownership / session (EIP-4361) | Vercel server action; HttpOnly, Secure, SameSite=Strict, host-bound | sign-in with a disposable key `SIGNED_IN`, session read back `SESSION_ACTIVE`, ownership enforced (`WALLET_SESSION_REQUIRED` without it) | `PARTIAL` → `CLOUD_READY` |
| Wallet signing | user's injected wallet only | owner boundary — not performed | `CLOUD_READY` (unchanged design) |
| Execution | owner wallet submits; server records the result | owner boundary — not performed | `PARTIAL` → `CLOUD_READY` (MOCKED PostgreSQL + browser suites) |
| Recovery / reconciliation | `observe` on any instance (embedded) or the Railway worker (remote) | read-backs on new requests; recovery after a lost wallet result proven on PostgreSQL and in the browser | `PARTIAL` → `CLOUD_READY` |
| Evidence | computed by each service, persisted in the durable run log; optional object-store export | no repository or local-disk writes; filesystem store refused on hosted | `CLOUD_READY` |
| Copilot `off` / `replay` | Vercel server action; replay fixtures traced into the deployment | `MODE_OFF` (the Preview has no `FLOFI_COPILOT`) | `CLOUD_READY` (replay verified on the hosted-shape build) |
| Copilot `live` | Vercel server action → OpenAI Responses API, server-only key | not configured | `BLOCKED_EXTERNAL` (owner `OPENAI_API_KEY` + `OPENAI_COPILOT_MODEL`) |
| Conversation / proposal state | browser only | nothing server-side | `CLOUD_READY` |
| Base observation (recorded replay) | server, committed recordings (traced) | — | `CLOUD_READY` (replay) |
| Readiness diagnostics | `GET /api/flofi/readiness[?probe=networks]` | `READY`; 9/9 networks | new |

## Local rehearsal infrastructure (deliberately not deployed)

| Item | Why it stays local | Remote Preview | Status |
| --- | --- | --- | --- |
| Mode A swap / Mode A Uniswap liquidity (chain 31337 forks) | Anvil fork on loopback by design (`FORK_REPRODUCED`) | `LOCAL_FORK_ONLY` | `NOT_USER_FACING` |
| Mode B Safe + Zodiac Roles, B007 composition | Anvil fork **and a server-held disposable executor key** — can never be hosted | `LOCAL_FORK_ONLY` (both) | `NOT_USER_FACING` |
| MOCKED loopback harnesses, synthetic chains, Playwright servers, replay fixtures, test keys, chain 31337 | deterministic CI evidence | harness gates ignored on hosted | `NOT_USER_FACING` |

## Durable-state audit

| State | Before (local) | Classification | Cloud |
| --- | --- | --- | --- |
| Run snapshots / journals (all cloud flows, now including lending composition) | `GRYLOO_*_JOURNAL` JSONL files | PRODUCTION_RUNTIME | PostgreSQL log store (append-only, fenced) |
| Owner nonce + economic intent reservations | `*.intent` files, exclusive create; Aave and lending share one directory | PRODUCTION_RUNTIME | PostgreSQL exclusive create; Aave and lending share the `aave-supply` namespace |
| Cross-process locks | PID lock directories | PRODUCTION_RUNTIME | PostgreSQL fenced leases |
| Ownership sessions | sealed cookie; per-process key fallback | PRODUCTION_RUNTIME | sealed cookie, configured key, host-bound (no server storage) |
| Idempotency keys | n/a locally | PRODUCTION_RUNTIME | `api_idempotency` (remote API); embedded calls are in-process (no transport retry) |
| Evidence metadata / export | in run record; local evidence dir | PRODUCTION_RUNTIME | run log + optional S3-compatible store |
| Reconciliation checkpoints / async orders / bridge state | in run record | PRODUCTION_RUNTIME | run log; work items tenant-scoped, addressed by flow |
| Copilot admission limiter, RPC pacing queues, service maps, DB pool | process memory | performance only | unchanged (never authority) |
| Across demo, CoW loopback, BUILD-008 bridge, Mode A/B | files / `os.tmpdir()` | LOCAL rehearsal | refused on hosted |
| Browser recovery pointers (localStorage) | browser | convenience only | server state stays authoritative |
