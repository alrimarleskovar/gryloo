# Scope guard

## Current UX path policy (BUILD-GOV-001)

Ordinary reference DApp styling, image assets, canvas and Simulate presentation, editor helpers, and UX browser tests use the category rules in `scripts/governance_ux_scope.py`. They need typecheck, lint, focused tests, and browser tests when relevant. They do not need a DEC record, owner path approval, or a manual governance amendment. Unrecognized paths fail closed. Wallet/signing, server and network code, protocol adapters, execution and capability rules, public execution, evidence promotion, credentials, and governance files still require explicit approval. Historical build comparisons remain pinned to their delivered commits. This policy grants no execution authority.


## BUILD-011D-1 approved implementation boundary (DEC-0054)

Only the [BUILD-011D-1 plan](builds/BUILD-011D-1-PLAN.md) exact paths may change from `33a83ce9de18d8bbbfe4ccfb73811b00c09f290d`. The owner’s `.canvas-toolbox` margin and floating toolbox position are preserved. The Action Registry gains a distinct capability resolver and the DApp gains presentation-only environment inspection and typed Execute blockers. No public transaction, `TESTNET_EXECUTED`, Mainnet, new provider, BUILD-011D-2, BUILD-012 or merge is authorized. Historical BUILD-011C-1 and BUILD-011C-2 scopes remain frozen.

## BUILD-011C-2 approved implementation boundary (DEC-0053)

Only the [BUILD-011C-2 plan](builds/BUILD-011C-2-PLAN.md) exact paths may change from `0ac839738e9aa198007fbf354ea2f14894459c38`. Preserve the BUILD-011C-1 tree as historical baseline. Recovery may classify destination swap/mint failure, unknown mint results, policy expiry and stale artifacts in MOCKED composition, and present bounded choices in the existing DApp. No new provider, return bridge, public-chain execution, BUILD-011D, BUILD-012 or merge is authorized.

## BUILD-011C-1 approved implementation boundary (DEC-0052)

From BUILD-011B merged main `89415eb3574ddd28ab8b1cb0d39e221791c5521f`, use only the [BUILD-011C-1 plan](builds/BUILD-011C-1-PLAN.md) exact paths. Reuse Base → Arbitrum LI.FI or direct Across bridge and the existing Uniswap liquidity adapter with only Arbitrum deployment and pool identity validation added. The composed financial journey is MOCKED, with no public financial transaction, new bridge route/provider, new liquidity protocol, Aave, compensation, failure recovery, BUILD-012 or merge authorization. The historical BUILD-011 and BUILD-011B scopes remain frozen. BUILD-011C-2 is still required before Master Prompt Build 011 completion.

## BUILD-011B approved implementation boundary (DEC-0051)

From merged BUILD-011 main `502d167212cdff80ad4c6740ed8bde47eace1c31`, implement only the [BUILD-011B plan](builds/BUILD-011B-PLAN.md) exact paths. The toolbox mode key stores presentation preference only; canvas layout stays separate from semantic IR. BUILD-011 remains historically frozen. Existing MOCKED, local-fork, wallet, provider and evidence limits remain in force. No new financial execution level, provider, chain, real funds, testnet/mainnet executed claim, next functional build, or merge is approved.

## Historical BUILD-011 implementation boundary (DEC-0050)

From merged BUILD-010 main `5d169748e6a44e3fb63e371a18ace2e0814d5f04`, implement the [BUILD-011 plan](builds/BUILD-011-PLAN.md) for canvas and product UX only. Layout metadata remains separate from semantic IR. Existing provider authorization, wallet and evidence limits remain in force. No new provider, chain, financial execution level, real funds, testnet/mainnet executed claim or merge is approved.

## Historical BUILD-010 pre-merge boundary

## BUILD-010 approved implementation boundary (DEC-0049)

From main `f455892b58561bbe740a83f1aa0837e8ac82f5e4`, implement only the exact [BUILD-010 plan](builds/BUILD-010-PLAN.md) path set. Direct Across Base → Arbitrum USDC uses FIXED authorization and deterministic MOCKED financial execution. Credentials for optional read-only Across data stay server-side. No post-authorization silent provider change, public-chain financial submission, real funds, broad redesign, testnet/mainnet execution claim, or merge is approved.

## BUILD-009 approved implementation boundary (DEC-0047)

DEC-0047 approves the [BUILD-009 plan](builds/BUILD-009-PLAN.md) only for Base USDC → LI.FI bridge → Arbitrum USDC → Arbitrum WETH and an injected EIP-1193 top-bar wallet. Live wallet connection and read-only LI.FI quotes are allowed. Financial execution, recovery and reconciliation are deterministic MOCKED. No public-chain financial execution, real funds, `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, merge or certification is approved. Exact created and modified paths are enumerated in the plan; all other certified-main paths remain protected.

## Historical BUILD-008 certified boundary and BUILD-009 planning (DEC-0046)

DEC-0046 certifies BUILD-008 COMPLETE / CERTIFIED: MOCKED for one Base → Optimism USDC bridge path. Live LI.FI token and quote/route data are real read-only provider evidence; financial bridge execution, recovery and destination reconciliation are deterministic MOCKED. The certification establishes no `TESTNET_EXECUTED` or `MAINNET_EXECUTED` result, real-funds use or public-chain financial execution. Earlier BUILD certifications remain unchanged. BUILD-009 is planning only; implementation requires a separate approved plan and owner decision. The BUILD-007 boundary below is historical and separately certified.

## BUILD-007 certified boundary and BUILD-008 planning (DEC-0043)

After the owner merged PR #17, DEC-0043 certifies BUILD-007 COMPLETE at FORK_REPRODUCED on local chain 31337 only. The finite composition confers no public-chain, testnet, mainnet, real-funds, production-wallet, CoW-composition or later-liquidity authority. BUILD-008, the LI.FI-routed bridge, is the only next milestone and is planning only; implementation requires a separate approved plan and owner decision. The pre-existing intermittent Simulate canvas race is out of BUILD-007 scope and needs its own approved diagnosis.

## BUILD-007 approved path and authority guard (historical implementation scope)

DEC-0038 approves only the exact created and modified paths in [BUILD-007 plan §11](builds/BUILD-007-PLAN.md), plus the six consumer-manifest pin amendments recorded there. Every other tracked baseline path, including certified BUILD-003–006 records and transcripts, frozen v1 contracts/vectors and prior visual snapshots, is byte- and mode-protected. The owner authorizes implementation, local gates, one conditional bounded read-only Base recording, report, commit, push and one unmerged PR. Public-chain writes, testnet, mainnet, production keys, real funds, later liquidity operations, package publication and PR merge remain outside scope.

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

## BUILD-006 approved boundary (DEC-0036)

The owner approved the exact create and modify paths in the [BUILD-006 plan](builds/BUILD-006-PLAN.md) from main `4a402dd6be956fee0e3df001b8ad0f356f625937`; every other baseline path remains byte- and mode-protected. The isolated Uniswap v3 Base USDC/WETH liquidity lifecycle uses Mode A exact user-wallet payloads only on local chain 31337. A new owner-operated read-only Base recording is conditional on the plan's offline preflight and fixed one-attempt caps. No previous transcript or provider budget may be repurposed. The target ceiling is `FORK_REPRODUCED`; no public-chain write, real funds, production wallet, Mode B liquidity, BUILD-007 composition or merge is approved. The global non-custodial multichain roadmap and Solana priority remain unchanged.

## BUILD-006 implementation checkpoint

The additive liquidity path is disabled without an explicit local-fork profile. Its shared IR action cannot compose with a swap or CoW node in BUILD-006. Offline math, wallet-byte and mocked service tests establish engineering behavior only. The distinct new Base transcript, byte-identical owner-local replay and independent lifecycle results were required before any `FORK_REPRODUCED` statement. They passed locally on 2026-09-28. The single approved recording attempt is spent, and a new recording needs a new owner decision. The BUILD-003/004/005 protected records and evidence ceilings remain separate.

## BUILD-006 certified boundary and BUILD-007 planning (DEC-0037)

After the owner merged PR #16 and the post-merge checks passed, DEC-0037 certifies BUILD-006 COMPLETE at FORK_REPRODUCED on local chain 31337 only. The isolated liquidity lifecycle confers no public-chain, testnet, mainnet, real-funds, production-wallet or Mode B liquidity authority. BUILD-007 swap-to-liquidity composition planning is the only next milestone; implementation requires a separate approved plan and owner decision.

## BUILD-011D-2 scope guard (DEC-0055)

The [BUILD-011D-2 plan](builds/BUILD-011D-2-PLAN.md) lists exact paths from baseline `205055605d96f36e024a0bbc770453113e4f7b40`. Only the Uniswap v3 Swap + Base Sepolia + PUBLIC_TESTNET profile gains public execution support. Implementation support alone leaves demonstrated evidence unset. A real canonical DApp swap with explicit wallet authorization, successful public receipt, independent balances, gas, Evidence Bundle and explorer is required for exact-profile `TESTNET_EXECUTED`. All earlier records and unrelated capabilities remain protected.

## BUILD-012A exact exception

Under DEC-0056, scripts/governance_build012a_scope.py checks the exact approved baseline, branch and 64-file inventory in BUILD-012A-PLAN §8. This single Supply exception does not expand the ordinary UX category policy. No directories, extra paths, deletions, dependency/integrity changes or server signing are permitted. The public acceptance JSON remains absent until owner execution independently reconciles.
