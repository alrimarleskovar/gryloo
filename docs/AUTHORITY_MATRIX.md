# Authority matrix

`NOT_ENFORCED` means no financial enforcement control exists in BUILD-001. Documentation,
UI checks, and monitoring do not become independent enforcement.

| Rule | Authority | Enforcement location | Current state |
|---|---|---|---|
| Approve governance scope | Human owner | Repository review and Git history | ENFORCED |
| Apply AI financial proposal | User or delegated authority | NOT_ENFORCED | NOT_IMPLEMENTED |
| Mode A exact payload on the local fork | User signature through an injected EIP-1193 wallet | Browser byte review, same-origin app gateway and signed EIP-1559 payload on chain 31337 only; no general intent binding | FORK_ONLY |
| Mode B maximum policy limits | Safe 1.4.1 plus Zodiac Roles 2.1.0 | Local chain-31337 Roles target/function/parameter/one-time allowance, Uniswap deadline and minimum output; final owner acceptance pending | LOCAL_FORK_TESTED |
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
| Mainnet execution, public testnet execution, Mode C or BUILD-005 implementation | Human owner | Separate explicit approval required | NOT_APPROVED |

The Safe/Roles Mode B mechanism is selected and implemented on the controlled local fork under DEC-0031. Final BUILD-004 acceptance and certification are pending; no public deployment exists.

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
