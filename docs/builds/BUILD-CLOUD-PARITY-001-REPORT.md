# BUILD-CLOUD-PARITY-001 — Report

Date: 2026-10-05. Branch `claude/build-cloud-parity-001` from `main` `92593cf` (PR #61, BUILD-ETHEREUM-001), verified equal to
`origin/main` before any change. [Plan](BUILD-CLOUD-PARITY-001-PLAN.md) · [Matrix](BUILD-CLOUD-PARITY-001-MATRIX.md) ·
[Environment reference](../deploy/ENVIRONMENT.md) · [Deployment guide](../deploy/CLOUD.md).

**Status: CLOUD PARITY VALIDATED ON THE VERCEL PREVIEW — READY_FOR_OWNER_CLOUD_EXECUTION.** Every supported user-facing
capability now runs from the Vercel Preview on the embedded PostgreSQL runtime and public testnets, with no WSL, localhost,
Anvil, `/tmp` journal or team step, or is refused there with a documented reason. After the owner configured the Preview, a
read-only smoke and a per-capability parity sweep were run **through the Preview URL**: eight durable Simulates were read back
on later requests, wallet sessions and ownership work over HTTPS, and every off or local-only capability fails closed with its
documented code. No owner signature was requested, nothing was reviewed, prepared, signed or sent, and no `TESTNET_EXECUTED`
claim is made.

## Preview

| Item | Value |
| --- | --- |
| Vercel project | `flofi` (existing; GitHub integration) |
| Verified deployment | `https://flofi-git-claude-build-cloud-p-69135a-alrimarleskovars-projects.vercel.app` (branch alias) → `https://flofi-ihjzmom30-alrimarleskovars-projects.vercel.app`, GitHub deployment `6870673722` |
| Status | `success` / Ready; readiness `READY` |
| Branch / SHA | `claude/build-cloud-parity-001` / `b09703b97d6d9bcc77e3f151e2c4551719012106` |
| Runtime | `embedded`, tenant `pv-claude-build-cloud-parity-001-63fb69fb`, schema 4, region `iad1`, session `CONFIGURED`, Copilot `off` |
| Reachability | the branch alias is public; per-deployment URLs still answer 302 (Vercel Authentication) |

Earlier Previews of this branch: `5587a11` (`6867899808`) and `2d1adad` (`6867965815`, redeployed by the owner with the Preview
configuration) — both Ready; `d18550f` (`6870519790`) — Ready, used for the first remote lending check.

## What was found and fixed

| # | Root cause (before) | Fix |
| --- | --- | --- |
| R1 | Only the remote API was durable; Railway deploys `main` only, so a Preview could never run its own backend. | `src/server/flow-runtime.ts`: one decision point for every cloud flow — remote API (`API_BASE_URL`, unchanged), **embedded** runtime (`DATABASE_URL` on a hosted deployment: the same `backend/app.ts` composition inside the Vercel function, all state in PostgreSQL), or fail closed (`CLOUD_RUNTIME_NOT_CONFIGURED`). |
| R2 | Local mode silently used the function's filesystem (`/tmp`, journals, PID locks). | `src/server/deployment.ts`. Hosted deployments never use journals or loopback harnesses (harness-gated flows stay `off`); the Across demo, CoW loopback, the BUILD-008 bridge and local forks refuse themselves. |
| R3 | Per-process session key on a deployment without a configured secret. | Hosted deployments require `FLOFI_SESSION_SECRET` or `API_AUTH_TOKEN`. |
| R4 | Sessions not bound to their host. | Session tokens carry the issuing host and are accepted only there. |
| R5 | Worker claims and sweeps were global. | Tenant-scoped queue and sweep; the Railway worker passes `TENANT_ID`. The sweep now addresses work by flow (shared namespaces). |
| R6 | Schema check read migration files beside the code. | `SHIPPED_MIGRATIONS` identity manifest; optional Preview-only build migration `FLOFI_MIGRATE_ON_BUILD=preview`. |
| R7 | Lending composition on the filesystem. | Measured, then moved onto the ports: new flow `lending-composition` on the Aave family's shared namespace, 16 MiB run capacity enforced before every wallet request. |
| R8 | Base Sepolia overrides inconsistent; swap transport not chain-bound. | `GRYLOO_BASE_SEPOLIA_RPC_URL` reaches every Base Sepolia client; swap client bound to 84532. |
| R9 | Replay fixtures not deployed. | Traced into the serverless functions. |
| R10 | No diagnostics. | `GET /api/flofi/readiness[?probe=networks]`, never a URL, key or upstream message. |
| R11 | Previews behind Vercel SSO. | Owner setting (done for the branch alias). |
| R12 | *Found remotely:* the public Base Sepolia endpoint drops read bursts from Vercel's shared egress (2/6 liquidity Simulates failed). | The live Base Sepolia swap and liquidity clients use the Router's existing `pacedReadRpc` (spacing + bounded retry of transport failures; a node's answer is never retried) — 8/8 afterwards. |

Infrastructure summary — **persistence**: the existing `@defi-workflow-engine/cloud-runtime` PostgreSQL stores, no schema
change; **RPC**: chain-verified, bounded, HTTPS-only overrides, no cross-chain/Mainnet/localhost fallback, Base Sepolia reads
paced; **env**: [ENVIRONMENT.md](../deploy/ENVIRONMENT.md), nothing `NEXT_PUBLIC_*`; **sessions**: HttpOnly, Secure,
SameSite=Strict, 8 h, host-bound, configured key; **recovery**: a new request on any instance loads the durable run and observes
the chain (no background worker on a Preview); **origin**: the request host Vercel sets, nothing hardcoded.

## Matrix (summary — full tables in the matrix document)

| Capability | Local | Cloud | Remote Preview (`b09703b`) | Evidence (recorded) | Status |
| --- | --- | --- | --- | --- | --- |
| Native transfer — Robinhood Testnet / Ethereum Sepolia | MOCKED | `robinhood-transfer` | `SIMULATED ✓` both | RH `TESTNET_EXECUTED`; ETH Sepolia `MOCKED` | `CLOUD_READY` |
| Uniswap swap — Base Sepolia / Ethereum Sepolia | MOCKED | `base-sepolia-swap` | `SIMULATED ✓` both | Base Sepolia `TESTNET_EXECUTED` | `CLOUD_READY` |
| Uniswap liquidity — Base Sepolia / Ethereum Sepolia | MOCKED | `uniswap-liquidity` | `SIMULATED ✓` / balance gate | `PUBLIC_READ_ONLY` + `MOCKED` | `CLOUD_READY` |
| Aave Supply family — Base Sepolia USDC / Ethereum Sepolia WBTC | MOCKED | `aave-supply` | balance gate (`SUPPLY_INSUFFICIENT_*`) | Base Sepolia `TESTNET_EXECUTED` | `CLOUD_READY` |
| Supply → Borrow → Swap composition | MOCKED | `lending-composition` (new) | `LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED` | `MOCKED`; `PUBLIC_EXECUTION_BLOCKED` | path `CLOUD_READY` (capacity-bounded); live `BLOCKED_EXTERNAL` (owner `GRYLOO_ALCHEMY_API_KEY`) |
| Cross-chain Router testnet (LI.FI / Across) | MOCKED | `crosschain-router-testnet` | session + ownership + live quote, then `ROUTER_INSUFFICIENT_USDC` (unfunded disposable wallet) | `MOCKED` + `PUBLIC_READ_ONLY` | `CLOUD_READY` |
| Orca swap / liquidity (Devnet) | MOCKED | `solana-devnet-swap`, `orca-liquidity` | `SIMULATED ✓` both | `DEVNET_EXECUTED` | `CLOUD_READY` |
| Router mainnet, Jupiter | MOCKED | read-only flows | `ROUTER_NOT_ENABLED`, `JUPITER_PUBLIC_MAINNET_NOT_ENABLED` | `PUBLIC_READ_ONLY` | read-only `CLOUD_READY`; execution `BLOCKED_EXTERNAL` (owner real-funds decision) |
| Copilot off / replay | replay | Vercel | `MODE_OFF` | `MOCKED` | `CLOUD_READY` |
| Copilot live | — | Vercel, server-only key | not configured | never called live | `BLOCKED_EXTERNAL` (owner OpenAI key + model) |
| CoW signed intent | scripted MOCKED orderbook | refused on hosted | `COW_OFF` | `MOCKED` | `LOCAL_ONLY` (no public CoW path exists) |
| Across / LI.FI demos, Mode A/B, local forks | MOCKED / fork | refused | `ACROSS_MOCKED_DEMO_LOCAL_ONLY`, `BRIDGE_OFF`, `LOCAL_FORK_ONLY` | `MOCKED` / `FORK_REPRODUCED` | `NOT_USER_FACING` |

## Tests (local, 2026-10-05, final head)

| Gate | Result |
| --- | --- |
| `pnpm typecheck` · `pnpm lint` · `next build` | pass |
| `pnpm test` | **190 files, 1820 passed, 2 skipped** (the pre-existing env-gated `mode-b-service` / `composition-service` fork-profile suites) |
| `pnpm test:postgres` (PostgreSQL 18, loopback) | **10 files, 52 tests**, including `tenancy.pg` (4), `flow-runtime.pg` (4) and `lending-composition-cloud.pg` (4: five steps across new instances with five transactions; a lost wallet result reconciled by a tenant-scoped worker with no resubmission; a nonce held in the shared namespace blocking the step before any wallet request; the capacity guard refusing before any wallet request) |
| Browser `cloud-runtime.spec.ts` (embedded runtime, disposable loopback DB) | 2 passed (also in CI) |
| Browser regressions | journey 3, robinhood + ethereum-sepolia transfer 9, supply/borrow/repay/withdraw/ethereum-sepolia-supply 49, uniswap-liquidity 4, router 4, solana-devnet + solana-liquidity 13, jupiter 9, copilot + conversation 13, public-testnet/across/build009/network-isolation/interface-honesty/robinhood-network/execution-capabilities/cross-chain-liquidity(+recovery) 16, lending-composition 17 (after the port; the first-ever run of this branch had one `beforeEach` `ENOTEMPTY` fixture race that did not reproduce) |
| `bootstrap-ci.py --verify-dependencies` | pass — 262 verified, 16 reviewed exceptions (no dependency added) |
| governance-lite + 17 self-tests (clean export) | pass — 959 text files |
| CI on `5587a11` and `2d1adad` | contracts and governance pass (push and pull_request); `cloud-runtime.spec.ts` 2/2 in CI |

Not run locally: the Anvil fork suites and the Mode A/B/composition browser specs (untouched apart from a one-line hosted guard,
inert locally) and the zero-pixel visual baselines (known local font differences). CI runs them.

## Remote validation (through the Preview URL)

**Readiness** (`?probe=networks`, 22:22Z): `READY`, runtime `embedded`, schema 4, commit `b09703b`; flows live: swap,
liquidity, Aave, transfer, Router testnet, Orca swap, Orca liquidity, lending composition; Router mainnet and Jupiter `off`;
9/9 endpoints `REACHABLE` with the expected chain identity (Base Sepolia block 47,735,323 at 177 ms; Ethereum Sepolia
11,851,691; Arbitrum Sepolia 316,161,343; Robinhood 129,493,774; Solana Devnet 495,123,908; Base 52,224,793; Arbitrum One
512,057,513; Solana mainnet-beta 431,749,758).

**Smoke** (`scripts/cloud-preview-smoke.mjs`): **28/28** — page, CSP `connect-src 'self'`, readiness, commit match, 168 server
actions discovered, Copilot/session/flow probes, live pool prices (Base Sepolia, Ethereum Sepolia, Solana Devnet), and one
Ethereum Sepolia self-transfer Simulate for the owner's public address `0x8ef12e4e…5e41b3b` (`rhx-556d499c…`) read back.

**Parity sweep** (`pnpm test:cloud-remote`, 22:23Z): passed. Durable Simulates read back on later requests — Robinhood transfer
`rhx-3224b6b2…`, Ethereum Sepolia transfer `rhx-e8772fc4…`, Base Sepolia swap `pub-1eedabee…`, Ethereum Sepolia swap
`pub-d8d89047…`, Base Sepolia liquidity `unilp-94f1e741…`, Orca swap `orca-c0bd737c…`, Orca liquidity `orcalp-148aa56d…`.
Deterministic domain outcomes for the public owner addresses: `UNISWAP_INSUFFICIENT_USDC` (Ethereum Sepolia liquidity),
`SUPPLY_INSUFFICIENT_USDC` / `SUPPLY_INSUFFICIENT_ASSET` (Aave). Lending composition reached the cloud runtime:
`LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED`. Router testnet: `WALLET_SESSION_REQUIRED` without a session; EIP-4361 sign-in with
a **disposable in-memory key** (never the owner's wallet, never funded; the message authorizes no transaction) → `SIGNED_IN`,
session read back, then a live provider quote and `ROUTER_INSUFFICIENT_USDC`. Fail-closed probes: `ROUTER_NOT_ENABLED`,
`JUPITER_PUBLIC_MAINNET_NOT_ENABLED`, Copilot `off`, `ACROSS_MOCKED_DEMO_LOCAL_ONLY`, `COW_OFF`, `BRIDGE_OFF`,
`LOCAL_FORK_ONLY` (Mode A, Mode B, Mode B composition).

**Provider behavior observed from Vercel** (all fail closed, no run written, the user re-simulates): before pacing, Base Sepolia
liquidity failed 2/6 (`PUBLIC_RPC_UNAVAILABLE`, one failed price read) and once `UNISWAP_SIMULATION_UNAVAILABLE`; after pacing
8/8 succeeded. The Ethereum Sepolia swap returned `PUBLIC_RPC_RESPONSE_INVALID` once in five sweeps (a JSON-RPC answer from the
load-balanced public node; answers are deliberately not retried). Keyed endpoints (`GRYLOO_BASE_SEPOLIA_RPC_URL`,
`GRYLOO_ETHEREUM_SEPOLIA_RPC_URL`) are the owner-side remedy.

**Tooling fixes found by the remote run** (test tooling only, no product change): React Flight replies carry long strings as
length-prefixed text rows and hint rows with an empty id; the first smoke/sweep parser split on newlines and misread Orca
replies and cookie-setting replies. Both parsers now read Flight rows properly.

## Owner boundary

Flofi constructs, simulates, reviews and reconciles; the user's injected wallet signs; the chain executes. Nothing in the cloud
holds a key, signs, approves a wallet prompt or submits an owner transaction. This build stopped at Simulate.

**`READY_FOR_OWNER_CLOUD_EXECUTION`** — no terminal needed:

1. Open `https://flofi-git-claude-build-cloud-p-69135a-alrimarleskovars-projects.vercel.app`.
2. Connect your wallet.
3. Select the testnet (for example Ethereum Sepolia or Base Sepolia).
4. Author a supported action (for example a tiny test-ETH self-transfer, Supply 0.0001 WBTC to Aave on Ethereum Sepolia, or a
   Uniswap swap on Base Sepolia); fund the wallet with test tokens first — the sweep's Simulates showed the balance gates.
5. Simulate, then review the Manifest.
6. Sign in your wallet. Close the tab and reopen to see recovery; download the Evidence Bundle after reconciliation.

Only a run that lands and reconciles may be described as `TESTNET_EXECUTED`.

## Remaining blockers (specific)

1. **Lending composition live use** — the Preview needs `GRYLOO_ALCHEMY_API_KEY` (BUILD-013's keyed provider). Run capacity is
   bounded by the 16 MiB cloud log (a clean run fits; a retry-heavy run stops before its next wallet request); lifting it needs a
   compact lending log in its own reviewed build.
2. **CoW** — `LOCAL_ONLY`: no public CoW orderbook path exists in Flofi (Base mainnet = real funds; a testnet profile = new scope).
3. **Copilot live** — owner `OPENAI_API_KEY` + `OPENAI_COPILOT_MODEL` (and the owner-only live smoke).
4. **Mainnet execution** (Router mainnet, Jupiter) — explicit owner real-funds decision; not enabled.
5. **Public RPC reliability** — keyed endpoints recommended for Base Sepolia and Ethereum Sepolia on deployments.
6. **Background reconciliation on a Preview** — none (request-driven recovery only); Production keeps the Railway worker.
7. **Per-deployment Preview URLs** stay behind Vercel Authentication; the branch alias is the user URL.

## Behavior changes for owner review

1. Hosted deployments refuse the BUILD-010 Across MOCKED demo (`ACROSS_MOCKED_DEMO_LOCAL_ONLY`; it is on by default and authorable
   from the action library). Its journal lived in each instance's `os.tmpdir()`.
2. The lending composition now runs on the cloud runtime (remote API or embedded) when `GRYLOO_SUPPLY_TESTNET=live`; it shares
   the Aave Supply family's durable namespace and needs `GRYLOO_ALCHEMY_API_KEY`. On Railway, the API and worker will expose it
   once those variables are set.
3. Sessions issued before this change carry no host and are refused once; users sign in again.
4. `GRYLOO_BASE_SEPOLIA_RPC_URL`, if set on Railway, now also serves Aave Base Sepolia and the swap; live Base Sepolia swap and
   liquidity reads are paced (a Simulate takes a few seconds longer).
5. The Railway worker claims and sweeps only its `TENANT_ID` (Production uses one tenant, `default`).

## UX overlap with `codex/build-product-ux-001`

Compared read-only against that branch. This build touches **no** file under `src/components`, `src/state`, `src/domain`,
`globals.css`, `layout.tsx` or `copilot-panel.tsx`, and Codex touches none of this build's runtime files (`src/app/*-action.ts`,
`src/server/*`, `backend/*`, `packages/cloud-runtime`, `next.config.ts`, `playwright.config.ts`, CI, `deploy/`). Interaction points:

* `e2e/cloud-runtime.spec.ts` (new) authors the Robinhood transfer with the same UI steps as `e2e/robinhood-transfer.spec.ts`,
  which Codex edits; it already uses the "Workflow stages" navigation rather than the renamed CTA. If Codex changes the
  "Advanced action setup" form or the transfer region labels, update both specs together.
* `src/server/cloud-parity.remote.test.ts` authors workflows through `src/domain/editor` commands (not the UI), so it follows the
  domain model, not presentation.
* New codes visible on hosted deployments surface through the existing error displays: `CLOUD_RUNTIME_NOT_CONFIGURED`,
  `ACROSS_MOCKED_DEMO_LOCAL_ONLY`, `LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED`, `LENDING_JOURNAL_CAPACITY_INSUFFICIENT`.

## PR

Branch `claude/build-cloud-parity-001`, [PR #62](https://github.com/alrimarleskovar/gryloo/pull/62) against `main` (not merged,
no automatic merge). Final SHA, CI and Preview are recorded in the PR description.
