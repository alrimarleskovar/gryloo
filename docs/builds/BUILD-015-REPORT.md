# BUILD-015 — Solana liquidity / Orca Whirlpools report

STATUS: READY_FOR_OWNER_EXECUTION

Work follows [GOVERNANCE-LITE](../SCOPE_GUARD.md): branch `claude/build-015-solana-liquidity` from main `f2b8afa`, one PR, owner merge. Nothing was signed or broadcast during implementation. All execution evidence so far is `MOCKED` (unit and loopback browser tests) or `PUBLIC_READ_ONLY` (Devnet reads and simulations). `DEVNET_EXECUTED` requires the owner to execute the lifecycle through Gryloo with their own wallet; see [Owner execution](#owner-execution-ready_for_owner_execution). Raydium, mainnet, rebalancing, compounding and composition are not implemented. See the [plan](BUILD-015-PLAN.md).

## Outcome

The canonical **`asset.liquidity.concentrated`** intent now runs Build → Simulate → Review → Execute → Result on **Solana Devnet** through **Orca Whirlpools**, for the Devnet SOL / devUSDC test pool used by BUILD-DEMO-001. The bounded lifecycle is: open + add, inspect, partial removal with fee collection, then exit with full removal, fee collection and position close. Each step is one exact, reviewed, owner-signed transaction, with durable journals, signature-first recovery, independent reconciliation and Evidence Bundles.

## Semantic IR (one liquidity intent)

- **Neutral action.** `workflow-contracts/liquidity.ts` adds `asset.liquidity.concentrated`. It has the BUILD-006 port names and output (`amount0/1-max`, `amount0/1-min`, `tick-lower/upper`, `fee-tier`, `position-nft`) and capability `liquidity.position-direct`, plus a `MAXIMUM_SLIPPAGE_BPS` constraint. The position recipient is the executing owner, bound at Review, so the wallet stays session state and never enters the IR.
- **BUILD-006 unchanged.** `readConcentratedLiquidity` reads both spellings. `asset.liquidity.uniswap-v3` stays byte-identical, because accepted BUILD-006/007/011C evidence and fixtures bind it. EVM authoring, linting and execution are untouched.
- **Runtime resolution.** `orca-whirlpools` on Solana Devnet resolves to the new capability row `orca.whirlpools-devnet-liquidity` (`PUBLIC_TESTNET`, no demonstrated evidence ceiling). The neutral action on any other chain or provider fails closed: `LIQUIDITY_RUNTIME_UNSUPPORTED`, `SOLANA_CLUSTER_UNSUPPORTED`, `SOLANA_LIQUIDITY_PROVIDER_UNSUPPORTED` (including Raydium) or `SOLANA_LIQUIDITY_POOL_UNSUPPORTED`.
- **Authoring parity.** Chat ("Add liquidity 0.01 SOL and 0.30 devUSDC from 20.12 to 24.59 devUSDC per SOL on Solana Devnet [slippage N bps]", or `ticks A to B`) and the canvas form (Advanced action setup → Liquidity position → Network Solana Devnet) produce byte-identical IR. Price ranges are aligned to tick spacing 64 with integer math only: the lower bound rounds down and the upper bound rounds up, so the aligned range always contains the requested one. The canvas offers "Use ±10% around the current Devnet price", a read-only pool read.

## Verified Orca facts (2026-10-01)

| Fact | Verification |
|---|---|
| Program `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | Executable on Devnet. Last deploy slot 439,560,432 (block time 2026-02-03T08:35Z). |
| Source | orca-so/whirlpools `e5f089bc5c49b01f5c8abb43c78457ab6c440568`, the last program commit before that deploy. Later `main` commits (for example the 2026-09 rent-reduction changes) are not deployed and were not used. |
| Instructions | `open_position_with_token_extensions` `d42f5f5c726683fa`, `increase_liquidity_v2` `851d59df45eeb00a`, `decrease_liquidity_v2` `3a7fbc3e4f52c460`, `collect_fees_v2` `cf755fbfe5b4e20f`, `close_position_with_token_extensions` `01b6873b9b1963df`. Each one was accepted by the deployed program in read-only simulation. |
| Events | `PositionOpened` `edaff3e6…`, `LiquidityIncreased` `1e0790b5…`, `LiquidityDecreased` `a6012447…`, seen in Devnet simulation logs. |
| Position and signer model | The position PDA is `["position", mint]`. The NFT is Token-2022 and held in the owner's ATA. The new mint keypair signs only the mint's account creation: mint, freeze and close authority go to the position PDA, and the mint authority is removed after the single mint. The position authority is the owner of the position token account (the wallet). |
| Remove and collect | `decrease_liquidity_v2` pays principal directly to the owner and emits `LiquidityDecreased`. `collect_fees_v2` transfers only `fee_owed` and emits no event. |
| Close | Requires zero liquidity, fees and rewards. Burns the NFT and closes the position, mint and token account, refunding all rent. |
| Pool `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt` | Config `FcrweF…`, SOL / devUSDC, tick spacing 64, fee 2000 (0.20%), no reward emitters. The range's tick array `7knZZ461…` (start −39424) is an initialized fixed-size `TickArray`. |

The existing pool supports the full lifecycle. **No blocker.**

## Owner execution profile (`PUBLIC_READ_ONLY` validation)

`node scripts/solana-devnet-liquidity-readonly-validation.mjs <owner>` uses a transport that refuses `sendTransaction`; its output is [BUILD-015-DEVNET-READONLY.json](BUILD-015-DEVNET-READONLY.json). It was run with the owner's public BUILD-DEMO-001 address as the hypothetical fee payer, with signature verification off. Nothing was signed or sent.

- Pool price ≈ 22.36 devUSDC per SOL, tick −38008. The ±10% band (20.121668–24.593150) aligns outward to ticks **−39104 / −36992** (20.036403–24.747889), in range.
- At maxima 0.01 SOL and 0.30 devUSDC, SOL is the binding side. Expected deposit is **0.010000000 SOL + 0.240757 devUSDC**, liquidity **30,192,888**.
  - Token bounds at 100 bps slippage are 0.01 SOL and 0.243165 devUSDC, never above the maxima, which are not increased.
  - The deployed program's simulated deposit equals Gryloo's independent integer math exactly.
- OPEN costs:
  - fee 10,000 lamports (two signatures);
  - refundable deposits of 6,075,680 lamports (position, mint and position token account);
  - 825-byte message, about 85k compute units.
- A composite read-only message (open → increase → decrease all → collect → close) succeeded. All three accounts closed, and the owner's net SOL change was −10,001 lamports: only the fee plus 1 lamport of rounding.

## Implementation

- **Profile (`action-registry/orca-liquidity-devnet.ts`).** Program, config, pool, mints, Token-2022, metadata authority, discriminators, fee tier, tick bounds, slippage cap (300 bps) and review TTL (60 s), with the reviewed source commit.
- **Linter (`solana-liquidity.ts`).** One isolated node with exact mints in pool order, provider, fee tier, ticks aligned to 64 and within ±443,636, caps, slippage 1–300 bps and no recipient. It must be byte-equivalent to the canonical construction. Lint finding: `SOLANA_LIQUIDITY_SIMULATION_REQUIRED`.
- **Compiler (`orca-liquidity.ts`).**
  - Math: bit-identical `sqrt_price_from_tick_index` and an exact inverse, `get_amount_delta_a/b` rounding, and the program's below/in/above-range branch (which uses the tick index). Maximal liquidity within both maxima; integer price → tick alignment.
  - Codec: instruction encode/decode and event parsing.
  - Reads: pool, position and Token-2022 position account.
  - Simulation is read-only and fails closed on:
    - a wrong cluster, a pool mismatch, a changed fee tier or reward emitters;
    - uninitialized or dynamic tick arrays;
    - a pre-existing wrapped-SOL account;
    - insufficient devUSDC;
    - zero liquidity, or a deposit below the authored minimum;
    - wrong position authority, a range mismatch, or a position mint that is unknown or already in use.
  - Simulation also requires that the program's simulated amounts equal Gryloo's math (`ORCA_LIQUIDITY_MATH_MISMATCH`). It builds the frozen v1 artifact chain (ArtifactSet, SimulationBundle, Policy, Manifest, ExecutionPlan) per operation.
- **Codec addition (`solana.ts`).** `serializeSignedTransaction` for multi-signer wire transactions. The single-signer helpers are unchanged.
- **Executor (`orca-liquidity.ts`).** A run per operation (`orcalp-<id>`) with the same attempt states and rules as the canonical Solana swap: `PREPARED` before the wallet is asked, `SUBMITTING` with signature and signed bytes before the single broadcast, unknown results only observed, and no resubmission path.
- **Reconciler (`orca-liquidity.ts`).** Independent, from finalized transaction facts only. It requires:
  - the Devnet genesis, and on-chain bytes identical to the signed reviewed bytes;
  - Ed25519 signatures from exactly the reviewed signers, and no lookup tables;
  - an instruction list equal to the Review;
  - top-level programs ⊆ {ComputeBudget, ATA, System, Token, Whirlpools} and inner programs ⊆ {Token, Token-2022, System, ATA};
  - exactly the planned Orca events on the verified pool, position and range, with the reviewed liquidity delta;
  - token maxima respected and withdrawal minimums met;
  - the position token held by the owner (amount 1);
  - owner, vault and position lamport/token deltas that each balance exactly, with the closed accounts at zero after EXIT;
  - no other token account and no other lamport balance changed.

  Principal comes only from `LiquidityDecreased`. Collected fees are the vault outflow beyond principal, so **principal is never counted as fees**. A mismatch is `DIVERGENT`; a provider gap is `INCONCLUSIVE`.
- **Evidence.**
  - Classes are `MOCKED`, `PUBLIC_READ_ONLY` and `DEVNET_EXECUTED`; `DEVNET_EXECUTED` only for an owner-initiated, reconciled Devnet run.
  - The bundle's `publicExecution` records the operation, pool, position, authority, range, bounds, deposits, principal, fees, deposits paid and refunded, events, programs, signature, slot, fee and the position's lifecycle so far.
  - The frozen v1 enum has no Devnet member, so `bundle.environment` is `TESTNET_EXECUTED`, `realFunds: false`, never `MAINNET_EXECUTED` (the BUILD-DEMO-001 convention).
- **DApp.**
  - Service (`orca-liquidity-service.ts`):
    - append-only journals, plus a per-owner lease allowing one unresolved attempt at a time;
    - a per-owner position registry written when an OPEN attempt is prepared, so position identity survives restart before any signature exists;
    - one Gryloo position per owner on this pool: a new OPEN is refused while a position exists or an OPEN is unresolved, so recovery always targets the real position.
  - Server actions with the same harness and RPC switches as the Devnet swap (`GRYLOO_SOLANA_DEVNET_JOURNAL`, `GRYLOO_SOLANA_DEVNET_RPC_URL`, `GRYLOO_SOLANA_DEVNET_EXECUTION=DISABLED`).
  - Store, panel, form, canvas card and inspector, chat, proposal summary, capability environment and stage navigation.
  - The Wallet Standard session is shared with the Solana swap (one wallet experience). `connect(chain)` lets the liquidity flow ask for `solana:devnet` explicitly.
- **Position-mint key (`wallet/position-mint-signer.ts`).**
  - A non-extractable WebCrypto Ed25519 key, created per OPEN simulation and signing once.
  - Only its public key is sent to the server; it is never persisted, uploaded or logged.
  - The wallet signs first. If the returned message differs from the Review by one byte, the key does not sign and nothing is sent.
  - A reload loses the key, so the prepared OPEN is refused (`ORCA_LIQUIDITY_POSITION_KEY_UNAVAILABLE`) and observed as not submitted.
  - After creation the key has no authority, as verified in the program source above.

## Simulation disclosure (UI, read-only)

The Simulate view shows:
- **Network and venue:** Solana Devnet with its genesis, the Orca Whirlpools program, the pool and config, and both mints.
- **Pool state:** price, current tick, tick spacing, fee and slot.
- **Range:** in prices and aligned ticks, with its status (below, in or above range).
- **Amounts:** maxima; expected contribution and liquidity, or principal and fees for removals; slippage bounds; expected residuals; owner balances.
- **Accounts:** all token and position accounts, and those that may be created.
- **Costs:** estimated network fee (by signature count) and refundable deposits.
- **Execution:** invoked programs, the transaction count (one per step, three in the lifecycle) and review freshness.

Nothing simulated is presented as executed. Technical JSON stays collapsed.

## Review binding

The Review commitment covers the exact compiled message and its hash, the signer list (owner and, for OPEN, the position mint) and the unsigned transaction. It also covers the blockhash and last valid block height, the pool snapshot (price, tick, slot), the operation plan (liquidity delta and token bounds), the accounts and the instruction summary. Finally it covers the semantic intent (cluster, mints, ticks, maxima, minima, slippage, fee tier) and the frozen v1 artifacts.

`assertOrcaLiquidityReview` fails closed on any of these:
- **Validity:** the commitment changed, the workflow hash changed, the owner differs, the review is older than 60 s, or the blockhash is within 20 blocks of expiry.
- **Bytes:** the message hash or unsigned bytes differ, or the signer list differs.
- **Rebuild:** a re-derived instruction round-trip differs. A forged message with every hash recomputed is still rejected.

`verifySignedOrcaLiquidityTransaction` requires the exact reviewed message with valid signatures from every reviewed signer.

## Validation (local, 2026-10-01)

Fixtures and the loopback harness are `MOCKED`; Devnet reads and simulations are `PUBLIC_READ_ONLY`. Neither is `DEVNET_EXECUTED`.

- **`pnpm check`:** PASS. Typecheck, lint, production build, schema drift (no schema change) and **877 unit tests** passed; the 2 pre-existing opt-in skips are not counted as passes. BUILD-DEMO-001 recorded 747 on its baseline.
- **New BUILD-015 unit tests (65):**
  - **contracts (4):** IR round trip; BUILD-006 bytes unchanged and readable; field and port rejections.
  - **linter (17):** valid profile and capability; unknown cluster; EVM chain on the neutral action; mainnet USDC on Devnet; reversed tokens; decimals; Uniswap and Raydium providers; another fee tier (invalid pool); unaligned and out-of-bound ticks; excessive SOL and devUSDC; slippage bounds; foreign position asset; tampered declaration; composition.
  - **compiler (15):**
    - math: program bounds and inverse, and **real Devnet `PUBLIC_READ_ONLY` fixture parity**, where Gryloo's math reproduces the program's own increase/decrease amounts; deterministic alignment and boundary rounding; below/in/above range, maximality and rounding; codec;
    - Review and signatures: Review binding including a forged self-consistent message; exact-signature verification (missing, wrong or foreign signer, changed message);
    - simulation guards: wrong cluster, pool config, fee tier, rewards, uninitialized tick arrays, zero liquidity, below minimum; wrong position authority and range mismatch.
  - **executor (1):** run model and corruption checks.
  - **reconciler (11):** open, partial and exit reconciliation with principal/fee separation. Fail-closed cases:
    - an unexpected inner program;
    - unexplained token or lamport movement;
    - an owner balance that disagrees with the events;
    - different on-chain bytes;
    - a fee above Review;
    - a missing event;
    - a foreign position authority;
    - finality gaps, a failed transaction, the wrong cluster.

    Evidence classification produces a schema-valid bundle that never says `MAINNET_EXECUTED`.
  - **service (9):**
    - Lifecycle and recovery:
      - two OPEN reviews prepared in parallel never create two positions (re-checked under the owner lock at Execute);
      - the full open → partial removal (fees collected) → exit lifecycle with the post-execution verifier;
      - no second position while one exists;
      - partial-lifecycle recovery after an on-chain failure;
      - restart before submission, restart after submission, and confirmed-before-restart.
    - Signing and Review integrity: wallet-modified bytes, a missing or wrong position signature, a foreign wallet; stale, semantic-edit and tamper rejection.
    - Submission outcomes: ambiguous submission (observe only), dropped (expires as not executed), duplicate Execute; a price move beyond the slippage bound failing on chain.
    - Authorization boundary: unknown positions; public provenance staying `PUBLIC_READ_ONLY`; execution disabled by the server.
  - **authoring (4)** and **position-mint key (3):** chat/canvas parity; inspector round trip; rejections; the key is non-extractable and single-use; wallet-first ordering; changed bytes are never signed by the mint key.
- **Existing suites:** all pass unchanged, including the BUILD-006 Uniswap liquidity units, the BUILD-014 Jupiter, BUILD-DEMO-001 Devnet swap, BUILD-012A/B Aave Supply/Borrow, and the cross-chain and composition suites.
- **Browser, MOCKED loopback:**
  - **BUILD-015 Solana liquidity: 5/5.**
    - Canvas authoring with the ±10% helper.
    - Full disclosure.
    - Review, then Execute with the wallet asked for `solana:devnet`, then a Success result.
    - Partial removal showing collected fees, then exit with the position closed: three signatures and three broadcasts.
    - Chat parity with no wallet request.
    - Wallet rejection.
    - Wallet-changed bytes are never sent.
    - After a reload, Execute is refused before any wallet request.
  - Devnet swap 8/8, Jupiter 9/9, Aave Supply/Borrow 27/27, main CI group 44 passed with the 4 pre-existing opt-in skips, and Mode A 9 passed.
- **Local browser environment notes:**
  - **Libraries.** This machine lacks the headless shell's runtime libraries (`libnspr4`, `libnss3`, `libasound2`) and has no passwordless sudo. The official Ubuntu packages were fetched with `apt-get download`, extracted under `/tmp/gryloo-b015-browser-libs`, and used only via `LD_LIBRARY_PATH` for these runs. Nothing in the repository or system changed.
  - **Visual baselines.** 11 zero-pixel screenshot baselines fail locally: 7 in the main group and 4 in Mode A. They fail **identically on the untouched baseline commit `f2b8afa`** in this environment, with the same pixel counts, and this branch's visual-shell screenshots are byte-identical to the baseline's. They are local font rendering, not this change; CI renders them on its own runner. No baseline image was changed.
- **CI:** `.github/workflows/contracts.yml` adds `solana-liquidity.spec.ts` on the MOCKED loopback (`GRYLOO_SOLANA_DEVNET_E2E=MOCKED_LOOPBACK_ONLY`). All other gates are unchanged.
- **Governance-Lite and its 17 self-tests:** PASS. `git diff --check`: PASS. No dependency, lockfile or toolchain change.

## Intentional changes for owner review

- **Neutral liquidity action.** Additive, and EVM remains on the BUILD-006 spelling. Moving EVM authoring to the neutral id would change accepted evidence hashes, so it is left for a separate owner decision.
- **Mocked wallet (test helper).** `createMockedSolanaWallet().sign` now preserves other signer slots for multi-signer transactions, like a real Wallet Standard wallet. Single-signer output is byte-identical.
- **Orca mock extended.** The MOCKED loopback interprets the five position instructions, Token-2022 position accounts, multi-signer verification, and test knobs for fees, failure and price moves. Existing swap behaviour and tests are unchanged.
- **Shared Solana wallet session.** The Jupiter store exposes `session` and accepts `connect(chain)`; the swap flow calls it exactly as before.
- **Bounded policy choices:**
  - one Gryloo position per owner on this pool;
  - `with_token_metadata = false` (fewer accounts; all rent is refundable either way; some wallets will not show the NFT by name);
  - pools with reward emitters, dynamic tick arrays and uninitialized tick arrays fail closed rather than being handled;
  - OPEN minimums default to 0. On-chain protection is fixed liquidity plus slipped token maxima capped by the authored maxima, and a below-minimum expected deposit fails at simulation.
- **Read-only fixture.** `packages/reference-compiler/test/fixtures/orca-devnet-liquidity.json` holds one real Devnet pool account and simulation log, committed only as a `PUBLIC_READ_ONLY` parser and math fixture.
- **New scripts:**
  - `scripts/solana-devnet-liquidity-readonly-validation.mjs` (`PUBLIC_READ_ONLY`);
  - `scripts/solana-devnet-liquidity-execution-verification.mjs` (post-execution, read-only, refuses `sendTransaction`; exercised in unit tests on a MOCKED journal).

## Owner execution (READY_FOR_OWNER_EXECUTION)

Claude did not, and will not, sign or send any public transaction. To produce `DEVNET_EXECUTED`, the owner runs the lifecycle in Gryloo.

1. **Wallet.**
   - Use the BUILD-DEMO-001 Devnet wallet, or any Wallet Standard wallet on Solana Devnet. Solflare worked in BUILD-DEMO-001.
   - It needs at least about 0.02 Devnet SOL and at least 0.25 devUSDC. The BUILD-DEMO-001 owner address currently holds about 4.898 SOL and 2.231 devUSDC. If needed, use [faucet.solana.com](https://faucet.solana.com) and a Gryloo SOL → devUSDC Devnet swap.
   - A wallet that rewrites the transaction (for example by adding instructions) is refused by Gryloo with no broadcast. If that happens, use a wallet that signs the exact bytes.
2. **Start the app.** From this branch:
   ```
   pnpm install --frozen-lockfile && pnpm build
   GRYLOO_SOLANA_DEVNET_JOURNAL=/absolute/dir/outside/git pnpm --filter @defi-workflow-engine/reference-dapp start
   ```
   Optionally set `GRYLOO_SOLANA_DEVNET_RPC_URL=https://…`.
3. **Build.**
   - Canvas: Advanced action setup → Liquidity position → Network **Solana Devnet** → Maximum SOL `0.01`, Maximum devUSDC `0.30` → **Use ±10% around the current Devnet price** → slippage `100` → Review position proposal → Apply proposal.
   - Or chat: "Add liquidity 0.01 SOL and 0.30 devUSDC from LOWER to UPPER devUSDC per SOL on Solana Devnet".
4. **Open.**
   1. Continue to Simulate → Connect Solana wallet → choose your wallet by name.
   2. Operation: Open position and add liquidity → **Simulate position**, and check the disclosure.
   3. **Review position** → **Accept liquidity review** → **Execute position**.
   4. Sign **one** transaction in the wallet within 60 seconds of simulating, and **do not reload the tab** between Simulate and Execute (the one-time position key lives only in that tab).
   5. Wait for **Success**, then download the Evidence Bundle.
5. **Partial removal.** Back to simulation → Operation: Partially remove liquidity and collect fees (portion `5000` bps) → Simulate removal → Review position → Accept → **Execute removal** → sign → Success.
6. **Exit.** Back to simulation → Operation: Remove all liquidity, collect fees and close the position → Simulate removal → Review position → Accept → **Execute removal** → sign → Success. The position list then shows the position as closed.
7. **Hand back.** Tell Claude the journal directory and the owner address. Claude will then:
   - run `node scripts/solana-devnet-liquidity-execution-verification.mjs <journalDir> <owner> docs/builds/BUILD-015-EVIDENCE/independent-verification.json` (read-only);
   - archive the journals, the finalized transactions and the Evidence Bundles with `SHA256SUMS`;
   - only then record `DEVNET_EXECUTED`.

   If only part of the lifecycle executes, the report records exactly which operations were executed and reconciled.
