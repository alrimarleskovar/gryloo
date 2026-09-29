# Authority matrix

## Current BUILD-011 implementation authority

DEC-0050 approves the [BUILD-011 canvas/product UX plan](builds/BUILD-011-PLAN.md) from merged BUILD-010 main `5d169748e6a44e3fb63e371a18ace2e0814d5f04`. The work changes authoring controls and graph layout without expanding financial or provider authority. Existing MOCKED, local-fork and read-only evidence boundaries remain separate. One unmerged PR is authorized; owner approval is required for merge.

## Historical BUILD-010 implementation authority

DEC-0048 records BUILD-009 merged on main at `f455892b58561bbe740a83f1aa0837e8ac82f5e4`, without a separate certification claim. DEC-0049 approves the [BUILD-010 plan](builds/BUILD-010-PLAN.md) for direct Across Base → Arbitrum USDC with FIXED `across.direct` authorization, deterministic MOCKED financial lifecycle, optional credentialed read-only Across data, bounded UI cleanup and canvas keyboard edits. No public-chain financial submission or merge is approved.

## Current BUILD-009 implementation authority

DEC-0047 approves the [BUILD-009 plan](builds/BUILD-009-PLAN.md) from certified main `308901495790416c149976aaee747c2fd5ef9f52`: Base USDC → Arbitrum USDC through LI.FI, then Arbitrum USDC → WETH, with an injected EIP-1193 wallet connection in the top bar. Live wallet state and read-only LI.FI quote/route data may be used. Financial execution, recovery and reconciliation remain deterministic MOCKED. This approval permits implementation, tests and one unmerged PR; merge and certification require separate owner decisions. No public-chain financial execution, real funds, `TESTNET_EXECUTED` or `MAINNET_EXECUTED` claim follows.

## Historical BUILD-008 certification authority

DEC-0046 certifies BUILD-008 COMPLETE / CERTIFIED: MOCKED after PR #18 merged as `d5d3934d595943a45f5696fab440437d81e0690c` and post-merge Governance `36479683368` and contracts/reference-app `36479683443` passed. Live LI.FI quote/route data are real read-only provider evidence for the Base → Optimism USDC path. Financial bridge execution, recovery and destination reconciliation are deterministic MOCKED. No `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, real-funds or public-chain financial execution authority follows. BUILD-009 is planning only, with no plan or implementation approved. Previous BUILD certifications are unchanged. The DEC-0043 BUILD-008 planning row below is historical.

## BUILD-007 finite composition authority

After the owner merged PR #17 as b4e2ea34bc04b537014ce54e635f6da9f3a9b1ce, DEC-0043 certifies BUILD-007 COMPLETE / CERTIFIED: FORK_REPRODUCED on local chain 31337 only. The certification rests on the attempt-2 transcript, byte-identical closed replay, direct Roles mint-bound tests and independent raw-RPC reconciliation, and it accepts one post-merge failure of a pre-existing intermittent canvas test as a documented exception. It establishes no public-chain, production-wallet, real-funds, CoW-composition, later-liquidity or BUILD-008 authority. BUILD-008 is planning only. The historical implementation boundary follows.

The approved `MODE_B_FINITE_DELEGATION` profile applies only on local chain 31337. A Safe owner signs the exact approvals, two role installations and revocation; the owner retains broader Safe control. The disposable executor can call only the reviewed Router02 exact-input swap and Position Manager mint through separate one-use Zodiac Roles permissions. Roles enforces target, selector, token pair, Safe recipient, swap input and mint fee, ticks, desired-amount ceilings, fixed minimums and deadline fields. Uniswap enforces output minimum, mint minimums and deadlines. The application checks cumulative budgets, gas reserve, sequential step order, state freshness and durable recovery. Hashes bind review artifacts but do not create onchain enforcement. The direct onchain bypass table and exact boundary results are in the [BUILD-007 report](builds/BUILD-007-REPORT.md). The one read-only Base recording attempt stopped after 2 requests / 52 reserved CU and is exhausted; a new attempt requires another owner decision.

`NOT_ENFORCED` means no financial enforcement control exists in BUILD-001. Documentation,
UI checks, and monitoring do not become independent enforcement.

| Rule | Authority | Enforcement location | Current state |
|---|---|---|---|
| Approve governance scope | Human owner | Repository review and Git history | ENFORCED |
| Apply AI financial proposal | User or delegated authority | NOT_ENFORCED | NOT_IMPLEMENTED |
| Mode A exact payload on the local fork | User signature through an injected EIP-1193 wallet | Browser byte review, same-origin app gateway and signed EIP-1559 payload on chain 31337 only; no general intent binding | FORK_ONLY |
| Mode B maximum policy limits | Safe 1.4.1 plus Zodiac Roles 2.1.0 | Local chain-31337 Roles target/function/parameter/one-time allowance, Uniswap deadline and minimum output; owner acceptance passed | CERTIFIED_LOCAL_FORK_31337 (DEC-0033) |
| Mode C managed execution | Explicit future policy | NOT_ENFORCED | NOT_IMPLEMENTED |
| Pause, revoke, cancel, or refund execution | Future authority boundary | NOT_ENFORCED | NOT_IMPLEMENTED |
| Implement BUILD-001 contracts | Human owner | Explicit 2026-09-22 approval, approved plan, and exact-scope governance checks | APPROVED |
| Accept serialized artifact contracts | Pure validation rules | Raw-byte ingress followed by closed schema validation | CONTRACT_VALIDATION_ONLY |
| Validate revision, invalidation, or state transition | Pure contract rules | Contract package functions; no persistence or execution | CONTRACT_VALIDATION_ONLY |
| Review mocked artifact links, revision binding and freshness | Deterministic application review | NOT_ENFORCED; client-side reference linter and access guard only | APPLICATION_REVIEW_ONLY |
| Publish packages or implement later BUILD-003 stages | Human owner | Separate explicit approval | NOT_APPROVED |

| BUILD-002 reference shell, exact dependency exceptions and legal notice copies | Human owner | [Approved BUILD-002 plan](builds/BUILD-002-PLAN.md), [report](builds/BUILD-002-REPORT.md), [third-party notices](../THIRD_PARTY_NOTICES.md) | APPROVED |
| BUILD-003A | Human owner | DEC-0018 and [approved plan](builds/BUILD-003A-PLAN.md), exact Section 11 scope | APPROVED |
| BUILD-003B | Human owner | DEC-0019 and [approved plan](builds/BUILD-003B-PLAN.md), exact Section 11 scope | APPROVED |
| BUILD-003C | Human owner | DEC-0020, DEC-0021, DEC-0022 and [approved plan](builds/BUILD-003C-PLAN.md); read-only local development observation only | APPROVED |
| BUILD-003C Alchemy continuation after HTTP 403 | Human owner | Approved Amendment 3 and DEC-0022; offline journal validation precedes the owner-run command | APPROVED |
| BUILD-003D Mode A fork implementation | Human owner | DEC-0023 and [approved plan](builds/BUILD-003D-PLAN.md), including Amendments 1–6; closed under Option B (DEC-0025) with 66 created and 26 modified offline-accepted paths | APPROVED |
| BUILD-003F recorded Base fork acceptance, fork application integration and manual-wallet acceptance | Human owner | DEC-0028, approved BUILD-003F plan, one bounded owner recording and manually operated local wallet G7 | APPROVED |
| BUILD-004 finite Mode B local fork implementation | Human owner | DEC-0031 and [approved BUILD-004 plan](builds/BUILD-004-PLAN.md); merge remains owner decision | APPROVED |
| BUILD-005 CoW local signed-intent implementation | Human owner | DEC-0034 and [approved BUILD-005 plan](builds/BUILD-005-PLAN.md); deterministic loopback and disposable local wallet only | APPROVED_MOCKED_LOCAL |
| BUILD-005 CoW local profile certification | Human owner | DEC-0035, [BUILD-005 report](builds/BUILD-005-REPORT.md), PR #15 merge and passing post-merge checks | CERTIFIED_MOCKED_LOCAL (DEC-0035) |
| BUILD-006 isolated Mode A local-fork liquidity implementation | Human owner | DEC-0036 and the approved BUILD-006 plan; owner-operated read-only recording only after its bounded preflight | APPROVED_LOCAL_FORK_ONLY |
| BUILD-006 liquidity local-fork certification | Human owner | DEC-0037, [BUILD-006 report](builds/BUILD-006-REPORT.md), PR #16 merge and passing post-merge checks | CERTIFIED_FORK_REPRODUCED_LOCAL (DEC-0037) |
| BUILD-007 planning after BUILD-006 (historical) | Human owner | DEC-0037 allowed planning only before DEC-0038 | PLANNING_ONLY_HISTORICAL |
| BUILD-007 finite Mode B local-fork composition implementation | Human owner | DEC-0038 and approved BUILD-007 plan; one conditional bounded read-only owner recording; merge remains owner decision | APPROVED_LOCAL_FORK_ONLY |
| BUILD-007 composition local-fork certification | Human owner | DEC-0043, [BUILD-007 report](builds/BUILD-007-REPORT.md), PR #17 merge and a documented post-merge exception for a pre-existing intermittent canvas test | CERTIFIED_FORK_REPRODUCED_LOCAL (DEC-0043) |
| BUILD-008 planning | Human owner | DEC-0043 allows planning only; a separate plan and approval are required for implementation | PLANNING_ONLY |
| BUILD-008 Base → Optimism USDC bridge implementation | Human owner | DEC-0044 and DEC-0045, approved BUILD-008 plan; live LI.FI read-only quote and deterministic MOCKED financial lifecycle only | APPROVED_MOCKED_ONLY |
| BUILD-008 bridge certification | Human owner | DEC-0046, [BUILD-008 report](builds/BUILD-008-REPORT.md), PR #18 merge and passing post-merge Governance, Contracts, Browser, Audit and SBOM | CERTIFIED_MOCKED (DEC-0046) |
| BUILD-009 planning | Human owner | DEC-0046 allows planning only; no BUILD-009 plan or implementation is approved | PLANNING_ONLY |
| BUILD-009 Base → Arbitrum bridge and destination swap implementation | Human owner | DEC-0047 and [approved BUILD-009 plan](builds/BUILD-009-PLAN.md); injected wallet and LI.FI reads; MOCKED financial lifecycle | APPROVED_MOCKED_ONLY |
| Mainnet execution, public testnet execution or Mode C | Human owner | Separate explicit approval required | NOT_APPROVED |

The BUILD-005 CoW signature is an injected-wallet EIP-712 authorization for a disposable local order only. Gryloo does not hold that key. The signed order, posting journal and MOCKED settlement are not public-chain evidence or production financial enforcement.

The Safe/Roles Mode B mechanism is selected and implemented on the controlled local fork under DEC-0031. DEC-0033 certifies BUILD-004 `FORK_REPRODUCED` on local chain 31337 and accepts ADR-0001 for that profile only; no public deployment exists.

ADR-0002 covers contract and toolchain decisions only. General product authorization remains `NONE`; the BUILD-003F Mode A exact-payload signature is limited to the local fork. A valid policy, payload hash, journal entry or evidence bundle alone is data, not a signature or permission.

BUILD-003B mocked Quote/State Artifacts, Artifact Sets and Simulation Bundles
are synthetic data. They carry literal non-executable review results, keep the
canonical workflow state at `DRAFT`, and create no Authorization Policy,
Strategy Manifest, Execution Plan, payload or intent hash. Their hashes and
`MOCKED` provenance identify data; they are not authenticity proof or an
enforcement location.

BUILD-003C observations are not authorization inputs. The public RPC recording is stopped at 2/4 attempts and 24/84 requests after two HTTP 429 responses. The original Alchemy HTTP 403 session remains preserved at 1/3 attempts and 1/63 requests. The owner-run DEC-0022 continuation verified canonical hash-pinned `eth_getCode` and `eth_call`, recorded both directions and ended at 3/3 attempts and 43/63 requests. No additional RPC attempt or request is approved. The local replay and code pins passed acceptance; see the [report](builds/BUILD-003C-REPORT.md). No payment method, paid plan or charge is authorized. The owner's latest delivery instruction allows the agent to push and open the BUILD-003C PR after local acceptance; merge remains with the owner.

DEC-0023's D-5 Amendment 3 permits only local proxy replies for the exact observed Anvil v1.8.3 extra requests. The provider method allowlist, caps, exact Anvil command and simulation method remain unchanged. A local null lookup cannot itself establish `NOT_FOUND` or authorize retry. G1 must pass offline before subsequent gates; no live request or owner-only recording occurred for the amendment. BUILD-003 remains `IN_PROGRESS`; certification requires G7 `PASS` and the separate owner decision.

G3 pure-package and scripted-transport checks passed locally on 2026-09-24. G4 passed offline with owner-reported billing facts and a zero-live-request preflight. The owner subsequently authorized only limited G5 preparation, and the single-use, owner-only entrypoint passed synthetic and saved-replay validation.

**Owner-run attempt.** The owner ran that entrypoint once. It stopped at attempt 1 with 2/1,800 provider requests and 52 reserved CU (`UNAPPROVED_UPSTREAM`). The entrypoint is consumed.

**Authority now.**

- **Amendment 5:** approved on 2026-09-24 for attempt 2. Attempt 2 stopped with `DEV_ACCOUNTS_NOT_CLEAN`.
- **Amendment 6:** approved for a final attempt 3 with project-specific local test accounts. Attempt 3 stopped with `SETUP_TRANSACTION_FAILED`.
- **Recording authority:** exhausted at 3/3 attempts, 68/1,800 requests and 1,768/46,800 reserved CU. No Amendment 7 or further BUILD-003D recording is permitted.
- **Closure:** the owner selected Option B (DEC-0025). BUILD-003D closes with its offline-accepted scope, and the recording, G6, G7 and the dependent certification rows move to BUILD-003F, which is `NOT_APPROVED`.
- **Delivery:** the owner authorized the final BUILD-003D commit, a push and a pull request, and retains merge. The agent has no authority to make a live request, use a credential or operate a wallet.
- **Certification:** BUILD-003 certification remains pending the owner decision, and BUILD-004 planning is blocked until BUILD-003F.

## Current BUILD-003F authority and acceptance boundary

DEC-0028 approved 52 created and 46 modified paths, one real Alchemy Free Base Mainnet recording capped at 1,500 requests and 39,000 reserved CU, and one owner-operated G7 on the replayed chain 31337. The single F3 attempt completed at 286 requests and 7,436 reserved CU; the credential was removed. F4 reproduced the same transcript byte-identically. The owner used MetaMask 13.48.0 in Brave 1.95.104 to authorize only the local approval and swap. Independent G7 verification found both signed payloads exact, both receipts successful and Evidence Bundle `RECONCILED:EXACT`. Gryloo never held the owner wallet key or signed/broadcast a transaction. These are local acceptance facts, not a grant for public-chain use, Mode B, production deployment or BUILD-004. DEC-0030 accepted ADR-0004 and certified BUILD-003 `COMPLETE / CERTIFIED: FORK_REPRODUCED` on local chain 31337 after PR #11 4/4 and successful post-merge Governance and Contracts/app checks. It grants no mainnet, public-testnet, production, live-provider, wallet-custody, financial-execution or later-build implementation authority.

BUILD-006 implementation remains bounded by DEC-0036: the owner operates the one read-only Base recording after preflight; the DApp and server may prepare exact Mode A payloads on local chain 31337, and only the user wallet may sign. Offline unit results confer no recording completion, public-chain write, Mode B liquidity, BUILD-007 composition or merge authority.

After the owner merged PR #16 as 1edd783028ee8eed0953ca1e7e1446ad03229844, the post-merge Governance fetch was fixed in 3e4aae6fb48812a6db64abdd771e13718f96615e; Governance run 36361208012 and contracts/app run 36361208019 then passed. DEC-0037 certifies BUILD-006 COMPLETE / CERTIFIED: FORK_REPRODUCED for the isolated Uniswap v3 Mode A liquidity lifecycle on local chain 31337 only. This does not alter the separate BUILD-003/004/005 certifications. It establishes no public-chain, production-wallet, real-funds, Mode B liquidity or BUILD-007 composition authority. DEC-0037's BUILD-007 planning-only statement is historical; DEC-0038 now approves the bounded BUILD-007 implementation.
