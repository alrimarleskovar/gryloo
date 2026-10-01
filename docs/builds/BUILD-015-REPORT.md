# BUILD-015 — Solana liquidity / Orca Whirlpools report

STATUS: DEVNET_EXECUTED

Work follows [GOVERNANCE-LITE](../SCOPE_GUARD.md): branch `claude/build-015-solana-liquidity` from main `f2b8afa`, one PR (#44), owner merge. Claude signed and broadcast nothing.

On 2026-10-01 the owner executed the complete bounded Orca liquidity lifecycle on **public Solana Devnet** through Gryloo, with their own wallet: open + add, partial removal with fee collection, and exit with close. Each of the three transactions was independently reconciled and produced an Evidence Bundle, and the read-only independent verifier passed **55/55** checks. The status is therefore **`DEVNET_EXECUTED`**.

This was real public Devnet execution with **valueless Devnet test tokens** (Devnet SOL and Orca's devUSDC test token). It is not mainnet execution and involved no real funds; nothing here claims `MAINNET_EXECUTED`. Raydium, mainnet, rebalancing, compounding and composition are not implemented. See the [plan](BUILD-015-PLAN.md).

## DEVNET_EXECUTED acceptance

| Fact | Value |
|---|---|
| Network | Solana Devnet, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (valueless test tokens; `realFunds: false`) |
| Provider / program | Orca Whirlpools `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Pool | `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt` (Devnet SOL / devUSDC, tick spacing 64, fee 0.20%) |
| Owner and position authority | `6Mc7hRBcjoYukC7PNqKUbfS5pHeJwf41bogtUfKuMYQR` |
| Position mint | `DscRyBK8SAH4F5KizzUpv9wd55QFk5cUbK9piNMXvgWv` (Token-2022, position account `F9u8AigVGsENekpd9B5SqF5FKfHspZo8J7jVGFwjV3tB`, owner token account `CvMo3Bw7av9aNpJH8MzxCG53yTFfzXwDuJS29N7MBLeB`) |
| Range | ticks −39104 to −36992 (20.036403–24.747889 devUSDC per SOL), in range throughout (pool tick −38008, price ≈ 22.3575) |
| Authored maxima / slippage | 0.01 Devnet SOL and 0.30 devUSDC / 100 bps; never increased |

### Transactions (each finalized; reconciled by Gryloo and by the independent verifier)

| Step | Transaction | Slot · block time (UTC) | Signers · fee |
|---|---|---|---|
| OPEN (open + add) | [`4NmXs8NoB6KW8jzPesDRZqDcQ26QS4crkF13jN9kNkbPxUf4W8FDitGy3ywaNKBaVTUQM9HcLYLpvJQhvW8LaLJJ`](https://explorer.solana.com/tx/4NmXs8NoB6KW8jzPesDRZqDcQ26QS4crkF13jN9kNkbPxUf4W8FDitGy3ywaNKBaVTUQM9HcLYLpvJQhvW8LaLJJ?cluster=devnet) | 506,426,965 · 2026-10-01T22:32:04Z | owner + one-time position-mint key · 10,000 lamports |
| DECREASE_PARTIAL (5,000 bps + collect) | [`5HQGjFbb1jbwNCEvm2fZM3oKZVQvqQ879Q1vDLumCGJF8RDX5t8KaEmFaXnRhNvvP73uiwzrEKwg88EA3r3oNHPa`](https://explorer.solana.com/tx/5HQGjFbb1jbwNCEvm2fZM3oKZVQvqQ879Q1vDLumCGJF8RDX5t8KaEmFaXnRhNvvP73uiwzrEKwg88EA3r3oNHPa?cluster=devnet) | 506,427,731 · 22:35:04Z | owner · 5,000 lamports |
| EXIT (remove all + collect + close) | [`8MAvfVGXXo6mMcfkuikKnHmTfQ6S37Y5oPh6F7sdVJSNeNSgFZyFsGp1WpoonHHrAPLRWKzaQtq2zgCu1hzfZTV`](https://explorer.solana.com/tx/8MAvfVGXXo6mMcfkuikKnHmTfQ6S37Y5oPh6F7sdVJSNeNSgFZyFsGp1WpoonHHrAPLRWKzaQtq2zgCu1hzfZTV?cluster=devnet) | 506,428,344 · 22:37:28Z | owner · 5,000 lamports |

### Amounts (finalized transaction metadata and Orca events)

**OPEN**
- **Liquidity and deposit:** liquidity 30,193,890. Deposited **0.010000000 Devnet SOL + 0.240772 devUSDC**, exactly equal to the reviewed expected amounts.
- **Bounds:** at most 0.01 SOL and 0.243180 devUSDC, which is the 100 bps bound and below the authored maxima.
- **Accounts and deposits:** created the position, position mint and position token account. Refundable account deposits were 6,075,680 lamports.
- **Balances:**
  - owner SOL 4,898,483,840 → 4,882,398,160 lamports;
  - owner devUSDC 2,231,352 → 1,990,580;
  - pool vaults +10,000,000 lamports and +240,772 devUSDC units.
- **Events:** exactly one `PositionOpened` and one `LiquidityIncreased`. Position authority is the owner, holding the single Token-2022 position token.

**DECREASE_PARTIAL (5,000 bps)**
- **Liquidity:** removed 15,096,945 of 30,193,890; the same amount remained.
- **Principal returned:** **4,999,916 lamports (0.004999916 SOL) + 120,387 devUSDC units (0.120387)**, from the `LiquidityDecreased` event. The reviewed minimums were 4,949,916 and 119,183.
- **Fees collected:** **0 + 0**. The position's share of trading fees in that window rounded to zero, and principal is never counted as fees.
- **Balances:** owner SOL 4,882,398,160 → 4,887,393,076 (+principal − 5,000 fee); devUSDC 1,990,580 → 2,110,967.

**EXIT**
- **Liquidity:** removed the remaining 15,096,945.
- **Principal returned:** **4,999,916 lamports + 120,387 devUSDC units**; minimums 4,949,916 and 119,183.
- **Fees collected:** **0 + 0**.
- **Close:** the position, position mint and position token account were closed, and the full **6,075,680-lamport deposit was refunded**.
- **Balances:** owner SOL 4,887,393,076 → 4,898,463,672; devUSDC 2,110,967 → 2,231,354.
- **After close:** a finalized read at slot 506,429,131 found none of the three accounts.

**Whole lifecycle**
- **Owner SOL:** 4,898,483,840 → 4,898,463,672 lamports, a net change of −20,168. That is −20,000 network fees and −168 lamports of position composition: deposited 10,000,000, withdrawn 9,999,832.
- **Owner devUSDC:** 2,231,352 → 2,231,354, a net change of +2 units: deposited 240,772, withdrawn 240,774.
- **Why the small shift:** the pool price moved slightly upward between the steps (22.357483 → 22.357520), so the position held marginally less SOL and more devUSDC. This is plus Orca's integer rounding in the pool's favour; there is no unexplained movement.

### Recovery and evidence

- **Journals:** each step's journal shows `PREPARED → SUBMITTING → PENDING → CONFIRMED`. The attempt was durable before the wallet was asked, and the signature and signed bytes were durable before the single broadcast. There was no unknown submission and no resubmission.
- **Position registry:** it recorded the position mint before the OPEN signature.
- **Evidence Bundle hashes:**

  | Step | Hash |
  |---|---|
  | OPEN | `0x56b6474742834cb9e4105eb376506512c13c49287ca3931ca6b45d23a8ed7e08` |
  | DECREASE_PARTIAL | `0x7cd44c687d4c054e7ecd7886b932e825be7e3a163c0b31e65af46a8570172238` |
  | EXIT | `0x56a343b0ee23d1b19a89ab9b20620c5e1cd07cdf00b7b9a39877000c407dc2ff` |

  Each records `bundle.environment: TESTNET_EXECUTED`, `publicExecution.environment: DEVNET_EXECUTED`, evidence class `DEVNET_EXECUTED` and `realFunds: false`, and none says `MAINNET_EXECUTED`. This is the frozen v1 enum convention, unchanged from BUILD-DEMO-001.

**Independent verification: VERIFIED (55/55 checks).** `scripts/solana-devnet-liquidity-execution-verification.mjs` is read-only; it refuses `sendTransaction`. The owner ran it on the live journals. For every operation it checks:
- **Cluster and journal:** Devnet genesis; an owner-initiated `PUBLIC_DEVNET` run; the journal binds the ExecutionPlan; message hash = ExecutionPlan payload; durable attempt order.
- **Transaction:** finalized and successful; on-chain bytes = journal signed bytes; on-chain message = reviewed message; transaction id = journal signature.
- **Signatures:** valid Ed25519 signatures from exactly the reviewed signers (owner plus position-mint key for OPEN, owner only otherwise); owner is fee payer, with no lookup tables.
- **Instructions and programs:** the exact instruction list; only allowlisted top-level and inner programs.
- **Orca events:** on the verified pool, position and range, with the reviewed liquidity delta.
- **Evidence:** bundle hash recomputes; honest `DEVNET_EXECUTED` / `realFunds: false` labelling; evidence bound to the signature and position.
- **Second opinion:** Gryloo's reconciler re-run against public Devnet returns `RECONCILED`.

The same 55 checks pass again against the archived copies. Claude re-ran them read-only from a scratch copy of the archive, and the owner's verification file was not modified.

**Archived evidence** is in [`BUILD-015-EVIDENCE/`](BUILD-015-EVIDENCE/). The files are immutable copies listed in `SHA256SUMS` (`sha256sum -c SHA256SUMS` passes):

| Kind | File | SHA-256 |
|---|---|---|
| Journal, OPEN | `execution-journal-open.jsonl` | `9a5be2776587b17b32c8acf6e435d8cc6daa1213c6a05f1748699dffeeae12ee` |
| Journal, DECREASE_PARTIAL | `execution-journal-decrease-partial.jsonl` | `454859bb8850d8671e03c090e23fe92a1e42fbdfca10c0fd1e17d4477deccb1e` |
| Journal, EXIT | `execution-journal-exit.jsonl` | `c6e85608357a8246cc9287dfe307c968ae83c3188347164c3cd8cf152d7b55bf` |
| Position registry | `position-registry.orcalp-positions` | `064118d8e17289a2768dde603fa063490c7798ef083efe7e867145da9632c2aa` |
| Owner lease history | `owner-lease.orcalp-lease` | `b7b71385509d5fe7face81090f7984b2d87905e6d4bdfcf842b70182c8ec962f` |
| Finalized `getTransaction`, OPEN | `devnet-transaction-open.json` | `05e7c20ee92ceba4ae7aed96b2e27f690e8e92d4ecc992ae208ef82388055198` |
| Finalized `getTransaction`, DECREASE_PARTIAL | `devnet-transaction-decrease-partial.json` | `4f597913fc10c4eb3a0c9be8c89fd1db40fd2ac6da9c27384f135c19d88b3b29` |
| Finalized `getTransaction`, EXIT | `devnet-transaction-exit.json` | `2661f64207fc17ed1035e41afb6cecf97d2618d265b4ad834cd9fbc5b4b7b027` |
| Evidence Bundle, OPEN | `evidence-bundle-open.json` | `9cf873dafc6b4d577ebaec9a5235b29d4923b2bac95b8c5172755a2589ebfe16` |
| Evidence Bundle, DECREASE_PARTIAL | `evidence-bundle-decrease-partial.json` | `be3556a7533f2899fa06b03e1b0e57ee046410c7564bc2be86be91b22e7f2bd8` |
| Evidence Bundle, EXIT | `evidence-bundle-exit.json` | `f089639d0635b2c8d8da787562930864ede4e0e4bc5ca70948583f0f321f3309` |
| Independent verification | `independent-verification.json` | `77dd7d04d5d10907082aa518fd7a45c48c2b0cf5ee3d19dec873862910a94cda` |
| Post-lifecycle state | `post-lifecycle-position-state.json` | `b56740e1a5a2bfe6d803a046f34a6b41bb839e8b0cdda6e72ff587fef09820ac` |

Notes on the archive:
- The owner's verifier output was preserved byte for byte.
- The journals are byte copies of `~/.gryloo/build-015-devnet` and contain no key material.
- Each Evidence Bundle file is the run's `evidence` record, serialized as the UI's "Download Evidence Bundle" link serializes it; its `bundleHash` recomputes.
- The post-lifecycle state is a `PUBLIC_READ_ONLY` finalized read confirming the three position accounts are closed.

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

## Pre-execution owner profile (`PUBLIC_READ_ONLY` validation)

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

Fixtures and the loopback harness are `MOCKED`, and the pre-execution Devnet reads and simulations are `PUBLIC_READ_ONLY`. Neither is `DEVNET_EXECUTED`; only the owner-executed lifecycle above is.

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

## Owner execution (completed 2026-10-01; recorded above)

Claude did not sign or send any public transaction. The owner ran the lifecycle in Gryloo with these steps.

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
7. **Hand back (done).** The owner ran the read-only verifier (55/55), and Claude then:
   - archived the journals, the finalized transactions and the Evidence Bundles with `SHA256SUMS`;
   - re-verified the archived copies (55/55);
   - recorded `DEVNET_EXECUTED` above.

   All three operations executed and reconciled.
