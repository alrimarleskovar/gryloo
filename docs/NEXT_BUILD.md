# Next build

## Current implementation: BUILD-012A

DEC-0056 approves [BUILD-012A Supply](builds/BUILD-012A-PLAN.md) from main `64a0a46f45532d667e226193f29529d8938acf15`. Status: READY_FOR_OWNER_EXECUTION. One exact official Aave V3 USDC Supply profile on Base Sepolia is authorized, with owner execution through Gryloo required for TESTNET_EXECUTED. The wallet-handoff correction and deterministic checks pass; current CI is recorded on the PR. Draft PR #38 remains unmerged. The exact reserve is funded; a fresh owner Review and injected-wallet execution are next. BUILD-012B Borrow, 012C Repay and 012D Withdraw remain unstarted and unapproved. No merge is authorized.

## Current next milestone: BUILD-012A owner public execution

Only independently reconciled real injected-wallet execution initiated by the owner in Gryloo satisfies acceptance. MOCKED fixtures and fork tests are development evidence.

## Historical implementation: BUILD-011D-2

The owner approved the [BUILD-011D-2 plan](builds/BUILD-011D-2-PLAN.md) under DEC-0055. The owner-authorized DApp swap succeeded and its public receipt, balances, gas and Evidence Bundle support `TESTNET_EXECUTED` for the exact Uniswap Swap + Base Sepolia profile. Local gates, one unmerged PR and CI close this build. BUILD-012 — Aave V3 primitives — remains a separate future decision; no BUILD-012 implementation is underway.

## Historical next milestone: BUILD-011D-2 — First real public testnet/devnet execution

DEC-0054 approves BUILD-011D-1 from main `33a83ce9de18d8bbbfe4ccfb73811b00c09f290d`: capability registry, runtime environment inspection and honest Execute gating. Its unmerged PR remains for owner review. BUILD-011D-2 is the next planned build for the first real public testnet/devnet execution from the canonical Gryloo DApp, subject to a separate plan and owner approval. No public financial transaction, `TESTNET_EXECUTED`, Mainnet, BUILD-012 Aave V3, or merge is authorized by BUILD-011D-1.

## Historical next milestone: BUILD-011D-1 (2026-09-29)

BUILD-011C-2 implemented MOCKED cross-chain liquidity failure and recovery under DEC-0053 from merged main `0ac839738e9aa198007fbf354ea2f14894459c38`. The planned sequence was BUILD-011D-1, BUILD-011D-2 public testnet/devnet execution, then BUILD-012 Aave V3. Its implementation authority did not include BUILD-011D or BUILD-012.

## Historical next milestone: BUILD-011C-1 approved implementation (2026-09-29)

DEC-0052 approves the [BUILD-011C-1 plan](builds/BUILD-011C-1-PLAN.md) from BUILD-011B merged main `89415eb3574ddd28ab8b1cb0d39e221791c5521f`. The bounded successful Base → Arbitrum liquidity composition reuses the existing bridge and Uniswap adapter; financial execution remains MOCKED. One unmerged PR is authorized. BUILD-011C-2 destination failure, compensation authority, recovery and manual intervention remain required before Master Prompt Build 011 is complete. Merge remains the owner's decision.

## Historical next milestone: BUILD-011B approved implementation (2026-09-29)

BUILD-011 merged on main at `502d167212cdff80ad4c6740ed8bde47eace1c31`. DEC-0051 approves the [BUILD-011B editor stabilization plan](builds/BUILD-011B-PLAN.md), including drag and connection fixes, selectable toolbox presentation, and an exact-path governance amendment. One unmerged PR is authorized; merge remains the owner’s decision. No next functional Master Prompt build is approved.

## Historical next milestone: BUILD-011 approved implementation (2026-09-29)

BUILD-010 is merged on main at `5d169748e6a44e3fb63e371a18ace2e0814d5f04`. DEC-0050 approves the [BUILD-011 canvas/product UX plan](builds/BUILD-011-PLAN.md): direct node manipulation, editable connections, contextual action editing, a six-action toolbox and a quieter Build workspace. The existing semantic IR, provider rules, wallet, and evidence ceilings remain unchanged. One PR is authorized; merge remains the owner’s decision. No separate BUILD-010 certification or post-merge CI claim is made here.

## Historical next milestone: BUILD-010 approved implementation (2026-09-29)

BUILD-009 is merged on main at `f455892b58561bbe740a83f1aa0837e8ac82f5e4` under DEC-0048; no separate BUILD-009 certification or post-merge CI claim is made. DEC-0049 approves the [BUILD-010 plan](builds/BUILD-010-PLAN.md): direct Across Base → Arbitrum USDC, fixed-provider authorization, deterministic MOCKED financial lifecycle, bounded UI cleanup and canvas keyboard controls. Live Across reads require server-side credentials; merge remains an owner decision.

## Historical next milestone: BUILD-009 approved implementation (2026-09-28)

## Historical BUILD-009 approved implementation (2026-09-28)

DEC-0047 approves the [BUILD-009 plan](builds/BUILD-009-PLAN.md) from certified main `308901495790416c149976aaee747c2fd5ef9f52`: Base USDC → LI.FI bridge → Arbitrum USDC → Arbitrum WETH swap, with injected EIP-1193 wallet connection and explicit chain switching. Live wallet connection and LI.FI reads are allowed. Financial execution, recovery and reconciliation remain MOCKED. Implementation, tests and one unmerged PR are approved; merge and certification are not. BUILD-008 and prior certifications remain unchanged.

## Historical BUILD-009 planning-only state (2026-09-28)

DEC-0046 certifies BUILD-008 COMPLETE / CERTIFIED: MOCKED after [PR #18](https://github.com/alrimarleskovar/gryloo/pull/18) merged as `d5d3934d595943a45f5696fab440437d81e0690c` and post-merge Governance `36479683368` and contracts/reference-app `36479683443` passed, including Browser, Audit and SBOM. The implemented path is Base → Optimism USDC. Live LI.FI quote/route data are real read-only provider evidence; financial execution, recovery and destination reconciliation remain deterministic MOCKED. No `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, real-funds or public-chain financial execution claim follows. BUILD-009 is planning only; no BUILD-009 plan or implementation is approved. BUILD-003/004/006/007 `FORK_REPRODUCED` and BUILD-005 `MOCKED` certifications, BUILD-003E and BUILD-007E separation, and the global non-custodial multichain roadmap with Solana priority remain unchanged. See the [BUILD-008 report](builds/BUILD-008-REPORT.md).

## BUILD-007 approved implementation (historical, 2026-09-28)

DEC-0038 approves the [BUILD-007 plan](builds/BUILD-007-PLAN.md) from synchronized main `f4868b94e10981b820653dd21d1ef94a72edb067`. Its first finite Mode B swap-to-liquidity composition is limited to local chain 31337. The owner also approved the six exact workspace manifest pin changes required by `workflow-contracts` 0.3.0. The one separately bounded, owner-operated, read-only Base recording is conditional on credential-free rehearsal, preflight, Free-plan state and a fresh private key; its one attempt stopped after 2 reads / 52 reserved CU and is exhausted. DEC-0039 confirms the cause (a harness runtime outside `/tmp/`) and approves two fixes: a `/tmp/` runtime in every mode and a 120,000 ms live-recording fork RPC timeout. After both, 16/16 credential-free synthetic rehearsals passed with byte-identical closed replay. DEC-0040 then authorized one attempt-2 recording from `/home/asus/.gryloo/build-007-attempt-2`. It completed at Base block 51,906,032 (122 requests / 3,172 reserved CU; transcript `337da42d…c30a496d`). Its closed replay is byte-identical, and fork tests, browser specs and independent verification pass on it, so BUILD-007 demonstrates `FORK_REPRODUCED` on local chain 31337. It is not certified: pushing the transcript and records, PR-head CI, owner merge, post-merge CI and a separate certification decision remain. The approved maximum possible evidence was `FORK_REPRODUCED`, with owner merge and certification still separate. No BUILD-008 scope or implementation is approved. BUILD-003E and the global non-custodial multichain roadmap, including Solana priority, retain their prior positions.

## Historical next milestone: BUILD-007 planning only (2026-09-28)

DEC-0037 closes BUILD-006 as COMPLETE / CERTIFIED: FORK_REPRODUCED on local chain 31337. [PR #16](https://github.com/alrimarleskovar/gryloo/pull/16) merged into main as 1edd783028ee8eed0953ca1e7e1446ad03229844. After the Governance fetch fix 3e4aae6fb48812a6db64abdd771e13718f96615e, post-merge Governance run 36361208012 and contracts/app run 36361208019 passed. BUILD-007, the first swap-to-liquidity Mode B composition in the Master Prompt roadmap, may be planned. No BUILD-007 plan, implementation, public provider, public chain, production wallet or real-funds operation is approved; a later plan and separate explicit owner approval are required before implementation. BUILD-003E public-testnet evidence and the global non-custodial multichain roadmap, including Solana priority, remain unchanged.

## BUILD-006 approved implementation (historical, 2026-09-27)

DEC-0036 approves the [BUILD-006 plan](builds/BUILD-006-PLAN.md) from clean synchronized main `4a402dd6be956fee0e3df001b8ad0f356f625937`. The one isolated Uniswap v3 Base USDC/WETH Mode A liquidity lifecycle is limited to a controlled chain-31337 fork, with a conditional one-attempt owner-operated read-only Base recording and a maximum `FORK_REPRODUCED` evidence target. Implementation, local gates, report, commit, push and one unmerged PR are authorized. The owner retains merge. No public-chain transaction, mainnet execution, real funds, production wallet, BUILD-007 composition or Mode B liquidity authority is approved. The BUILD-003/004 fork and BUILD-005 mocked certifications and global non-custodial multichain roadmap, including Solana priority, remain unchanged.

BUILD-006 local acceptance is complete as of 2026-09-28. The owner-operated Base recording, closed byte-identical replay and independent reconciliation demonstrate `FORK_REPRODUCED` on local chain 31337; BUILD-006 is not certified. One unmerged PR, remote CI, the owner's merge decision and post-merge checks remain; see the [BUILD-006 report](builds/BUILD-006-REPORT.md). BUILD-007 is not authorized.

## Historical next milestone: BUILD-006 planning only (2026-09-27)

DEC-0035 closes BUILD-005 as COMPLETE / CERTIFIED: MOCKED after [PR #15](https://github.com/alrimarleskovar/gryloo/pull/15) merged into main as 37a0782ece81f83c362b50f68adfc1accb37ccff and post-merge Governance run 36344564513 and contracts/app run 36344564511 passed. BUILD-006 may be planned, but no BUILD-006 plan, implementation, public provider, public chain, production wallet or real-funds operation is approved. A later plan and separate explicit owner approval are required before implementation. BUILD-003E public-testnet evidence and the global non-custodial multichain roadmap, including Solana priority, remain unchanged.

## BUILD-005 active milestone (historical, 2026-09-27)

DEC-0034 approves the [single BUILD-005 plan](builds/BUILD-005-PLAN.md). Implementation and local acceptance are underway on `codex/build-005-cow-signed-intent` from synchronized `main` at `9c5484d`. The user-facing outcome is capability discovery through exact EIP-712 review, local-wallet signing, duplicate-safe posting/recovery, tracking, supported cancellation, and scripted settlement evidence for the same semantic swap IR. This build uses only a deterministic loopback orderbook and disposable local wallet, so its resulting financial evidence is `MOCKED`. Its final PR will remain unmerged for owner review. No later build is approved. BUILD-003E public-testnet evidence and the broader global multichain roadmap, including Solana priority, retain their source-of-truth positions.

## Historical next milestone: BUILD-005 planning (2026-09-27)

BUILD-004 is `COMPLETE / CERTIFIED: FORK_REPRODUCED` on local chain 31337 under DEC-0033. PR #13 passed 4/4 checks on `effc6bad8dc828ee9e598d43fbcd6413e2b19dbe`, merged into `main` as `e71de3946c7aac6095023ca1ee6f1e1a58a98112` at 2026-09-27T16:29:44Z, and post-merge Governance run `36333448106` and Contracts/app run `36333448100` passed. The immediate next product milestone is **BUILD-005 planning — CoW signed-intent adapter**, reusing the same semantic swap action with its distinct EIP-712 order, posting ambiguity, tracking, expiry, cancellation and settlement evidence ([BUILD-004 plan §11](builds/BUILD-004-PLAN.md)). No BUILD-005 plan or implementation is approved: BUILD-005 needs its own plan and explicit owner approval. BUILD-003E remains reserved for public-testnet evidence, and the rest of the Master Spec roadmap is unchanged.

## BUILD-004 path (historical, 2026-09-27)

DEC-0031 approved [BUILD-004](builds/BUILD-004-PLAN.md) and the finite Safe/Roles D-1 profile; DEC-0032 recorded Amendment A-1. Implementation, local automated acceptance and the owner-operated injected-wallet session pass on the clean closed-replay fork. Still outstanding: remote CI on the final PR #13 head, the owner's merge decision and post-merge checks. BUILD-004 is not yet certified. After successful BUILD-004 completion, proceed directly to BUILD-005 planning. BUILD-005 implementation has no separate approval. The older `NONE_APPROVED` and BUILD-003F pending statements below are historical as of their dated sections. The evidence ceiling remains `FORK_REPRODUCED` on local chain 31337.


## Current state after BUILD-003 certification (2026-09-27)

DEC-0028 approved the complete BUILD-003F implementation and the bounded, single-use owner recording. F2, real F3 recording, byte-identical F4 replay, F5 local-fork application tests and the owner-operated G7 wallet verification have passed locally; see the [BUILD-003F report](builds/BUILD-003F-REPORT.md). PR #11 passed 4/4 checks on `45dc852c88810be41ec2a703c163f4e41bcfa2eb`, merged as `4bf7d4f6e96c5ef433b0c930dad067d4001f2956`, and post-merge Governance `36286360276` and Contracts/app `36286360265` passed. DEC-0030 accepts ADR-0004 and certifies BUILD-003 `COMPLETE / CERTIFIED: FORK_REPRODUCED` on local chain 31337 only. This grants no public-chain, production, live-provider, wallet-custody or financial-execution authority.

The approved next build is `NONE_APPROVED`. BUILD-004 planning may now be proposed separately; no BUILD-004 plan or implementation is approved. BUILD-003E remains reserved for public-testnet evidence; no testnet, mainnet, Mode B or package-publication approval is implied.

## Historical state at BUILD-003D closure (2026-09-24)

The following approval and planning statements record the earlier DEC-0025 closure. DEC-0028 subsequently approved BUILD-003F; the current state above supersedes those historical pending statements.

BUILD-003D is closed under Option B (DEC-0025). It delivers only the offline-accepted scope: the viewport and forensics fix, historical pre-secret-removal Anvil compatibility evidence, the enforcement-matrix contract, the pure compiler, executor and reconciler packages, and the fork harness and replay infrastructure.

All three owner-run Base recording attempts stopped, and D-5 recording authority is exhausted at 3/3 attempts and 68/1,800 requests. No further BUILD-003D recording is permitted.

## Approved next build

`NONE_APPROVED`.

**Required next planning step: BUILD-003F.** BUILD-003F is not approved. It must carry:

- the successful recorded Base fork state and transcript, preceded by final-byte pinned-account owner-secret revalidation;
- the fork application integration previously assigned to BUILD-003D G6;
- the manual injected-wallet acceptance previously assigned to G7;
- every BUILD-003 certification row that depends on them.

It needs its own plan, recording budget and explicit owner approval. BUILD-003E remains reserved for public-testnet evidence.

**BUILD-004.** Planning is blocked until BUILD-003 certification, which requires BUILD-003F. Package publication, Mode B and mainnet execution remain unapproved.

**Earlier builds.** BUILD-003C was merged through PR #9 as `8a5fbaed26e005e5719528c399f7ca1adb334eb6`. Its exact run IDs and retained historical hashes are in the [BUILD-003D plan](builds/BUILD-003D-PLAN.md), and its public and Alchemy stop evidence remains preserved. BUILD-002 and BUILD-003A remain completed historical records in [status](STATUS.md).
