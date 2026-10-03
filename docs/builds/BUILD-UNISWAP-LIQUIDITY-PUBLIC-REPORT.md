# BUILD-UNISWAP-LIQUIDITY-PUBLIC — Report

Date: 2026-10-03. Branch `claude/build-uniswap-liquidity-public`, stacked on `claude/build-cloud-001`
(`40ea29dd39e9aa487747d40e6bc99e196053b806`). Plan: [BUILD-UNISWAP-LIQUIDITY-PUBLIC-PLAN.md](BUILD-UNISWAP-LIQUIDITY-PUBLIC-PLAN.md).

**Status: IMPLEMENTATION COMPLETE — READY FOR OWNER PUBLIC E2E.** The remaining steps are the owner's: deploy
BUILD-CLOUD-001 with this flow enabled, then run the public acceptance below with your own wallet. No public
transaction was sent by the agent, and no `TESTNET_EXECUTED` claim is made.

## What was built

The existing canonical `asset.liquidity.concentrated` action gained a public EVM runtime: Uniswap v3 USDC/WETH 0.05% on
Base Sepolia. It runs as one more flow on the BUILD-CLOUD-001 runtime, the same way the Base Sepolia swap and Orca
liquidity do. There is no protocol-specific service, schema, database migration or key.

| Layer | Change |
| --- | --- |
| Canonical IR | **Unchanged.** The neutral node (token0/token1 in pool order, maxima, aligned ticks, fee tier, `MAXIMUM_SLIPPAGE_BPS`, recipient `null` = executing owner, position asset = Position Manager) already represents the action. |
| Profile | `action-registry/src/uniswap-v3-base-sepolia.ts`: verified addresses, runtime-code SHA-256 pins for the factory, Position Manager and pool, caps, slippage limit, Review TTL 120 s, mint deadline 15 min. |
| Registry | New row `asset.liquidity.concentrated` / `uniswap.v3` / `eip155:84532` / `PUBLIC_TESTNET`, Mode A, `evidenceMaturity: null`. The BUILD-006 `asset.liquidity.uniswap-v3` `LOCAL_FORK` row stays `FORK_REPRODUCED`. |
| Linter | `validateUniswapLiquidityNode/Workflow`: pool token order, fee tier, provider, tick alignment, usable bounds, caps, slippage, IR minimums `0`, recipient `null`, closed canonical declaration, isolated node. Other EVM chains still fail with `LIQUIDITY_RUNTIME_UNSUPPORTED`. |
| Compiler | `uniswap-public-liquidity.ts`: deterministic price↔tick conversion by exact integer search (no floating point), ±N% band, pool range state, independent composition estimate, exact `approve`/`mint` calldata with a strict canonical decoder, mint-result and `positions` decoders, pinned selectors and topics. |
| Authoring | Chat (`Add liquidity 10 USDC and 0.005 WETH from 140 to 180 USDC per WETH on Base Sepolia`) and canvas (`ADD/SET_UNISWAP_LIQUIDITY`) produce the identical node; proposal, summary, canvas card and inspector support it. |
| Service | `src/server/uniswap-liquidity-service.ts` on the `ExecutionStorage` port (files locally, PostgreSQL in the cloud). It never signs or sends. |
| Cloud | `backend/flows.ts` flow `uniswap-liquidity`: strict argument validation, Base Sepolia read-only transport, projector, observation rule and evidence export. It uses the existing outbox, worker, leases, idempotency and EvidenceStore. |
| Shared code | The swap's owner-submission verifier (direct, or one canonical MetaMask delegated redemption) is now an exported function used by both flows. The swap's 12 tests pass unchanged. The read-only RPC client became a factory with per-flow method allowlists that refuse send methods. |
| UI | "Liquidity position → Network: Base Sepolia" in the existing Advanced setup. One Simulate/Execute panel with an Execute button per wallet request, refresh and re-Review between steps, reload recovery, observation, result and Evidence Bundle download. |

## Network selection and verified deployment

Base Sepolia (84532) was chosen. It has the official Uniswap v3 deployment and a live USDC/WETH 0.05% pool. The
same pool already carries the repository's `TESTNET_EXECUTED` swap, so test tokens and browser wallets are proven.
The public RPC supports `eth_simulateV1`, which allows a real simulation of the full approve → approve → mint
sequence before any allowance exists. No mainnet or real-funds path is needed.

| Contract | Address | Verification (read-only, 2026-10-03) |
| --- | --- | --- |
| UniswapV3Factory | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | code SHA-256 `2e3c9aa7…a164` (pinned) |
| NonfungiblePositionManager | `0x27f971cb582bf9e50f397e4d29a5c7a34f11faa2` | code `253dd1ca…1c60` (pinned); `factory()` and `WETH9()` match; name "Uniswap V3 Positions NFT-V1" |
| Pool USDC/WETH 0.05% | `0x94bfc0574ff48e92ce43d495376c477b1d0eeec0` | code `5f45f1a6…cac9` (pinned); `getPool` match; token0 USDC, token1 WETH, fee 500, spacing 10 |
| USDC (test) | `0x036cbd53842c5426634e7929541ec2318f3dcf7e` | 6 decimals |
| WETH | `0x4200000000000000000000000000000000000006` | 18 decimals |

## Authority, approvals and position ownership

- **Authority (Mode A only).** Only your browser wallet signs and sends. Each wallet request (each exact approval, then
  the mint) needs your Execute click on a current Review. The backend builds, simulates and records. Workers get
  transports that reject `eth_sendTransaction`, `eth_sendRawTransaction` and `sendTransaction`, and the liquidity RPC
  allowlist has no send method. Mode B (Safe + Roles with a disposable executor key) is not used.
- **Approvals.** An approval is requested only when the on-chain allowance is short. Its spender is the verified
  Position Manager and its amount is exactly the reviewed maximum for that token; there are no unlimited approvals.
  Approvals are durable attempts and reconcile exactly:
  - one `Approval` log, from you, to the Position Manager, with the reviewed value;
  - the allowance at the receipt block equals that value.

  Any residual allowance after the mint is shown and recorded as evidence.
- **Position ownership.** The mint recipient is your wallet, checked in three places:
  - it is encoded in the reviewed calldata;
  - it is re-checked from the receipt (`Transfer(0 → owner)`);
  - `ownerOf(tokenId)` is read at the receipt block.

  The backend has no address of its own that could receive anything.

## Simulation and Review binding

`simulate(workflow, owner)` runs entirely on the public network:

1. **Single-block reads.**
   - Chain ID and head freshness.
   - Contract code against the pins, and the Position Manager's factory and WETH.
   - Pool identity, token order, fee, tick spacing, `slot0` (unlocked) and liquidity.
   - Token decimals.
   - Your balances, allowances, nonce, pending nonce and position count.
   - A reorg check.
2. **Two `eth_simulateV1` passes.** The first pass simulates `[needed approvals…, mint]` with zero minimums to get the
   expected amounts. Minimums are then the expected amounts × (1 − slippage). The second pass simulates the exact
   reviewed calldata.
3. **Independent cross-check.** The simulated liquidity and amounts must match an independent local composition
   estimate (tolerance: rounding of the independent sqrt ratio). The range state must agree as well.
4. **Fees.** Gas limits come from the simulation. The L1 data-fee upper bound comes from the OP-stack GasPriceOracle.

The Review commitment is a SHA-256 over all of the following:

- chain and block, contracts and code hashes, tokens and their order, fee tier;
- current price and tick, range ticks and USDC-per-WETH prices, range state;
- maxima, expected amounts, minimums, deadline;
- current balances and allowances, the approvals and the exact call list;
- fee estimates, simulation results and nonce.

`begin` re-reads everything and re-simulates the remaining reviewed calls. It clears the authorization and requires a
new simulation and Review if any of these changed:

- the code;
- the range state;
- a needed approval that is not in the Review;
- expected amounts drifting by more than half the reviewed slippage;
- a reviewed call that would now revert.

## Recovery and reconciliation

| Case | Behaviour (test) |
| --- | --- |
| Browser closes before approval | PREPARED → `CANCELLED` on observation (no wallet request can exist); the same nonce can be re-authorized (unit) |
| Browser closes after approval submission / receipt uncertain | Hash is saved locally before reporting. Without a hash, nonce discovery (binary search) finds the transaction; a restarted service or worker reconciles it (unit, PostgreSQL, browser) |
| Browser reload after approval | Run recovered from the server pointer; continues from the server-held reviewed IR; no resend (browser) |
| Backend or worker restart between approval and mint | Fresh API and worker instances continue from PostgreSQL alone (PostgreSQL) |
| Browser closes after mint submission | The worker discovers the mint by nonce and reconciles position, NFT owner and balance deltas (PostgreSQL) |
| Duplicate API request | Idempotency key replays the same run (PostgreSQL over HTTP) |
| Duplicate tx-hash registration | Same hash is a no-op; a different hash is `UNISWAP_HASH_DIVERGENT` (unit, PostgreSQL) |
| Stale Review | `UNISWAP_REVIEW_EXPIRED` → refresh + new Review (unit) |
| Changed pool state | `UNISWAP_STATE_CHANGED_REVIEW_REQUIRED`; authorization cleared (unit) |
| Revert | `REVERTED`; authorization cleared; no automatic retry (unit) |
| Replaced transaction | Same-call speed-up adopted as `replacementHash`. Cancellation → `NOT_FOUND` (nonce consumed by a different transaction) (unit) |
| Pending | Stays `PENDING`; worker retries with backoff; nothing sent (unit) |
| Mint never sent | `NOT_FOUND` once the chain passes the mint deadline (unit) |
| Position may already exist | A new mint is refused if the owner's position count grew since an unproven earlier mint (`UNISWAP_POSITION_MAY_EXIST_OBSERVE`) (unit) |
| Wrong transaction reported | Run frozen `DIVERGENT` / `RECONCILIATION_REQUIRED`; never resent (unit) |
| Wallet refusal | Proven pre-broadcast refusal → `CANCELLED`; ambiguous error → `SUBMISSION_RESULT_UNKNOWN`, observation only (unit, browser) |
| Owner nonce across runs | Owner+nonce is one economic identity: a second run cannot prepare the same nonce (unit) |
| Malformed or tampered state | `UNISWAP_LIQUIDITY_STORE_CORRUPT` / `JOURNAL_CORRUPT` for API and worker (unit, PostgreSQL) |
| Tenant isolation | Other tenant cannot read or act on the run (PostgreSQL) |
| Stale work item | Never cancels a PREPARED attempt (PostgreSQL) |

## Evidence Bundle

The frozen v1 Evidence Bundle is unchanged in format. `environment` is `TESTNET_EXECUTED` only for a public run and
`MOCKED` for the harness; `outcome` is `RECONCILED`. Receipts cover each confirmed approval and the mint. The
reconciliation section holds post-mint balances, residual allowances, one position, total fees and ownership. It is
archived by the existing worker to the EvidenceStore with SHA-256 verification. The export also carries:

- network and owner, Position Manager and pool, token pair and fee tier;
- ticks and prices, token ID, liquidity, amounts and minimums;
- per-transaction hash, block, block hash, status, fee, submission kind, Review commitment and explorer link;
- residual allowances, balances after, and the bundle hash.

## MetaMask delegated-redemption compatibility (owner E2E, 2026-10-03)

**What happened.** Your first public approval,
[`0x8248b684…5ccc`](https://sepolia.basescan.org/tx/0x8248b68421e381ce6971f5cd0ad3eb61abc8852ef15e9e64883617cbad8b5ccc),
was fulfilled by MetaMask as a relayed Delegation Framework redemption:

- type 2, sent to the canonical Delegation Manager `0xdb9b…47db3`;
- `redeemDelegations` at depth 1, with no `authorizationList`;
- your owner account was already EIP-7702-delegated to `0x63c0…e32b`;
- the decoded inner call is exactly the reviewed `USDC.approve(Position Manager, 3000000)` with value 0.

The shared verifier only accepted type 2 at depth 2, so it rejected a correct submission.

**Fixes (narrow):**

1. **Verifier.** An already-delegated type-2 redemption without an `authorizationList` is accepted at depth 1 as well as
   depth 2. Every other check is unchanged:
   - the exact inner target, data and value;
   - the canonical manager address and non-empty manager code;
   - your code equal to the expected delegator at the receipt block **and** at the prepared block;
   - exactly `depth` `Redeemed` events naming you as delegator;
   - the redeemer topology (depth 1: the redeemer is the sender).

   Account code is now read with a reader that permits empty `0x`. An undelegated owner or a manager without code is
   now a mismatch instead of an RPC error retried forever.
2. **Owner-nonce reservation.** A relayed redemption does not consume your nonce. Previously the run's next step (WETH
   approval or mint) would have failed with `UNISWAP_OWNER_NONCE_IN_USE` on the same nonce. A reservation is now held
   only while its attempt is active. Terminal attempts (cancelled, not found, confirmed, reverted, frozen) cannot
   execute again.

**Regression coverage.**

- The real transaction and receipt are a fixture (`src/server/testdata/`). The harness encoder reproduces the real
  envelope byte-for-byte.
- 14 adversarial variants are rejected.
- A unit and a browser journey run approve → approve → mint entirely through relayed depth-1 redemptions.
- With the old code, both regressions fail.

**Your current run.** If the worker already observed the hash before this fix, that run is frozen as `DIVERGENT`.
Frozen runs are terminal by design and are not rewritten. Start a fresh Simulate after redeploying. The 3 USDC
allowance is already on chain, so a new Review will show "existing allowance is sufficient" for USDC maxima up to 3.

**Known limit.** If a relayed submission's hash is lost before it reaches the server, nonce-based discovery cannot
find it, because your nonce does not change. The saved local hash pointer and the duplicate-position guard still
apply, and nothing is ever resent automatically.

## Swap → liquidity composition

**Not made public in this build.** The blocker is explicit:

- **BUILD-007's composition is Mode B.** A Safe owns the position, and a worker with a disposable executor key sends
  both steps under Roles bounds. That authority model must not become public.
- **A public Mode A composition needs a deliberate canonical-IR change.** It would be two owner-signed runs linked by a
  typed reference. The neutral `asset.liquidity.concentrated` reader (shared with Orca) does not accept an
  `OUTPUT_REFERENCE` input or dependencies. Its maxima would have to change meaning: from a fixed authored amount to
  "at most the reconciled output of another run". That semantic and the cross-run binding (swap run → liquidity
  intent, across flows) are owner decisions. They are not a direct reuse of the standalone primitives.
- **What works today.** You can run the public Base Sepolia swap and then this public liquidity flow as two separate
  workflows, each reviewed and signed. That is sequential use, not a composition, and is not claimed as one.

## Tests and results (local)

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit) | **pass**: 1,230 passed, 2 skipped (the same pre-existing environment-gated suites as BUILD-CLOUD-001) |
| New/extended unit files (registry, compiler, linter, authoring, service) | 46 passed |
| `pnpm test:postgres` (PostgreSQL 18.6, loopback) | **pass**: 35 passed (33 existing + 2 new) |
| Browser `uniswap-liquidity.spec.ts` (MOCKED loopback) | **3/3 passed**: full journey; reload between approval and mint; refusal + lost response |
| Browser main CI list + BUILD-006 liquidity specs | 46 passed, 6 skipped, 7 failed. Skipped: BUILD-006 fork specs and Mode B specs, owner-local opt-in, not in CI, code unchanged. The 7 failures are the known zero-pixel screenshot baselines; the identical 7 fail on an untouched `git archive` of `40ea29d`, and all 7 actual images are byte-identical between this branch and that base. Baselines not modified. |
| Browser Solana Devnet swap + liquidity / Robinhood / Supply family | 13/13, 7/7, 44/44 |
| `governance_lite.py` + self-tests, `git diff --check` | pass |
| Not run locally | Anvil fork suites (`test:anvil`, `test:fork`), lending/Jupiter/CoW/Mode-A browser suites (untouched code paths), dependency audit (needs network). CI runs them. No dependency was added or changed. |

## CI (draft PR #51, head `b409713`)

All checks passed: Governance (push and PR runs), and the Contracts job (runs 37100728133 and 37100743231). The
Contracts job covers registry integrity, licences and release age, typecheck, lint, build, schema drift, unit tests,
the PostgreSQL suites, the Anvil compatibility gate and fork suite, the guarded browser suite (including the
zero-pixel screenshot baselines and the new `uniswap-liquidity.spec.ts`), the dependency audit and the CycloneDX
SBOM. The Vercel preview also passed.

## Real read-only public preflight

Recorded in [BUILD-UNISWAP-LIQUIDITY-PUBLIC-READONLY.json](BUILD-UNISWAP-LIQUIDITY-PUBLIC-READONLY.json).
`scripts/uniswap-liquidity-readonly-preflight.mjs` runs the production service against public Base Sepolia:

- **Chain and deployment.** Chain 84532 at block 47,618,529. Every code pin and deployment relation verified. Price
  159.41071 USDC per WETH, tick 225,606.
- **Simulated Review.** Wallet-independent transaction preparation for 1 USDC / 0.0005 WETH at ±10%: ticks
  224,650–226,670 (143.33–175.41 USDC per WETH), in range.
- **Simulation results.** `eth_simulateV1` of approve USDC → approve WETH → mint succeeded:
  - liquidity 135,167,331,034;
  - deposit 0.088362 USDC + 0.0005 WETH;
  - the independent local estimate is identical;
  - gas used 55,437 / 46,031 / 521,735;
  - total fee upper bound ≈ 0.0000098 ETH.
- **Simulated address.** The simulation ran from a public address that holds test tokens. Simulating requires no
  authority over that address; nothing was signed.
- **Through the real API process.** `node backend/main.ts api` with `GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live` and
  execution disabled, on a disposable loopback PostgreSQL:
  - `mode` returned `live`;
  - `simulate` produced run `unilp-e8c3…5023` with provenance `PUBLIC_TESTNET`, durable in PostgreSQL (2 append-only
    segments);
  - the Review was accepted (status `AUTHORIZED`);
  - `begin` refused with `UNISWAP_EXECUTION_NOT_ENABLED`;
  - no errors were logged.

**Public transactions submitted: none.**

## READY FOR OWNER PUBLIC LIQUIDITY E2E: owner-only sequence

**Prerequisites:**

1. **Deploy BUILD-CLOUD-001.** Follow [docs/deploy/CLOUD.md](../deploy/CLOUD.md): Neon, bucket, Railway `flofi-api`
   and `flofi-worker`, and Vercel with `API_BASE_URL`/`API_AUTH_TOKEN`.
2. **Enable this flow on both Railway services.** Set `GRYLOO_UNISWAP_LIQUIDITY_TESTNET=live`. Migrations are
   unchanged (schema version 3).
3. **Fund your wallet on Base Sepolia.** You need a little ETH for fees, test USDC (Circle faucet) and WETH (wrap ETH,
   or use Flofi's Base Sepolia swap). Suggested maxima: 1 USDC and 0.0005 WETH.

**In Flofi (public URL, your own wallet, no CLI signing):**

1. Open the public Flofi URL and connect your wallet on Base Sepolia.
2. **Build:** open Advanced action setup → Liquidity position → set Network to **Base Sepolia**. Enter Maximum USDC 1
   and Maximum WETH 0.0005, click **Use ±10% around the current Base Sepolia price**, keep slippage at 100 bps. Then
   click **Review position proposal**, then **Apply proposal**.
3. **Simulate:** click **Continue to Simulate**, then **Simulate position**. Check the Review: pool, token order
   (token0 USDC / token1 WETH), fee 0.05%, exact ticks and USDC-per-WETH range, in-range status, expected and minimum
   deposit, exact approvals, Position Manager, NFT recipient (your wallet), deadline and fees.
4. **Execute:** click **Accept liquidity review**, then **Execute: Approve USDC (exact amount)**, then confirm in your
   wallet. Wait for "confirmed".
5. **Reload check:** reload the page and open Execute. The run is recovered and the approval shows as confirmed.
6. Click **Execute: Approve WETH (exact amount)**, then confirm in your wallet. If the Review expired, click **Refresh
   simulation for the next step**, then **Accept liquidity review** first.
7. **Restart check:** restart or redeploy the Railway API and worker. The run state persists.
8. Click **Execute: Mint the position NFT** (refresh and accept the Review first if asked), then confirm in your
   wallet. The worker reconciles it, and **Position created** shows the NFT token ID owned by your wallet.
9. Click **Download Evidence Bundle**. Confirm `GET /v1/runs/<id>/evidence` returns `verified: true`, and check the NFT
   owner on BaseScan.
10. Share the approval and mint transaction hashes for independent verification. Only then may the registry row become
    `TESTNET_EXECUTED`.

## Confirmations

- No server-held execution key, executor identity, delegation or automatic owner signing was introduced. No
  credential was requested, printed or committed.
- BUILD-013 (branch, worktree `/home/asus/projects/gryloo/.turbo/build013`, PR #48) and PRs #48–#50 were not touched.
- BUILD-CLOUD-001 deployment work (Neon/Railway/Vercel, credentials) was not touched. The only shared-code changes
  are the extracted owner-submission verifier and the RPC client factory; their behaviour is unchanged and their
  tests pass.
- Historical evidence (BUILD-006/007 `FORK_REPRODUCED`) and its formats were not modified.
