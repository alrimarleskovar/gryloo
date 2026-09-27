# Repository status

## Current BUILD-004 implementation state (2026-09-27)

DEC-0031 approved the [BUILD-004 plan](builds/BUILD-004-PLAN.md) and D-1; DEC-0032 recorded Amendment A-1. The Safe 1.4.1 plus Zodiac Roles 2.1.0 finite swap path is implemented on local chain 31337. The local fork uses the certified BUILD-003F transcript strictly closed, plus explicitly declared local-only accounts and three owner-selected `LOCAL_SETUP_NOT_BASE_OBSERVED` Safe token slots.

Passed locally on this tree:

- the real Mode B browser specs, 4/4 in two consecutive strict runs with repository-confined module resolution;
- the Mode B fork tests: direct bypass, compiler read-back and reconciliation;
- `pnpm check` (346 tests);
- the full browser suite with Mode B off: 42 passed, and the 4 Mode B specs skipped;
- both governance steps.

**Owner-operated injected-wallet acceptance: PASS.** MetaMask in Brave on chain 31337 covered six installation signatures, a browser-independent worker with a fresh-process restart, `RECONCILED`, and four revocation signatures ending in `REVOCATION_CONFIRMED`. The independent verifier returned PASS.

The status is **LOCAL ACCEPTANCE COMPLETE / READY FOR OWNER MERGE DECISION**. Still outstanding:

- remote CI on the final PR #13 head;
- the owner's merge decision;
- post-merge checks.

The [BUILD-004 report](builds/BUILD-004-REPORT.md) separates these gates. Evidence cannot exceed `FORK_REPRODUCED`; no public-chain or production authority exists.

## Current BUILD-003 certification state (2026-09-27)

BUILD-003D was merged through PR #10 at `ca22dd5796614691a8de3a4271c3af5a7c889fd9`. DEC-0028 approved BUILD-003F, then DEC-0029 amended its ceiling to 52 created and 47 modified paths, with 271 protected BUILD-003D baseline paths. The delivered inventory was 52 created and 46 modified. The current owner checkpoint has completed one real Alchemy Free Base Mainnet recording (286 provider requests, 7,436 reserved CU, finalized source block 51,797,365), byte-identical closed replay of transcript `ebf4daaf10f891a735db682e8db2ee383b5165cece414e606a2011e681ed7d75`, 18/18 real-replay browser cases and a manually operated MetaMask/Brave G7 verification. G7 independently found both signed payloads exact, both receipts successful and Evidence Bundle `0xd651a51063af8f86aee30d7f85844bb4747147bc27eb371807e38c3ac5f795b6` `RECONCILED:EXACT` on local chain 31337. The separate earlier F2 owner-secret suite passed 51/51 and G1 C1–C10. See the [BUILD-003F report](builds/BUILD-003F-REPORT.md) for the distinct environments and limits.

**Current markers:** BUILD-003 certification: CERTIFIED: FORK_REPRODUCED. G7 manual wallet acceptance: PASS. BUILD-003: COMPLETE. Under DEC-0030 the owner accepted ADR-0004 and certified the controlled local-fork evidence on chain 31337 after PR #11 passed 4/4 checks on `45dc852c88810be41ec2a703c163f4e41bcfa2eb`, merge `4bf7d4f6e96c5ef433b0c930dad067d4001f2956`, and successful post-merge Governance `36286360276` and Contracts/app `36286360265`. `TESTNET_EXECUTED` and `MAINNET_EXECUTED` remain absent. The owner provider credential was removed after F3. No mainnet, public-testnet, production, live-provider, wallet-custody or financial-execution authority is added. The approved next build remains `NONE_APPROVED`; BUILD-004 planning may be considered separately, but no BUILD-004 implementation is approved.

## Historical BUILD-003D closure state (2026-09-24)

The following paragraphs preserve the state at BUILD-003D closure. Their pending/not-run statements are historical and are superseded by the current BUILD-003F section above.
BUILD-003D was approved under DEC-0023, with Amendments 1–6. It is closed under Option B (DEC-0025) and delivers only the implementation and acceptance evidence that passed offline: 66 created and 26 modified paths.

- **G0:** a deterministic Simulate viewport and screenshot-diff forensics. Local stress passed; CI without a rerun remains pending until the pull request exists.
- **G1:** historical pre-secret-removal Anvil v1.8.3 C1–C10 pass; final-byte pinned-account startup awaits BUILD-003F owner-secret revalidation under DEC-0026.
- **G2:** the additive enforcement-matrix contract and exact-payload profile (ADR-0003, `workflow-contracts` 0.2.0).
- **G3:** the pure compiler, executor and reconciler packages, tested with scripted transports.
- **G4:** the fork harness, closed replay upstream and fork setup, with the G5 incident repairs and the Amendment 6 project-specific test accounts.

Local results on the final tree:

| Check | Result |
|---|---|
| Unit | 313/313 on final bytes |
| Contracts | 79/79 |
| G1 | HISTORICAL_PASS_PRE_SECRET_REMOVAL; final-byte pinned-account startup deferred to BUILD-003F |
| Fork suites | 12 passed, 21 owner-secret cases deferred on final bytes |
| Guarded browser suite | 28/28 at zero pixels |
| Typecheck | 11/11 |
| Build | 7/7 |
| Lint | pass |
| Schema exports | 11 |
| Updated persistent governance programs | pass |

**Recording.** The owner ran three Alchemy attempts, and all three stopped:

- attempt 1: `UNAPPROVED_UPSTREAM`, after 2 requests;
- attempt 2: `DEV_ACCOUNTS_NOT_CLEAN`, after 32 requests;
- attempt 3: `SETUP_TRANSACTION_FAILED`, after 34 requests. The setup read its receipt before Anvil had mined the transaction.

D-5 authority is exhausted at 3/3 attempts, 68/1,800 requests and 1,768/46,800 reserved listed CU. The owner-reported dashboard showed 1,008 CU after attempt 2. No transcript exists, and no further BUILD-003D recording is permitted.

**Moved to BUILD-003F.** BUILD-003F is not approved; it needs its own plan and recording budget. It receives:

- the successful Base recording and transcript;
- the fork application integration (formerly G6);
- the manual-wallet acceptance (formerly G7);
- the dependent certification rows.

BUILD-003E stays reserved for public-testnet evidence. BUILD-004 planning is blocked until BUILD-003 certification, which requires BUILD-003F.

BUILD-003 certification: PENDING_OWNER_DECISION. G7 manual wallet acceptance: NOT_RUN. BUILD-003: IN_PROGRESS.

The agent made no live RPC request, used no credential and operated no wallet. The BUILD-003D commit and pull request are owner-authorized but pending final verification; merge stays with the owner. No `FORK_REPRODUCED`, `RECONCILED` or other execution evidence exists. See the [BUILD-003D report](builds/BUILD-003D-REPORT.md).

- Last merged build: `BUILD-003C`, merged through PR #9 as `8a5fbaed26e005e5719528c399f7ca1adb334eb6` at 2026-09-24T15:31:30Z. Branch and PR checks passed. Post-merge Governance passed on attempt 1; contracts/app passed on attempt 2 after one `simulate-expired` screenshot failure. Exact run and job IDs are in the BUILD-003D plan §2.3. Historical BUILD-003C plan and report remain byte-identical.
- Earlier merged build: `BUILD-003B`, merged through PR #8 as `0faec71207628dfe27fb23c81680d2c27827f5ea` at 2026-09-24T02:46:29Z. Pull-request checks passed (Governance 35948277062; contracts and reference app 35948277082), as did post-merge push checks (Governance 35948667349; contracts and reference app 35948667352). The preserved BUILD-003B report was written before delivery.
- Earlier merged build: `BUILD-003A`, merged through PR #7 as
  `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd` on 2026-09-24. Pull-request
  checks passed (Governance runs 35939197467 and 35939261995; contracts and
  reference app runs 35939197471 and 35939261865), and so did the post-merge
  push checks (Governance run 35940556463; contracts and reference app run
  35940556433). The preserved [BUILD-003A report](builds/BUILD-003A-REPORT.md)
  was written before delivery and still says remote CI was not performed.
- Earlier completed build: `BUILD-002`; result `COMPLETED`, merged through PR #5
  as `606174f0bd944e5a1c31baf8dad685d7558b7cc8`
- BUILD-003B: implementation approved on 2026-09-24 under DEC-0019 and the
  [exact plan](builds/BUILD-003B-PLAN.md); local acceptance and remote CI are
  recorded separately in [its report](builds/BUILD-003B-REPORT.md)
- BUILD-003C: local acceptance passed for a separate read-only Base/Uniswap v3 observation. The public RPC session remains stopped after two HTTP 429 responses at 2/4 attempts and 24/84 requests. The original Alchemy HTTP 403 attempt-1 evidence remains byte-identical at 1/3 attempts and 1/63 requests. After the owner enabled Base Mainnet only and approved Amendment 3/DEC-0022, the owner-run continuation completed both hash-pinned recordings in attempts 2 and 3, ending at 3/3 Alchemy attempts and 43/63 requests. Both transcripts, four reviewed code pins, replay fixture and two observation snapshots passed local checks; no further RPC request is authorized. BUILD-003C was delivered through PR #9 and merged; the post-merge contracts/app check passed on rerun. See the [report](builds/BUILD-003C-REPORT.md).
- Current approved implementation: `BUILD-003D` through its gated plan; after it, `NONE_APPROVED`
- Product implementation: frozen contract packages, mocked visual shell,
  non-executing Base USDC↔WETH authoring with deterministic review, and a
  `MOCKED` Quote/State Artifact, Artifact Set and Simulation Bundle chain built
  locally from a synthetic fixture
- Financial functionality: read-only historical quote observation in local replay, with opt-in local-development live reads only; no wallet, signing, submission, financial simulation or execution
- Authorization mode: `NONE`; financial enforcement: `NOT_ENFORCED`; the
  canonical workflow state stays `DRAFT`
- Interface and mocked artifact evidence label: `MOCKED`
- Build financial outcome: `NOT_APPLICABLE`
- Asset metadata: `NOT_ONCHAIN_VERIFIED`
- Licensing authority: `RESOLVED_FOR_PREINCORPORATION_LICENSING`
- Future legal-entity transfer: `DEFERRED_UNTIL_INCORPORATION`
- License publication: `AUTHORIZED`
- Third-party materials: `EXCLUDED_UNLESS_VERIFIED`
- CLA adoption: `DEFERRED`
- Dependency inventory: 245 pinned registry identities and 16 reviewed license
  exceptions; BUILD-003D adds the approved two Noble identities for 247 locked registry identities without changing the earlier resolutions

## Historical state by category at BUILD-003D closure

| Category | Current state |
|---|---|
| Planned | BUILD-003F (recorded Base fork acceptance, fork application integration and manual-wallet acceptance) must be planned and approved separately; no later build is approved |
| Mocked | Local command assistant, example nodes, stage shell and the synthetic quote and simulation fixture |
| Implemented locally | BUILD-001 contracts, BUILD-002 shell, BUILD-003A authoring and deterministic lint, BUILD-003B mocked artifact chain, BUILD-003C read-only observation and offline replay, BUILD-003D pure compiler/executor/reconciler with scripted transports |
| `MOCKED` | Interface interactions and the Quote/State, Artifact Set and Simulation Bundle chain; internal logic only, no financial evidence |
| `FORK_REPRODUCED`, `TESTNET_EXECUTED`, `MAINNET_EXECUTED` | None |
| `CONFIRMED_NOT_RECONCILED`, `RECONCILED`, `INCONCLUSIVE`, `DIVERGENT` | None |
| Blocked or not approved | BUILD-003D recording authority exhausted (3/3 attempts, no transcript); BUILD-003F not yet approved; BUILD-004 planning blocked until BUILD-003 certification; Mode B (ADR-0001 remains PROPOSED), package publication and mainnet execution not approved |

Historical BUILD-000, BUILD-001, BUILD-002 and BUILD-003A records and the
BUILD-002 governance amendment remain unchanged. BUILD-003B local and remote
evidence must be read separately in its report. Mocked provenance and hashes
identify synthetic data; they are not proof of authenticity or of independent
financial enforcement.
