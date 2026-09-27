# Next build

## Current milestone: BUILD-006 approved implementation (2026-09-27)

DEC-0036 approves the [BUILD-006 plan](builds/BUILD-006-PLAN.md) from clean synchronized main `4a402dd6be956fee0e3df001b8ad0f356f625937`. The one isolated Uniswap v3 Base USDC/WETH Mode A liquidity lifecycle is limited to a controlled chain-31337 fork, with a conditional one-attempt owner-operated read-only Base recording and a maximum `FORK_REPRODUCED` evidence target. Implementation, local gates, report, commit, push and one unmerged PR are authorized. The owner retains merge. No public-chain transaction, mainnet execution, real funds, production wallet, BUILD-007 composition or Mode B liquidity authority is approved. The BUILD-003/004 fork and BUILD-005 mocked certifications and global non-custodial multichain roadmap, including Solana priority, remain unchanged.

## Next milestone: BUILD-006 planning only (2026-09-27)

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
