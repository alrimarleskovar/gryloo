# Scope guard

## Immutable product thesis

- Gryloo is a conversational and visual compiler plus bounded executor, not a
  swap chatbot or unrestricted autonomous agent.
- Chat, canvas, and integrations share one Semantic Workflow IR.
- Semantic intent, observations, simulation, authorization, execution, journal,
  and evidence remain distinct.
- AI may propose and explain; it is never financial authority.
- Authorization limits must be technically enforced at the stated boundary.
- Execution is fail-closed, resumable, idempotent, and honestly reconciled.

## Naming and visual controls

The display brand is Gryloo. Persistent contracts, schemas, packages, events,
IDs, database objects, and APIs use neutral names. The visual assets are
direction only. Historical or prohibited names may appear solely in governance
checks explaining that they are prohibited. Unsupported claims of protection or
safety are forbidden unless tied to a named enforceable technical control.

## Approved BUILD-001 boundary

The human owner approved the complete revised canonical-contracts plan on
2026-09-22. Its exact create and modify lists are recorded in
[BUILD-001-PLAN.md](builds/BUILD-001-PLAN.md) and enforced by governance CI.
Only the two private contract packages, schemas, fixtures, pure validation and
hash functions, declarative registry, fixed toolchain, tests, and governance
updates are authorized. Implementation uses only
`codex/build-001-canonical-contracts` and is delivered as an unmerged pull request.

All BUILD-000 records, ADR-0001, Master Spec, Master Prompt, root legal texts,
and assets remain byte-identical. ADR-0001 remains `PROPOSED`. Package LICENSE
files must be byte-for-byte copies of `LICENSES/Apache-2.0.txt`.

## Deferred scope

BUILD-002 has separate approval for its local mocked DApp, chat and canvas.
At the BUILD-002 decision there was no approval for an API, database, worker, wallet connection, protocol
adapter, transaction construction, signing, submission, live quote, financial
simulation, reconciliation implementation, managed-plane component, package
publication, Mode B selection, or BUILD-003. Descriptive contracts for these concepts
grant no authority to implement or execute them.

Any difference from approved dependency versions, integrity digests, Node
checksum, peers, licenses, parser behavior, CI downloads, or transitive review
must stop implementation for a human decision before substitution.

BUILD-002 is separately authorized by the human owner. Its exact path scope
and 16-package legal-evidence amendment are recorded in the
[BUILD-002 plan](builds/BUILD-002-PLAN.md). BUILD-003, Mode B, package
publication and financial execution remained unapproved at that decision.

## BUILD-002 governance amendment boundary

The human owner approved a governance-only amendment with an exact path scope
(DEC-0012 and DEC-0017). The byte-identity statement above describes the BUILD-001
boundary. The amendment's only change to root legal text is the factual
`LICENSE` correction in DEC-0013. Official license texts, `NOTICE`,
`TRADEMARKS.md` and every path classification are unchanged. Mode A planning
and non-executing authoring may be separately approved while ADR-0001 remains
PROPOSED (DEC-0015). The amendment approves no BUILD-003 build or sub-build,
and candidate BUILD-003A was `NOT_APPROVED` at that time (DEC-0016), before DEC-0018.

## Approved BUILD-003A boundary

DEC-0018 approves only the exact create and modify paths in the
[BUILD-003A plan](builds/BUILD-003A-PLAN.md). The authoring profile supports
isolated exact-input USDC↔WETH intent on Base and deterministic, non-enforcing
review. Asset caps and slippage thresholds are prototype constraints. Swap
nodes cannot connect to other nodes. The mock workflow remains a mock.

At BUILD-003A completion, no live quote, protocol adapter, RPC, wallet, authorization, calldata, signing, submission, financial simulation, execution, BUILD-003B/003C or Mode B was approved. ADR-0001 remains `PROPOSED`. Existing dependency resolutions and
protected contracts, fixtures, legal texts and historical records remain fixed.

## Approved BUILD-003B boundary

DEC-0019 approves only the exact 25 created and 34 modified paths in the
[BUILD-003B plan](builds/BUILD-003B-PLAN.md). The build adds a `MOCKED`
Quote/State Artifact, Artifact Set and Simulation Bundle chain, generated
locally from a fixed synthetic rate of 1 WETH = 1,000 USDC with a 60-second
validity period. The chain stops after the Simulation Bundle. It is not a live
quote or a financial simulation, and it cannot authorize execution.

At BUILD-003B completion, no live quote, RPC, wallet, router, spender or recipient identity, calldata, authorization artifact, signing, submission, financial simulation, execution, BUILD-003C or Mode B was approved. ADR-0001 remains `PROPOSED`. Frozen contracts,
schemas, fixtures, dependency resolutions and historical records, including the
BUILD-003A plan and report, remain fixed.

## Approved BUILD-003C read-only boundary

DEC-0020 approves the exact [BUILD-003C plan](builds/BUILD-003C-PLAN.md): a Base/Uniswap v3 quote observation in a separate state and UI region. Every `eth_call` and `eth_getCode` uses `{ "blockHash": H, "requireCanonical": true }` and fails closed if unsupported. The public session remains stopped after two HTTP 429 responses at 2/4 attempts and 24/84 requests. DEC-0021 approved Alchemy Free with a server-only Bearer credential and separate 3-attempt/63-request cap; its first `eth_chainId` request received HTTP 403, preserving the original session at 1/3 attempts and 1/63 requests. After the owner enabled Base Mainnet only, Amendment 3/DEC-0022 authorized one carried-counter continuation. The owner-run attempt 2 verified both pinned methods and recorded WETH → USDC; attempt 3 recorded USDC → WETH. Final Alchemy use is 3/3 attempts and 43/63 requests, with no further request approved. The reviewed code pins, replay fixture and local acceptance are recorded in the [report](builds/BUILD-003C-REPORT.md). Observations cannot enter the BUILD-003B mocked chain, workflow IR or an authorization path. Wallet, signing, submission, financial execution and Mode B remain unapproved; ADR-0001 remains `PROPOSED`.

## Approved BUILD-003D fork boundary

DEC-0023 approves the [BUILD-003D plan](builds/BUILD-003D-PLAN.md), Amendments 1–4 and its exact Section 11 path scope. D-5 Amendment 3 handles only the five observed extra Anvil v1.8.3 method names locally: method-not-found for `eth_gasPrice []` and `eth_getAccountInfo [address, H]`; local null for missing `eth_getBlockByHash [hash, true]`, `eth_getTransactionByHash [txHash]` and `eth_getTransactionReceipt [txHash]`. Source H is served only from verified pinned block data or fails closed. These methods never reach Alchemy. Every approved provider-bound state read is rewritten from exact H to `{ "blockHash": H, "requireCanonical": true }`; any other form, hash, method or batch stops. The original provider allowlist, recording caps, exact Anvil command, simulation method and stop rules remain in force. A local null alone cannot establish `NOT_FOUND` or permit retry. At the original approval stage, offline G1 preceded later gates and recording had not yet occurred. The later three stopped owner runs and DEC-0026 evidence boundary are recorded below. BUILD-003 certification requires G7 `PASS` and a later owner decision. Mainnet execution, public testnet execution, Mode B and BUILD-004 remain outside this authority.

At the current boundary, G3 pure packages passed locally and G4 passed offline with owner-reported Free billing confirmation and a key-unset scripted preflight. The owner's later limited G5 authorization permitted one owner-only single-use entrypoint.

The owner ran it once. It stopped after 2/1,800 provider requests (52 reserved CU, `UNAPPROVED_UPSTREAM`), because Anvil sent `eth_gasPrice` with `params` omitted. The consumed journal stays preserved and is never reset or reused.

The offline repair stays within the amended exact lists. It changes no provider method, cap, Anvil argument or simulation method. Under the shared normalization, an omitted `params` is read as `[]` for `eth_gasPrice` only, which remains a local reply. The owner approved that form (A5-1) together with the rest of Amendment 5. Attempt 2 then stopped at the §3.2.3 clean-account rule: all ten default dev accounts carry EIP-7702 code on Base. Amendment 6 then replaced Anvil's public default accounts with pinned project-specific test accounts, confined to the e2e harness and the local fork, with the empty-code rule unchanged. One final attempt 3 (at most 600 requests) is prepared offline.

The full scenario driver still lacks recorded-fork proof. G5, G6–G8 and final persistent governance are pending. No agent live request, wallet operation or recording is authorized.

**Option B closure (DEC-0025).** Attempt 3 stopped with `SETUP_TRANSACTION_FAILED`, and BUILD-003D recording authority is exhausted at 3/3 attempts and 68/1,800 requests.

The owner selected Option B. BUILD-003D closes with exactly 66 created and 26 modified offline-accepted paths, enforced by the updated persistent governance. The remaining 47 planned created and 25 planned modified paths are not delivered.

At the DEC-0025 closure these items moved to BUILD-003F, then `NOT_APPROVED`; DEC-0028 later approved its separate plan and budget:

- the Base recording and transcript;
- the fork application integration (G6);
- the manual-wallet acceptance (G7);
- the dependent certification rows.

No Amendment 7 or further BUILD-003D recording is permitted. BUILD-004 planning is blocked until BUILD-003 certification. Mainnet execution, public testnet execution and Mode B remain outside every authority.

**DEC-0026 delivery-security boundary.** The earlier G1 result is historical pre-secret-removal evidence. The delivered acceptance-only harness holds no phrase or reconstruction input; final-byte pinned-account startup requires BUILD-003F owner-secret revalidation. No recording authority remains in BUILD-003D. Production Gryloo is global, online, non-custodial and multichain; its user-wallet signing flow never takes fork test secrets.

## Approved BUILD-003F local-fork boundary

DEC-0028 approved the [BUILD-003F plan](builds/BUILD-003F-PLAN.md), 52 created and 46 modified paths and 272 protected paths. F2 used disposable test-only account material under owner control. One F3 Alchemy Free Base Mainnet read session acquired finalized, hash-pinned state under a 1,500-request/39,000-reserved-CU cap; it completed at 286/7,436, removed its credential, and produced a credential-free transcript. F4 closed replay reproduced the seven scenarios byte-identically. The separate local fork application is opt-in, same-origin and loopback chain 31337 only; `MOCKED` artifacts cannot authorize it. The manually operated injected wallet G7 signed an approval and swap only on that fork; the independent result is `RECONCILED:EXACT`.

The Base provider was read for state, not used to submit a transaction. No public-chain account, funds or authority is associated with the disposable local accounts. No autonomous wallet, server-held private key, public-chain transaction, production deployment, Mode B or BUILD-004 planning is authorized. DEC-0030 accepted ADR-0004 and certified BUILD-003 only at `FORK_REPRODUCED` on local chain 31337, after PR #11 and post-merge CI passed. No mainnet, public-testnet, production, live-provider, wallet-custody, financial-execution or BUILD-004 implementation authority follows.

## BUILD-004 scope guard

DEC-0031 and Amendment A-1 (DEC-0032) approve exactly the 31 created and 45 modified paths in [BUILD-004 plan §8](builds/BUILD-004-PLAN.md), no deletions, and byte/mode identity for every other path at baseline `05910364feac7f9fe0856a5c2c197eeeb12db902`. The BUILD-003F closed replay, source-of-truth specifications, frozen v1 corpus, legal text and earlier build records remain protected. The local fork, browser screenshots and tests cannot promote BUILD-004 above `FORK_REPRODUCED` chain 31337.

## BUILD-005 approved boundary (DEC-0034)

The owner approved one [BUILD-005 plan](builds/BUILD-005-PLAN.md) from synchronized main `9c5484d`. It authorizes a CoW `SIGNED_INTENT` user journey for the existing semantic swap IR, with exact path scope and protected baseline enforced by governance. Acceptance is deterministic loopback with a disposable local wallet and `MOCKED` settlement only. No public provider, public chain, production wallet, credential, spending, financial transaction or PR merge is in scope. The Master Spec, Master Prompt, accepted ADRs, frozen schemas and historical BUILD-003/004 evidence remain protected. The global multichain roadmap and Solana priority remain intact.

## BUILD-005 certified boundary and BUILD-006 planning (DEC-0035)

After the owner merged PR #15 and both post-merge checks passed, DEC-0035 certifies BUILD-005 COMPLETE at MOCKED only. The deterministic loopback orderbook, disposable injected local wallet and scripted settlement confer no public CoW, public-chain, production-wallet or real-funds authority. BUILD-006 planning is the only next milestone; implementation requires a separate approved plan and owner decision. BUILD-003/004 evidence limits, the global non-custodial multichain roadmap and Solana priority remain unchanged.
