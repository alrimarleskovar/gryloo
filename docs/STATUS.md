# Repository status

Current product name: **Flofi** (formerly Gryloo); see the
[branding transition](builds/BUILD-BRAND-001-PLAN.md). Historical entries below
retain the name used at the time. Runtime identifiers remain compatible.
BUILD-013 remains OPEN on `codex/build-013-lending-composition` at
`6cd675e41c0838fa8ac9cf3ec8e90de9442da3b9`; PR #48 remains open and unmerged.
This separate branding build does not resume its execution work. BUILD-CLOUD-001 (below) does not touch BUILD-013 either.

## BUILD-AUTOMATION-001 — FloFi Automations (automated evaluation, owner-confirmed execution)

**Status: READY_FOR_OWNER_PUSH — implementation and every local gate on MOCKED/fixture/loopback evidence; NO LIVE PRICE PROVIDER CALL,
NO REAL TELEGRAM MESSAGE AND NO TRANSACTION; NOT PUSHED; NO PR UNTIL THE OWNER SAYS SO.** Branch `claude/build-automation-001-production`
from main `8f91a01`. Owners create scheduled DCAs (DAILY/WEEKLY in IANA zones, DST-correct, `LATEST_WITHIN_GRACE` missed-run policy),
deterministic price triggers (below/above/percentage, fire once per crossing, re-arm on clear, cooldown) and daily market watches in a new
Automations workspace (EN/PT). Execution mode is only `CONFIRM_EACH_TIME`: an occurrence (unique per trigger event, migration
`0010_automations`) becomes an `AUTOMATION_RULE` handoff on the shared approval model when the owner opens it, claimable only by the owner's
proven wallet; FloFi's unchanged flow follows (fresh simulation, Strategy Manifest Review, the owner's signature). Actions are bound by value
to a canonical StrategySpec and hash; a saved-workflow edit stops proposals until an explicit, limit-checked rebind. Enforced limits per
execution, per day/week/month, cooldown, slippage, expiry. Evaluation runs as durable work items behind the bearer-only
`/api/automations/dispatch` and, when enabled on it, in the existing Railway worker (its 60 s sweep is the heartbeat for an embedded
deployment sharing its database and tenant; no new service, no cron needed there). Production stays on the remote runtime, where
automations fail closed like MCP/Channels/Developer. Daily-watch Buy/Sell is the owner's own new Build trade, not automation execution. Prices: read-only Chainlink feeds on Base mainnet (configured, verified on-chain) or a test
fixture. Notifications: in-app, and Telegram through the existing Channel Core after a one-time link code (no secret in any message;
WhatsApp unchanged). BTC can be watched but has no swap route (`BTC_EXECUTION_ROUTE_UNAVAILABLE`); Base mainnet swaps are not
owner-executable on main. See the [plan](builds/BUILD-AUTOMATION-001-PLAN.md), [report](builds/BUILD-AUTOMATION-001-REPORT.md) and
[operator guide](deploy/AUTOMATIONS.md).

## BUILD-DEVELOPER-001 — FloFi for Developers (Developer API, SDK, webhooks)

**Status: IMPLEMENTATION COMPLETE ON A STACKED BRANCH — MOCKED/LOCAL-INTEGRATION EVIDENCE ONLY; NO LIVE PREVIEW SESSION; NO
TRANSACTION; NOT PUSHED; NO PR UNTIL THE OWNER SAYS SO.** Branch `claude/build-developer-001`, stacked on BUILD-MCP-002 (`8f9650a`).
A third-party **server** application integrates FloFi end to end with a dependency-free TypeScript SDK (Apache-2.0) over
`/api/developer/v1` (10 endpoints + an internal scheduler endpoint): capability discovery → immutable StrategySpec (same workflow
hash as the app and MCP) → validate → read-only simulation preview → approval handoff → the end user's unchanged FloFi flow on
`/approve` (wallet proof, fresh simulation, Strategy Manifest Review, explicit approval, the user's own wallet signature) → status
and the canonical Evidence Bundle of runs the user chooses to share (off by default) → Standard Webhooks notifications derived
from durable state. The first commit extracted the shared engine into `src/platform` (MCP unchanged); Phase 2A generalized the
approval handoff to one requester-neutral model (migration `0006`) that MCP, the Developer API and future channels share;
developer state is migration `0007`. **An API key has zero financial authority**: no endpoint signs, submits or approves; sandbox
keys are test-funds only; live keys and mainnet are refused. Projects and keys come from an operator CLI. Evidence: unit,
PostgreSQL and browser suites, including the SDK-only third-party journey on MOCKED loopback chains with signed loopback webhooks.
Owner actions: a Preview with a testnet wallet for live acceptance, a scheduler for prompt webhooks, legal review before any
production or mainnet use. See the [plan](builds/BUILD-DEVELOPER-001-PLAN.md), [report](builds/BUILD-DEVELOPER-001-REPORT.md),
[developer docs](developer/README.md) and [operator guide](deploy/DEVELOPER.md).

## BUILD-CHANNELS-001 — FloFi Channels: production Channel Core, Telegram (live-capable), WhatsApp (policy-blocked)

**Status: READY_FOR_OWNER_REAL_E2E (Telegram) — implementation and every local gate on MOCKED/loopback evidence; NO REAL MESSAGE, NO
LIVE PROVIDER CALL AND NO TRANSACTION YET; WHATSAPP LIVE ACTIVATION BLOCKED BY POLICY (D1); NOT PUSHED; NO PR UNTIL THE OWNER SAYS SO.**

Branch `claude/build-channels-001-production`, restacked onto main `043ab01` (BUILD-DEVELOPER-001 included). A conversational
channel is an entry point into the shared platform (`src/platform`) with zero financial authority. Channel Core
(`src/channels/core`) is provider-neutral and production-grade: durable, tenant-scoped PostgreSQL state (migration `0009`),
deduplication, fenced leases, the canonical StrategySpec/IR with parity checks, a `CHANNEL_CONVERSATION` approval handed to
`/approve`, a transactional outbox with classified retries, dead letters and no resend after an uncertain send, delivery receipts
where the provider has them, status notifications ("loaded", "in progress", "reconciled ✅ · evidence: …"), retention and a
content-free audit trail. A scheduled dispatch (`/api/channels/dispatch`, bearer-only) makes retries, stranded turns and status
independent of the next inbound message; `/api/channels/health` reports readiness.

Providers share one contract. **Telegram**: a real Bot API adapter (secret-token webhook, private chats, buttons, 429
`retry_after`), configurable on a Vercel Preview today; the owner's real test is [CHANNELS-OWNER-E2E.md](deploy/CHANNELS-OWNER-E2E.md).
**WhatsApp**: the complete Cloud API path (Graph transport, statuses, 24-hour window, templates), but live activation requires
written policy clearance recorded in code (WhatsApp Business Messaging Policy §4); until then fixture-only and never hosted.

Evidence: unit, PostgreSQL and in-process journeys (the owner's full MOCKED execution and reconciliation), browser journeys for
Telegram and WhatsApp through `next start` to the blocked MOCKED Review, and the MCP/Developer regressions. See the
[plan](builds/BUILD-CHANNELS-001-PLAN.md), [report](builds/BUILD-CHANNELS-001-REPORT.md), [Telegram](deploy/TELEGRAM.md) and
[WhatsApp](deploy/WHATSAPP.md) guides.

## BUILD-MCP-002 — Consumer OAuth, trusted approval handoff and in-chat execution

**Status: INTEGRATED ON CURRENT MAIN — MOCKED/LOOPBACK EVIDENCE ONLY; NO LIVE CLAUDE OR CHATGPT CLIENT YET; NO PUBLIC
TRANSACTION.** Branch `claude/build-mcp-002` is rebased onto `a23a77d2a1ea93decc6904ea039d7fe4278240aa` (PR #64 UX and PR #63
MCP-001 are merged). Current main’s UX, persistent workspace, release gates, dependency resolutions and governance win. The
265 registry identities, `source-map-js@1.2.2` and exact temporary Colosseum waiver are unchanged; audit passes with zero
vulnerabilities. The MCP browser journeys verify that MOCKED simulations remain blocked at Review/Execute, with no wallet
transaction; the PostgreSQL integration journey retains positive mocked lifecycle/status/evidence coverage. See
[the integration report](builds/BUILD-MCP-002-INTEGRATION.md). FloFi is its own OAuth 2.1 authorization server for consumer MCP clients (RFC 9728/8414 discovery, PKCE S256,
Client ID Metadata Documents with an SSRF-guarded fetch, narrow optional DCR, consent with invite codes, rotating refresh tokens
with reuse detection, RFC 7009 revocation, `iss`, audience binding, 401/403 step-up), with pseudonymous accounts and digests only
in PostgreSQL (migration `0005_mcp_oauth`). `request_user_approval` re-composes and re-checks a strategy and stores a trusted
handoff (authority NONE; fragment secret; forward-only states enforced by the database); `/approve` shows the external proposal,
requires an EIP-4361 or **Sign-In With Solana** wallet proof, and places the re-composed command in FloFi's existing proposal
flow, after which the unchanged panels simulate, review, approve and the owner's wallet signs. An MCP App panel
(`ui://flofi/approval-panel.html`) opens the FloFi signing window or a wallet's in-app browser and brings the reconciled status
and evidence back into the chat; runs are attributed only when their reviewed workflow hashes to the proposal and the owner
shares them. Wallet links (`/connections`) gate run reads. Step lists: `{version: 2, steps}`; one step = version 1; the lending
composition executes; other sequences fail honestly with `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`. Mainnet: supported by code where
it is, disabled by policy only (`MAINNET_HANDOFF_DISABLED_BY_POLICY`). Evidence: unit, PostgreSQL and browser suites with a
minimal MCP Apps host on MOCKED loopback chains (EVM and Solana). Owner actions: Preview variables and the live Claude/ChatGPT
acceptance. See the [plan](builds/BUILD-MCP-002-PLAN.md), [report](builds/BUILD-MCP-002-REPORT.md) and [MCP guide](deploy/MCP.md).

## BUILD-MCP-001 — FloFi Remote MCP Gateway

**Status: IMPLEMENTATION COMPLETE — NO LIVE THIRD-PARTY CLIENT CONNECTED YET; NO TRANSACTION.** Branch
`claude/build-mcp-001` from main `bf84bbd` (BUILD-CLOUD-PARITY-001 merged). `POST /api/mcp` is a stateless Streamable HTTP
MCP server (official SDK v2, `@modelcontextprotocol/server` 2.2.0) with nine read-only tools: networks, assets and
capabilities derived from the registries; `compose_strategy` / `validate_strategy` / `review_strategy` through a pure engine
facade (`src/engine`) over the DApp's own commands, reducer, linter and capability registry (MCP IR byte-identical to DApp
chat authoring); `simulate_strategy` as a read-only preview of each flow's unchanged simulation (nothing persisted, not
authorizable, no calldata returned); owner-scoped `get_execution_status` / `get_evidence`. Stateless strategy contract bound
by `semanticWorkflowHash`; no new table. Dedicated `FLOFI_MCP_CLIENTS` credentials (digests only; never `API_AUTH_TOKEN`);
no FloFi-owned model call. Off unless `FLOFI_MCP=enabled`. Evidence: `MOCKED` only. Known: no production OAuth (consumer
connectors cannot connect yet); `pnpm audit` currently fails on a pre-existing `source-map-js` advisory whose fix clears the
release-age gate on 2026-10-07. See the [plan](builds/BUILD-MCP-001-PLAN.md), [report](builds/BUILD-MCP-001-REPORT.md) and
[MCP guide](deploy/MCP.md).

## BUILD-ETHEREUM-001 — Ethereum Sepolia as a first-class execution network

**Status: IMPLEMENTATION COMPLETE — READY_FOR_OWNER_EXECUTION (no public transaction made; `TESTNET_EXECUTED` not
claimed).** Branch `claude/build-ethereum-001` from main `66d5843`. Ethereum Sepolia (`eip155:11155111`, `0xaa36a7`)
is a `PUBLIC_TESTNET` network for Aave V3 WBTC Supply/Borrow/Repay/Withdraw (USDC, USDT and DAI are above their supply
caps; the owner chose WBTC), the native test-ETH self-transfer, the Uniswap v3 USDC ↔ WETH swap and USDC/WETH 0.3%
concentrated liquidity. All of them run on the existing Review → owner wallet → reconcile → evidence path through
chain-selected profiles (no copied flows). Chain-bound read RPCs, chain-qualified nonce leases, per-chain MetaMask
delegation code pins. Ethereum Mainnet is recognised only to stop a wallet that is on it; it is never switched to or
added and has no capability row. Copilot: `ETHEREUM_SEPOLIA`/`WBTC` added; "Ethereum" alone always asks. Evidence:
`PUBLIC_READ_ONLY` verification (47/47 checks, block 11,848,941), a `MOCKED` local-fork rehearsal on the official
contracts (7/7 reconciled, block 11,849,026), unit and browser suites. Owner action: the
[WBTC Supply package](builds/BUILD-ETHEREUM-001-OWNER-EXECUTION-PACKAGE-AAVE-WBTC-SUPPLY.json). See the
[plan](builds/BUILD-ETHEREUM-001-PLAN.md) and [report](builds/BUILD-ETHEREUM-001-REPORT.md).

## BUILD-COPILOT-002 — Conversational Flofi Copilot

**Status: IMPLEMENTATION COMPLETE — LIVE MODEL NOT YET EXERCISED.** Branch `claude/build-copilot-002` from main `d58b535`
(BUILD-COPILOT-001 merged). The Copilot now holds a bounded conversation: it asks for missing facts and takes the answer,
revises a pending proposal ("actually make it 2"), edits, repeats or removes existing steps by kind and position ("the
second swap", "o último passo"), and answers read-only questions about the workflow, approvals, Manifest, simulation
status, blockers and failure handling, in English, Portuguese and mixed input. The model returns a strict, versioned
`CopilotIntentV2` and never sees the workflow or wallet. Flofi resolves every reference, clarifies anything ambiguous,
keeps deterministic provenance for every value (the open request, a resolved step or visible proposal, the connected
wallet where the exact grammar already uses it, or a Flofi default), writes every factual answer from its own state, and
still turns everything into an ordinary proposal that needs **Apply proposal**. No new protocol, dependency, wallet or
execution capability. Evidence: MOCKED only (unit tests, a 198-case deterministic eval with zero safety-invariant
violations, replay browser suites); no live OpenAI request and no transaction were made. See the
[plan](builds/BUILD-COPILOT-002-PLAN.md) and [report](builds/BUILD-COPILOT-002-REPORT.md).

## BUILD-COPILOT-001 — AI natural-language interpretation for the Flofi Copilot

**Status: IMPLEMENTATION COMPLETE — LIVE MODEL NOT YET EXERCISED.** Branch `claude/build-copilot-001` from main `1cf923f`.
The AI is an untrusted natural-language interpreter with no financial authority. Text that the exact chat grammar does
not recognize can be sent server-side to the OpenAI Responses API (`FLOFI_COPILOT=live`, owner-chosen
`OPENAI_COPILOT_MODEL`, no default model), which may only return a strict, versioned `CopilotIntentV1`. Flofi validates
it, grounds every amount, slippage, range bound, address, asset and mainnet in the user's own words, and renders an
exact-grammar sentence for the existing `parseLocalCommand`. The AI therefore cannot author anything a user could not
type. The result is an ordinary proposal that needs **Apply proposal**, then the unchanged Simulate, Review, wallet
signature, execution, recovery, reconciliation and evidence path. V1 covers Base/Base Sepolia/Solana/Solana Devnet swaps, the
Cross-chain Router bridge, Aave V3 Supply/Borrow/Repay/Withdraw, Uniswap v3 and Orca liquidity, and the existing
Supply → Borrow → Swap composition, with clarifications instead of guesses. Default `off` keeps the panel unchanged.
No new dependency. Evidence: MOCKED only (unit tests, mock transport, replay browser suite); no live OpenAI request
and no transaction were made. See the [plan](builds/BUILD-COPILOT-001-PLAN.md) and
[report](builds/BUILD-COPILOT-001-REPORT.md).

## BUILD-JOURNEY-001 — Permissionless external user journey

**Status: IMPLEMENTATION COMPLETE — DEPLOYED JOURNEY NOT YET RUN (`PERMISSIONLESS_EXECUTED` not claimed).** Branch
`claude/build-journey-001` from main `bc4fc57`. The existing Router lifecycle now serves any external wallet on public
testnets: **Base Sepolia USDC → Cross-chain Router → Arbitrum Sepolia USDC** (verified supported by LI.FI and the Across
testnet API; real Across testnet fills observed), as its own flow `crosschain-router-testnet` (gate `GRYLOO_ROUTER_TESTNET=live`).
A one-signature EIP-4361 wallet session (verified server-side; no transaction authority) binds every Router run to the wallet
that created it in the API and local actions; run reads and listings are per wallet; an account switch after Review clears
the unused authorization; runs are recoverable from any browser. No new runtime, executor, authorization or evidence format;
no new dependency (app manifest and lockfile identical to main). Evidence: MOCKED (unit 1,411, PostgreSQL 40 incl. the journey
suite with API/worker restarts and wallet isolation, browser journey 3/3) and a real `PUBLIC_READ_ONLY` preflight
([BUILD-JOURNEY-001-READONLY.json](builds/BUILD-JOURNEY-001-READONLY.json)). Owner actions remain: deploy this revision's
API/worker with `GRYLOO_ROUTER_TESTNET=live`, make the Vercel URL public, then an external user's own run. See the
[plan](builds/BUILD-JOURNEY-001-PLAN.md) and [report](builds/BUILD-JOURNEY-001-REPORT.md).

## BUILD-ROUTER-001 — Flofi canonical Cross-chain Router

**Status: IMPLEMENTATION COMPLETE — READY FOR OWNER MAINNET E2E.** Branch `claude/build-crosschain-router-001` from main
`ebbd4aa` (PR #56 not included; rebase after it lands). The canonical `asset.bridge` action gained a provider-neutral
Cross-chain Router (adapter `flofi.router`) for Base USDC → Arbitrum One USDC: owner-chosen amount, recipient, slippage and
routing policy (LI.FI first, Across direct, or one of them); a canonical route model whose commitment is bound into the
Manifest and the owner's authorization; `ROUTE_CHANGED` on any material change after Review (no fallback); real
`eth_simulateV1` of the exact Base transactions; asynchronous lifecycle `PREPARED → AUTHORIZED → SOURCE_SUBMITTED →
SOURCE_CONFIRMED → IN_FLIGHT → DESTINATION_OBSERVED → RECONCILED` (plus `RECONCILIATION_REQUIRED`, `RECOVERY_REQUIRED`,
`REFUNDED`, `FAILED`), destination success proven from the Across `FilledRelay` on Arbitrum at both chains' safe heads.
Same file/PostgreSQL runtime (`crosschain-router` flow; no migration, no new service). Evidence: MOCKED (unit,
PostgreSQL, loopback browser) and a real `PUBLIC_READ_ONLY` preflight
([BUILD-ROUTER-001-READONLY.json](builds/BUILD-ROUTER-001-READONLY.json)). No transaction was sent; `MAINNET_EXECUTED` needs
the owner's wallet-signed run. See the [plan](builds/BUILD-ROUTER-001-PLAN.md) and [report](builds/BUILD-ROUTER-001-REPORT.md).

## BUILD-UNISWAP-LIQUIDITY-PUBLIC — Public Uniswap v3 liquidity on the cloud runtime

**Status: IMPLEMENTATION COMPLETE — READY FOR OWNER PUBLIC E2E.** Stacked on BUILD-CLOUD-001 in branch
`claude/build-uniswap-liquidity-public`. The canonical `asset.liquidity.concentrated` action now has a public EVM
runtime: Uniswap v3 USDC/WETH 0.05% on Base Sepolia, signed and sent only by the owner's browser wallet (exact finite
approvals, then a mint whose NFT recipient is the owner), simulated with `eth_simulateV1` against public state, and
reconciled by the same PostgreSQL/API/worker runtime as every cloud flow (`uniswap-liquidity`; no migration, no new
service, no key). Evidence so far: MOCKED (unit, PostgreSQL and loopback browser suites) and a real
`PUBLIC_READ_ONLY` preflight through the production service and the real API process. No public transaction was
sent; `TESTNET_EXECUTED` needs the owner's wallet-signed acceptance. BUILD-006's `FORK_REPRODUCED` record is
unchanged. Public swap → liquidity composition is not part of this build (see the
[report](builds/BUILD-UNISWAP-LIQUIDITY-PUBLIC-REPORT.md)).

## BUILD-CLOUD-001 — Durable, cloud-capable execution

**Status: IMPLEMENTATION COMPLETE — OWNER ACTION REQUIRED.** Stacked on BUILD-BRAND-001 (PR #49) in branch
`claude/build-cloud-001`. Execution state for every capability with a real-network path except BUILD-013 (Base Sepolia Uniswap swap, Aave Supply/Borrow/Repay/Withdraw, Robinhood transfer, Solana Devnet Orca swap and liquidity, Jupiter mainnet-beta Simulate/Review) can now
live in PostgreSQL behind explicit storage ports (fenced leases, append-only logs, transactional outbox), served
by a stateless API and reconciled by horizontally scalable workers; evidence exports go to a content-addressed
EvidenceStore. File/local mode, every `GRYLOO_*` variable and every persisted format are unchanged. Validation is
local and MOCKED (loopback PostgreSQL, in-process chains): no deployment exists yet and no public transaction was
made. Deployment needs owner credentials (Neon, object storage, Railway, Vercel) and the testnet acceptance needs
an explicit owner wallet action; see the [plan](builds/BUILD-CLOUD-001-PLAN.md),
[report](builds/BUILD-CLOUD-001-REPORT.md), [capability matrix](builds/BUILD-CLOUD-001-CAPABILITIES.md) and [deployment runbook](deploy/CLOUD.md).

## BUILD-013 — Advanced lending composition

**Implementation evidence: MOCKED; public execution gated.** Owner-approved single finite path: Supply Aave USDC → HF checkpoint ≥ 2.0 → Borrow Aave USDC → Swap exactly the borrowed output to WETH on Base Sepolia. Chat/Canvas authoring, composed Simulate/Review, exact owner calls, durable partial recovery, economic reconciliation and an independent read-only verifier are implemented with no Manifest schema change. The exact-token compatible route was discovered independently, but all three original bounded public sequential-simulation attempts, and all three separate recheck attempts, were rate-limited. **PUBLIC_EXECUTION_BLOCKED** before Supply; no public owner transaction/signature and no public composed completion/certification claim. See the [plan](builds/BUILD-013-PLAN.md), [report](builds/BUILD-013-REPORT.md), preserved [preflight](builds/BUILD-013-PREFLIGHT-READONLY.json) and open [PR #48](https://github.com/alrimarleskovar/gryloo/pull/48). The original `7003856` implementation is preserved in `dd0e97d`; the later RH-DEMO main was integrated only after GitHub confirmed PR conflicts. Robinhood and historical BUILD-012 records remain unchanged against main.

Closure traced CI run `37018814071` to repeated full-history lending journal validation in the Borrow/route-loss continuation test. Exact byte-prefix validation reuse fixes that runtime cost while preserving disk checks, corruption rejection, simulation and owner gates; the 30-second unit-test timeout is unchanged. The integrated `pnpm check` passed **1,144 tests / two existing skips**, Governance-Lite passed, and guarded browsers passed **15 lending**, **44 Aave primitive**, **7 Robinhood** and **53 broad/visual** cases, with four existing environment skips. Final engineering evidence is recorded in the report. This is implementation closure for owner review, with public execution still blocked and no merge authorized.

## Governance-lite migration

Future repository work follows [GOVERNANCE-LITE](SCOPE_GUARD.md), from baseline `6e41b2fb5762c321730c3427aeb1fc0c64d8f916`. This migration changes repository authorization only. The build status and evidence entries below are retained as recorded; no new financial execution, acceptance or certification is claimed.

## RH-DEMO-001 — Robinhood Testnet owner-signed transaction proof

**TESTNET_EXECUTED / RECONCILED / INDEPENDENTLY_RECONCILED** on `claude/rh-demo-001` ([PR #47](https://github.com/alrimarleskovar/gryloo/pull/47), unmerged), from canonical main `7003856` (including merged BUILD-RH-001). The owner `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b` signed one native test-ETH self-transfer of exactly 1000000000000 wei on Robinhood Chain Testnet (`eip155:46630`) in [transaction `0xdadc1fd5fd23e9bad85171cf2255c1e26df121ce3c8e2c35b121274436f4a498`](https://explorer.testnet.chain.robinhood.com/tx/0xdadc1fd5fd23e9bad85171cf2255c1e26df121ce3c8e2c35b121274436f4a498), block **127567253**, nonce 0 → 1, fee **253590000000** wei (the exact owner balance delta). The Gryloo runtime reconciled it; the [Evidence Bundle](builds/RH-DEMO-001-EVIDENCE.json) records `TESTNET_EXECUTED / RECONCILED`. The strictly read-only [independent verifier](builds/RH-DEMO-001-VERIFICATION.json) recovered the signer from the raw signature and records `INDEPENDENTLY_RECONCILED` (11:17Z, same bundle hash as the archive). A separate read-only check later confirmed the block `L1_FINALIZED`. The public RPC has since pruned the historical state of those blocks, so a full re-run needs an archival node; this is documented in the report and does not affect the recorded verification. One durable attempt, one transaction and no duplicate submission. This is a chain execution proof, not a DeFi capability: no DeFi protocol is supported on Robinhood. See the [report](builds/RH-DEMO-001-REPORT.md).

## Completed BUILD-012D — Aave V3 Withdraw

**TESTNET_EXECUTED / RECONCILED / INDEPENDENTLY_RECONCILED** on `codex/build-012d-aave-withdraw`, from canonical main `70ce37efae08018c642ddcc912913c07cabcb770`. The owner completed exactly **100000 raw = 0.1 USDC** on Base Sepolia (84532), with owner/recipient `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b`, in [transaction `0xd62dc935a1897f549a9cd7e131c8847953d97d7b8b8acdbf4d0d602adbeac372`](https://sepolia.basescan.org/tx/0xd62dc935a1897f549a9cd7e131c8847953d97d7b8b8acdbf4d0d602adbeac372), block **47570537**.

The [Gryloo runtime Evidence Bundle](builds/BUILD-012D-EVIDENCE.json) records `TESTNET_EXECUTED / RECONCILED`, `PUBLIC_TESTNET` provenance and owner-initiated wallet execution. The separate [independent verifier result](builds/BUILD-012D-VERIFICATION.json), produced by `scripts/verify-aave-withdraw.mjs`, records `TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED` from **96 read-only RPC requests**. Wallet USDC rose from 5000 to 105000 raw (**+100000**); final supplied collateral is **900001** raw, variable debt **5002** raw and HF **154738272501899316246** (154.738272501899316246). Scaled-balance/index rounding explains the 100001-raw nominal collateral decrease.

The execution record has one durable attempt and one transaction, with no duplicate submission. Final evidence closure submitted or signed no additional transaction. [PR #46](https://github.com/alrimarleskovar/gryloo/pull/46) remains unmerged for the owner, with auto-merge disabled. BUILD-013 is the existing roadmap successor and is not started. See the [report](builds/BUILD-012D-REPORT.md), [original plan](builds/BUILD-012D-PLAN.md) and [historical selection prestate](builds/BUILD-012D-PRESTATE.json).

## Merged BUILD-012C — Aave V3 Repay

[PR #43](https://github.com/alrimarleskovar/gryloo/pull/43) is merged in the canonical baseline. **TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED**: owner Repay of exactly 5000 raw USDC, independently verified with preserved public receipts, owner authority, scaled debt/index and balance proofs. The [historical report](builds/BUILD-012C-REPORT.md), exported Evidence Bundle and verification remain unchanged.

## BUILD-015 Solana liquidity / Orca Whirlpools

**DEVNET_EXECUTED**; [PR #44](https://github.com/alrimarleskovar/gryloo/pull/44) is merged in canonical main. The preserved implementation/evidence originated on `claude/build-015-solana-liquidity` from main `f2b8afa`.

The canonical, chain-neutral `asset.liquidity.concentrated` intent ran on public Solana Devnet through Orca Whirlpools, on the BUILD-DEMO-001 SOL/devUSDC test pool. BUILD-006's `asset.liquidity.uniswap-v3` is byte-identical and read by the same reader. The owner `6Mc7hRBcjoYukC7PNqKUbfS5pHeJwf41bogtUfKuMYQR` signed every step with their own wallet:

- **Open + add:** [`4NmXs8NoB6KW…`](https://explorer.solana.com/tx/4NmXs8NoB6KW8jzPesDRZqDcQ26QS4crkF13jN9kNkbPxUf4W8FDitGy3ywaNKBaVTUQM9HcLYLpvJQhvW8LaLJJ?cluster=devnet), slot 506,426,965. Deposited 0.01 Devnet SOL + 0.240772 devUSDC as position `DscRyBK8SAH4F5KizzUpv9wd55QFk5cUbK9piNMXvgWv`.
- **Partial removal:** 5,000 bps with fee collection, [`5HQGjFbb1jbw…`](https://explorer.solana.com/tx/5HQGjFbb1jbwNCEvm2fZM3oKZVQvqQ879Q1vDLumCGJF8RDX5t8KaEmFaXnRhNvvP73uiwzrEKwg88EA3r3oNHPa?cluster=devnet), slot 506,427,731. Returned 0.004999916 SOL + 0.120387 devUSDC principal; 0 fees.
- **Exit:** remove all, collect and close, [`8MAvfVGXXo6m…`](https://explorer.solana.com/tx/8MAvfVGXXo6mMcfkuikKnHmTfQ6S37Y5oPh6F7sdVJSNeNSgFZyFsGp1WpoonHHrAPLRWKzaQtq2zgCu1hzfZTV?cluster=devnet), slot 506,428,344. Returned the same principal again, closed the position and refunded every deposit.

All three were reconciled by Gryloo and independently verified (55/55 read-only checks). Evidence Bundles `0x56b64747…7e08`, `0x7cd44c68…2238` and `0x56a343b0…c2ff` are archived with `SHA256SUMS`. The frozen v1 bundle schema records `TESTNET_EXECUTED`; the Gryloo evidence class is `DEVNET_EXECUTED`. These are valueless Devnet test tokens: there is no real-funds, mainnet or `MAINNET_EXECUTED` claim. See the [BUILD-015 report](builds/BUILD-015-REPORT.md) and [archived evidence](builds/BUILD-015-EVIDENCE/).

## BUILD-DEMO-001 Solana Devnet real execution

**DEVNET_EXECUTED** on branch `claude/build-demo-001-solana-devnet` (PR #42, unmerged), from main `148f79c`. The canonical `asset.swap.exact-input` intent ran on Solana Devnet through Orca Whirlpools `swap_v2` on Orca's documented test pool. The owner signed with their own wallet. Transaction [`5Aoo6QX3b7rh3wAX5fxY8ybx7R7k1VgrT95QhuAf5HNF2zNiaCVAoTZtus3HbdwtZthSY9BiMKWiJRVQc67dLCbB`](https://explorer.solana.com/tx/5Aoo6QX3b7rh3wAX5fxY8ybx7R7k1VgrT95QhuAf5HNF2zNiaCVAoTZtus3HbdwtZthSY9BiMKWiJRVQc67dLCbB?cluster=devnet), finalized at slot 506,389,990, swapped 0.1 Devnet SOL for 2.231352 devUSDC (minimum 2.220195) with a 5,000-lamport fee. It was reconciled by Gryloo and independently verified (35/35 read-only checks). Evidence Bundle hash `0x621c869a0dbee6e0d827ed536d32230c1ef14e0281a84c92d2d0619e9716e6c9`. The frozen v1 bundle schema records `environment: TESTNET_EXECUTED`; the Gryloo evidence class is `DEVNET_EXECUTED`. The tokens are valueless; there is no real-funds, mainnet or `MAINNET_EXECUTED` claim. Jupiter mainnet (BUILD-014) remains unexecuted. See the [BUILD-DEMO-001 report](builds/BUILD-DEMO-001-REPORT.md) and [archived evidence](builds/BUILD-DEMO-001-EVIDENCE/).

## BUILD-014 Jupiter / Solana portability

READY_FOR_OWNER_EXECUTION on branch `claude/build-014-jupiter` from main `7726970`. One canonical swap intent now compiles, simulates, reviews, executes (owner-signed), recovers, reconciles and produces evidence on Solana mainnet-beta through Jupiter. No mainnet transaction was signed or sent; there is no `PUBLIC_EXECUTED` or `MAINNET_EXECUTED` claim. See the [BUILD-014 report](builds/BUILD-014-REPORT.md).

## Merged BUILD-012A / BUILD-012B

BUILD-012A Aave Supply and BUILD-012B Aave Borrow are merged and **TESTNET_EXECUTED** on their exact verified Base Sepolia profiles. The [Supply report](builds/BUILD-012A-REPORT.md) and [Borrow report](builds/BUILD-012B-REPORT.md) preserve the historical implementation checkpoints and completed owner public acceptance. BUILD-012C is merged as recorded above; BUILD-012D public owner execution and independent reconciliation are completed, with PR #46 awaiting owner merge.

The older entries below remain historical evidence/status checkpoints. They do not supersede the current canonical baseline or authorize another build.

## BUILD-011D-2 public recording gate (2026-09-29)

DEC-0055 approves the [BUILD-011D-2 plan](builds/BUILD-011D-2-PLAN.md) from main `205055605d96f36e024a0bbc770453113e4f7b40`. The normal Build view no longer displays the environment selector or permanent readiness diagnostics. The owner submitted one approval and one Uniswap v3 swap through Gryloo. The successful public swap receipt, exact delegated inner call, independent USDC/WETH reconciliation, sponsored gas and Evidence Bundle establish `TESTNET_EXECUTED` for **Uniswap Swap + Base Sepolia only**. The [BUILD-011D-2 report](builds/BUILD-011D-2-REPORT.md) records the transaction and evidence. Other public profiles and Mainnet remain unavailable.


## Current BUILD-011D-1 implementation state (2026-09-29)

DEC-0054 approves the [BUILD-011D-1 plan](builds/BUILD-011D-1-PLAN.md) from main `33a83ce9de18d8bbbfe4ccfb73811b00c09f290d`. The typed registry resolves action, adapter, chain and environment without deriving execution authority from declaration alone. Base Uniswap swap and isolated liquidity retain their existing `FORK_REPRODUCED` local-fork evidence; CoW, LI.FI, Across and cross-chain composition retain `MOCKED` financial ceilings. Supply, Lending and Borrow are authoring templates. Public Testnet and Mainnet execution remain unavailable. See the [BUILD-011D-1 report](builds/BUILD-011D-1-REPORT.md) for measured checks. The owner retains merge; BUILD-011D-2 is next only after that decision.

## Current BUILD-011C-2 implementation state (2026-09-29)

DEC-0053 approves the [bounded BUILD-011C-2 plan](builds/BUILD-011C-2-PLAN.md) from merged main `0ac839738e9aa198007fbf354ea2f14894459c38`. The cross-chain recovery extension remains a deterministic MOCKED proof. It records irreversible bridge/swap effects, partial states, independently classified mint ambiguity, bounded retry, separate compensation authority and a manual stop. The [BUILD-011C-2 report](builds/BUILD-011C-2-REPORT.md) records measured acceptance. The functional requirements originally assigned to Master Prompt BUILD-011 are fulfilled by BUILD-011C-1 plus BUILD-011C-2 on the unmerged PR head at MOCKED evidence maturity. Public financial execution and owner merge remain future decisions.

## Historical BUILD-011C-1 implementation state (2026-09-29)

DEC-0052 approves the [bounded BUILD-011C-1 plan](builds/BUILD-011C-1-PLAN.md) from BUILD-011B merged main `89415eb3574ddd28ab8b1cb0d39e221791c5521f`. The shared Base → Arbitrum bridge, calculated destination split, existing Uniswap v3 liquidity adapter extended to the verified Arbitrum WETH/native-USDC fee tier 500 pool, canonical artifacts/Manifest, MOCKED journal, reconciliation and Evidence Bundle are implemented on an unmerged branch. Base liquidity remains supported. Public financial execution, recovery/compensation and merge remain outside this approval. The [BUILD-011C-1 report](builds/BUILD-011C-1-REPORT.md) records local gates and remaining limits.

BUILD-011C-1 implements the successful cross-chain liquidity composition path. BUILD-011C-2 is still required for destination failure, compensation authority, recovery and manual-intervention proof before Master Prompt Build 011 is considered complete.

## Historical BUILD-011B implementation state

BUILD-011 merged on main at `502d167212cdff80ad4c6740ed8bde47eace1c31`; this records the Git merge, not a separate certification. DEC-0051 approves [BUILD-011B](builds/BUILD-011B-PLAN.md) from that merge for editor stabilization and presentation-only toolbox preference storage. The current branch remains unmerged; owner approval is required for merge. No financial execution or evidence authority expands.

## Historical BUILD-011 implementation state

BUILD-010 is merged on main at `5d169748e6a44e3fb63e371a18ace2e0814d5f04`; this records the Git merge only and does not assert post-merge CI or separate certification. DEC-0050 approves [BUILD-011](builds/BUILD-011-PLAN.md), a canvas/product UX refactor from that main. It changes authoring and interaction, not financial execution authority. Local acceptance is in progress on an unmerged branch; the owner retains merge.

## Historical BUILD-010 pre-merge state

BUILD-009 is merged on main at `f455892b58561bbe740a83f1aa0837e8ac82f5e4` (DEC-0048). No separate BUILD-009 certification or post-merge CI claim is recorded. BUILD-010 implementation is approved under DEC-0049 from that main; direct Across financial execution remains MOCKED and the branch must stop before merge.

## Historical BUILD-009 implementation state (before merge)

BUILD-009 implementation is approved under DEC-0047 on a separate branch from certified main `308901495790416c149976aaee747c2fd5ef9f52`. The approved Base → Arbitrum USDC bridge → Arbitrum WETH swap and injected EIP-1193 wallet flow had passed local implementation gates and awaited PR-head CI and the owner merge decision at that time. Financial execution/recovery/reconciliation remain MOCKED. No merge or certification is approved. The BUILD-008 and prior certification statements below remain historical and unchanged.

## BUILD-008 certified state (2026-09-28)

Under DEC-0046, BUILD-008 is COMPLETE / CERTIFIED: MOCKED. [PR #18](https://github.com/alrimarleskovar/gryloo/pull/18) merged the approved head `13ed18c082dfefb7d830eca4c071403e0ed2d39a` into main as `d5d3934d595943a45f5696fab440437d81e0690c`. Post-merge [Governance run 36479683368](https://github.com/alrimarleskovar/gryloo/actions/runs/36479683368) and [contracts/reference-app run 36479683443](https://github.com/alrimarleskovar/gryloo/actions/runs/36479683443) passed on that merge commit; the latter passed contracts, guarded Browser, dependency Audit and SBOM validation. See the [BUILD-008 report](builds/BUILD-008-REPORT.md) for the implementation and CI record.

**Markers:** BUILD-008: COMPLETE. BUILD-008 certification: CERTIFIED: MOCKED. The implemented `asset.bridge` path is Base → Optimism USDC with the connected owner as recipient. Live LI.FI token and quote/route data are real read-only provider evidence; financial bridge execution, recovery and destination reconciliation remain deterministic MOCKED. There is no `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, real-funds or public-chain financial execution claim. BUILD-003/004/006/007 `FORK_REPRODUCED` and BUILD-005 `MOCKED` certifications are unchanged. BUILD-009 is planning only, with no plan or implementation approved. BUILD-007E public EVM demo readiness remains separate.

## Current state after BUILD-007 certification (2026-09-28)

**Markers:** BUILD-007: COMPLETE; BUILD-007 certification: CERTIFIED: FORK_REPRODUCED (DEC-0043), local chain 31337 only. PR #17 merged into main as b4e2ea34bc04b537014ce54e635f6da9f3a9b1ce. PR-head checks on a83dd0597b043cebe87da207c805173bce6d598b passed. Post-merge Governance run 36438835696 passed. Post-merge contracts/app run 36438835487 failed only at the pre-existing intermittent Simulate canvas `fitted` wait, which the owner accepted as a documented exception. The certified baseline `f4868b94e10981b820653dd21d1ef94a72edb067` reproduces the same Simulate canvas `pending`/`fitted` timeout. In an offline CI-like stress of `visual-shell.spec.ts` "Simulate mocked-chain empty visual baseline" (30 repetitions per revision, same pinned browser, toolchain and environment), the baseline failed 6/30 and the BUILD-007 merge 12/30. At n=30 this is not a statistically significant regression (Fisher exact two-sided p=0.158). The root cause remains unconfirmed, and no BUILD-007-specific causal change has been identified. It is recorded as a known pre-existing intermittent test failure, not a demonstrated BUILD-007 regression. The next milestone is BUILD-008 planning only; no BUILD-008 plan or implementation is approved. BUILD-003/004/006 `FORK_REPRODUCED` and BUILD-005 `MOCKED` certifications are unchanged.

## BUILD-007 implementation state (historical pre-merge record, 2026-09-28)

**Markers (historical):** BUILD-007 APPROVED / IN PROGRESS; certification NOT CERTIFIED at that time. DEC-0038 records the owner's complete plan and six-manifest scope amendment from synchronized main `f4868b94e10981b820653dd21d1ef94a72edb067`. The first Mode B Base USDC → WETH swap → Safe-owned Uniswap v3 WETH/USDC fee tier 500 position is implemented for local chain 31337. Direct Safe 1.4.1 / Zodiac Roles 2.1.0 mint-cap bypass tests pass. A credential-free synthetic source and closed replay pass but remain `MOCKED`; the single approved owner-operated Base recording stopped during local harness startup. The [BUILD-007 report](builds/BUILD-007-REPORT.md) lists the current gates and pending evidence.

The recording preflight passed with manifest SHA-256 `977502de3c68f054365d1d2b41ed0121260b4b8940b158db837a8b3d11515627`. The fresh credential and truthful attestations passed, then the one authorized attempt stopped with a local harness readiness timeout after 2 read-only provider requests and 52 reserved CU. The credential was removed. No BUILD-007 transcript exists and the one-attempt authority is exhausted. BUILD-007 has no `FORK_REPRODUCED` claim; the actual local evidence ceiling is `MOCKED` pending a new owner decision. The approved PR will remain unmerged; BUILD-003/004/006 `FORK_REPRODUCED` and BUILD-005 `MOCKED` certifications are unchanged.

DEC-0039 records the credential-free diagnosis and the owner-approved remediation. The confirmed root cause was that `record` mode placed the harness runtime outside the `/tmp/` path the harness requires for disposable keys. `composition-recording.mjs` now uses a fresh `/tmp/` runtime in every mode and a 120,000 ms fork RPC timeout in live recording sessions only, because one source simulation otherwise ran 17–20 s against a 20-second limit. New attempts use `/home/asus/.gryloo/build-007-attempt-2`; the first-attempt stop evidence in `/home/asus/.gryloo/build-007` is unmodified. After the fixes, 16/16 offline synthetic rehearsals passed with `REPLAY_BYTE_IDENTICAL` closed replay. Attempt-2 preflight awaits the owner's same-day billing report. The evidence ceiling stays `MOCKED` until a real Base transcript exists. A second recording attempt is owner-gated and not authorized.

**Attempt 2 (2026-09-28, DEC-0040).** After the attempt-2 preflight passed (manifest `6a171dc81fcda36ead2f0f561e19220464c6e2c431cdfd40e16b1a6796ca292f`), the owner rotated the credential and authorized one recording. It completed at Base block 51,906,032 with 122 of 1,500 requests and 3,172 of 39,000 reserved CU, and the credential was removed. Transcript SHA-256 is `337da42d5a89f504a37ea795703b52a340a27cfbac2ccbf6793de532c30a496d`; its leakage scan is clean. The closed replay is `REPLAY_BYTE_IDENTICAL`. On that replay the direct Roles mint-bound, worker and reconciliation fork tests (3/3), composition browser specs (3/3) and independent verifier (`PASS`, mint `RECONCILED`, Safe-owned token ID 6107134) pass. BUILD-007 therefore demonstrates `FORK_REPRODUCED` on local chain 31337 and is not certified. Pushing the transcript and records, new PR-head CI, owner merge, post-merge CI and certification remain. The first-attempt evidence is unchanged.

## Current BUILD-006 certification state (2026-09-28)

**Current markers:** BUILD-006: COMPLETE. BUILD-006 certification: CERTIFIED: FORK_REPRODUCED.

Under DEC-0037 the owner merged [PR #16](https://github.com/alrimarleskovar/gryloo/pull/16) into main as 1edd783028ee8eed0953ca1e7e1446ad03229844 at 2026-09-28T00:06:06Z. All four PR-head checks passed on e8ec5a256f346d4062ab5e4c1716efed4996f1c8. The merge-commit Governance run 36360916944 failed only in its historical shallow fetch, while the merge-commit contracts/app run 36360916815 passed. The minimal fetch fix 3e4aae6fb48812a6db64abdd771e13718f96615e then passed [Governance run 36361208012](https://github.com/alrimarleskovar/gryloo/actions/runs/36361208012) and [contracts/app run 36361208019](https://github.com/alrimarleskovar/gryloo/actions/runs/36361208019).

The certification covers one isolated Uniswap v3 Base USDC/WETH Mode A liquidity lifecycle on local chain 31337. It rests on the owner-recorded Base transcript `c9a02102422df5a333d67bdf869a4f1b75ae2ec314d1e834872d92c86ea95805`, the closed byte-identical replay and independent reconciliation; see the [BUILD-006 report](builds/BUILD-006-REPORT.md). It grants no public-chain, testnet, mainnet, real-funds, production-wallet, Mode B liquidity or BUILD-007 composition authority. BUILD-003/004 `FORK_REPRODUCED` and BUILD-005 `MOCKED` remain separate. The next milestone is BUILD-007 planning only; no BUILD-007 plan or implementation is approved. See [NEXT_BUILD.md](NEXT_BUILD.md).

## BUILD-006 pre-merge local acceptance state (historical, 2026-09-28)

**Pre-merge markers (historical):** BUILD-006: LOCAL ACCEPTANCE COMPLETE / READY FOR OWNER MERGE DECISION. BUILD-006 local evidence: `FORK_REPRODUCED` demonstrated on local chain 31337. BUILD-006 certification: NOT CERTIFIED.

DEC-0036 and the [approved plan](builds/BUILD-006-PLAN.md) authorize the work, from synchronized main `4a402dd6be956fee0e3df001b8ad0f356f625937`. The owner ran the single approved read-only Base recording on 2026-09-28. It completed at source block 51,880,679 with 207 requests and 5,382 reserved CU, and the credential was removed.

Validation of the credential-free transcript `c9a02102…95805`, the closed `REPLAY_BYTE_IDENTICAL` replay and an independent raw-RPC verifier all passed. Together they reconcile one isolated Uniswap v3 Base USDC/WETH Mode A lifecycle of 12 separately signed operations, ending in the burn of NFT #6104987. The real-transcript browser specs pass. The [BUILD-006 report](builds/BUILD-006-REPORT.md) separates each gate.

Still outstanding: remote CI on the unmerged PR head, the owner's merge decision, post-merge checks and any certification decision. BUILD-003/004 and BUILD-005 keep their separate certified ceilings. No public-chain transaction, mainnet, real funds, production wallet, BUILD-007 composition, Mode B liquidity authority or PR merge is authorized.

## BUILD-006 implementation state (historical, 2026-09-27)

BUILD-006 was APPROVED / IN_PROGRESS under DEC-0036 before the recording; the state above supersedes this.

## Current BUILD-005 certification state (2026-09-27)

**Current markers:** BUILD-005: COMPLETE. BUILD-005 certification: CERTIFIED: MOCKED.

Under DEC-0035 the owner merged [PR #15](https://github.com/alrimarleskovar/gryloo/pull/15) into main as 37a0782ece81f83c362b50f68adfc1accb37ccff at 2026-09-27T19:30:00Z. All four final-head PR/push checks passed on 171fc02857b43318460de6b25a2a013d3edbd24e; post-merge [Governance run 36344564513](https://github.com/alrimarleskovar/gryloo/actions/runs/36344564513) and [contracts/app run 36344564511](https://github.com/alrimarleskovar/gryloo/actions/runs/36344564511) also passed. The [BUILD-005 report](builds/BUILD-005-REPORT.md) records the local and CI gates. Its signed-intent orderbook, injected disposable wallet and settlement are deterministic loopback and scripted only; every BUILD-005 financial result remains MOCKED. This grants no public CoW, public-chain, production-wallet, real-funds or production-financial-execution evidence. BUILD-003/004 retain their separate local-fork evidence ceilings. Gryloo remains global, non-custodial and multichain, with Solana priority unchanged.

That BUILD-005-era next-milestone statement is historical. The current BUILD-006 authority is stated above and in [NEXT_BUILD.md](NEXT_BUILD.md).

## BUILD-005 pre-merge implementation state (historical, 2026-09-27)

DEC-0034 approves the [BUILD-005 plan](builds/BUILD-005-PLAN.md) from synchronized `main` at `9c5484d`. The CoW signed-intent user journey is implemented in the reference DApp and local acceptance is in progress. It uses the same semantic swap IR and a separate EIP-712 order lifecycle. The only BUILD-005 orderbook, wallet and settlement acceptance is deterministic loopback with a disposable local signer; all resulting evidence is `MOCKED`. No public CoW endpoint, public chain, production wallet, credential or financial transaction is used or authorized. BUILD-003 and BUILD-004 remain certified only at their recorded `FORK_REPRODUCED` local-fork boundaries. Gryloo remains global, non-custodial and multichain, with Solana's stated roadmap priority intact. The owner retains PR merge.

## Current BUILD-004 certification state (2026-09-27)

**Current markers:** BUILD-004: COMPLETE. BUILD-004 certification: CERTIFIED: FORK_REPRODUCED. Owner-operated injected-wallet acceptance: PASS.

Under DEC-0033 the owner certified BUILD-004 and accepted ADR-0001 for the demonstrated finite Safe 1.4.1 plus Zodiac Roles 2.1.0 profile, strictly on local chain 31337. PR #13 passed 4/4 checks on `effc6bad8dc828ee9e598d43fbcd6413e2b19dbe`, merged into `main` as `e71de3946c7aac6095023ca1ee6f1e1a58a98112` at 2026-09-27T16:29:44Z, and post-merge Governance run `36333448106` and Contracts/app run `36333448100` passed. The evidence is recorded in the [BUILD-004 report](builds/BUILD-004-REPORT.md); its pre-merge status line is historical. `TESTNET_EXECUTED` and `MAINNET_EXECUTED` remain absent, and no public-chain, production-key, live-provider or composed Mode B authority exists. The next milestone is BUILD-005 planning; see [NEXT_BUILD.md](NEXT_BUILD.md).

## BUILD-004 pre-merge acceptance state (historical, 2026-09-27)

DEC-0031 approved the [BUILD-004 plan](builds/BUILD-004-PLAN.md) and D-1; DEC-0032 recorded Amendment A-1. The Safe 1.4.1 plus Zodiac Roles 2.1.0 finite swap path is implemented on local chain 31337. The local fork uses the certified BUILD-003F transcript strictly closed, plus explicitly declared local-only accounts and three owner-selected `LOCAL_SETUP_NOT_BASE_OBSERVED` Safe token slots.

Passed locally on this tree:

- the real Mode B browser specs, 4/4 in two consecutive strict runs with repository-confined module resolution;
- the Mode B fork tests: direct bypass, compiler read-back and reconciliation;
- `pnpm check` (346 tests);
- the full browser suite with Mode B off: 42 passed, and the 4 Mode B specs skipped;
- both governance steps.

**Owner-operated injected-wallet acceptance: PASS.** MetaMask in Brave on chain 31337 covered six installation signatures, a browser-independent worker with a fresh-process restart, `RECONCILED`, and four revocation signatures ending in `REVOCATION_CONFIRMED`. The independent verifier returned PASS.

The status is **LOCAL ACCEPTANCE COMPLETE / READY FOR OWNER MERGE DECISION**. Still outstanding:

- remote CI on the final PR #13 head;
- the owner's merge decision;
- post-merge checks.

The [BUILD-004 report](builds/BUILD-004-REPORT.md) separates these gates. Evidence cannot exceed `FORK_REPRODUCED`; no public-chain or production authority exists.

## Current BUILD-003 certification state (2026-09-27)

BUILD-003D was merged through PR #10 at `ca22dd5796614691a8de3a4271c3af5a7c889fd9`. DEC-0028 approved BUILD-003F, then DEC-0029 amended its ceiling to 52 created and 47 modified paths, with 271 protected BUILD-003D baseline paths. The delivered inventory was 52 created and 46 modified. The current owner checkpoint has completed one real Alchemy Free Base Mainnet recording (286 provider requests, 7,436 reserved CU, finalized source block 51,797,365), byte-identical closed replay of transcript `ebf4daaf10f891a735db682e8db2ee383b5165cece414e606a2011e681ed7d75`, 18/18 real-replay browser cases and a manually operated MetaMask/Brave G7 verification. G7 independently found both signed payloads exact, both receipts successful and Evidence Bundle `0xd651a51063af8f86aee30d7f85844bb4747147bc27eb371807e38c3ac5f795b6` `RECONCILED:EXACT` on local chain 31337. The separate earlier F2 owner-secret suite passed 51/51 and G1 C1–C10. See the [BUILD-003F report](builds/BUILD-003F-REPORT.md) for the distinct environments and limits.

**Current markers:** BUILD-003 certification: CERTIFIED: FORK_REPRODUCED. G7 manual wallet acceptance: PASS. BUILD-003: COMPLETE. Under DEC-0030 the owner accepted ADR-0004 and certified the controlled local-fork evidence on chain 31337 after PR #11 passed 4/4 checks on `45dc852c88810be41ec2a703c163f4e41bcfa2eb`, merge `4bf7d4f6e96c5ef433b0c930dad067d4001f2956`, and successful post-merge Governance `36286360276` and Contracts/app `36286360265`. `TESTNET_EXECUTED` and `MAINNET_EXECUTED` remain absent. The owner provider credential was removed after F3. No mainnet, public-testnet, production, live-provider, wallet-custody or financial-execution authority is added. The approved next build remains `NONE_APPROVED`; BUILD-004 planning may be considered separately, but no BUILD-004 implementation is approved.

## Historical BUILD-003D closure state (2026-09-24)

The following paragraphs preserve the state at BUILD-003D closure. Their pending/not-run statements are historical and are superseded by the current BUILD-003F section above.
BUILD-003D was approved under DEC-0023, with Amendments 1–6. It is closed under Option B (DEC-0025) and delivers only the implementation and acceptance evidence that passed offline: 66 created and 26 modified paths.

- **G0:** a deterministic Simulate viewport and screenshot-diff forensics. Local stress passed; CI without a rerun remains pending until the pull request exists.
- **G1:** historical pre-secret-removal Anvil v1.8.3 C1–C10 pass; final-byte pinned-account startup awaits BUILD-003F owner-secret revalidation under DEC-0026.
- **G2:** the additive enforcement-matrix contract and exact-payload profile (ADR-0003, `workflow-contracts` 0.2.0).
- **G3:** the pure compiler, executor and reconciler packages, tested with scripted transports.
- **G4:** the fork harness, closed replay upstream and fork setup, with the G5 incident repairs and the Amendment 6 project-specific test accounts.

Local results on the final tree:

| Check | Result |
|---|---|
| Unit | 313/313 on final bytes |
| Contracts | 79/79 |
| G1 | HISTORICAL_PASS_PRE_SECRET_REMOVAL; final-byte pinned-account startup deferred to BUILD-003F |
| Fork suites | 12 passed, 21 owner-secret cases deferred on final bytes |
| Guarded browser suite | 28/28 at zero pixels |
| Typecheck | 11/11 |
| Build | 7/7 |
| Lint | pass |
| Schema exports | 11 |
| Updated persistent governance programs | pass |

**Recording.** The owner ran three Alchemy attempts, and all three stopped:

- attempt 1: `UNAPPROVED_UPSTREAM`, after 2 requests;
- attempt 2: `DEV_ACCOUNTS_NOT_CLEAN`, after 32 requests;
- attempt 3: `SETUP_TRANSACTION_FAILED`, after 34 requests. The setup read its receipt before Anvil had mined the transaction.

D-5 authority is exhausted at 3/3 attempts, 68/1,800 requests and 1,768/46,800 reserved listed CU. The owner-reported dashboard showed 1,008 CU after attempt 2. No transcript exists, and no further BUILD-003D recording is permitted.

**Moved to BUILD-003F.** BUILD-003F is not approved; it needs its own plan and recording budget. It receives:

- the successful Base recording and transcript;
- the fork application integration (formerly G6);
- the manual-wallet acceptance (formerly G7);
- the dependent certification rows.

BUILD-003E stays reserved for public-testnet evidence. BUILD-004 planning is blocked until BUILD-003 certification, which requires BUILD-003F.

BUILD-003 certification: PENDING_OWNER_DECISION. G7 manual wallet acceptance: NOT_RUN. BUILD-003: IN_PROGRESS.

The agent made no live RPC request, used no credential and operated no wallet. The BUILD-003D commit and pull request are owner-authorized but pending final verification; merge stays with the owner. No `FORK_REPRODUCED`, `RECONCILED` or other execution evidence exists. See the [BUILD-003D report](builds/BUILD-003D-REPORT.md).

- Last merged build: `BUILD-003C`, merged through PR #9 as `8a5fbaed26e005e5719528c399f7ca1adb334eb6` at 2026-09-24T15:31:30Z. Branch and PR checks passed. Post-merge Governance passed on attempt 1; contracts/app passed on attempt 2 after one `simulate-expired` screenshot failure. Exact run and job IDs are in the BUILD-003D plan §2.3. Historical BUILD-003C plan and report remain byte-identical.
- Earlier merged build: `BUILD-003B`, merged through PR #8 as `0faec71207628dfe27fb23c81680d2c27827f5ea` at 2026-09-24T02:46:29Z. Pull-request checks passed (Governance 35948277062; contracts and reference app 35948277082), as did post-merge push checks (Governance 35948667349; contracts and reference app 35948667352). The preserved BUILD-003B report was written before delivery.
- Earlier merged build: `BUILD-003A`, merged through PR #7 as
  `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd` on 2026-09-24. Pull-request
  checks passed (Governance runs 35939197467 and 35939261995; contracts and
  reference app runs 35939197471 and 35939261865), and so did the post-merge
  push checks (Governance run 35940556463; contracts and reference app run
  35940556433). The preserved [BUILD-003A report](builds/BUILD-003A-REPORT.md)
  was written before delivery and still says remote CI was not performed.
- Earlier completed build: `BUILD-002`; result `COMPLETED`, merged through PR #5
  as `606174f0bd944e5a1c31baf8dad685d7558b7cc8`
- BUILD-003B: implementation approved on 2026-09-24 under DEC-0019 and the
  [exact plan](builds/BUILD-003B-PLAN.md); local acceptance and remote CI are
  recorded separately in [its report](builds/BUILD-003B-REPORT.md)
- BUILD-003C: local acceptance passed for a separate read-only Base/Uniswap v3 observation. The public RPC session remains stopped after two HTTP 429 responses at 2/4 attempts and 24/84 requests. The original Alchemy HTTP 403 attempt-1 evidence remains byte-identical at 1/3 attempts and 1/63 requests. After the owner enabled Base Mainnet only and approved Amendment 3/DEC-0022, the owner-run continuation completed both hash-pinned recordings in attempts 2 and 3, ending at 3/3 Alchemy attempts and 43/63 requests. Both transcripts, four reviewed code pins, replay fixture and two observation snapshots passed local checks; no further RPC request is authorized. BUILD-003C was delivered through PR #9 and merged; the post-merge contracts/app check passed on rerun. See the [report](builds/BUILD-003C-REPORT.md).
- Current approved implementation: `BUILD-003D` through its gated plan; after it, `NONE_APPROVED`
- Product implementation: frozen contract packages, mocked visual shell,
  non-executing Base USDC↔WETH authoring with deterministic review, and a
  `MOCKED` Quote/State Artifact, Artifact Set and Simulation Bundle chain built
  locally from a synthetic fixture
- Financial functionality: read-only historical quote observation in local replay, with opt-in local-development live reads only; no wallet, signing, submission, financial simulation or execution
- Authorization mode: `NONE`; financial enforcement: `NOT_ENFORCED`; the
  canonical workflow state stays `DRAFT`
- Interface and mocked artifact evidence label: `MOCKED`
- Build financial outcome: `NOT_APPLICABLE`
- Asset metadata: `NOT_ONCHAIN_VERIFIED`
- Licensing authority: `RESOLVED_FOR_PREINCORPORATION_LICENSING`
- Future legal-entity transfer: `DEFERRED_UNTIL_INCORPORATION`
- License publication: `AUTHORIZED`
- Third-party materials: `EXCLUDED_UNLESS_VERIFIED`
- CLA adoption: `DEFERRED`
- Dependency inventory: 245 pinned registry identities and 16 reviewed license
  exceptions; BUILD-003D adds the approved two Noble identities for 247 locked registry identities without changing the earlier resolutions

## Historical state by category at BUILD-003D closure

| Category | Current state |
|---|---|
| Planned | BUILD-003F (recorded Base fork acceptance, fork application integration and manual-wallet acceptance) must be planned and approved separately; no later build is approved |
| Mocked | Local command assistant, example nodes, stage shell and the synthetic quote and simulation fixture |
| Implemented locally | BUILD-001 contracts, BUILD-002 shell, BUILD-003A authoring and deterministic lint, BUILD-003B mocked artifact chain, BUILD-003C read-only observation and offline replay, BUILD-003D pure compiler/executor/reconciler with scripted transports |
| `MOCKED` | Interface interactions and the Quote/State, Artifact Set and Simulation Bundle chain; internal logic only, no financial evidence |
| `FORK_REPRODUCED`, `TESTNET_EXECUTED`, `MAINNET_EXECUTED` | None |
| `CONFIRMED_NOT_RECONCILED`, `RECONCILED`, `INCONCLUSIVE`, `DIVERGENT` | None |
| Blocked or not approved | BUILD-003D recording authority exhausted (3/3 attempts, no transcript); BUILD-003F not yet approved; BUILD-004 planning blocked until BUILD-003 certification; Mode B (ADR-0001 remains PROPOSED), package publication and mainnet execution not approved |

Historical BUILD-000, BUILD-001, BUILD-002 and BUILD-003A records and the
BUILD-002 governance amendment remain unchanged. BUILD-003B local and remote
evidence must be read separately in its report. Mocked provenance and hashes
identify synthetic data; they are not proof of authenticity or of independent
financial enforcement.
