# BUILD-013 — Advanced lending composition

Owner-approved implementation scope, including the public execution amendments. One finite build, on `codex/build-013-lending-composition` from refreshed canonical main `700385676270ecb82e35806f2df1aff04453c575`. The interrupted implementation was preserved and tested in commit `dd0e97d26ab6285e8f088f23e350255cb7c4a9ca`. RH-DEMO-001 subsequently merged as `ce78992bdb135c96caf55da90880c7aa0591958a`. Integration was deferred until GitHub reported [PR #48](https://github.com/alrimarleskovar/gryloo/pull/48) CONFLICTING/DIRTY; only then was that main merged into the BUILD-013 branch under the owner's strictly-necessary exception. Shared-file resolutions retain both features; Robinhood code/evidence and historical BUILD-012 evidence remain unchanged against main. The separate RH-DEMO worktree is untouched.

## Product and semantic contract

Supply Aave USDC → health checkpoint → Borrow Aave USDC → Swap exactly the borrowed amount to WETH, on Base Sepolia (84532). Use collateral to borrow an asset and convert the borrowed exposure into another asset; the debt persists. Build → Simulate → Review → Execute → Result remains the flow.

The three financial IR nodes are `lending-supply`, `lending-borrow`, `lending-swap`. Health is a derived policy checkpoint, never a wallet or transaction node. Borrow depends on Supply and declares the typed `borrowed-amount` output; Swap consumes precisely that output through `OUTPUT_REFERENCE` and one resource edge. The finite reader rejects additions, reordered nodes, substituted tokens, other recipients, rates, dependencies and untyped amounts. Chat and Canvas share the builder and require explicit proposal acceptance. An economic correction changes the workflow revision/commitment, invalidates previous authority, and requires new artifacts, Manifest, Simulate and Review.

Default bounded pilot: Supply **100000 raw / 0.1 USDC**, Borrow **10000 raw / 0.01 USDC**, variable rate mode 2, slippage **50 bps**. The owner may author different exact amounts; every accepted Review binds its exact amounts and fees. No amount changes automatically.

## Exact asset identity and public gate

Aave USDC is `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f`, with six decimals. The existing public swap profile's Circle USDC, `0x036cbd53842c5426634e7929541ec2318f3dcf7e`, is a different token and cannot substitute for it. WETH is `0x4200000000000000000000000000000000000006`, with 18 decimals.

The exact route is independently discovered from the canonical Uniswap factory. Addresses come from the official Aave address book and Uniswap Base deployment documentation. The read-only route transcript records matching infrastructure code fingerprints from two public RPCs. That observation is not execution readiness.

Before releasing **any** owner transaction, including the first approval and Supply, the runtime must prove:

- Exact token addresses, chain, canonical factory/router/quoter identities and compatible fee-500 pool identity; nonempty code and unchanged reviewed code fingerprints.
- Active, unlocked pool liquidity, sufficient WETH settlement balance, exact-input quote, expected output and the reviewed minimum output.
- Stateful `eth_simulateV1` of the whole remaining sequence, with validation enabled and no overrides, preserving Supply/Borrow principal and wallet balances and completing Swap at or above the reviewed minimum.
- Verified Aave deployment, reserve configuration/caps/liquidity, enabled collateral, complete account state, no other reserves or eMode, and HF **≥ 2.0** at the relevant checkpoints.
- A fresh pinned block/hash, owner USDC and ETH funding, current nonce, reviewed gas limits, gas price and total network/L1 fee budgets.

Checks run at Simulate, Review acceptance, PREPARED creation and immediately before SUBMITTING. Final release rereads state and checks deadline, nonce, funding and fee bounds again. Unsupported simulation, throttling, inconsistent reads or any failed downstream condition blocks before Supply. A known unavailable downstream route never permits an earlier financial step. No fallback token, intermediary conversion, deployed pool or artificial liquidity is permitted.

## Reuse and minimum additions

Reuse Aave Supply/Borrow calldata compilation, deployment/state readers, capacity and HF arithmetic, ray/share reconciliation, existing owner wallet transport and strict single-call EIP-7702 proof, canonical hashes, journal transitions, durable extending-file storage, Manifest/Authorization Policy, Evidence Bundle v1, and the existing editor/proposal flow. Repay/Withdraw retain their isolated implementation and regression coverage. The Circle-USDC public swap profile remains separate; the exact borrowed-token route uses the established Uniswap ABI and settlement patterns with its own verified identities. Liquidity is unchanged.

Add only the closed composition reader/builder/linter, a finite compiler with composed snapshots and sequential simulation, an immutable Review wrapper, durable composed attempts/reservations, composed reconciliation, a read-only verifier and the small authoring/Review/result UI. Snapshots carry collateral, variable debt, HF, wallet USDC/WETH, allowances, reserve configuration, oracle price and scaled principal/index data. Borrow provenance is fungible accounting linkage, not identification of particular token units. The initial snapshot and complete ordered chain observations bind the resulting exposure.

## Existing Manifest schema binds the constraints

No schema change. Frozen v1 fields bind:

| Constraint | Existing binding |
| --- | --- |
| Collateral, borrow/output assets and exact amounts | Semantic workflow hash and artifact/plan payload commitments |
| Maximum total/per-step spend | Exact USDC `spendLimits`: S+B total, max(S,B) per step |
| HF ≥ 2.0 | Hashed policy `accountRiskRules` with ratio 2/1 and identified checkpoints |
| Swap minimum and slippage | Hashed artifacts, exact calldata, policy `checkpointRules.minimumOutputs`, `maximumSlippageBps` |
| Gas/L1 fees | `gasBudgets`, `feeBudgets` and exact Review call limits |
| Protocols/contracts/functions/chain/recipient | Hashed policy allowlists, authorized provider set, owner and committed payloads |
| Freshness, nonce, revision and recovery | Expiry/deadline, nonce, revocation epoch and existing recovery policy |

No extra leverage field is necessary for fixed USDC collateral/debt principal, the exact WETH purchase, and the HF bound. Mode A uses application checks and exact owner wallet requests; it does not claim protocol-enforced HF/fees or Mode B authority. General policy enforcement and generalized concurrent budget reservation remain honestly `NOT_ENFORCED` / `NOT_IMPLEMENTED`. BUILD-013's concrete nonce/economic leases and root network budget are enforced by its finite application runtime.

## Simulate and Review

Display collateral, debt, HF, USDC and WETH before and after Supply/Borrow/Swap; exact borrowed amount/Swap input; expected/minimum output, slippage and pool fee; maximum gas/L1 network fees and variable borrowing rate; resulting collateral/debt/WETH exposure; owner, token, pool and spender identities; required exact approvals; ordered dependencies and per-step state. Review explains persistent debt, variable interest, liquidation risk, non-atomic failure, residual assets/allowances and observation-only recovery. Technical commitments remain in collapsible details and downloadable records.

Review expires after **120 seconds**. Block observations must be no more than 120 seconds old, allowing at most 15 seconds future clock skew. Prior authority allows at most **0.1%** drift plus integer rounding in price/debt/account values/HF, with exact principal, balances, configuration, deployment and allowances unchanged. Backward blocks or a changed hash at the same block fail closed. Fresh Simulate/Review can explicitly accept changed market prices when principal continuity holds; it cannot repeat completed financial steps or exceed the original root network budget. Changes between Borrow and Swap pause the remaining path and expose the actual position; they never trigger compensation or a new Swap attempt.

## Execution, failure and recovery

Transactions: optional exact Pool approval S, Supply S, Borrow B, optional exact router approval B, exact-input Swap B with the approved minimum. Each transaction needs a separate explicit owner click and wallet authority. A health checkpoint is a read, not another transaction. No wallet private key enters the runtime.

Every attempt is durably **PREPARED → SUBMITTING → PENDING → CONFIRMED**, followed by canonical economic reconciliation before the next step. Unknown results become `SUBMISSION_RESULT_UNKNOWN` and observation-only recovery. Reverted or divergent transactions block the attempt; prepared cancellation is permitted only before any handoff and requires a fresh accepted Review. A hash returned while its durable report fails is retained as a local recovery pointer and reported on restart without another send.

Nonce leases share the BUILD-012 journal. Exact economic leases reserve the entire remaining path before the first request and survive changed workflow IDs/nonces and restarts. Completed strict EIP-7702 calls may leave the owner nonce unchanged: advancing the next distinct step requires fresh positive predecessor proof. Previously completed BUILD-012 nonce use requires the same proof; ambiguous prior activity cannot release a lease. Retain the journal, never delete it to obtain a new submission.

If Borrow succeeds and Swap fails/unavailable: Supply and Borrow are never repeated; debt, borrowed USDC, current observed HF and residual allowances remain explicit. No automatic Repay, compensation, silent retry or second Swap attempt. A route becoming unavailable before any Swap submission can permit only the unsubmitted tail after fresh state, Simulate/Review and explicit owner action. A failed or ambiguous Swap has no automatic or same-run retry. Manual economic actions require their own separately reviewed workflow/owner decision.

Unsafe HF, insufficient collateral/USDC/ETH, wrong chain/account, stale Review, price drift, slippage/minimum violation, missing route or unavailable simulation all block before requesting a transaction. Disconnect after handoff and unknown submission outcomes remain observation-only. Duplicate Execute, app restart, conflicting nonce activity, RPC inconsistency and changed predecessor proof cannot create another submission.

## Reconciliation and evidence

The runtime and independent verifier prove owner-authorized exact calldata/envelopes, canonical transaction/block/index linkage, two confirmations, strict step order, one submission per attempt, unique receipts and scaled collateral/debt principal. Prove Supply debit, Borrow credit/event/rate mode, exact B Swap debit and pool/owner settlement ≥ minimum, final balances, collateral/debt/HF, allowances and aggregate gas/L1 costs. Cross-step balance/principal/allowance/deployment continuity and final conservation must hold: wallet USDC = initial−S; WETH = initial+actual Swap output; collateral shares match Supply; debt shares match Borrow.

Historical snapshots include all transactions in a block: interfering effects fail closed rather than claiming isolated attribution. A read-only independent CLI uses the official Base RPC, distinct from the runtime's provider, rechecks public receipts/state, reconstructs literal ABI independently, verifies commitments/Manifest/journal, rejects unaccounted submissions, and repeats economic/ray arithmetic. General failure produces partial evidence; full composition success requires all proofs. Public preflight or an unproven submission cannot produce `TESTNET_EXECUTED` evidence.

Evidence hierarchy remains MOCKED → FORK_REPRODUCED → TESTNET_EXECUTED → MAINNET_EXECUTED. READY_FOR_OWNER_EXECUTION is readiness, not an execution level. Mocked receipts or observed public quotes never establish public composed execution.

## Tests and definition of done

Require finite IR and Chat/Canvas equivalence tests; malformed graph/token/rate/dependency rejection; compiler/calldata, linter, Manifest, simulation/HF/freshness/funding tests; owner and durable executor gates; duplicate/restart/unknown-result tests at every transaction; partial/failure recovery; canonical receipt, signature, scaled principal, balance and composed settlement tests; independent verifier asset/debt/journal tamper tests; guarded browser authoring/Review/execution/recovery tests; BUILD-012A/B/C/D regression coverage; standard repository, schema, governance, dependency, audit and relevant browser/fork gates. Skips remain explicit.

Implementation is reviewable as one unmerged PR with honest local evidence and preserved read-only route/preflight transcripts. Automated work submits/signs no public transaction. If the full public gate passes, stop READY_FOR_OWNER_EXECUTION and provide exact owner steps. The intended completion target for a legitimate viable route is owner **TESTNET_EXECUTED / RECONCILED** plus **TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED**. If viability cannot be proven, document the blocker and stop without claiming that target.

Closure continues the preserved `dd0e97d` implementation and the in-progress merge of `ce78992`; it does not restart or broaden this build. CI run `37018814071` exposed repeated full-history validation in the durable lending service's Borrow/route-loss continuation test. Reuse validation only for an exact byte prefix already fully validated by the same service instance, keeping its parsed predecessor private; validate every appended snapshot and transition, and fully validate changed history or a restarted service. Keep disk reads, atomic/fsynced extending writes, live predecessor proofs, complete-path simulation, assertions and the existing 30-second unit-test timeout. Verify historical corruption with both warm and restarted services. Final implementation checks and owner-review delivery are recorded in the report; public evidence remains MOCKED / PUBLIC_EXECUTION_BLOCKED.

## Out of scope

Liquidity, another build split, Mode B/C, monitoring, liquidation defense, mainnet, auto repayment/compensation/retries, another USDC, intermediary conversion, pool deployment/funding/artificial liquidity, generic strategy/exposure frameworks, speculative Manifest fields, app redesign, automatic merge, owner execution by the agent, Robinhood changes and historical BUILD-012 evidence changes.
