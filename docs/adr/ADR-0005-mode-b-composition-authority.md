# ADR-0005 — Finite Mode B swap to liquidity authority

Status: PROPOSED for BUILD-007 local acceptance. The owner approved implementation of the [BUILD-007 plan](../builds/BUILD-007-PLAN.md), including this authority design. Acceptance of the ADR and certification require a separate owner decision after an unmerged PR, its checks, merge and post-merge checks.

## Context

BUILD-004 proves a finite isolated Safe/Roles swap; BUILD-006 proves an isolated Mode A Uniswap v3 position. Their certified source blocks differ. A composition must obtain a new single-source transcript, reconcile the swap output before selecting mint amounts, and constrain both transactions even when the worker, browser or RPC fails.

## Decision

For the first composition, permit only Base USDC → WETH through Router02 at fee 500, followed by one WETH/USDC fee-500 Position Manager mint on local chain 31337. The disposable Safe owns the output WETH and receives the NFT. The owner signs Safe module setup, two separate Roles scopes, one-use non-refilling allowances and exact finite ERC-20 approvals. A disposable executor can invoke each scoped function once. Roles constrains the swap target, selector, pair, Safe recipient and input, and the mint target, selector, pair, fee, ticks, Safe NFT recipient, each desired token cap, fixed minimums and deadline. Router and Position Manager enforce protocol output and deadline checks. The owner retains broader Safe authority. Gas, step order and quote freshness are application controls.

The permission profile is a strict additive `mode-b-composition-permission` domain in `workflow-contracts` 0.3.0. Its hash binds the Manifest and exact reviewed state, but a document hash alone is never described as onchain enforcement. The two-node semantic IR stores a typed WETH output reference. Quote, pool, receipts, token ID, balances and transaction status remain separate artifacts.

The worker has a fixed swap then mint sequence. It writes durable workflow, segment, step and attempt records before sending, records the exact mint choice before the second send, and never resends an unknown submission. A confirmed swap must reconcile before a fresh pool/range calculation chooses the bounded mint. A reverted mint leaves WETH and USDC in the Safe and reports partial completion; it never automatically swaps back. Revocation requires separate owner calls and chain readback. Deleting a journal cannot undo a confirmed chain effect.

## Evidence and limits

Synthetic rehearsals are `MOCKED`. The maximum permitted BUILD-007 outcome is `FORK_REPRODUCED`, contingent on a new bounded owner-operated read-only Base recording, credential-free closed replay with byte-identical scenario results, direct Roles bypass tests and independent signed-byte, receipt, NFT, transfer, allowance and role-state reconciliation. No Base public transaction or production security claim follows. A source read is `NOT_EVIDENCE` for a transaction. A receipt without reconciliation is `CONFIRMED_NOT_RECONCILED`.

The recording proxy is single flight, waits at least 400 ms between provider sends, reserves before send, allows at most 1,500 requests and 39,000 listed CU in 30 minutes, and stops permanently on the first provider, policy or validation error. A fresh owner-controlled mode-0600 credential and current Free-plan report are required after a complete synthetic dry run and exact preflight. The credential is removed after the one attempt. No previous BUILD-003 through BUILD-006 transcript or budget is reused.

## Consequences

The flow may be partially complete. An unknown swap or mint result freezes continuation pending exact receipt, nonce, bytes, role and balance reconciliation. Changing a material graph value retires downstream artifacts and requires new owner authority. CoW composition, increase/remove/collect, rebalancing, another chain or pool, public-chain writes and production keys remain outside this decision. Certified BUILD-003 through BUILD-006 records, v1 schemas and vectors stay byte-identical.
