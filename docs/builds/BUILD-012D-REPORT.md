# BUILD-012D — Aave V3 Withdraw

Status: **TESTNET_EXECUTED / RECONCILED / INDEPENDENTLY_RECONCILED**. The owner completed the exact 0.1 USDC withdrawal on public Base Sepolia through their wallet. Gryloo runtime reconciliation and the separate read-only verifier both passed, as distinguished below. The existing transaction is final; this evidence/documentation closure performed no additional signing, submission, wallet request or execution. BUILD-013 is not started. Main is unchanged; [PR #46](https://github.com/alrimarleskovar/gryloo/pull/46) remains unmerged from `codex/build-012d-aave-withdraw`, based on `70ce37efae08018c642ddcc912913c07cabcb770`.

## Canonical baseline and live selection

The merged BUILD-012A/B/C implementation and BUILD-012C Evidence Bundle, verification, report and read-only tools were inspected before implementation. PR #44 / BUILD-015 is merged and DEVNET_EXECUTED. PR #43 / BUILD-012C is merged and TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED. Historical evidence is preserved; STATUS records Withdraw as completed, and NEXT_BUILD identifies the existing roadmap successor, BUILD-013, for future planning only.

[BUILD-012D-PRESTATE.json](BUILD-012D-PRESTATE.json) records the initial live read-only snapshot and exact selection rationale. Owner: `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b`. Network: Base Sepolia, chain 84532. Pool: `0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27`. USDC: `0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f`, six decimals.

| Initial live field | Exact value |
| --- | --- |
| Observed UTC | 2026-10-02T01:01:24.181Z |
| Block | 47567291 |
| Block hash | 0x72f6af572212704bd8177bf603c1bda462838ebcefb372104bab811041df8416 |
| Supplied USDC, raw | 1000001 |
| Scaled aToken balance | 803435 |
| Normalized income index | 1244658226988670665599345266 |
| Variable debt USDC, raw | 5002 |
| Scaled variable debt | 3858 |
| Variable debt index | 1296361915267372345054439157 |
| Health factor, 18 decimals | 171931394977807989123 |
| Wallet USDC, raw | 5000 |
| Pool allowance | 0 |
| Owner ETH, wei | 96884768054543 |
| Owner nonce | 5 |
| Collateral / debt base units | 99996099 / 500180 |
| Liquidation threshold / LTV | 8600 / 8250 bps |
| Price / oracle base currency unit | 99996000 / 100000000 |
| Reserve configuration | 7237005577332262213973186568751985011653213565835679148722714856698947313722 |
| User configuration / eMode | 3 / 0 |

Only after that snapshot was read, **100000 raw = 0.100000 USDC** was selected. This removes about 10% of supplied collateral, retains about 90%, and leaves estimated HF **154.738272501899316246**, comfortably above liquidation and the implementation minimum **2.0**. Conservative preview burns 80344 scaled shares, rounds remaining collateral down and debt valuation up. Estimated collateral is 900001 raw and wallet USDC 105000 raw. The small existing variable debt remains outstanding. This exact finite partial amount is never `uint256.max`.

[BUILD-012D-READONLY.json](BUILD-012D-READONLY.json) preserves a second public read-only compiler validation: block **47568245**, hash `0xf518e5023f33c48de4a00f44878ec98d91884e71dc0adc71a4f5fabc85aa0e66`, observed UTC 2026-10-02T01:33:14.749Z. Normal interest increased supplied balance to **1000002** raw; scaled collateral remains 803435, debt 5002, wallet 5000 and HF **171931566915910272301**. It contains 77 read-only RPC responses, exact call/return, official address-book and protocol-source hashes, gas estimation and the complete canonical artifact chain. `eth_call` returned exactly 100000. Gas limit including 1.5× margin is 296069; reviewed gas-price ceiling is 12000000 wei; maximum network budget including fee margin is 13552828000000 wei (0.000013552828 ETH).

These initial snapshots are historical selection and validation records. The earlier archived Review expired at 2026-10-02T01:34:59.544Z. The completed owner execution used a fresh Review, with state observed at 2026-10-02T02:48:00.365Z and expiry 2026-10-02T02:49:55.388Z; its transaction was included at 2026-10-02T02:49:22Z. Its estimated post-collateral, wallet balance and HF match the final evidence. The transaction is final and must not be rerun.

## Final public owner execution

The [exact exported Evidence Bundle](BUILD-012D-EVIDENCE.json) records Gryloo runtime **TESTNET_EXECUTED / RECONCILED**, `PUBLIC_TESTNET` provenance and `ownerInitiated: true`, with no reconciliation differences. The separate [independent verification](BUILD-012D-VERIFICATION.json), produced by `scripts/verify-aave-withdraw.mjs`, records **TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED**, `readOnly: true` and **96 read-only RPC requests**. These are separate runtime and independent acceptance records.

| Canonical execution evidence | Exact value |
| --- | --- |
| Public transaction | [`0xd62dc935a1897f549a9cd7e131c8847953d97d7b8b8acdbf4d0d602adbeac372`](https://sepolia.basescan.org/tx/0xd62dc935a1897f549a9cd7e131c8847953d97d7b8b8acdbf4d0d602adbeac372) |
| Network / chain ID | Base Sepolia / 84532 |
| Owner / recipient | 0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b |
| Pool / USDC | 0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27 / 0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f |
| Withdrawal | 100000 raw = 0.100000 USDC |
| Canonical prestate block / hash | 47570536 / 0x0794d29f3f1abb40428a7b9d89be0b5751a66dde52a8668048a315adf8c4883f |
| Receipt/poststate block / hash | 47570537 / 0x58de57c4383a372bfe3ab6476ba09f0f3c1fa130937c3882c84c81aed9474258 |
| Transaction index / receipt status | 1 / 1 (successful) |
| Included UTC | 2026-10-02T02:49:22Z |
| Runtime bundle observed UTC | 2026-10-02T02:49:59.851Z |
| Independent verifier observed UTC | 2026-10-02T02:54:40.134Z |
| Supplied collateral before → after, raw | 1000002 → 900001 (1.000002 → 0.900001 USDC) |
| Wallet USDC before → after, raw | 5000 → 105000; delta **+100000** |
| Variable debt before → after, raw | 5002 → 5002 (0.005002 USDC) |
| Scaled variable debt before → after | 3858 → 3858; index advanced through normal interest accrual |
| HF before → after, 18 decimals | 171931566915910272301 → **154738272501899316246** |
| HF before → after, decimal | 171.931566915910272301 → **154.738272501899316246** |
| Scaled collateral before → after | 803435 → 723091; burn **80344** |
| Execution income index | 1244658775820995817639892411 |
| Reserve / user configuration / eMode | Unchanged; reserve configuration as above / 3 / 0 |
| Gas used / effective gas price | 308189 / 6000001 wei |
| Base L1 fee | 24687265236 wei |
| Total network cost | **1873821573425 wei** = 0.000001873821573425 ETH |
| Owner native cost | 0 wei; sponsored by the wallet envelope fee payer |
| Evidence Bundle hash | 0xd7952acf36916a50665bb85a99f32a82a99fa71a36787e8cd330db6b170fb6fb |

The wallet used the existing pinned MetaMask EIP-7702 envelope: the outer fee payer/sender is `0xc066ac5d385419b1a8c43a0e146fa439837a8b8c`, and its outer destination is DelegationManager `0xdb9b1e94b5b69df7e401ddbede43491141047db3`. The independently verified owner signature authorizes the exact inner Pool call below, with owner and recipient identical. The owner nonce remains 5, the pinned wallet implementation remains unchanged and the one-call caveat counter advances from 0 to 1. This reuses existing wallet compatibility; it introduces no new lending delegation feature.

The wallet received exactly 100000 raw USDC. Nominal collateral decreased by 100001 raw because the protocol burns **80344 scaled shares** at the execution income index; nearest rounding would yield 80343, whereas the verified current ceil burn is 80344. The normalized withdrawal is 100001 raw, within the explicit three-raw-unit representation bound. The verifier also validates the aToken interest checkpoint and Burn/Transfer events. This explains the collateral representation without assuming naive nominal subtraction. Debt principal, reserve configuration and owner configuration remain unchanged, and final HF remains comfortably above the 2.0 safety minimum.

The bundle contains exactly one Withdraw observation, one receipt and one durable attempt: PREPARED at 02:48:42.969Z → SUBMITTING at 02:49:14.313Z → PENDING at 02:49:23.099Z → CONFIRMED at 02:49:59.840Z, all on 2026-10-02. There is no duplicate submission or second transaction in this execution record. The final evidence closure only inspects that existing execution and does not submit another transaction.

## Implementation and user flow

Build → Simulate → Review → Execute → Result uses the existing Aave compiler, capability model, wallet session, durable journal and Evidence Bundle architecture. The new canonical `withdraw` reader contains chain, Aave adapter/profile constraints, asset, exact amount and `CONNECTED_OWNER` recipient semantics. Chat and Canvas call the same authoring reducer and produce identical IR; authored nodes contain no wallet address. The owner is bound from the session at simulation/Review.

Only an isolated partial self-withdrawal on the existing verified reserve is executable. No approval, permit, withdraw-max, new delegation feature, advanced lending or Solana protocol change was added. Existing pinned MetaMask envelope compatibility independently verifies the owner-wallet authorization used in this execution.

The canonical reviewed intent has owner `from`, Pool `to`, zero value, chain `0x14a34`, and the following calldata. In the completed sponsored wallet execution these fields bind the inner Pool call; the outer sender and destination are recorded above:

```text
0x69328dec000000000000000000000000ba50cd2a20f6da35d788639e581bca8d0b5d4d5f00000000000000000000000000000000000000000000000000000000000186a00000000000000000000000008ef12e4e2fd397c227492019f626b5d1c5e41b3b
```

This is `Pool.withdraw(USDC, 100000, connectedOwner)`. Simulation performs pinned-block `eth_call` and `eth_estimateGas`, checks the exact return, then rechecks canonical block identity. It displays supplied collateral before/after, requested amount, variable debt, HF before/after, wallet USDC before/after, gas/budget, chain, owner/recipient, Pool, asset, exact call/calldata, state block and expiry. Insufficient collateral/liquidity, unsafe HF, incorrect profile/configuration, multi-reserve/eMode state, inconsistent scaled/nominal/account data and unsupported chain fail closed.

Review binds the complete workflow and artifact chain, owner/recipient, chain/profile, exact finite amount and calldata, current principal, debt, indices, health, conservative post-health, gas budget, block and 120-second expiry. Principal balances, wallet, allowance, configuration, code profile and owner interest checkpoint must remain fixed; interest/price/risk drift is bounded to 0.1%. Freshness is rechecked at acceptance, PREPARED creation and handoff. Every semantic edit invalidates authority.

## Recovery and execution guarantees

The server durably persists PREPARED before returning the wallet request and SUBMITTING before wallet handoff. Only the connected owner wallet signs. Gryloo never receives or uses an owner private key. A historical attempt is observed; there is no second submit, automatic retry, replacement transaction or reset of its durable economic identity.

Unknown submission stays observation-only through reload, service restart, workflow metadata changes and nonce changes. Permanent nonce/economic intent leases block a new run from duplicating it. If a restart occurs before any durable handoff, or a recorded wallet refusal proves no submission, a fresh explicit owner Review is required. A completed wrapped prior call can share an unchanged owner nonce only after independent proof of its completion; the same Withdraw economic intent still cannot be replayed. Browser execution fixtures use only MOCKED loopback chains and disposable test authorization.

## Independent verifier

The reconciler independently reads chain, transaction, receipt, canonical block/slot and confirmations, verifies owner signature or the existing pinned owner-wallet envelope, exact Pool destination/inner call, USDC, finite amount, recipient, zero value, receipt success and exactly one Aave Withdraw event. Historical pre/post states must match canonical parent/receipt blocks and the reviewed deployment.

Underlying owner USDC must increase by exactly the requested amount. Scaled collateral must decrease by the legacy nearest or current ceil burn at the execution index; normalized principal must remain within its explicit index-derived rounding bound. Nominal balances are checked against the protocol representation instead of requiring naive exact subtraction. The owner's previous interest index, Burn/Mint event, accrued interest and net collateral Transfer are independently checked. Scaled debt and reserve/user configuration remain unchanged; debt changes are limited to normal bounded interest accrual. Post-HF must be consistent and at least 2.0. Extra owner asset movement, native-cost/nonce discrepancies for direct calls, unexpected events, wrong call or missing Base L1 fee fail closed. Network cost includes gas used × effective gas price plus the reported L1 fee.

The separate CLI `scripts/verify-aave-withdraw.mjs` contains a strict read-only RPC allowlist and no wallet/signing/submission entry point. Its evidence mode was run against the completed owner transaction. It re-read canonical public state and authorization, verified archived commitments, journal/artifact/bundle hashes, receipt and state consistency, then independently reconstructed ABI bytes and scaled burn arithmetic. It rejects MOCKED evidence and any acceptance amount/recipient/profile mismatch. Whole-block historical snapshots deliberately fail closed if concurrent effects prevent unique reconciliation.

The completed read-only evidence-mode command was:

```sh
node scripts/verify-aave-withdraw.mjs \
  --evidence docs/builds/BUILD-012D-EVIDENCE.json \
  docs/builds/BUILD-012D-VERIFICATION.json
```

It returned `{"status":"TESTNET_EXECUTED","readOnly":true,"rpcReadCount":96,"output":"docs/builds/BUILD-012D-VERIFICATION.json"}`. Its archived transcript contains only chain, transaction, receipt, block, code, balance, nonce, gas-price and historical `eth_call` reads; it contains no gas-estimation, signing or submission request. The independent result is `INDEPENDENTLY_RECONCILED`. The final closure preserved both supplied files byte for byte and replayed these existing 96 read-only responses through the current reconciler, with zero new network requests.

## Validation

The implementation checks below passed before owner execution on implementation commit `34e9b8ea68fc6be8f097ce2b8be97dee4f8be282`. They are retained as historical implementation validation; transaction-capable harnesses were not rerun for this documentation/evidence closure.

| Check | Result |
| --- | --- |
| Focused Withdraw contract/compiler/linter/capability/authoring/service/reconciliation | 70 passed |
| `pnpm check` | Passed: typecheck, lint, production build, 11 frozen schema exports; 133 test files passed, 2 skipped; 1023 tests passed, 2 skipped |
| Supply/Borrow/Repay, Orca/Jupiter and shared surface unit regressions | Included in the full successful check |
| Guarded Aave + Canvas browser regressions | 59 passed, including all 8 Withdraw cases |
| Guarded Jupiter browsers | 9 passed |
| Guarded Solana Devnet / Orca swap and liquidity browsers | 13 passed |
| Default shared-surface/visual browsers | 51 passed; 4 existing Mode B profile skips |
| Guarded Mode A browser recovery regressions | 13 passed |
| Final authoring/visual snapshot verification, no update flag | 8 passed; zero-pixel comparison |
| Anvil compatibility | 4 passed, 10 existing owner-only skips |
| Fork tests | 31 passed, 29 existing profile/owner-artifact skips |
| Five independent fresh-process synthetic fork rehearsals | PASS; 50 provider-equivalent requests per pass, loopback only |
| Base, liquidity and composition closed transcript validation | Passed structure, digest and identity checks |
| Governance-Lite | Passed; all 17 self-tests passed |
| `git diff --check` | Passed |
| Frozen dependency installation | Passed, offline cached packages, unchanged lockfile |
| Dependency integrity/license/release-age gate | Passed: 247 entries, exact 16 reviewed license exceptions |
| `pnpm audit --audit-level low` | No known vulnerabilities |
| CycloneDX 1.6 SBOM gate | Passed exact lockfile/component/manifest/license validation; ephemeral SBOM removed after validation |
| Screenshot-diff summary self-test | Passed |
| Historical pre-execution Withdraw simulation | 77 read-only RPC responses; exact 100000 return; that validation submitted no transaction |

The two default unit skips, ten Anvil skips and 29 fork skips are pre-existing optional owner/profile cases; they are not counted as passes. All new focused Withdraw tests run.

The host had another workspace using the standard loopback ports. Browser acceptance used a disposable source copy with app port 13014 and isolated 1954x/1955x RPC ports, keeping the network guard strict and the repository/CI ports unchanged. Chromium revision 1243, Anvil 1.8.3 and the existing Liberation font configuration were retained. Disk-backed Chromium temporary storage resolved full `/tmp` crashes; test journals retained their required `/tmp/gryloo-…` safety prefixes. Earlier environmental failures were corrected before final acceptance. No other workspace app, process or owner journal was changed.

The unknown-result refresh test waits for the durable observation-only UI state before reloading, so it tests restart after submission rather than racing the handoff itself. The mock Withdraw display assertion was corrected to its index-derived 1000002 supplied / 5001 debt representation. The live snapshot retains its independently read protocol values. Three inspected snapshots were updated for the Withdraw toolbar and resulting Canvas header/centering: Build, proposal and blocked review. All other baselines remain unchanged; the zero-pixel visual threshold remains unchanged.

## Final evidence/documentation closure checks

- Both JSON files parse; the Evidence Bundle passes the existing contract reader. Review, workflow/artifact, journal, observation, receipt and bundle hashes match the current implementation.
- Offline replay of all **96** archived read-only RPC responses through `reconcileWithdrawAttempt` returns `RECONCILED`, reproducing owner-envelope authorization, canonical receipt/block, exact inner calldata, protocol events, collateral/share rounding, wallet credit, debt, configuration, HF and network cost. This replay made **zero network requests** and invoked no wallet or submission path.
- Exactly one durable attempt, one receipt and one transaction are recorded. Review inclusion predates expiry, and final balance projections agree with the bundle and independent verifier.
- Governance-Lite and all **17** self-tests passed; `git diff --check` passed. Changed documentation links and final status statements were checked against the archived evidence and existing roadmap.
- Supplied file SHA-256 values remain unchanged: Evidence `9f08a5b6963628bd249a79c9517ae9042da46bd41e749b2276d36432c3a88c40`; verification `a1ba4dcad5c7050872bb92f1802155bf686a9da2976e5e47d530f551c27c1eb2`.

## Changed files

Historical BUILD-012A/B/C and BUILD-015 evidence was not changed. No dependency or lockfile change was needed. The implementation changed 49 paths; the closure adds the two final JSON archives and updates the three existing status/report documents, bringing this PR to 51 changed paths:

- `.github/workflows/contracts.yml`
- `apps/reference-dapp/e2e/aave-wallet-fixtures.ts`
- `apps/reference-dapp/e2e/canvas-ux.spec.ts`
- `apps/reference-dapp/e2e/supply-fixtures.ts`
- `apps/reference-dapp/e2e/supply-harness.mjs`
- `apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png`
- `apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png`
- `apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png`
- `apps/reference-dapp/e2e/withdraw-fixtures.ts`
- `apps/reference-dapp/e2e/withdraw.spec.ts`
- `apps/reference-dapp/src/app/supply-action.ts`
- `apps/reference-dapp/src/components/action-library.tsx`
- `apps/reference-dapp/src/components/app-shell.tsx`
- `apps/reference-dapp/src/components/artifact-inspector.tsx`
- `apps/reference-dapp/src/components/summary-bar.tsx`
- `apps/reference-dapp/src/components/withdraw-panel.tsx`
- `apps/reference-dapp/src/components/workflow-canvas.tsx`
- `apps/reference-dapp/src/domain/commands.ts`
- `apps/reference-dapp/src/domain/editor.ts`
- `apps/reference-dapp/src/domain/proposal.ts`
- `apps/reference-dapp/src/domain/supply-authoring.ts`
- `apps/reference-dapp/src/domain/withdraw-authoring.test.ts`
- `apps/reference-dapp/src/server/supply-service.ts`
- `apps/reference-dapp/src/server/withdraw-service.test.ts`
- `apps/reference-dapp/src/state/capability-store.tsx`
- `apps/reference-dapp/src/state/supply-store.tsx`
- `docs/NEXT_BUILD.md`
- `docs/STATUS.md`
- `docs/builds/BUILD-012D-EVIDENCE.json`
- `docs/builds/BUILD-012D-VERIFICATION.json`
- `docs/builds/BUILD-012D-PLAN.md`
- `docs/builds/BUILD-012D-PRESTATE.json`
- `docs/builds/BUILD-012D-READONLY.json`
- `docs/builds/BUILD-012D-REPORT.md`
- `package.json`
- `packages/action-registry/src/execution-capabilities.ts`
- `packages/reference-compiler/src/index.ts`
- `packages/reference-compiler/src/supply.ts`
- `packages/reference-compiler/src/withdraw.ts`
- `packages/reference-compiler/test/withdraw.test.ts`
- `packages/reference-executor/src/supply.ts`
- `packages/reference-linter/src/supply.ts`
- `packages/reference-linter/src/validation.ts`
- `packages/reference-reconciler/src/index.ts`
- `packages/reference-reconciler/src/supply.ts`
- `packages/reference-reconciler/src/withdraw.ts`
- `packages/reference-reconciler/test/repay.test.ts`
- `packages/reference-reconciler/test/withdraw.test.ts`
- `packages/workflow-contracts/src/index.ts`
- `packages/workflow-contracts/src/withdraw.ts`
- `scripts/verify-aave-withdraw.mjs`

## Delivery

Branch: `codex/build-012d-aave-withdraw`; base: `main` at the exact canonical SHA above. [PR #46](https://github.com/alrimarleskovar/gryloo/pull/46) remains open for owner merge, with auto-merge disabled. BUILD-012D is completed as **TESTNET_EXECUTED / RECONCILED / INDEPENDENTLY_RECONCILED**. Public owner execution is complete; no additional transaction was signed, sent or initiated during this closure. BUILD-013 remains a future roadmap build and was not started.
