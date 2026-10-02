# RH-DEMO-001 — Robinhood Testnet owner-signed transaction proof (plan)

Baseline: `7003856` (main, including BUILD-RH-001). Branch: `claude/rh-demo-001`.

## Purpose and boundary

This build proves Gryloo can carry one real, owner-signed transaction on
Robinhood Chain Testnet (`eip155:46630`) through the existing authority
model: Build → Simulate → Review → Execute → Result, with a durable journal,
recovery and independent reconciliation.

It is a chain execution proof, not a DeFi capability. It adds no Uniswap,
Morpho, bridge, lending, swap or liquidity support on Robinhood. The
BUILD-RH-001 gate (no canonical testnet DeFi deployment) is unchanged.

## Transaction selected

A native test-ETH self-transfer, using the chain-neutral semantic action
`asset.transfer`, the adapter `evm.native-transfer`, and recipient
`CONNECTED_OWNER`:

```
from  = connected owner (EOA)
to    = the same owner
value = authored amount (default 0.000001 ETH; maximum 0.001 ETH)
data  = 0x
```

Why this transaction:

- **No third-party contract.** No address needs provenance beyond the chain
  itself, so there is nothing to invent or guess.
- **Value stays with the owner.** The only economic effect is the network fee,
  about 24,000 gas × 0.01 gwei ≈ 0.00000024 test ETH, measured on a real
  testnet transfer.
- **Fully deterministic.** No logs, and the balance effect is exactly
  `post = pre − gasUsed × effectiveGasPrice` (verified on a real testnet
  receipt; Arbitrum Nitro's `gasUsed` already includes `gasUsedForL1`). The
  nonce moves exactly N → N+1.
- **One wallet confirmation.**
- **Stronger than a transfer to another address.** A self-transfer checks
  that the value leg nets to zero while the fee leg is exact.

Owner binding stays session state, as in Withdraw: the authored node says
`recipient: CONNECTED_OWNER`, and the address is bound only at Simulate and
Review. The wallet is never a workflow node.

## Components (reused architecture)

| Layer | Addition | Reuses |
| --- | --- | --- |
| IR | `workflow-contracts/native-transfer.ts`: `createNativeTransferNode` / `readNativeTransferNode` (closed declaration) | existing node schema, native `Asset` |
| Registry | One row `asset.transfer` / `evm.native-transfer` / `eip155:46630` / `PUBLIC_TESTNET`, evidence maturity `null`; `ROBINHOOD_TESTNET_TRANSFER` profile | capability resolver, BUILD-RH-001 network identity |
| Linter | Isolated-node validation and amount cap | `validateAuthoringWorkflow` dispatch |
| Compiler | `simulateNativeTransfer`: read state at one block (chain, EOA check, balance, latest and pending nonce, gas price), `eth_call` + `eth_estimateGas` of the exact transaction, fee budget, expected post-balance, artifact set, simulation, policy, manifest, plan and commitment; `assertNativeTransferReview` | Supply artifact and commitment model |
| Executor | `TransferRun` with the shared journal: PREPARED → SUBMITTING → PENDING / SUBMISSION_RESULT_UNKNOWN → CONFIRMED / REVERTED / RECONCILIATION_REQUIRED; read-only nonce-based discovery (binary search on `eth_getTransactionCount`) | `createJournal`, `appendJournalState`, state machine |
| Reconciler | Runtime reconciliation (chain, canonical inclusion, receipt, sender, recipient, value, empty calldata, nonce, gas and fee bounds, exact balance delta, nonce delta, no logs, EOA) and an Evidence Bundle | Evidence Bundle schema |
| Verifier | A strictly read-only independent verifier over the archived record: recovers the signer from the raw EIP-1559 signature, re-reads all chain facts, checks the journal hash chain, exactly one SUBMITTING and the commitment, and reports L2 finality (`latest`/`safe`/`finalized`) | BUILD-RH-001 allowlisted-transport pattern |
| Service | Journal files written by `writeExtendingFile`, process locks, a permanent owner+nonce lease, observation-only unknowns, and a fresh Review only after a proven pre-broadcast refusal | Aave service pattern |
| UI | Authoring form, canvas title, Simulate/Review/Execute panel, wallet switch to Robinhood Testnet through the shared wallet table | shared EIP-1193 wallet store |
| Tests | Unit tests per layer; a browser spec against a MOCKED loopback chain (port 8553) with a disposable fixture key; never a public broadcast | Supply harness pattern |

## Safety

- The wallet request is reachable only from the owner's Execute click.
- PREPARED is persisted before any wallet request, and SUBMITTING is
  persisted immediately before `eth_sendTransaction`.
- An owner+nonce lease is reserved durably before handoff. It is never
  released by uncertainty, so a reload or restart cannot create a second
  economic attempt.
- An unknown result stays observation-only. Discovery uses only reads by
  nonce, and no code path can resend.
- A fresh Review is allowed only after a refusal with no broadcast (wallet
  error code 4001, 4100 or 4200 and no hash). It is never allowed after
  an uncertain submission.
- The fee is bounded by the Review: gas limit and `maxFeePerGas`. A
  transaction that exceeds either, uses another nonce, another recipient,
  another value, non-empty data, or any type other than 0x0/0x2 is
  DIVERGENT.
- The owner must be a plain EOA. A code-bearing account (for example
  EIP-7702) is refused at Simulate.
- Server-side reads use the official public testnet RPC with a method
  allowlist. Live mode requires an explicit development flag and an
  absolute journal directory.

## Evidence states

| State | When |
| --- | --- |
| READY_FOR_OWNER_EXECUTION | This PR. The row's `evidenceMaturity` stays `null` |
| TESTNET_EXECUTED / RECONCILED | After an owner-signed transaction reconciles in the runtime |
| TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED | After `scripts/verify-robinhood-transfer.mjs` passes against public chain state |

Only after the last state may the registry row be raised to
`TESTNET_EXECUTED`, in a follow-up commit with the archived evidence.
