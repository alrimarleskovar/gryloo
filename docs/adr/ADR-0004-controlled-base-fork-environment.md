# ADR-0004 — Controlled Base fork environment

Status: PROPOSED (2026-09-24). Carried to BUILD-003F under DEC-0025, which closes BUILD-003D under Option B. G4 passed offline. The single owner-run G5 attempt stopped after two provider requests, and its offline repair passed. Attempt 2 under Amendment 5 stopped because all ten Anvil default dev accounts carry EIP-7702 code on Base. Amendment 6 replaces them with pinned project-specific test-only accounts on the derivation path m/44'/60'/31337'/0/. The phrase is confined to the e2e harness, and the empty-code rule is unchanged. The final attempt 3 then stopped with `SETUP_TRANSACTION_FAILED`. This ADR is not accepted as execution evidence.

## Context

Mode A needs real Base contract and pool state while every reviewed payload must be valid only on the local fork. A live provider session is needed to acquire finalized, hash-pinned source state. The provider credential must stay with the owner, and later verification must reproduce the same state without another live read.

## Decision

Use the approved Foundry Anvil v1.8.3 binary, verified by archive, binary and version pins. The fork serves chain 31337 and reports Base 8453, the finalized source block number and hash in `anvil_metadata`. Anvil reads the source through one loopback proxy. The owner alone starts the recording proxy with the Bearer credential in the WSL process environment. Gryloo never stores that credential in an argument, URL, transcript, journal, browser or repository file.

The proxy reads `finalized` once, then forwards only the approved D-5 methods. State reads from Anvil must name the exact source hash; the proxy rewrites them to `{ "blockHash": H, "requireCanonical": true }`. Amendment 3's five extra method names receive only their exact local replies. Persistent counters allow at most three whole-scenario attempts, 900 provider requests per attempt and 1,800 total. The proxy permits one in-flight request and starts at least 400 ms apart. A non-200 status, RPC error, changed source block, timeout, oversized response, policy breach or interrupted journal stops the session without fallback.

The transcript records credential-free canonical exchanges and exact response bytes. The closed replay upstream answers only transcript requests. Fork setup uses Anvil's built-in dev accounts, local ETH funding, a WETH deposit, a labeled setup swap for USDC and 20 empty local blocks. Reviewed workflows use the local chain 31337 only. The recording command remains owner-run, after G1, G4 preflight and the owner-reported Free billing confirmation.

## Consequences

The fork is evidence for `FORK_REPRODUCED` only. Its signatures are invalid on Base mainnet. The source state, local ETH override, setup transactions, test-wallet surface and manual-wallet surface must be identified in evidence. An unrecorded state request fails closed and may require an owner-acknowledged whole-scenario rerecord within the original caps. G4 prepares and checks the boundary offline; it does not record state or prove fork execution.

The G5 incident (2026-09-24) established two wire facts about the pinned Anvil. The recording proxy, the replay upstream and G1 must all apply them identically:

- **Omitted `params`.** Anvil sends `eth_gasPrice` with the JSON-RPC `params` member omitted.
- **Concurrent genesis reads.** Anvil issues its genesis account reads concurrently, up to 40 at once.

The proxy therefore normalizes the wire form once and queues requests, keeping one provider request in flight. It never stops merely because requests arrive together. After a stop it keeps answering with errors instead of closing its listener. The harness starts Anvil only after the upstream is listening, and treats readiness as Anvil's own listening line.

**Closure outcome.** Attempt 3 selected the Amendment 6 accounts. It then stopped because the fixture read a receipt before Anvil's asynchronous automine; under paced recording, mining first needs roughly 25 reads of OP-stack system contracts and the target.

BUILD-003D recording authority is exhausted, and no recorded Base state exists. This ADR therefore stays `PROPOSED`, and its acceptance moves to BUILD-003F. Two lessons carry forward:

- waiting for inclusion is required;
- an offline full-fixture rehearsal against locally deployed contracts must precede any recording.
