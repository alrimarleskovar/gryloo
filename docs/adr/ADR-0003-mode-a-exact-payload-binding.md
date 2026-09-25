# ADR-0003 — Mode A exact payload binding

Status: ACCEPTED for BUILD-003D under DEC-0023 and DEC-0024 (2026-09-24). ADR-0001 remains PROPOSED; this ADR does not select Mode B.

## Context

BUILD-003A authoring and BUILD-003C observation have no signing authority. BUILD-003D adds an execution path only on the local Base fork at chain 31337. A wallet must authorize the same bytes the user reviewed, and recovery must not turn an unknown result into a duplicate submission.

## Decision

Use two exact EIP-1559 transactions: finite ERC-20 approval and SwapRouter02 multicall with one exact-input swap. Bind their unsigned bytes with the frozen payload hash domain, decode them for the review UI, and re-derive the EIP-1193 request from those bytes. Any wallet change to data, target, nonce, gas or fee fields is divergent. The chain 31337 guard is enforced in compiler, wallet bridge and reconciler; the server cannot broadcast. The independent reconciler verifies on-chain raw transaction, hash, signer and receipt against the reviewed payload and records `RECONCILED` only after all invariants hold.

Add the closed v1 enforcement matrix and EVM payload profile documented in `docs/contracts/`. The matrix binds predecessor hashes, source block, simulation response and per-limit locations. It does not make the v1 policy, Manifest or plan independently enforcing. No frozen v1 schema or fixture changes.

## Consequences

The review discloses two wallet authorizations, fork-only evidence, the exact spender and recipient, gas caps, minimum output, deadline and residual allowance risk. A wallet rejection or error after submission is an unknown result until reconciliation. A local null lookup cannot itself establish `NOT_FOUND` or authorize retry. The recovery path checks nonce, blocks, txpool and the waiting window, and exercises broadcast-before-unknown-result.

UniversalRouter, Permit2, unlimited approvals, typed-data signatures, mainnet execution and Mode B are outside this decision. The v1 policy, Manifest, plan, journal and evidence shape debt remains C-9 through C-12 for a later v2 design.
