# BUILD-012C — Aave V3 Repay

Status: **READY_FOR_OWNER_EXECUTION**. Public acceptance has not occurred. The agent has made only public reads and closed-loop engineering tests; it has not signed, approved, repaid or merged anything.

Baseline is clean main `f2b8afa53d9d0d46346fbb0515b167f1045d3f1e`, containing merged BUILD-012B and BUILD-DEMO-001. Branch is `codex/build-012c-aave-repay`. Remote main was independently rechecked and remains this revision. Delivery uses Governance-Lite: one PR, CI, human owner merge. No BUILD-012D, advanced lending or Solana implementation work is included.

## Public prerequisites and read-only simulation

[BUILD-012C-PRESTATE.json](BUILD-012C-PRESTATE.json) preserves the initial independent raw public RPC snapshot, canonical BUILD-012B Borrow receipt and official address-book verification before implementation. Its 30 RPC reads were taken at block 47560156. [BUILD-012C-READONLY.json](BUILD-012C-READONLY.json) preserves a subsequent real compiler simulation with 81 public read-only requests, observed at **2026-10-01T21:37:48.128Z**, state block **47561184**, hash `0x8aeb670707679506257c5c6c297ec905e1c90363664996253ba9c940eafb3599`.

| Field | Current public observation |
| --- | --- |
| Network / chain | Base Sepolia / 84532 |
| Owner / onBehalfOf | `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b` |
| Canonical Pool | `0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27` |
| USDC, 6 decimals | `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f` |
| Variable debt token | `0xfb3e85601b7feb3691bbb8779ef0e1069e347204` |
| Wallet USDC | 10000 raw = 0.010000 USDC |
| Variable debt | 10001 raw = 0.010001 USDC |
| Scaled variable debt | 7714 |
| Variable debt index | 1296356258575833821902930968 |
| Allowance to Pool | 0 |
| aToken collateral | 1000001 raw; enabled |
| Health factor before | 85991485650860948343 (about 85.9915) |
| Conservative estimated debt after | 5002 raw |
| Maximum network budget | 13741480000000 wei = 0.00001374148 ETH |

The existing Borrow debt remains present, debt exceeds 5000, wallet USDC covers 5000 and configured Pool/reserve/token addresses match deployment reads and the official address book. **The 0.005-USDC acceptance is feasible at this observation.** Simulation, Review, Execute and handoff re-read the relevant live state. If prerequisites fail, stop and report; never faucet, transfer, borrow more or alter the amount as a workaround.

The preview is conservative and uses scaled debt/index arithmetic. Actual post-debt must be observed: index accrual and protocol rounding prevent simple nominal subtraction. The acceptance amount remains exactly 5000 raw regardless of the estimated remaining debt.

## Product and safety

Canonical `repay` is a first-class semantic action, with `aave-v3.repay` capability. Chat `Repay 0.005 USDC to Aave on Base Sepolia` and the Canvas Repay form produce the same canonical IR. The minimal form selects the existing network/profile, USDC, amount and variable mode. Existing authoring, capability, compiler, linter, owner-wallet, journal and evidence architecture is reused.

The journey is Build → Repay → read-only Simulate → explicit Review → Execute → owner wallet → independent reconciliation → Evidence Bundle. Simulation shows wallet balance, debt, allowance, exact approval requirement, remaining debt estimate, before/estimated-after health factor, collateral and estimated/maximum costs. Any allowance override is an ephemeral verified `eth_call` / gas-estimation override; it cannot alter public state.

For acceptance the only permitted calls are `approve(Pool,5000)` if allowance is insufficient, then `repay(USDC,5000,2,owner)`. Existing sufficient allowance skips approval. No maximum approval/repayment, permit or aToken repayment path is introduced. Gryloo never signs for the owner.

Review commits to the workflow, chain/profile, owner/onBehalfOf, Pool, asset, amount, mode, approval spender/amount, exact calldata, policy/manifest/plan, debt/index, collateral/configuration, prices, gas budget and freshness. It expires after 120 seconds. Semantic edits retire authorization. Live checks run again at Review, preparation and handoff; parameters cannot silently change.

Preparation and handoff are durably journaled before a wallet request. Nonce reservations and an economic lease tied to the final exact repayment prevent duplicate approval/repayment after uncertain submission, including re-authored metadata or changed allowance. Unknown attempts remain observation-only across refresh/restart. A known wallet refusal requires a fresh explicit Review. An independently confirmed approval may be carried into a fresh Review without being repeated, including the existing compatible wrapped owner-wallet model where the owner nonce stays unchanged.

Independent reconciliation requires canonical successful receipts and confirmations, exact Pool calldata, direct recovered owner signature or the existing pinned wrapped-wallet authorization, the exact Aave `Repay` event, an exact 5000-raw wallet debit, allowance consumption, decreasing variable debt, scaled burn at the independently read execution index, improved consistent health factor and unchanged scaled collateral/configuration. Unexpected owner ERC20 movement fails closed. Direct execution also requires historical nonce increment and native balance debit equal to receipt gas costs including reported L1 fee. Historical snapshots cover entire blocks; overlapping inconsistent effects fail closed.

The reconciler accepts the documented floor or legacy nearest scaled-burn rounding and records the normalized amount and derived raw-unit bound. The canonical event and wallet debit must still be exactly 5000. This follows [Aave BorrowLogic](https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/logic/BorrowLogic.sol), [TokenMath](https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/helpers/TokenMath.sol) and [VariableDebtToken](https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/tokenization/VariableDebtToken.sol). This narrow profile supports partial self-repayment in variable mode, no eMode/multi-reserve position, and preserves the existing verified deployment safety restrictions. Durable journals must be retained.

## Engineering validation

Focused tests cover canonical calldata, forbidden amounts/modes, shared Chat/Canvas IR, read-only state/estimation, Review mutation/expiry, wrong owner/chain, refusal, index accrual, wrapped-wallet approval/Repay, durable restart, uncertainty, duplicate prevention, stale debt and divergent signatures/events/balances/allowances/collateral/native costs.

- `pnpm check`: typecheck, lint, production build, all 11 schema exports and **863 passing unit tests**, with 2 existing optional skips.
- Aave/Canvas/capability browser regression: 50 passed, including all 9 Repay, 9 Borrow and 18 Supply/recovery cases. Review/result screenshots were visually checked.
- Additional browser regressions passed: BUILD-014 Jupiter 9, BUILD-DEMO-001 Solana Devnet 8, Mode A 13 and CoW 9. The default and composition browser groups are also required by normal CI. Three exact visual baselines are intentionally updated for the added Repay toolbar button and consequent header wrap; screenshot tolerance remains zero.
- Governance-Lite and all 17 self-tests; screenshot-summary self-test; frozen install without lifecycle scripts; 247 registry dependency integrity/license/release-age checks; audit with no known vulnerabilities; current CycloneDX 1.6 validator passed.
- Pinned Anvil compatibility: 4 passed, 10 existing owner-only skips. Normal fork suite: 31 passed, 29 existing environment/owner-dependent skips. Five fresh-process offline rehearsals passed with 50 provider-equivalent requests each. Base, liquidity and composition transcript structure/digest/identity checks passed.

A final build ran concurrently with an initial Devnet browser group and interrupted its form test. The complete group passed after restarting against the completed build; no Solana source or assertion was changed.

Mock/fork/browser results prove engineering behavior only. Existing skips do not count as passes or public execution proof. GitHub CI results for the delivery revision belong to [PR #43](https://github.com/alrimarleskovar/gryloo/pull/43). The PR is open and unmerged.

## Owner acceptance and independent verification

Only the owner may execute the two wallet requests through Gryloo on Base Sepolia. Recheck the public prerequisites first, author exactly 0.005 USDC, Simulate, Review, approve exactly 5000 raw if required, then explicitly Execute Repay. Preserve any uncertain execution record and observe it; do not submit another attempt.

After successful DApp reconciliation, download the exported Evidence Bundle without editing it. Save it as `docs/builds/BUILD-012C-EVIDENCE.json`, then run the read-only verifier:

```sh
pnpm build
node scripts/verify-aave-repay.mjs --evidence docs/builds/BUILD-012C-EVIDENCE.json docs/builds/BUILD-012C-VERIFICATION.json
```

The verifier refuses MOCKED/non-owner/non-5000 evidence, recomputes Review, artifact, journal, observation, receipt and bundle commitments, obtains fresh canonical receipts/transactions and historical state, verifies owner authority and independently checks fixed canonical ABI and scaled-debt arithmetic. It records public RPC responses and official profile/protocol source digests. Its RPC allowlist contains no signing or submission method. A fresh read-only prestate can also be produced with `--prestate output.json`.

Only after the owner’s DApp execution and successful independent verification may this report become **TESTNET_EXECUTED**. Final Evidence Bundle and independent execution-verification artifact are pending that owner action; neither has been fabricated. The prestate and read-only simulation artifacts are not execution evidence.
