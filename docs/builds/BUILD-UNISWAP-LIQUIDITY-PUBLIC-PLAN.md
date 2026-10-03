# BUILD-UNISWAP-LIQUIDITY-PUBLIC — Plan

Date: 2026-10-03. Branch `claude/build-uniswap-liquidity-public`, stacked on `claude/build-cloud-001`
(`40ea29dd39e9aa487747d40e6bc99e196053b806`). BUILD-013 (branch, worktree, PR #48) and PRs #48–#50 are out of scope
and untouched.

## 1. Objective

Promote Uniswap v3 concentrated liquidity from its historical `FORK_REPRODUCED` local-Anvil level (BUILD-006) to a
public-network path executed by the owner's browser wallet, on the same BUILD-CLOUD-001 runtime as every other
cloud-backed capability: Canonical IR → capability registry → Build → Simulate → Review → owner wallet → public
network → worker reconciliation → PostgreSQL durable state → Evidence Bundle.

## 2. Inventory (what exists)

| Area | Existing implementation | Public-path suitability |
| --- | --- | --- |
| Canonical IR | `asset.liquidity.uniswap-v3` (BUILD-006 spelling: explicit recipient, no slippage) and the chain-neutral `asset.liquidity.concentrated` (`workflow-contracts/src/liquidity.ts`): token0/token1, per-token maxima/minima, immutable ticks, fee tier, `MAXIMUM_SLIPPAGE_BPS`, recipient `null` = the executing owner bound at Review, one `position-nft` output. Read by `readConcentratedLiquidity`. | **Reused unchanged.** The neutral action already represents a Uniswap position; the protocol constraint selects the runtime (`orca-whirlpools` today). No schema change. |
| Registry | `execution-capabilities.ts`: `asset.liquidity.uniswap-v3` / `uniswap.v3` on `eip155:8453` `LOCAL_FORK` = `FORK_REPRODUCED`; `asset.liquidity.concentrated` → Orca Devnet only. | Add one row; keep every existing row. |
| Range math / payloads | `reference-compiler/src/liquidity.ts`: independent `sqrtRatioAtTick`, `rangeComposition`, EIP-1559 **unsigned payload bytes for chain 31337**, deployment pinned to Base mainnet / Arbitrum with WETH as token0. | Payload format and pool identity are fork-only. Reuse the independent `sqrtRatioAtTick` for deterministic price↔tick conversion and a cross-check; public calls are new exact `eth_sendTransaction` requests (like the public swap). |
| Mode A service | `liquidity-service.ts`: `GRYLOO_LIQUIDITY=fork`, chain 31337 profile, Anvil RPC, file journal, mint/increase/decrease/collect/burn, unknown-submission scan by raw signed bytes. | **Not suitable** for public use: fork-only RPC, unsigned-bytes wallet path on 31337, local files. Stays as the historical FORK_REPRODUCED path. |
| Mode B (BUILD-004/007) | Safe + Zodiac Roles, worker holding a disposable executor key. | **Must not** become public authority. Not reused for the public path. |
| Swap → liquidity (BUILD-007) | Two-node IR with an `OUTPUT_REFERENCE` input and a `resourceEdges` entry; Mode B worker executes both. | Authority model is Mode B; see §10. |
| Public EVM pattern | `public-testnet-service.ts` (Base Sepolia swap): read-only preflight, Review, owner `eth_sendTransaction`, worker receipt reconciliation, append-only run log, cloud flow `base-sepolia-swap`. RH-DEMO-001 transfer: PREPARED → durable `SUBMITTING` handoff → hash, nonce-pinned discovery by binary search, pre-broadcast refusal diagnostics. | The pattern the liquidity flow follows. |
| Cloud runtime | `cloud-runtime`: PostgreSQL `DurableLogStore`/`LeaseStore` (CAS, fenced leases), outbox, worker, API dispatcher, idempotency, EvidenceStore, tenant scoping. `backend/flows.ts`: one `FlowDefinition` per flow (methods, transport, projector, observation rule, evidence). Workers get `observeOnly` transports. | Reused unchanged; one new `FlowDefinition`. |
| UI | Advanced setup "Liquidity position" group with a network selector (Solana Devnet / Base local fork); per-capability Simulate/Execute panels selected by the workflow's action/chain. | Add "Base Sepolia" to the same selector and one panel/store pair, like every other capability. |

Local-only assumptions found in the old path: chain 31337, `0x7a69` wallet chain, Anvil-unlocked disposable accounts,
`GRYLOO_LIQUIDITY_PROFILE` file pins, `/tmp` journals and closed-replay transcripts. None are carried into the public path.

## 3. Network selection (verified read-only, 2026-10-03)

**Base Sepolia (84532)** is selected. Read-only checks against `https://sepolia.base.org` (block ≈ 47,614,000):

| Item | Value | Check |
| --- | --- | --- |
| UniswapV3Factory | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | code present; already pinned by the public swap |
| NonfungiblePositionManager | `0x27f971cb582bf9e50f397e4d29a5c7a34f11faa2` | code present; `factory()` = factory; `WETH9()` = WETH; `name()` = "Uniswap V3 Positions NFT-V1" |
| Pool USDC/WETH 0.05% | `0x94bfc0574ff48e92ce43d495376c477b1d0eeec0` | `factory.getPool` match; `token0` = USDC, `token1` = WETH, `fee` = 500, `tickSpacing` = 10, `liquidity` ≈ 4.48e11, tick 225,606 |
| USDC (Circle test) | `0x036cbd53842c5426634e7929541ec2318f3dcf7e` | 6 decimals |
| WETH | `0x4200000000000000000000000000000000000006` | 18 decimals |
| RPC capabilities | `eth_simulateV1` (multi-call, sequential state), historical `eth_call` ≥ 50,000 blocks back, OP-stack `GasPriceOracle.getL1FeeUpperBound` | all answered |

Why: the official Uniswap v3 deployment exists with a live pool; the same pool already carries the repository's
`TESTNET_EXECUTED` Base Sepolia swap, so test USDC/WETH and browser-wallet support are proven; `eth_simulateV1`
allows a real simulation of the exact approve → approve → mint sequence against current public state before any
allowance exists. A mint needs no counterparty liquidity. **Token order differs from Base mainnet** (USDC is token0
here), which the IR and Review bind explicitly. No mainnet or real-funds path is needed.

## 4. Design

**Canonical IR.** `asset.liquidity.concentrated`, chain `eip155:84532`, protocol `uniswap-v3`, token0 USDC, token1
WETH, fee 500, aligned ticks, maxima, minimums `0` in the IR (the binding minimums are derived at Review from the
simulated amounts and the IR's `MAXIMUM_SLIPPAGE_BPS`), recipient `null` (bound to the connected owner at Review),
position asset = the Position Manager. Price ranges (USDC per WETH) and "±N% around the current price" are converted
to ticks deterministically at authoring time with exact integer search (lower price → upper tick because token1/token0
is WETH per USDC; bounds aligned outward to spacing 10). The IR stores only ticks.

**Registry.** New row: `asset.liquidity.concentrated` / `uniswap.v3` / `eip155:84532` / `PUBLIC_TESTNET`, Mode A,
requirements injected wallet + quote provider + reviewed artifacts, `evidenceMaturity: null` until the owner's public
acceptance. Existing rows (incl. `asset.liquidity.uniswap-v3` `FORK_REPRODUCED`) are unchanged.

**Service** (`src/server/uniswap-liquidity-service.ts`, one implementation on the `ExecutionStorage` port: file store
locally, PostgreSQL in the cloud). It never signs or sends. Run = append-only snapshot log `unilp-<32 hex>.jsonl`.

* `simulate(workflow, owner)`: chain id, head freshness, contract code and code hashes, Position Manager ↔ factory/WETH,
  `factory.getPool`, pool token order/fee/spacing/`slot0`/liquidity, token decimals, owner balances/allowances/nonce,
  then **`eth_simulateV1`** of the exact sequence (needed approvals, then mint) from the owner at the observed block.
  The mint's returned liquidity and amounts are cross-checked against an independent local composition; minimums =
  simulated × (1 − slippage). Review commitment = SHA-256 of the canonical Review (chain, pool, tokens and order,
  fee, owner/recipient, maxima, ticks, prices, range state, expected amounts, minimums, deadline, approvals, exact
  calldata, Position Manager, estimated fees, simulation block). TTL 120 s; mint deadline = observed block time + 15 min.
* `review(id, commitment, workflow)`: owner acceptance of that exact commitment; any IR change invalidates.
* `begin(id, owner, workflow)`: re-reads chain state, re-simulates the remaining reviewed calls; fails closed and
  clears the authorization (`STATE_CHANGED_REVIEW_REQUIRED`) if chain, pool, code, range state or token order changed
  or the expected amounts drifted by more than half the reviewed slippage. Chooses the next step from on-chain
  allowances (approve token0 → approve token1 → mint), reserves the owner's nonce (economic intent, exclusive create),
  persists `PREPARED` with the exact transaction.
* `handoff(id)`: durable `SUBMITTING` before the wallet is called (nonce still unconsumed, no queued transaction).
* `report(id, result)`: wallet hash → `PENDING`; ambiguous → `SUBMISSION_RESULT_UNKNOWN`. `walletFailure` records a
  proven pre-broadcast refusal (`CANCELLED`/`NOT_FOUND`).
* `observe(id)` (API and worker): PREPARED → `CANCELLED` (no wallet request can exist); no hash → nonce discovery by
  binary search on `eth_getTransactionCount`; mismatching transaction on the reviewed nonce → `NOT_FOUND` for that
  attempt; receipt → strict reconciliation. Approval: exact Approval log, allowance at the receipt block equals the
  reviewed amount. Mint: transaction bytes equal the reviewed calldata; ERC-721 `Transfer(0 → owner, tokenId)`,
  `IncreaseLiquidity`, pool `Mint` with the reviewed ticks, token Transfer logs owner → pool; `ownerOf(tokenId)` =
  owner, `positions(tokenId)` = tokens/fee/ticks/liquidity; owner balance deltas between the parent and receipt blocks
  equal the deposited amounts; amounts within [minimum, maximum]. Then the Evidence Bundle.
* `refresh(id)`: after a confirmed approval (or an expired/invalidated Review, or a proven-not-sent mint), a new
  simulation and a new Review are required before the next wallet request.

**Duplicate-effect guards.** One active attempt per run; at most one confirmed mint per run; a new mint attempt only
after every earlier mint attempt is proven `CANCELLED`/`NOT_FOUND`/`REVERTED` and the owner's position count has not
grown; owner+nonce economic-intent reservation across runs; workers have no send path.

**Cloud.** One `FlowDefinition` (`uniswap-liquidity`) in `backend/flows.ts`: methods, Base Sepolia read-only transport
(allowlisted methods; optional HTTPS override `GRYLOO_BASE_SEPOLIA_RPC_URL`), projector (run/attempt rows),
observation rule (`SUBMITTING`, `SUBMISSION_RESULT_UNKNOWN`, `PENDING`), evidence export. Enabled with
`GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live` (`MOCKED_LOOPBACK_ONLY` harness for tests). No migration: attempt states,
provenance, owner/hash formats and the `TESTNET_EXECUTED` evidence environment are already in the schema domains.

**UI.** Same Build model: "Liquidity position" → Network "Base Sepolia" form (USDC/WETH maxima, price or tick range,
"±10% around current price", slippage). One Simulate/Execute panel showing the full Review, an Execute button per
step (each a separate wallet prompt), refresh/re-review between steps, reload recovery through a local pointer and
the durable run, observation, result and Evidence Bundle download.

**Evidence.** Frozen v1 Evidence Bundle (`environment: TESTNET_EXECUTED` only for a public owner-executed run,
`MOCKED` for the harness) plus an export carrying network, blocks, owner, approval and mint hashes/receipts, pool,
pair, fee, ticks, prices, token ID, liquidity, amounts, residual allowances, reconciliation and bundle hash.

## 5. Tests

Unit: tick/price conversion and alignment, ±% band, wrong token order, wrong fee tier, wrong chain/protocol, Review
commitment, stale Review, changed pool state, allowance → exact approval steps, mint calldata (owner recipient,
deadline, minimums), simulation divergence, approval and mint reconciliation, token-ID discovery, nonce discovery,
browser loss at each boundary, uncertain receipt, revert, replaced transaction, pending, position-exists guard,
malformed state, evidence. PostgreSQL: full journey through API + worker with fresh instances, duplicate API request,
duplicate hash report, two API instances racing `begin`, tenant isolation, corrupt state, worker cannot submit.
Existing liquidity suites stay unchanged.

## 6. Owner boundary

No public transaction is sent by the agent. After implementation and a real read-only preflight, the status is
**IMPLEMENTATION COMPLETE — READY FOR OWNER PUBLIC E2E**; `TESTNET_EXECUTED` is claimed only after the owner's
wallet-signed acceptance through the deployed product.

## 7. Swap → liquidity

Evaluated after the standalone path (see the report). BUILD-007's composition is Mode B; a public composition must be
two owner-signed Mode A runs linked by a typed output reference, with the mint maxima bound to the reconciled swap
output.
