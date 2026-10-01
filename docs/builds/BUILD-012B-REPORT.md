# BUILD-012B — Aave V3 Borrow

STATUS: TESTNET_EXECUTED

Branch `codex/build-012b-aave-borrow`, baseline main `7726970` after BUILD-012A and GOVERNANCE-LITE. One PR; human owner merge only. No other worktree inspected or modified.

## Current authority and public state

Verified on 2026-10-01 before implementation using the current [Aave DAO Base Sepolia address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3BaseSepolia.sol), [official Pool documentation](https://aave.com/docs/aave-v3/smart-contracts/pool), and [current IPool interface](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/interfaces/IPool.sol). Live reads through the public Base Sepolia RPC bound chain 84532, Provider.getPool(), Provider.getPriceOracle(), reserve data, decimals, oracle price, balances, variable debt and owner collateral configuration to one block.

Pool `0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27`; provider `0xe4c23309117aa30342bfaae6c95c6478e0a4ad00`; oracle `0x943b0de18d4abf4ef02a85912f8fc07684c141df`. Selected USDC `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f`, 6 decimals, aToken `0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc`, variable debt token `0xfb3e85601b7feb3691bbb8779ef0e1069e347204`. This is the Aave reserve token.

The initial read-only market scan at block 47551528 found USDC, USDT, WETH, cbETH and LINK borrow-enabled; WBTC borrowing disabled. All six reserves were active, unfrozen and unpaused. USDC has no borrow cap and ample liquidity. Selection happened after these reads: 0.01 USDC (10,000 native units), variable mode 2, borrower/onBehalfOf equal to the owner. This practical demonstration amount avoids economically insignificant single-unit index rounding and consumes about 1.2% of the existing available capacity.

Owner `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b`: 0.999999 USDC aToken balance from the earlier nominal 1-USDC Supply, collateral enabled, eMode 0, zero debt, health factor uint256.max (no debt). Collateral $0.999959, LTV 82.5%, liquidation threshold 86%, available borrow $0.82496617. No new collateral-enabling action is added.

Exact public `eth_call` and `eth_estimateGas` passed at block 47552322 with zero wallet USDC and zero debt. Expected post-Borrow debt value $0.00999960, health factor 85.999913996559862394. Gas limit with existing 50% margin 374936, fee ceiling 12000000 wei, budget including existing reserve 14499232000000 wei. Owner native balance 99773024516581 wei is sufficient. No simulation, verification script or agent action signed or submitted a public transaction. These snapshots are read-only observations, never execution acceptance evidence.

## Borrow safety and reuse

The canonical `borrow` action carries chain, asset, amount, beneficiary/onBehalfOf and variable interest-rate mode 2 under `aave-v3`. Chat and Canvas share the same reducer and semantic revision. Runtime capability limits this build to the verified USDC Base Sepolia profile; the IR has no testnet action alias. Self-borrow is required; delegated third-party credit, collateral changes, Repay and Withdraw are absent.

The BUILD-012A compiler artifacts, injected wallet, durable journal, file persistence, pre-submission diagnostics, provider-managed nonce, transaction discovery, EIP-7702 owner signature/enforcer verification, and Evidence Bundle schema are reused. Existing internal Supply service/run names are retained for compatibility. Borrow has one `BORROW` attempt and one exact `Pool.borrow(asset, amount, 2, 0, owner)` call, with no approval.

There was no existing product health-factor floor. BUILD-012B explicitly sets a conservative minimum of **2.0**, in addition to protocol reserve, liquidity, borrow-cap and account-capacity constraints. Health factors use bigint arithmetic; zero debt is represented as infinity. Borrow value rounds upward for conservative preview. eMode and multi-reserve user configurations outside this narrow verified profile fail closed. State inputs and account capacity/health-factor consistency are validated.

Simulation is read-only. Review, Execute preparation and final wallet handoff read fresh public collateral, debt, capacity, health factor, reserve configuration, price and liquidity. Review expires after 120 seconds. Configuration, owner, beneficiary, workflow/revision, calldata, amount and mode bind exactly. Price/account/debt/health drift above 0.1% (plus bounded integer rounding where needed) invalidates Review; smaller drift must still pass the same minimum health factor and protocol constraints. Borrow-specific economic leases bind the exact owner/chain/Pool/calldata independently of workflow IDs, revisions or nonces. The same uncertain economic call cannot be re-authored under changed metadata or another nonce; a focused regression reproduces and blocks that bypass. Uncertain submissions remain observation-only. Only positively known pre-submission refusal/cancellation can prepare a fresh Review for the exact original intent and nonce; that action cannot submit.

Reconciliation independently reads the canonical transaction, receipt, Borrow and underlying Transfer events and historical pre/post chain state. Direct transactions and owner-authorized wrapped calls share the existing secure envelope model. Wallet token delta must equal the requested amount. Variable debt scaled principal must match within the existing ray-index rounding bound; nominal debt, aggregate Aave debt, capacity and post-health factor must also agree. Collateral/configuration inconsistency, token effects without debt, debt without token receipt, wrong semantics and unsafe post-health factor fail closed. Receipt success or an event alone cannot produce evidence.

The Evidence Bundle records debt, balances, pre/post risk, exact event, owner, beneficiary, Pool, asset, amount, mode, transaction envelope, hash/block, gas/cost and explorer metadata. The owner’s actual completed wrapped Supply was independently reconciled again before handoff: transaction `0x717f81f6c360d7f62c64a13d258a513cf003e76ae3c2c1318dd00d3115cf5f0a`, owner nonce 4 before and after. Borrow may append to that permanent nonce lease only after fresh independent proof that the preceding wrapped action completed; the previous economic identity is retained. Uncertain or unverified actions never release the nonce lease. This is covered by a signed wrapped-Supply → Borrow → known-pre-submission-refusal recovery test. MOCKED fixtures remain MOCKED. Only a real public owner execution followed by reconciliation can become TESTNET_EXECUTED. The completed owner execution and independent reconciliation now satisfy that acceptance requirement.

## Validation and delivery

Final local current-code checks passed: `pnpm check` (typecheck, lint, production build, 11 schema exports; 701 tests passing, 2 existing optional cases skipped), Governance-Lite and 17 self-tests, registry integrity/license/release-age verification for all 247 dependencies, dependency audit (no known vulnerabilities), current Contracts-workflow CycloneDX validation (247 components and all eight workspace manifests), and whitespace checks. Normal pinned-Anvil compatibility gate: 4 passing, 10 owner-only cases skipped. Normal fork suite: 31 passing, 29 existing environment/owner-dependent cases skipped. No skipped case is claimed as execution proof.

Focused browser checks: **41 passing**, including all 9 Borrow cases, all 18 existing Supply/recovery cases, Canvas UX and execution-capability regression. Screenshots visually inspected; no browser page errors in the canonical Borrow flow. The pinned BUILD-012A Chromium libraries/fonts were reused. Earlier sandbox DNS/bind failures and the Next TypeScript subprocess crash were rerun outside the sandbox without modifying product gates. A new browser test timing race and Borrow diagnostic classification issue were corrected before this final passing run.

The running public Gryloo UI also completed Chat → Build → Borrow → read-only Simulate with the real owner’s position and **zero wallet requests**, no Review authorization and no execution attempt. At block **47553742**, collateral aToken balance is now 1.000000 USDC, collateral value $0.99996000, available borrow $0.82496700, debt zero, health factor infinity; estimated debt after 0.01-USDC Borrow is $0.00999960 and expected health factor **86.0**. Reserve/price/debt reads and exact `eth_call`/`eth_estimateGas` succeeded through the actual server action. The journal remains the existing public-testnet journal. `BUILD-012B-PRESTATE.json` includes the initial full-market scan and this later read-only preview; neither is acceptance evidence.

Canvas/template tests now exercise Lending where they previously treated Borrow as a mock template; every template manipulation/selection/drag/undo/network-isolation assertion remains. The toolbox test additionally verifies that Borrow opens real setup. New Borrow browser cases exercise the canonical journey, provider-managed nonce, lost-response reload, refusal, pre-submission failure, wrong owner/chain, stale public state, semantic edits and unsafe simulation. CI includes these cases in the existing closed loopback Aave harness.

The owner completed real public execution through Gryloo; acceptance is TESTNET_EXECUTED. No merge and no BUILD-012C.

## Real public owner execution and final acceptance

**STATUS: TESTNET_EXECUTED.** The owner completed Build → Borrow → Simulate → Review → Execute in Gryloo and explicitly confirmed through the injected wallet. The durable run is `supply-42735495268f9346de0236f0cae74606`: PUBLIC_TESTNET, ownerInitiated true, one BORROW attempt, CONFIRMED and RECONCILED. The recorded wallet request omits application nonce, contains the exact reviewed Borrow payload, and returns the transaction below. No agent signed or submitted a public transaction; acceptance was not a CLI, mock or fork execution.

Transaction: [`0x37a5648235efc91f32d3f1400ccc5529b27e34c7e46dd7547bde493e8667f7f4`](https://sepolia.basescan.org/tx/0x37a5648235efc91f32d3f1400ccc5529b27e34c7e46dd7547bde493e8667f7f4).

Independent fresh read-only reconciliation reran against live public Base Sepolia and historical blocks 47555222/47555223. Current official Aave address-book contents were fetched again and match all configured Pool/provider/oracle/asset/aToken/variable-debt addresses. Eighty read-only RPC requests verified chain, canonical transaction/receipt/block, debt/balances/risk, deployment and historical owner nonces. The direct signed EIP-1559 wire transaction was reconstructed and its keccak hash matched the public transaction hash; recovering its signature yielded the exact owner. No EIP-7702 envelope is present on this Borrow (the earlier Supply was wrapped). Historical owner nonce advances 4 → 5.

| Acceptance field | Independently verified value |
|---|---|
| Network / chain | Base Sepolia / 84532 |
| Owner / beneficiary / onBehalfOf | `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b` |
| Pool | `0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27` |
| Asset | USDC `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f`, 6 decimals |
| Call | `borrow(asset, 10000, 2, 0, owner)`, selector `0xa415bcad` |
| Interest-rate mode / referral code | 2 variable / 0 |
| Authorization / receipt | Direct owner signature recovered; receipt status 1 |
| Block | 47555223, transaction index 16 |
| Block hash | `0x96722d345f87a9c006d8924c30683576ddec5d0bedfaeb03f2082b635a8aa064` |
| Borrow event | Exact reserve/user/onBehalfOf/amount/mode/referral match; log index 73 |
| Underlying Transfer | aToken → owner, exactly 10000 raw USDC |
| Collateral pre / post | 1.000000 USDC aToken; $0.99996000; enabled |
| Available borrow pre / post | $0.82496700 → $0.81496640 |
| Wallet pre / post / delta | 0 → 10000; +10000 raw (0.01 USDC) |
| Variable debt pre / post / delta | 0 → 10001; +10001 raw (0.010001 USDC) |
| Scaled variable debt pre / post | 0 → 7714 |
| Normalized principal | 10000 raw; verified within protocol ray/index rounding bound |
| Health factor pre / post | ∞ (no debt) → 85.991400515969041857 |
| Expected Review health factor | 86.0; realized value remains safely above minimum 2.0 |
| LTV / liquidation threshold | 82.5% / 86%, unchanged |
| Gas used | 240114 |
| Transaction cost | 2888256462038 wei = 0.000002888256462038 ETH, including L1 fee |
| Final verdict | RECONCILED — BORROW_TRANSACTION_DEBT_BALANCE_AND_HEALTH_VERIFIED |

The variable-debt Mint/Transfer event itself records 10001 raw. The one-unit difference from the requested 10000 is consistent with independently checked scaled-principal and variable-index mechanics; wallet receipt is exact. No extra borrow, approval or collateral-enabling action is recorded or required. This debt observation is pinned to the execution block; later interest accrual does not change the accepted snapshot.

### Final Evidence Bundle

[`BUILD-012B-EVIDENCE.json`](BUILD-012B-EVIDENCE.json) preserves the exact Gryloo-exported Evidence Bundle, public execution observations and workflow/simulation/policy/manifest/plan/journal artifacts. Environment TESTNET_EXECUTED; outcome RECONCILED; bundle hash `0x9d87b9bcabaf355285add5caa724db80cc7f4c1ce63107ce133ba38cf06120b6`. Receipt, public-observation, artifact, bundle and journal-head hashes were independently recomputed and matched. Historical economic snapshots match the fresh public reads.

[`BUILD-012B-VERIFICATION.json`](BUILD-012B-VERIFICATION.json) records the fresh independent verdict, exact decoded call/event, signed-transaction hash reconstruction and owner-signature recovery, canonical historical nonces, official-source digest, pre/post economic observations and the read-only RPC transcript. Historical economic snapshots include all transactions in their blocks; inconsistent effects fail closed. The shared reader's position `nonce` field is current pending metadata; the independent verification separately records the authoritative historical nonces 4 and 5. No private keys, signing capability, credentials or mutable wallet authority are included.

### Delivery and current main

Product implementation `519ea9dfd558d0362f51026d56c253f108073546` passed [Governance CI](https://github.com/alrimarleskovar/gryloo/actions/runs/36902368727) and [normal Contracts/browser/dependency/SBOM CI](https://github.com/alrimarleskovar/gryloo/actions/runs/36902368791). Acceptance-only changes add the final report, immutable owner Evidence Bundle and independent public verification; runtime and tests are unchanged. Focused evidence/hash verification, Governance-Lite/self-tests and whitespace checks are run for this delivery. Normal CI results for the acceptance commit belong to PR #41.

PR [#41](https://github.com/alrimarleskovar/gryloo/pull/41) remains unmerged. Main advanced after the original baseline through merged BUILD-014. After the acceptance evidence commit, current origin/main is fetched solely for ordinary shared-file conflict assessment, without inspecting or modifying the BUILD-014 worktree. Any rebase/conflict requirements are recorded in PR metadata and the final acceptance summary. No rebase or merge is performed during this evidence finalization, and BUILD-012C is not started.
