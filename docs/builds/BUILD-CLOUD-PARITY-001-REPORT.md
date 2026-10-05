# BUILD-CLOUD-PARITY-001 — Report

Date: 2026-10-05. Branch `claude/build-cloud-parity-001` from `main` `92593cf` (PR #61, BUILD-ETHEREUM-001), verified equal to
`origin/main` before any change. [Plan](BUILD-CLOUD-PARITY-001-PLAN.md) · [Matrix](BUILD-CLOUD-PARITY-001-MATRIX.md) ·
[Environment reference](../deploy/ENVIRONMENT.md) · [Deployment guide](../deploy/CLOUD.md).

**Status: IMPLEMENTATION COMPLETE — READY_FOR_OWNER_CLOUD_CONFIGURATION.** Every supported user-facing capability now has a
production-shaped path that runs from a Vercel deployment with no WSL, localhost, Anvil, `/tmp` journal or team step, or is
explicitly refused there with a documented reason. The Preview of this branch builds and reaches **Ready** on Vercel. It could
not be exercised remotely: Previews of the `flofi` project answer HTTP 302 to Vercel Authentication, and the Preview
environment has no runtime configuration yet — both are owner settings. The same production build was exercised locally with
hosted-Preview semantics against the public testnets (read-only). No transaction was signed or sent; no `TESTNET_EXECUTED`
claim is made.

## Preview

| Item | Value |
| --- | --- |
| Vercel project | `flofi` (existing; GitHub integration) |
| Deployment | `https://flofi-d7slzsnxu-alrimarleskovars-projects.vercel.app` — GitHub deployment `6867899808`, Vercel `7fe27jM1bZWJfseRjW4SGDsEZiRE` |
| Status | `success` / Ready (2026-10-05T19:21:13Z); Vercel check "Deployment has completed" |
| Branch / SHA | `claude/build-cloud-parity-001` / `5587a114007982d8d66422dcf20117bb4ff22476` |
| Reachability | `/` and `/api/flofi/readiness` → HTTP 302 to `vercel.com/sso-api` (Vercel Authentication) |

The successful Vercel build is itself evidence for the clean-checkout requirement: the digest-verified toolchain
(`deploy/vercel/install.sh`), the frozen lockfile and the build of the embedded runtime (PostgreSQL driver traced as a server
dependency, replay fixtures traced) ran on Vercel's builder with no local path, global tool or manually installed binary.

## What was found and fixed

| # | Root cause (before) | Fix |
| --- | --- | --- |
| R1 | Only the remote API was durable; Railway deploys `main` only, so a Preview could never run its own backend. | `src/server/flow-runtime.ts`: one decision point for all nine cloud flows — remote API (`API_BASE_URL`, unchanged), **embedded** runtime (`DATABASE_URL` on a hosted deployment: the same `backend/app.ts` composition inside the Vercel function, all state in PostgreSQL), or fail closed (`CLOUD_RUNTIME_NOT_CONFIGURED`). |
| R2 | Local mode silently used the function's filesystem (`/tmp`, journals, PID locks). | `src/server/deployment.ts` (hosted detection). Hosted deployments never use journals or loopback harnesses (`flowMode` leaves harness-gated flows `off`); lending composition, the BUILD-010 Across demo, CoW loopback, the BUILD-008 bridge and local forks refuse themselves. |
| R3 | Per-process session key on a deployment without a configured secret. | Hosted deployments require `FLOFI_SESSION_SECRET` or `API_AUTH_TOKEN` (`WALLET_SESSION_NOT_CONFIGURED`). |
| R4 | Sessions not bound to their host. | Session tokens carry the issuing host and are accepted only there. |
| R5 | Worker claims and sweeps were global. | `createPostgresWorkQueue({ tenantId })`, `sweep(db, { tenantId })`; the Railway worker passes `TENANT_ID`. |
| R6 | Schema check read migration files beside the code. | `SHIPPED_MIGRATIONS` identity manifest (pinned to the SQL files by a unit test); `MIGRATIONS_DIRECTORY` is a path computation. Optional Preview-only build migration `FLOFI_MIGRATE_ON_BUILD=preview`. |
| R7 | Lending composition on the filesystem. | Measured, not migrated: its full-snapshot log exceeds the cloud store's 16 MiB bound (see matrix). Fails closed on hosted deployments. |
| R8 | Base Sepolia overrides inconsistent; swap transport not chain-bound. | `GRYLOO_BASE_SEPOLIA_RPC_URL` reaches Aave and the swap; the swap client is bound to chain 84532. No new variable. |
| R9 | Replay fixtures not deployed. | `outputFileTracingIncludes` for the Copilot and Base observation recordings. |
| R10 | No diagnostics. | `GET /api/flofi/readiness[?probe=networks]` — runtime, schema, tenant, per-flow mode, session, Copilot, chain identity per endpoint; never a URL, key or upstream message; 15 s per-instance cache, concurrent bounded probes. |
| R11 | Previews behind Vercel SSO. | Owner setting (below). `scripts/cloud-preview-smoke.mjs` accepts an automation-bypass secret from the owner's own shell. |

Infrastructure summary — **persistence**: the existing `@defi-workflow-engine/cloud-runtime` PostgreSQL stores, unchanged
schema (no migration added); **RPC**: every client chain-verified, bounded, HTTPS-only overrides, no cross-chain, Mainnet or
localhost fallback; **env**: documented per environment in [ENVIRONMENT.md](../deploy/ENVIRONMENT.md), nothing `NEXT_PUBLIC_*`;
**sessions**: HttpOnly, Secure (HTTPS), SameSite=Strict, 8 h, host-bound, configured key; **recovery**: a new request on any
instance loads the durable run and observes the chain (no background worker on a Preview; Vercel Cron does not run for
Previews); **origin**: derived from the request host Vercel sets, no hardcoded `localhost:3000` or production hostname.

## Matrix (summary — full table in the matrix document)

| Capability | Local | Cloud | Public testnet (read-only check) | Evidence (recorded) | Status |
| --- | --- | --- | --- | --- | --- |
| Native transfer (Robinhood, Ethereum Sepolia) | MOCKED | `robinhood-transfer` | Ethereum Sepolia Simulate persisted + read back | RH `TESTNET_EXECUTED`; ETH Sepolia `MOCKED` | `CLOUD_READY` |
| Uniswap swap (Base Sepolia, Ethereum Sepolia) | MOCKED | `base-sepolia-swap` | flow `live`; chains reachable | Base Sepolia `TESTNET_EXECUTED` | `CLOUD_READY` |
| Uniswap liquidity (Base Sepolia, Ethereum Sepolia) | MOCKED | `uniswap-liquidity` | live pool price, both chains | `PUBLIC_READ_ONLY` + `MOCKED` | `CLOUD_READY` |
| Aave Supply/Borrow/Repay/Withdraw | MOCKED | `aave-supply` | Aave endpoints reachable | Base Sepolia `TESTNET_EXECUTED`; ETH Sepolia WBTC `MOCKED` | `CLOUD_READY` |
| Cross-chain Router testnet (LI.FI / Across) | MOCKED | `crosschain-router-testnet` | both chains reachable (quotes need a signed-in wallet) | `MOCKED` + `PUBLIC_READ_ONLY` | `CLOUD_READY` |
| Orca swap / liquidity (Devnet) | MOCKED | `solana-devnet-swap`, `orca-liquidity` | live Orca price | `DEVNET_EXECUTED` | `CLOUD_READY` |
| Router mainnet, Jupiter (mainnets) | MOCKED | read-only Simulate/Review | chains reachable | `PUBLIC_READ_ONLY` | `CLOUD_READY` read-only; execution `BLOCKED_EXTERNAL` (owner real-funds decision) |
| Copilot off / replay | replay | Vercel server action | — | `MOCKED` | `CLOUD_READY` |
| Copilot live | — | Vercel server action, server-only key | — | never called live | `BLOCKED_EXTERNAL` (owner OpenAI key + model) |
| Supply → Borrow → Swap composition | MOCKED | refused on hosted | `PUBLIC_EXECUTION_BLOCKED` | `MOCKED` | `LOCAL_ONLY` (run-log size; keyed provider) |
| CoW signed intent | MOCKED loopback | refused on hosted | — | `MOCKED` | `LOCAL_ONLY` (no public CoW path exists) |
| Across / LI.FI / bridge→swap / cross-chain-liquidity demos, Mode A/B, forks | MOCKED / fork | refused or stateless | — | `MOCKED` / `FORK_REPRODUCED` | `NOT_USER_FACING` |

## Tests (local, 2026-10-05)

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | pass — 15/15 tasks |
| `pnpm lint` | pass (now includes `scripts/cloud-preview-smoke.mjs`) |
| `next build` (production) | pass — routes `/` (static) and `ƒ /api/flofi/readiness` |
| `pnpm test` | pass — 189 files, **1817 passed, 2 skipped** (the pre-existing env-gated `mode-b-service` / `composition-service` fork-profile suites) |
| `pnpm test:postgres` (PostgreSQL 18, loopback) | pass — **9 files, 48 tests**, including the new `tenancy.pg.test.ts` (4) and `flow-runtime.pg.test.ts` (4: an owner-signed journey with every request on a new runtime instance and exactly one transaction; Preview tenant isolation and redeploy survival; cached runtime validation and Router ownership; schema-behind fail-closed then recovery) |
| New browser suite `cloud-runtime.spec.ts` (embedded runtime, MOCKED loopback chain, disposable loopback DB, no journal) | **2 passed** |
| Browser regressions | journey 3, robinhood + ethereum-sepolia transfer 9, supply/borrow/repay/withdraw/ethereum-sepolia-supply 49, uniswap-liquidity 4, router 4, solana-devnet + solana-liquidity 13, jupiter 9, copilot + copilot-conversation 13, public-testnet/across/build009/network-isolation/interface-honesty/robinhood-network/execution-capabilities/cross-chain-liquidity(+recovery) 16 — all passed. lending-composition: first run 16 passed / 1 failed in `beforeEach` (`ENOTEMPTY` while the fixture's `rm -rf` raced a server write to its journal directory; no assertion ran); rerun **17 passed** |
| `bootstrap-ci.py --verify-dependencies` | pass — 262 registry entries verified, 16 reviewed license exceptions (unchanged; no dependency added) |
| governance-lite + 17 self-tests (clean export) | pass — 955 text files |
| `git diff --check` | pass |

Not run locally: the Anvil fork suites and the Mode A/B/composition browser specs (untouched code paths apart from a one-line
hosted guard that is inert locally) and the zero-pixel visual baselines (known local font differences). CI runs them.

New tests also cover: runtime selection for every environment combination, Preview tenant derivation, hosted harness refusal
(Vercel and Railway), readiness redaction (no secret, URL, connection string or upstream message in the report) and chain-identity
classification, host-bound sessions, hosted session-key refusal, and the shipped migration manifest.

## Remote validation

**Through the Preview URL:** only the deployment status (Ready) and HTTP 302 to Vercel Authentication for `/` and
`/api/flofi/readiness`. Nothing else could be exercised remotely; this is recorded as the remaining owner action, not as a pass.

**Through the production build served locally with hosted-Preview semantics** (`next start` of the same build with
`FLOFI_DEPLOYMENT=hosted`, `VERCEL_ENV=preview`, branch `claude/build-cloud-parity-001`, a freshly migrated database, the public
testnet gates and `FLOFI_COPILOT=replay`), public networks read-only:

* readiness `READY`, runtime `embedded`, tenant `pv-claude-build-cloud-parity-001-63fb69fb`, schema 4, session `CONFIGURED`;
  flows live: swap, liquidity, Aave, transfer, Router testnet, Orca swap, Orca liquidity; mainnet Router and Jupiter `off`;
* 9/9 endpoints `REACHABLE` with the expected chain identity — Base Sepolia (both endpoints, block 47,729,429), Ethereum
  Sepolia (11,850,728), Arbitrum Sepolia (316,114,299), Robinhood Testnet (129,420,403), Solana Devnet (495,074,995), Base
  (52,218,900), Arbitrum One (512,013,094), Solana mainnet-beta (431,705,849);
* `scripts/cloud-preview-smoke.mjs`: 168 server actions discovered from the deployment's own bundle; page, CSP, readiness,
  Copilot status, session status, flow modes, live pool prices (Base Sepolia, Ethereum Sepolia, Solana Devnet) all pass; one
  Ethereum Sepolia native self-transfer **Simulate** for the owner's public address `0x8ef12e4e…5e41b3b` returned run
  `rhx-69fa91ab…5437` (`SIMULATED`, `PUBLIC_TESTNET` provenance, Preview tenant), read back on a new request — no signature, no
  wallet, no transaction. 28/29 on the first run (one probe name that the client bundle does not reference — script fixed),
  then 26/26 without the Simulate.

## Owner boundary

Flofi constructs, simulates, reviews and reconciles; the user's injected wallet signs; the chain executes. No component holds a
key, signs, approves a wallet prompt or submits an owner transaction; workers' transports cannot send. Everything below needs
the owner, and no agent performs any of it.

**To make the Preview usable (once, in Vercel → Project `flofi` → Settings; see [CLOUD.md](../deploy/CLOUD.md)):**

1. Preview-only `DATABASE_URL` to a database that is **not** Production's (e.g. the Neon integration), plus
   `FLOFI_MIGRATE_ON_BUILD=preview` (and optionally `DATABASE_MIGRATION_URL`).
2. Preview-only `FLOFI_SESSION_SECRET`.
3. Preview-only capability gates: `GRYLOO_PUBLIC_TESTNET=record`, `GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live`,
   `GRYLOO_SUPPLY_TESTNET=live`, `GRYLOO_ETHEREUM_SEPOLIA_TRANSFER=live`, `GRYLOO_ROBINHOOD_TESTNET=live`,
   `GRYLOO_ROUTER_TESTNET=live`, `GRYLOO_SOLANA_DEVNET=live` (optionally Copilot live). `API_BASE_URL` unset for Preview.
4. Deployment Protection: disable Vercel Authentication for Preview deployments, or create a Protection Bypass for Automation.
5. Redeploy; `https://<preview>/api/flofi/readiness?probe=networks` must show `READY`.

**Then the owner cloud execution (`READY_FOR_OWNER_CLOUD_EXECUTION`):** 1. open the Preview URL; 2. connect the wallet;
3. select the testnet (e.g. Ethereum Sepolia); 4. author a supported action (e.g. supply WBTC to Aave, or a tiny test-ETH
self-transfer); 5. Simulate and review the Manifest; 6. sign in the wallet. Close the tab and reopen to see recovery. No terminal
command is needed. Only a run that lands and reconciles may be described as `TESTNET_EXECUTED`.

## Remaining blockers (specific)

1. **Preview reachability and configuration** — owner settings above (R11). Until then the Preview is Ready but unexercised.
2. **Lending composition** — `LOCAL_ONLY`: a compact durable log format is needed (financial-core validators; its own reviewed
   build), plus BUILD-013's keyed-provider requirement.
3. **CoW** — `LOCAL_ONLY`: no public CoW orderbook path exists in Flofi (Base mainnet = real funds; a testnet profile = new scope).
4. **Copilot live** — needs the owner's `OPENAI_API_KEY` and chosen `OPENAI_COPILOT_MODEL` (and the owner-only live smoke).
5. **Mainnet execution** (Router mainnet, Jupiter) — remains an explicit owner real-funds decision; not enabled.
6. **Background reconciliation on a Preview** — none (request-driven recovery only); Production keeps the Railway worker.
7. **Railway** still deploys `main` only; Production keeps `API_BASE_URL` → Railway and is unchanged except as listed below.

## Behavior changes for owner review

1. Hosted deployments refuse the BUILD-010 Across MOCKED demo (`ACROSS_MOCKED_DEMO_LOCAL_ONLY`; it is authorable from the action
   library and on by default). Its journal lived in each instance's `os.tmpdir()`.
2. Hosted deployments refuse lending composition (`LENDING_CLOUD_RUNTIME_UNAVAILABLE`).
3. Sessions issued before this change carry no host and are refused once; users sign in again.
4. `GRYLOO_BASE_SEPOLIA_RPC_URL`, if set on Railway, now also serves Aave Base Sepolia and the swap.
5. The Railway worker claims and sweeps only its `TENANT_ID` (Production uses one tenant, `default`).

## UX overlap with `codex/build-product-ux-001`

Compared read-only against that branch (committed and uncommitted). This build touches **no** file under `src/components`,
`src/state`, `src/domain`, `globals.css`, `layout.tsx` or `copilot-panel.tsx`, and Codex touches none of this build's runtime
files (`src/app/*-action.ts`, `src/server/*`, `backend/*`, `packages/cloud-runtime`, `next.config.ts`, `playwright.config.ts`,
CI, `deploy/`). Expected interaction points:

* `e2e/cloud-runtime.spec.ts` (new) authors the Robinhood transfer with the same UI steps as `e2e/robinhood-transfer.spec.ts`,
  which Codex edits (it renames "Continue to Simulate"). The new spec already navigates through the "Workflow stages"
  navigation instead of that button; if Codex changes the "Advanced action setup" form or the transfer region labels, update
  both specs together.
* Error codes now visible on hosted deployments: `CLOUD_RUNTIME_NOT_CONFIGURED`, `ACROSS_MOCKED_DEMO_LOCAL_ONLY`,
  `LENDING_CLOUD_RUNTIME_UNAVAILABLE` surface through the existing error displays; any copy mapping is Codex's to design.

## PR

Branch `claude/build-cloud-parity-001`, [PR #62](https://github.com/alrimarleskovar/gryloo/pull/62) against `main` (not merged,
no automatic merge). CI, final SHA and the final Preview are recorded in the PR description.
