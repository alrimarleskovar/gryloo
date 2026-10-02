# RH-DEMO-001 — Robinhood Testnet owner-signed transaction proof (report)

Status: **TESTNET_EXECUTED / RECONCILED / INDEPENDENTLY_RECONCILED**. The
owner signed one native test-ETH self-transfer on Robinhood Chain Testnet in
their own wallet. Gryloo reconciled it at runtime, and the strictly read-only
independent verifier re-proved it from public chain state. Plan:
[RH-DEMO-001-PLAN.md](RH-DEMO-001-PLAN.md). Owner steps:
[RH-DEMO-001-OWNER-EXECUTION.md](RH-DEMO-001-OWNER-EXECUTION.md).

This is a chain execution proof, not a DeFi capability. No Uniswap, Morpho,
bridge, lending, swap or liquidity support was added for Robinhood. The
BUILD-RH-001 gate result is unchanged: there is still no canonical testnet
DeFi deployment.

## Owner execution

| Fact | Value |
| --- | --- |
| Transaction | [`0xdadc1fd5fd23e9bad85171cf2255c1e26df121ce3c8e2c35b121274436f4a498`](https://explorer.testnet.chain.robinhood.com/tx/0xdadc1fd5fd23e9bad85171cf2255c1e26df121ce3c8e2c35b121274436f4a498) |
| Chain | Robinhood Chain Testnet, `eip155:46630` (`0xb626`) |
| Owner = sender = recipient | `0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b`; signer recovered from the raw EIP-1559 signature |
| Value / calldata | 1000000000000 wei (0.000001 test ETH) / `0x` |
| Nonce | 0 → 1 (the account's first transaction) |
| Block | 127567253, hash `0xa6c095fbf68bab1db83d232303f0cfde35b7975925f4e2b0703a6b44f207beaf` |
| Wallet request | Exactly the reviewed one: type 0x2, gas 41222 (= the reviewed limit), `maxFeePerGas` 20000000, priority fee 0 |
| Gas used / effective price | 25359 / 10000000 wei (Review estimate 27481; budget 824440000000 wei) |
| Network cost | 253590000000 wei (0.00000025359 test ETH) |
| Owner balance | 10000000000000000 → 9999746410000000 wei (delta = exactly the fee; the value leg nets to zero) |
| Journal | one attempt, PREPARED → SUBMITTING → PENDING → CONFIRMED; one economic submission; no duplicate |
| Runtime result | `TESTNET_EXECUTED` / `RECONCILED`, `PUBLIC_TESTNET` provenance, owner-initiated. Evidence Bundle hash `0x7b8bab9c732d5fc461ed9a6567a674c728c3132a64d804b7ee64d8732b34ce2f` |
| Independent verifier | `INDEPENDENTLY_RECONCILED` at 2026-10-02T11:17:14Z from 12 allowlisted public RPC reads, over the same Evidence Bundle hash `0x7b8bab9c…ce2f` as the archive; finality at that moment: `L2_INCLUDED` |
| L1 finality | `L1_FINALIZED`, confirmed by a separate read-only check at 2026-10-02T11:35:27Z: chain 46630, successful receipt, block 127567253 canonical with hash `0xa6c095fb…7beaf` containing the transaction, and the `finalized` head at 127567568 ≥ 127567253 |

Archived files: [RH-DEMO-001-EVIDENCE.json](RH-DEMO-001-EVIDENCE.json) (the
exported Evidence Bundle with workflow, artifacts, Review and journal) and
[RH-DEMO-001-VERIFICATION.json](RH-DEMO-001-VERIFICATION.json). The
verification file holds the authoritative verifier output with its full read
transcript, plus a separate `finalityRecheck` section with its own
transcript. The verifier command is:

```sh
pnpm build && node scripts/verify-robinhood-transfer.mjs docs/builds/RH-DEMO-001-EVIDENCE.json /tmp/rh-demo-001-verification.json
```

### Public RPC historical-state retention

The public endpoint `https://rpc.testnet.chain.robinhood.com` prunes historical
state. The full verifier reads the owner balance and nonce at blocks N−1 and N.
Those reads succeeded at 11:17Z, about 4 minutes after inclusion; that is the
authoritative verification. A complete re-run about 30 minutes later failed with
`historical state … is not available` on `eth_getBalance`. That failure is a
provider retention limit; it is not a mismatch, and it does not invalidate the
earlier result. Everything that does not need historical state was re-confirmed
read-only afterwards: chain ID, receipt, canonical block and L1 finality.

To re-run the full verifier now, point it at an archival Robinhood Testnet node.
The script currently pins the official public RPC. The balance and nonce deltas
from the original run stay preserved in its transcript. Future builds should
verify within the provider's retention window or use an archival endpoint.

The run directory also holds one earlier Simulate-only run,
`rhx-2b00bddd…`, with no attempt: it was never prepared, handed off or
sent. The owner+nonce lease (`…-0.intent`) records exactly one run, the
executed one. The registry row `asset.transfer` / `evm.native-transfer` /
`eip155:46630` / `PUBLIC_TESTNET` now records `evidenceMaturity:
TESTNET_EXECUTED`.

## Transaction selected

A native test-ETH self-transfer on Robinhood Chain Testnet (`eip155:46630`):
from the connected owner to the same owner, an exact value (default
0.000001 ETH, cap 0.001 ETH), with empty calldata. It runs through the
chain-neutral semantic action `asset.transfer` and the adapter
`evm.native-transfer`, with recipient `CONNECTED_OWNER`. The address is
bound only at Simulate and Review; the wallet stays session state.

Why:

- **No third-party contract.** Nothing needs provenance beyond the chain
  itself.
- **The value returns to the owner.** The only effect is the fee, about
  24–27k gas × 0.01 gwei ≈ 0.00000027 test ETH.
- **Deterministic checks.** On Robinhood Testnet a plain transfer emits no
  logs. The balance moves by exactly `gasUsed × effectiveGasPrice`
  (Arbitrum Nitro's `gasUsed` already includes L1 data gas, which was
  confirmed on a real testnet receipt), and the nonce moves N → N+1.
- **One wallet confirmation.**

## What runs where

| Stage | Behavior |
| --- | --- |
| Build | Action library form (or inspector edit) → explicit proposal → apply. One isolated node; the linter refuses other chains, values above 0.001 ETH and composition. |
| Simulate | Read-only. Reads the chain ID, a fresh head, and at the same block the balance, latest and pending nonce, code (the owner must be an EOA) and gas price. Runs the exact transfer with `eth_call` (must return `0x`) and `eth_estimateGas`. Builds the gas limit (estimate × 1.5), `maxFeePerGas` (2× price), fee budget and expected post-balance. Builds the artifact set, simulation, policy, manifest, plan and commitment. |
| Review | Shows chain and ID, owner, recipient, exact value (ETH and wei), calldata, current balance, expected post-balance, gas estimate and limit, expected cost, maximum fee budget, worst-case post-balance, nonce, reviewed block and hash, expiry (120 s) and the exact wallet request. Acceptance re-reads chain state and fails closed on any change. A semantic edit invalidates the authorization. |
| Execute | Validates the wallet session, then `begin`: Review re-checked against fresh state, a permanent owner+nonce lease reserved, **PREPARED** persisted. Re-validates the session, then `handoff`: **SUBMITTING** persisted. Final guards run, then exactly one `eth_sendTransaction` from the owner's Execute click. The wallet assigns the nonce, which must equal the reviewed nonce. |
| Result | Runtime reconciliation from public reads, then the Evidence Bundle (`TESTNET_EXECUTED` / `RECONCILED` on a real run; `MOCKED` in tests). |

## Recovery guarantees

- Restart before handoff (PREPARED): the attempt becomes CANCELLED and
  not-submitted, and only a fresh explicit Review is offered.
- Wallet refusal (4001, 4100 or 4200, no hash): the attempt goes through
  SUBMISSION_RESULT_UNKNOWN to NOT_FOUND, not-submitted. A fresh Review may
  re-authorize **the same nonce** only, and the lease records both runs.
- Uncertain result (lost response, timeout, unknown error after the wallet
  call): SUBMISSION_RESULT_UNKNOWN. It is observation-only forever; there is
  no resend path anywhere. Observation finds the transaction by binary search
  on the owner's nonce, read-only.
- A different transaction consuming the reviewed nonce is DIVERGENT and never
  reconciled.
- One run allows one attempt, and the journal allows one SUBMITTING. The
  owner+nonce lease stops a new run from re-reserving the nonce unless the
  prior run proved non-submission.

## Runtime reconciliation (`reconcileNativeTransfer`)

The reconciler re-reads and requires:

- chain 46630
- the transaction and receipt by hash
- sender = owner, recipient = owner, exact value, calldata `0x`, reviewed
  nonce and chain, transaction type 0x0 or 0x2
- gas limit and fee price within the Review, and fee within the budget
- receipt status 1, sender and recipient matching, and no logs
- the inclusion block canonical (hash match, contains the transaction) and
  at least 2 confirmations
- owner nonce N → N+1 in that block
- owner balance delta exactly equal to the fee (the self-transfer value nets
  to zero)
- the owner still an EOA

Any mismatch is DIVERGENT. Provider failures are INCONCLUSIVE and never
reconciled.

## Independent verifier (strictly read-only)

`verifyArchivedNativeTransfer` (in `packages/reference-reconciler`) and
`scripts/verify-robinhood-transfer.mjs`:

- Allowlist only: `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`,
  `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBalance`,
  `eth_getTransactionCount`, `eth_getCode`. No wallet, key, signing or
  submission method exists. The script reads only the official public
  testnet RPC.
- Archive checks: recomputes the Evidence Bundle hash, the Review commitment,
  the manifest, plan and workflow hashes, and the plan payload hash bound to
  the exact transaction and nonce. Re-derives the journal hash chain and
  requires exactly one attempt with exactly one SUBMITTING (PREPARED →
  SUBMITTING → … → CONFIRMED).
- Chain checks: recovers the **signer from the raw EIP-1559 or EIP-155
  signature** and proves the fields re-hash to the transaction hash. Then
  re-checks recipient, value, calldata, nonce, chain, fee bounds, the
  successful no-log receipt, canonical inclusion, confirmations, the nonce
  delta, the exact balance delta, and that the owner is an EOA.
- Every archived claim must equal the independently derived value.
- Reports finality as `L2_INCLUDED`, `L1_SAFE` or `L1_FINALIZED` from the
  `safe` and `finalized` tags.
- It refuses MOCKED evidence when TESTNET_EXECUTED is required. This was
  tested offline: it refused before any network read.

## Live read-only rehearsal

[RH-DEMO-001-READONLY.json](RH-DEMO-001-READONLY.json) (`PUBLIC_READ_ONLY`,
`signed: false`, `broadcast: false`) records the exact Simulate path against
public Robinhood Testnet for a third-party funded EOA: block 127544672,
nonce 29, `eth_call` = `0x`, gas 26,678, fee budget 0.00000080034 ETH.

A separate browser smoke ran `next dev` in live mode with a read-only stub
wallet for the same EOA. It reached **READY_FOR_OWNER_EXECUTION** from real
chain state, the browser made zero external requests, Execute was not
clicked, and nothing was signed or sent. That account is not the owner and
is not used for execution.

## Tests

| Suite | Result |
| --- | --- |
| `apps/reference-dapp/src/server/robinhood-transfer-service.test.ts` (Build → Simulate → Review → PREPARED → SUBMITTING → one submission → RECONCILED; lost response; unknown stays observation-only across restart; restart before handoff; refusal → fresh Review for the same nonce; ambiguous send cannot be recorded as a refusal; duplicate begin and handoff; semantic edit; stale (expired) Review; nonce change; wrong account; nonce consumed by another transaction; fee raised by the wallet; append-only journal; independent verifier on the archived record) | 15 passed |
| `packages/reference-reconciler/test/native-transfer.test.ts` (reconcile happy path; DIVERGENT: wrong sender, wrong destination, wrong chain in the transaction and at the provider, wrong amount, non-empty calldata, wrong nonce, unsupported type, gas above Review, receipt sender, unexplained logs, effective price above offer, non-canonical block, balance mismatch, revert; INCONCLUSIVE: malformed receipt, awaiting confirmations; simulation refusals; Review tampering, semantic edit, expiry, stale nonce and price; one attempt per run; corrupt runs; nonce discovery; verifier happy path, finality, MOCKED/TESTNET level, tampered claims, bundle and commitment, double SUBMITTING, signature, wrong chain, receipt, balance, confirmations, allowlist) | 29 passed |
| `packages/workflow-contracts/test/native-transfer.test.ts`, `packages/reference-linter/test/native-transfer.test.ts` | 4 passed |
| `packages/action-registry/test/robinhood-chain.test.ts` (updated: exactly one Robinhood row with no evidence; resolves only on Testnet in PUBLIC_TESTNET; wrong wallet chain blocks) | 12 passed |
| `apps/reference-dapp/e2e/robinhood-transfer.spec.ts` (MOCKED loopback chain on 127.0.0.1:8553 with a public disposable fixture key; full flow with exactly one broadcast and the exact wallet request; lost response plus refresh; unknown never broadcast plus refresh; refusal → fresh Review; wrong chain → switch to 0xb626; wrong account; semantic edit) | 7 passed |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | pass: 140 files, 1102 tests, 2 skipped (pre-existing Anvil-gated). A stray untracked `.turbo/build012d-validation/` copy in the canonical checkout is also collected locally; it passes and does not exist in CI. |
| Governance-Lite + self-tests, `git diff --check` | pass; 17 self-tests OK; clean |
| Dependency verification, `pnpm audit --audit-level low`, CycloneDX SBOM (CI script verbatim) | pass; lockfile and dependencies unchanged |
| Browser regression (full CI list, loopback only) | Main 46 passed, 7 failed, 4 skipped. Harness groups all pass: Supply/Borrow/Repay/Withdraw 44, Jupiter 9, Solana Devnet 8, Orca liquidity 5, **Robinhood transfer 7**, CoW 9. Mode A 9 passed, 4 failed. All 11 failures are `toHaveScreenshot` mismatches (local fonts). The same 11 fail on an untouched `git archive` of `7003856`, and **all 11 actual images are byte-identical (SHA-256) between main and this branch**. Baselines were not changed. The composition fork group (official artifact downloads) was not run locally. |
| Anvil gate / fork suite | Same as main: 4 passed, 10 skipped / 31 passed, 29 skipped (owner- or environment-gated) |
| Closure (after owner execution) | Registry row raised to `TESTNET_EXECUTED` (one data value) and the two registry tests that pin it updated; `pnpm check`, unit suite (140 files, 1102 tests, 2 pre-existing Anvil-gated skips), Governance-Lite and `git diff --check` pass. Browser specs were **not re-run after this one-value change**, because the owner's live `next dev` held port 3000; they passed before it, and no browser assertion reads evidence maturity. |

## Evidence ceiling

| State | Reached |
| --- | --- |
| READY_FOR_OWNER_EXECUTION | Yes |
| TESTNET_EXECUTED / RECONCILED | **Yes**: runtime reconciliation of the owner transaction |
| TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED | **Yes**: `scripts/verify-robinhood-transfer.mjs` against public Robinhood Testnet |

There is no `MAINNET_EXECUTED` claim and no DeFi claim. The MOCKED bundles
exist only in automated tests.

## Files

- **IR:** `packages/workflow-contracts/src/native-transfer.ts`
- **Registry:** `packages/action-registry/src/robinhood-chain.ts` (adds
  `ROBINHOOD_TESTNET_TRANSFER`) and `execution-capabilities.ts` (one row)
- **Linter:** `packages/reference-linter/src/native-transfer.ts` and
  `validation.ts`
- **Compiler:** `packages/reference-compiler/src/native-transfer.ts`
- **Executor:** `packages/reference-executor/src/native-transfer.ts`
- **Reconciler:** `packages/reference-reconciler/src/native-transfer.ts` and
  `robinhood-transfer-verifier.ts`
- **App:** `src/server/robinhood-transfer-service.ts`,
  `src/app/robinhood-transfer-action.ts`,
  `src/state/robinhood-transfer-store.tsx`,
  `src/components/robinhood-transfer-panel.tsx` and
  `src/domain/robinhood-transfer-authoring.ts`, plus additive wiring in
  `commands.ts`, `editor.ts`, `proposal.ts`, `app-shell.tsx`,
  `summary-bar.tsx`, `workflow-canvas.tsx`, `artifact-inspector.tsx`,
  `action-library.tsx`, `capability-store.tsx` and `page.tsx`
- **Browser tests:** `e2e/robinhood-transfer-harness.mjs` (+ `.d.mts`),
  `e2e/robinhood-transfer-fixtures.ts`, `e2e/robinhood-transfer.spec.ts`,
  and `playwright.config.ts` (opt-in harness)
- **Script:** `scripts/verify-robinhood-transfer.mjs`
- **CI and package:** `.github/workflows/contracts.yml` (one harness-gated
  line) and `package.json` (lint list)
- **Docs:** this report, the plan, the owner instructions,
  `RH-DEMO-001-READONLY.json`, `RH-DEMO-001-EVIDENCE.json`,
  `RH-DEMO-001-VERIFICATION.json` and `docs/STATUS.md`

No canvas toolbox button was added, so committed pixel baselines are
unchanged. No Aave, BUILD-012D, Solana or Ethereum code changed, and nothing
was renamed.

## Notes

- `next dev` (step 1 of the owner instructions) rewrites the tracked
  `apps/reference-dapp/next-env.d.ts` and generates untracked `AGENTS.md`
  and `CLAUDE.md` in the app folder; this is Next.js behavior. They are not
  part of this PR.
- Robinhood's sequencer may silently exclude a screened transaction. That
  case stays observation-only with no receipt, which is the safe behavior.
