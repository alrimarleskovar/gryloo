# BUILD-CLOUD-PARITY-001 — Cloud parity matrix

Date: 2026-10-05. Audit of `main` `92593cf` (BUILD-ETHEREUM-001) before any change, then the state of this branch. Inventory
sources: every `src/app/*-action.ts`, `src/server/*`, `backend/flows.ts`, `src/state/*`, `docs/STATUS.md` and the build
records. Evidence levels are copied from the records and are **not** upgraded by this build.

## Vocabulary (separate from evidence levels)

This matrix does not change the canonical evidence vocabulary ([EVIDENCE_LEVELS.md](../EVIDENCE_LEVELS.md)). Its status
column answers one question — *can this run from a Vercel deployment with no WSL dependency?*:

| Status | Meaning |
| --- | --- |
| `CLOUD_READY` | Its production-shaped path runs on a cloud runtime (the remote API or the embedded Vercel runtime) with no localhost, `/tmp`, process-local durable state, local file persistence, Anvil, synthetic RPC, mock harness, developer shell, team key or server-side signing; proven by the cloud-runtime test suites **and** the production build served with hosted-Preview semantics against the public network. Not a claim of `TESTNET_EXECUTED`. |
| `PARTIAL` | Some of its path is cloud-ready; the rest is listed. |
| `LOCAL_ONLY` | A real capability that cannot run on a hosted deployment yet; the exact blocker is given. Hosted deployments refuse it explicitly. |
| `BLOCKED_EXTERNAL` | Needs something outside this repository (owner credential, owner decision, provider capability). |
| `NOT_USER_FACING` | Test, rehearsal or MOCKED-demonstration infrastructure; never a product capability on a deployment. |

The rule this build keeps: **local fork success ≠ cloud ready; cloud ready ≠ testnet executed; testnet executed ≠ mainnet ready.**

"Remote Preview" records whether the capability was exercised **through the Vercel Preview URL** of this branch (see the
[report](BUILD-CLOUD-PARITY-001-REPORT.md)).

## Shared root causes found (before)

R1 only the remote API was durable and Railway runs `main` only; R2 local mode silently used process filesystems (`/tmp`,
journals, PID locks); R3 per-process session key on any deployment without a configured secret; R4 sessions not bound to
their host; R5 worker claims and sweeps not tenant-scoped; R6 schema check needs migration files on disk; R7 lending
composition never moved off the filesystem; R8 Base Sepolia RPC overrides inconsistent; R9 replay fixtures not deployed;
R10 no non-secret diagnostics; R11 Previews behind Vercel SSO. Details and fixes: [plan](BUILD-CLOUD-PARITY-001-PLAN.md).

## Networks

| Network | Capabilities on it | Local | Cloud path | Public read check (hosted-shape, 2026-10-05) | Before → After |
| --- | --- | --- | --- | --- | --- |
| Base Sepolia `eip155:84532` | Uniswap swap, Uniswap liquidity, Aave Supply family, Router testnet source | MOCKED loopback harnesses | remote API or embedded runtime; one override `GRYLOO_BASE_SEPOLIA_RPC_URL` for every client | `REACHABLE` chain 84532 (both the public and the Aave endpoint); live pool price read through the runtime | `PARTIAL` (Preview had no runtime) → `CLOUD_READY` |
| Ethereum Sepolia `eip155:11155111` | Aave V3 WBTC Supply/Borrow/Repay/Withdraw, native transfer, Uniswap swap, Uniswap liquidity | MOCKED loopback + fork rehearsal (`MOCKED`) | same; `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL` | `REACHABLE` chain 11155111; live pool price; a real Simulate of a native self-transfer persisted to PostgreSQL and read back | `PARTIAL` → `CLOUD_READY` |
| Arbitrum Sepolia `eip155:421614` | Router testnet destination (observation only) | MOCKED loopback | same; `GRYLOO_ARBITRUM_SEPOLIA_RPC_URL` | `REACHABLE` chain 421614 | `PARTIAL` → `CLOUD_READY` |
| Robinhood Chain Testnet `eip155:46630` | native self-transfer | MOCKED loopback | same | `REACHABLE` chain 46630 | `PARTIAL` → `CLOUD_READY` |
| Solana Devnet | Orca swap, Orca liquidity | MOCKED loopback | same; genesis-verified; `GRYLOO_SOLANA_DEVNET_RPC_URL` | `REACHABLE` (genesis `EtWTRABZ…`); live Orca pool price | `PARTIAL` → `CLOUD_READY` |
| Base `eip155:8453` | Router mainnet (read-only), Base observation (recorded replay) | MOCKED loopback; fork (31337) for Mode A/B | read-only on the cloud runtime; execution needs the owner's real-funds opt-in | `REACHABLE` chain 8453 | `CLOUD_READY` for Simulate/Review; execution `BLOCKED_EXTERNAL` (owner real-funds decision; no mainnet expansion) |
| Arbitrum One `eip155:42161` | Router mainnet destination | MOCKED loopback | read-only | `REACHABLE` chain 42161 | same as Base |
| Solana mainnet-beta | Jupiter (read-only) | MOCKED loopback | read-only; genesis-verified | `REACHABLE` (genesis `5eykt4Us…`) | same as Base |

## EVM capabilities

| Capability | Local | Cloud | Public testnet | Evidence (recorded) | Before → After | Remote Preview |
| --- | --- | --- | --- | --- | --- | --- |
| Native transfer (Robinhood Testnet, Ethereum Sepolia) | journal + MOCKED harness | flow `robinhood-transfer` | Ethereum Sepolia Simulate for a public address: `SIMULATED`, `PUBLIC_TESTNET` provenance, durable in the Preview tenant | Robinhood `TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED` (RH-DEMO-001); Ethereum Sepolia `MOCKED` | `PARTIAL` → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| Uniswap v3 swap (Base Sepolia, Ethereum Sepolia) | journal + MOCKED | flow `base-sepolia-swap` | availability `live`; transport now chain-bound to 84532 | Base Sepolia `TESTNET_EXECUTED` (BUILD-011D-2); Ethereum Sepolia `MOCKED` | `PARTIAL` → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| Uniswap v3 concentrated liquidity (Base Sepolia, Ethereum Sepolia) | journal + MOCKED | flow `uniswap-liquidity` | live pool price on both chains through the runtime | `PUBLIC_READ_ONLY` + `MOCKED`; `TESTNET_EXECUTED` pending owner | `PARTIAL` → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| CoW signed-intent swap | MOCKED loopback orderbook (`GRYLOO_COW=loopback`) | none — refused on hosted | none | `MOCKED` (BUILD-005) | `LOCAL_ONLY` → `LOCAL_ONLY` (explained) | n/a |
| Aave V3 Supply / Borrow / Repay / Withdraw (Base Sepolia USDC, Ethereum Sepolia WBTC) | journal + MOCKED | flow `aave-supply` | Base Sepolia Aave endpoint `REACHABLE`; now honours `GRYLOO_BASE_SEPOLIA_RPC_URL` | Base Sepolia Supply/Borrow `TESTNET_EXECUTED`, Repay/Withdraw `TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED`; Ethereum Sepolia WBTC `MOCKED`, `READY_FOR_OWNER_EXECUTION` | `PARTIAL` → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| Supply → Borrow → Swap composition (BUILD-013) | journal + MOCKED (`GRYLOO_LENDING_HARNESS`) | none — refused on hosted (`LENDING_CLOUD_RUNTIME_UNAVAILABLE`) | `PUBLIC_EXECUTION_BLOCKED` (BUILD-013) | `MOCKED` | `LOCAL_ONLY` (silently file-based on Vercel) → `LOCAL_ONLY` (explained, fails closed) | n/a |

**CoW blocker.** BUILD-005 is a deterministic MOCKED orderbook on loopback for the Base profile. There is no public CoW
orderbook integration in Flofi to make durable: a real path is either the Base mainnet orderbook (real funds, excluded by this
build) or a CoW testnet profile (a new network profile and protocol integration, excluded as new scope). Its async lifecycle
(order UID, posting, cancellation, settlement) would fit the existing durable runtime unchanged (one flow definition), once a
real orderbook path exists.

**Lending composition blocker.** Every lending log line is a full snapshot repeating every Review; the BUILD-013 pilot logged
15.9 MB by its first reconciled step and more than 100 MB by ROUTER_APPROVAL (local bound 512 MiB). The cloud log store is
bounded at 16 MiB per log (code and schema) and every cold serverless instance re-validates a log from its first byte. Moving it
needs a compact (delta or content-addressed Review) lending log — a change to the financial core's validators that needs its own
reviewed build. Separately, BUILD-013's public sequential `eth_simulateV1` is rate-limited on public endpoints and needs a keyed
provider (`GRYLOO_ALCHEMY_API_KEY`).

## Cross-chain

| Capability | Local | Cloud | Public testnet | Evidence | Before → After | Remote Preview |
| --- | --- | --- | --- | --- | --- | --- |
| Flofi Cross-chain Router — testnet journey (Base Sepolia → Arbitrum Sepolia USDC) | journal + MOCKED (`journey.spec.ts`) | flow `crosschain-router-testnet`, ownership bound to the host-bound wallet session | both chains `REACHABLE`; quotes need a signed-in wallet (by design), so no unsigned live quote was taken here — the BUILD-JOURNEY-001 `PUBLIC_READ_ONLY` record stands | `MOCKED` + `PUBLIC_READ_ONLY`; `TESTNET_EXECUTED`/`PERMISSIONLESS_EXECUTED` not claimed | `PARTIAL` (production API has it off; Previews had no runtime) → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| LI.FI path / Across path (inside the Router) | MOCKED providers | server-side provider reads in the same flow; outages fail closed | as above | as above | `CLOUD_READY` with the Router | Preview Ready; not exercised (Vercel Authentication) |
| Bridge lifecycle, recovery, reconciliation (Router) | MOCKED | durable run, request-driven `observe` (embedded) or worker (remote); never resubmits | — | `MOCKED` | `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| Router mainnet (Base → Arbitrum One) | MOCKED | read-only Simulate/Review | chains `REACHABLE` | `MOCKED` + `PUBLIC_READ_ONLY` | `CLOUD_READY` (read-only); execution `BLOCKED_EXTERNAL` (owner real-funds decision) | — |
| LI.FI bridge demo (BUILD-008, Base → Optimism, MOCKED execution) | journal (`GRYLOO_BRIDGE=mocked`) | refused on hosted | — | `CERTIFIED: MOCKED` | `NOT_USER_FACING` (MOCKED demo; superseded by the Router) | n/a |
| Across direct demo (BUILD-010, simulated deposit/fill/refund) | `os.tmpdir()` journal, **on by default** | refused on hosted (`ACROSS_MOCKED_DEMO_LOCAL_ONLY`) | — | `MOCKED` | was silently per-instance on Vercel → `NOT_USER_FACING` on hosted (the real Across path is the Router) | n/a |
| Bridge → swap demo (BUILD-009) | live LI.FI quotes, MOCKED execution, browser-local journal | stateless server (quote reads only) | — | `MOCKED` | `NOT_USER_FACING` (MOCKED demo; already stateless) | — |
| Cross-chain liquidity + recovery (BUILD-011C) | stateless MOCKED trace | stateless | — | `MOCKED` | `NOT_USER_FACING` (MOCKED demo; already stateless) | — |

## Solana

| Capability | Local | Cloud | Public | Evidence | Before → After | Remote Preview |
| --- | --- | --- | --- | --- | --- | --- |
| Orca Whirlpools swap (Devnet) | journal + MOCKED | flow `solana-devnet-swap`; owner-signed bytes verified and relayed once on the browser's explicit submit | Devnet `REACHABLE` | `DEVNET_EXECUTED` (BUILD-DEMO-001) | `PARTIAL` → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| Orca Whirlpools liquidity (Devnet) | journal + MOCKED | flow `orca-liquidity`; position-mint key generated in the browser, never sent | live pool price through the runtime | `DEVNET_EXECUTED` (BUILD-015) | `PARTIAL` → `CLOUD_READY` | Preview Ready; not exercised (Vercel Authentication) |
| Jupiter swap (mainnet-beta) | journal + MOCKED | flow `jupiter-swap`, Simulate/Review only | mainnet `REACHABLE` | `MOCKED` + `PUBLIC_READ_ONLY`, `READY_FOR_OWNER_EXECUTION` | `CLOUD_READY` (read-only); execution `BLOCKED_EXTERNAL` (owner real-funds decision); no Devnet→mainnet fallback (genesis check) | — |

## Core Flofi

| Capability | Where it runs | Cloud finding | Before → After |
| --- | --- | --- | --- |
| Canonical Workflow IR, authoring (chat/canvas), Strategy Manifest | browser + stateless server validation | no server state | `CLOUD_READY` |
| Simulation | each flow's service on the cloud runtime | bound to workflow + wallet + network + quote/state; persisted durably | `PARTIAL` → `CLOUD_READY` |
| Review | each flow, bound to the durable simulation commitment | stale or changed state fails closed | `PARTIAL` → `CLOUD_READY` |
| Wallet ownership / session (EIP-4361) | Vercel server action, HttpOnly + Secure + SameSite=Strict cookies | fixed: hosted deployments require a configured key (no per-process key); sessions bound to the issuing host | `PARTIAL` → `CLOUD_READY` |
| Wallet signing | user's injected wallet only | no server key, no automatic approval | `CLOUD_READY` (unchanged) |
| Execution | owner wallet submits; server records the result | durable attempt before the wallet request; never resubmitted | `PARTIAL` → `CLOUD_READY` |
| Recovery / reconciliation | `observe` on any instance (embedded) or the Railway worker (remote) | after instance loss a new request loads PostgreSQL state and observes the chain | `PARTIAL` → `CLOUD_READY` |
| Evidence | computed by each service, persisted in the durable run log; optional object-store export | no repository or local-disk writes; filesystem store refused on hosted | `CLOUD_READY` |
| Copilot `off` / `replay` | Vercel server action | `replay` fixtures now traced into the deployment | `PARTIAL` (replay failed on Vercel) → `CLOUD_READY` |
| Copilot `live` | Vercel server action → OpenAI Responses API, server-only key | supported by configuration; never called live by any build | `BLOCKED_EXTERNAL` (owner `OPENAI_API_KEY` + `OPENAI_COPILOT_MODEL`) |
| Conversation / proposal state | browser only | nothing server-side to persist | `CLOUD_READY` |
| Base observation (recorded replay) | server, committed recordings | recordings now traced into the deployment; live reads stay development-only | `CLOUD_READY` (replay) |
| Readiness diagnostics | `GET /api/flofi/readiness` | new; non-secret | new |

## Local rehearsal infrastructure (deliberately not deployed)

| Item | Why it stays local | Status |
| --- | --- | --- |
| Mode A swap / Mode A Uniswap liquidity (chain 31337 forks) | Anvil fork on loopback by design (`FORK_REPRODUCED`) | `NOT_USER_FACING`; refused on hosted |
| Mode B Safe + Zodiac Roles, B007 composition | Anvil fork **and a server-held disposable executor key** — can never be hosted | `NOT_USER_FACING`; refused on hosted |
| MOCKED loopback harnesses, synthetic chains, Playwright servers, replay fixtures, test keys, chain 31337 | deterministic CI evidence | `NOT_USER_FACING`; harness gates ignored on hosted |

## Durable-state audit

| State | Before (local) | Classification | Cloud |
| --- | --- | --- | --- |
| Run snapshots / journals (all cloud flows) | `GRYLOO_*_JOURNAL` JSONL files | PRODUCTION_RUNTIME | PostgreSQL log store (append-only, fenced) |
| Owner nonce + economic intent reservations | `*.intent` files, exclusive create | PRODUCTION_RUNTIME | PostgreSQL exclusive create (primary key) |
| Cross-process locks | PID lock directories | PRODUCTION_RUNTIME | PostgreSQL fenced leases |
| Ownership sessions | sealed cookie; per-process key fallback | PRODUCTION_RUNTIME | sealed cookie, configured key, host-bound (no server storage) |
| Idempotency keys | n/a locally | PRODUCTION_RUNTIME | `api_idempotency` (remote API); embedded calls are in-process (no transport retry) |
| Evidence metadata / export | in run record; local evidence dir | PRODUCTION_RUNTIME | run log + optional S3-compatible store |
| Reconciliation checkpoints / async orders / bridge state | in run record | PRODUCTION_RUNTIME | run log; work items tenant-scoped |
| Copilot admission limiter, RPC pacing queues, service maps, DB pool | process memory | performance only | unchanged (never authority) |
| Lending composition run, Across demo, CoW loopback, BUILD-008 bridge, Mode A/B | files / `os.tmpdir()` | LOCAL rehearsal | refused on hosted |
| Browser recovery pointers (localStorage) | browser | convenience only | server state stays authoritative |
