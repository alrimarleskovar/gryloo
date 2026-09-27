# ADR-0004 — Controlled Base fork environment

Status: ACCEPTED under DEC-0030 after BUILD-003F evidence, PR #11 passing 4/4 checks on `45dc852c88810be41ec2a703c163f4e41bcfa2eb`, merge `4bf7d4f6e96c5ef433b0c930dad067d4001f2956` and successful post-merge Governance `36286360276` and Contracts/app `36286360265`.

## Context

Mode A requires finalized Base contract and pool state while every reviewed payload stays valid only on a local chain-31337 fork. Historical BUILD-003D attempts 1–3 stopped at `UNAPPROVED_UPSTREAM`, `DEV_ACCOUNTS_NOT_CLEAN` and `SETUP_TRANSACTION_FAILED` (68 requests total); that recording authority is exhausted and no BUILD-003D transcript exists. The owner never received the historical Amendment 6 phrase. BUILD-003F uses new disposable test-only accounts and independent authority, budget and evidence.

## Controlled environment decision

Use the pinned Foundry Anvil v1.8.3 binary verified by archive, binary and version pins. The local fork serves chain 31337 and reports finalized Base source block N/H in `anvil_metadata`. A loopback proxy reads Base Mainnet through the fixed Alchemy Free endpoint, once establishing `finalized` and then forwarding only the approved D-5 method forms with state reads pinned to `{ "blockHash": H, "requireCanonical": true }`. Exact local replies cover only the Anvil v1.8.3 forms approved in the profile. Concurrent genesis reads queue; one provider request is in flight, starts are at least 400 ms apart, and each reservation is durable before send. Any first error permanently stops the attempt, without provider, block or request fallback.

DEC-0028 permits one whole-scenario F3 attempt, at most 1,500 provider requests, 39,000 reserved listed CU, 30 minutes overall and 30 seconds per request. The newly rotated credential comes only from an owner-owned mode-0600 regular file outside Git created after the preflight. Only the proxy reads its value and sends it in the Authorization header; no browser, Anvil, transcript, journal, argv or child environment receives it. The file is destroyed at completion. The owner confirmed Free billing without a payment method, paid add-on, overage or automatic upgrade and 29,997,692 CU remaining before the attempt.

One separate disposable test phrase for recording, replay and manual-wallet acceptance is stored only in an owner-only mode-0600 file outside Git. Ten derived public addresses are validated against a private public-only pin manifest before fork startup. Pinned Anvil may receive this permanently compromised test phrase in temporary `--mnemonic` argv only inside the approved local test boundary. Neither the phrase nor private keys enter tracked code, tests, reports, snapshots or the app. These accounts must never hold public-chain funds or authority.

The proxy builds a credential-free canonical transcript from exact request/response bytes and source/code pins. Closed replay answers only the recorded or explicitly local policy forms. The app's Mode A path is explicit, same-origin and loopback-only; mocked observations cannot authorize it. A human reviews two exact EIP-1559 payloads and operates an injected EIP-1193 wallet on chain 31337. Gryloo never signs or broadcasts for that wallet. Independent reconciliation re-reads signed bytes, receipts, balances, allowance and effects before a `RECONCILED` outcome.

## BUILD-003F evidence available for acceptance

F2 final-byte revalidation passed 51/51 fork cases and G1 C1–C10. The single real F3 attempt completed at 286 forwarded requests and 7,436 reserved CU, with 37 local replies and seven scenarios. Finalized source block 51,797,365 has hash `0x9951e66b23109cf6f9fb7d89cad05a2de38a15ac2ba789330dc8fb91613c0d82`. The credential-free transcript SHA-256 is `ebf4daaf10f891a735db682e8db2ee383b5165cece414e606a2011e681ed7d75`; the credential file is absent. F4 replay returned `REPLAY_BYTE_IDENTICAL` with the same seven scenario-results digest. Guarded real-replay browser acceptance passed 18/18.

For G7, owner-operated MetaMask 13.48.0 in Brave 1.95.104 signed local approval and swap transactions on chain 31337. The independent verifier returned PASS: both receipt statuses `0x1`, every compared signed field exact, and the `RECONCILED:EXACT` Evidence Bundle hash `0xd651a51063af8f86aee30d7f85844bb4747147bc27eb371807e38c3ac5f795b6`. Observed output was 2,685.012130 USDC with zero residual WETH router allowance. The complete non-secret counts, hashes and limitations are in the [BUILD-003F report](../builds/BUILD-003F-REPORT.md).

## Consequences and acceptance gate

This environment proves at most `FORK_REPRODUCED` local behavior. It does not prove a Base mainnet transaction, production execution, public-testnet behavior, independent Mode B limits or custody safety. The pinned Anvil's OP-stack receipt omits L1 data and operator fees; the service derives those fees independently from signed bytes and L1Block state and discloses that limitation in evidence. A stop cannot be retried without a new owner decision. BUILD-003D's exhausted budget is never reused.

ADR acceptance requires the pinned tools and clean public accounts, finalized canonical source N/H, complete transcript and byte-identical replay, both exact manually signed transactions, independent recovery/reconciliation, credential-free evidence, final local gates, green PR and post-merge CI, and the separate owner certification decision. DEC-0030 records that these criteria passed and certifies BUILD-003 only at `FORK_REPRODUCED` on local chain 31337. This acceptance grants no mainnet, public-testnet, production, live-provider, wallet-custody or financial-execution authority.
