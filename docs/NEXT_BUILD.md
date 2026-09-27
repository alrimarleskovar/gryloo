# Next build

## Current state after BUILD-003F local acceptance (2026-09-27)

DEC-0028 approved the complete BUILD-003F implementation and the bounded, single-use owner recording. F2, real F3 recording, byte-identical F4 replay, F5 local-fork application tests and the owner-operated G7 wallet verification have passed locally; see the [BUILD-003F report](builds/BUILD-003F-REPORT.md). Delivery, remote and post-merge CI, ADR-0004 acceptance and BUILD-003 certification remain pending. The local `FORK_REPRODUCED` result grants no public-chain, production or later-build authority.

The approved next build is `NONE_APPROVED`. BUILD-004 planning remains blocked until BUILD-003 is actually certified. BUILD-003E remains reserved for public-testnet evidence; no testnet, mainnet, Mode B or package-publication approval is implied.

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
