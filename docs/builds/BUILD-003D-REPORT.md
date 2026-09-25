# BUILD-003D — Provisional gate report

Status: **CLOSED_UNDER_OPTION_B (DEC-0025); G0, G2–G4 OFFLINE EVIDENCE; G1 HISTORICAL WITH OWNER-SECRET REVALIDATION PENDING; G5 FAILED AFTER THREE OWNER-RUN ATTEMPTS; RECORDING, G6 AND G7 MOVED TO BUILD-003F; BUILD-003 IN_PROGRESS**. Branch `codex/build-003d-mode-a-fork-vertical-slice` at baseline HEAD `8a5fbaed26e005e5719528c399f7ca1adb334eb6`. This report records:

- the authorized offline G0–G4 work;
- the limited G5 entrypoint preparation;
- the single owner-run G5 attempt, which stopped;
- the offline investigation and repair of that attempt.

All three owner-run recording attempts stopped: attempt 1 after 2 provider requests, attempt 2 after 32 and attempt 3 after 34. Totals are 68/1,800 requests and 1,768/46,800 reserved CU. The agent made no live request.

BUILD-003D then closed under Option B (DEC-0025). The reduced offline scope is authorized for commit, push and pull request, all pending final verification. No transcript, wallet operation or financial execution exists, and nothing is merged.

BUILD-003 certification: PENDING_OWNER_DECISION. G7 manual wallet acceptance: NOT_RUN. BUILD-003: IN_PROGRESS.

## 1. Approved objective

The approved [plan](BUILD-003D-PLAN.md) targets a Mode A vertical slice on a controlled Base fork at local chain 31337, labelled `FORK_REPRODUCED`, without reducing Gryloo's multichain Master Spec scope. P0–P4 offline gates and limited G5 entrypoint preparation have been worked on; owner recording remains separate.

## 2. What was implemented

G0 local viewport convergence and screenshot-diff forensics are preserved. G1 C1–C10 passed on the historical pre-secret-removal candidate; the final-byte pinned-account startup requires owner-secret revalidation in BUILD-003F. G2 added the approved enforcement-matrix contract and exact-payload profile. G3 now covers pure compiler, executor and reconciler functions with injected scripted transports, deterministic artifact compilation, strict review, durable attempt ordering, independent reconciliation and evidence guards.

## 3. What was not implemented

G4 passes its offline preflight gate, and the limited G5 entrypoint preparation passed offline.

All three owner-run G5 attempts stopped, and no transcript exists. Under Option B, the recording, the fork application integration (G6) and the manual-wallet acceptance (G7) move to BUILD-003F.

None of the following exists yet for BUILD-003D:

- recorded Base fork state;
- replayed fork state;
- an integrated fork quote;
- the app gateway;
- the manual wallet check;
- browser E2E or visual acceptance;
- a pull request, remote CI or post-merge evidence.

No BUILD-004 work has begun.

## 4. Changes by component

G3 changes were confined to `packages/reference-compiler/**`, `packages/reference-executor/**`, `packages/reference-reconciler/**` and the approved living record paths. The compiler adds scripted quote and two-pass simulation reads, exact-byte review cases and material-change tests. The executor adds serialized scripted preparation and request ordering, exhaustive journal transitions, recovery checks and file fsync ordering. The reconciler adds scripted independent reads, nonce and fee checks, signed-byte perturbations and Evidence Bundle completeness guards. Existing G0–G2 files are preserved.

## 5. Evidence and tests

| Gate or check | Result | Exact evidence |
|---|---|---|
| G0 | `PARTIAL` | Local 200/200 normal expiry, 100/100 at 6× CPU throttle, five 140/140 suite repetitions, viewport and diff self-tests passed; PR/CI/post-merge pending. |
| G1 | HISTORICAL_PASS_PRE_SECRET_REMOVAL; DEFERRED_TO_BUILD_003F_OWNER_SECRET_REVALIDATION | C1–C10 historical result SHA-256 `57ab6af9d19c94dc1bba3b8b416cc160b7eca79e8cb20e615dbfa719e6adeba7`. |
| G2 | `PASS` offline | 79/79 contract tests; 11 schema exports; frozen bytes and lock pin; preserved 247-identity dependency evidence SHA-256 `cf3c4a591d084028a53b34c76b70a3f7fee8565ac338a7e511d2e802c799bb75`. Networked verifier was not rerun. |
| G3 targeted packages | `PASS` | 60/60 tests in 14 files; log SHA-256 `d047208619424130df63cd1a46e732bdb9d0f1f93737590afb46696b3ec6dd75`. |
| G3 complete unit suite | `PASS` | 313/313 tests in 38 files; log SHA-256 `5be0c0d2d4229227e02f6f78c9c67159f6690661c33da9510ba7f70f60595b73`. |
| Typecheck, build, lint | `PASS` | 11/11 typecheck tasks, 7/7 build tasks and lint; log SHA-256 values in the plan's G3 record. |
| Contracts, schemas, diff | `PASS` | 79/79 contract tests, 11 schema exports, `git diff --check` clear. |
| Pre-G4 scope and frozen files | `PASS` | 65 created and 22 modified current paths, no deletion or out-of-list path; frozen 9 schemas, 20 compatibility files and 21 third-party licenses byte-identical to HEAD; lock resolved SHA-256 `9e0aaf059085b4d0ac9c367c049eb4ff7d460bf83fd0c09c8530153e6661f749`. |
| Persistent governance programs | `BLOCKED` for delivery | Both old programs were run read-only. They reject the approved partial BUILD-003D tree because they still enforce BUILD-003C scope and old document/package/schema sets. G8 must update and rerun them. |
| G4 | `PASS` offline | Owner-reported 968 CU billing confirmation, preserved G1 C1–C10 pass and the zero-live-request preflight passed. The driver lists nine deterministic local scenarios; actual Base-state outcomes are G5 evidence. |
| G5 entrypoint preparation | `PASS` offline | 37/37 key-unset synthetic proxy checks with 27 synthetic calls; saved transcript replay 3/3; separate local Anvil hash-parameter check passed; one-use claim accepted once and rejected a rerun. Private continuation journal is `READY` with zero attempts, requests and reserved CUs. |
| G5 recording, attempt 1 (owner-run) | `FAIL` (`STOPPED`, `UNAPPROVED_UPSTREAM`) | Two provider requests (HTTP 200) and 52 reserved listed CU, then a stop on Anvil's `eth_gasPrice` request, which had no `params`. Journal SHA-256 `ee7a3adaa8b10ec2996dad93ea520f49ebc2bb9e4eb79d06e69e37a05d74e220`; request log `221da8290b4cefc271ac31383e6b0418991bd787a02e0bae9dadcaaa0d832ecc`. No transcript. See the incident section. |
| G5 incident repair | `PASS` offline | Byte-identical offline reproduction; 27/27 fork-suite tests (G1 14/14, 13 lifecycle tests); saved-replay validation of the proxy corrections. See the incident section. |
| G5 attempt 2 (owner-run) | `FAIL` (`STOPPED`, `HARNESS_FAILED`: `DEV_ACCOUNTS_NOT_CLEAN`; all ten dev accounts carry EIP-7702 code on Base) | 32 provider requests; reproduced offline. See the attempt-2 section. |
| G5 continuation (historical preparation row) | `PREPARED_OFFLINE`, then consumed | Amendment 5 approved by the owner. Attempt-2 entrypoint: 111/111 offline preflight checks; gate `--check` passed read-only; not claimed. See the Amendment 5 section. |
| G5 recording, attempt 3 (final, owner-run) | `FAIL` (`STOPPED`, `HARNESS_FAILED`: `SETUP_TRANSACTION_FAILED`) | The Amendment 6 accounts were clean and selected. Then the setup `send()` read its receipt before Anvil mined the transaction. Journal `9c9725f4dacfa34c475084dc0b5eeb472fe5333ac5f1fd3a9118f4d6bc612d1c`. Reproduced offline; see the attempt-3 section. |
| G6, G7 | `NOT_RUN`: moved to BUILD-003F (DEC-0025) | No fork application integration or manual-wallet evidence exists. |
| G8 | NOT_ACHIEVED for certification | Reduced-scope governance checks are delivery controls; remote CI is pending. |

## 6. Acceptance criteria

G3's P3 pure-package criterion passes locally. This does not mark any §1.5 P1–P14 certification row as complete or satisfy the §5 full-build acceptance list. Actual fork, wallet, recovery and Evidence Bundle outcomes remain unproven outside synthetic and scripted unit cases.

## 7. Security

All G3 transport tests use injected local callbacks. The compiler rejects wrong-chain, nonzero-value, access-list, spender, target, selector, recipient, amount, stale-quote, code-pin and simulation discrepancies. An attempt is persisted before a scripted request; unknown results require reconciliation before retry. The reconciler checks raw signed bytes, recovered signer, nonce use, fees, balances, logs and receipt links. The in-process file write queue is tested; cross-process coordination awaits the later runtime integration.

## 8. Licenses

No new dependency, version, license exception or third-party notice was added in G3. The three private reference packages remain AGPL-3.0-only with the approved local license copies. The preserved G2 dependency evidence is used without registry access.

## 9. Deviations from the plan

No G3 path, dependency, schema, pin, provider method, recording cap or wallet authority was changed. The provisional report and status update precede the plan's eventual G8 delivery record. Full persistent governance remains pending its planned BUILD-003D update.

The G5 repair stays inside the §11 lists. It changes no dependency, pin, provider method, cap, Anvil argument, simulation method or scope count. It has four deliberate effects that need recording:

- **G1 is strengthened.** The gate now routes the raw wire request exactly as the proxy does, so its result digest changes.
- **One approved path is created early.** `compile.fork.test.ts` now exists, before G6.
- **Owner and setup selection now follows §3.2.3.** The setup now selects the lowest clean dev indices, where the previous implementation hard-pinned indices 0 and 1.
- **One routing form awaits a decision.** The routing of `eth_gasPrice` with `params` omitted is ready in code. Amendment 5 decision A5-1 asks the owner to confirm it before any live use.

## 10. Demonstrable state

Pure functions and scripted transports pass locally. No `FORK_REPRODUCED` execution evidence exists yet. `RECONCILED` results in G3 tests are synthetic and do not describe a real wallet, chain session or user funds.

## 11. Technical debt created

The v1 contract limitations C-9 through C-12 in the plan remain. The application RPC adapter, recorded-state replay proof, process restart proof and cross-process runtime behavior are later-gate work. The current persistent governance workflow must be updated under its approved G8 scope before delivery.

The G5 incident adds two further items:

- **Fork-suite ports.** The fork suites use the fixed ports 8545 and 8546. Future G6 fork suites must run one file at a time, or they will fail fast with `FORK_PORT_OCCUPIED`.
- **Source-block lookup.** A local lookup of source H returns the pinned block response with transaction hashes, even for a `[H, true]` request. That request form has not been observed.

## 12. Suggestions for the next build — NOT APPROVED

No later build is proposed or approved. Builds 004–018 and all multichain requirements remain as specified by the Master Spec and Master Prompt.

## 13. Next-build options

BUILD-003D is closed under Option B, and its recording authority is exhausted. The next step is a separately governed BUILD-003F plan, which needs the owner's approval of its own scope and recording budget. BUILD-004 planning is blocked until BUILD-003 certification.

## 14. Required human decision

The owner reported a Free Alchemy account with no paid billing, the Gryloo Base Mainnet HTTP app, and 968 of 30,000,000 monthly CUs used. The plan's 46,800-CU maximum gives 47,768 projected cumulative CUs and 29,952,232 remaining at that reported baseline. The agent did not verify the dashboard independently. The owner subsequently authorized only preparation and offline validation of the single-use recording entrypoint. The owner ran the prepared command once. It stopped after two provider requests and consumed its entrypoint.

Historical record: the owner approved Amendment 5 (attempt 2) and later Amendment 6 (attempt 3). Both attempts stopped. The owner then selected Option B (DEC-0025). The next decision is whether to approve a BUILD-003F plan. As approved, Amendment 5 covered:

- **A5-1:** treating `eth_gasPrice` with `params` omitted as the Amendment 3 local form;
- **A5-2:** proxy corrections C-1 to C-8;
- **A5-3:** the harness repair;
- **A5-4:** a new continuation journal carrying the attempt-1 counters, with attempt 2 only (at most 900 requests; 1,798 total and 46,748 CU remain);
- **A5-5:** a wrapper that prints a credential-free journal summary on every exit;
- **A5-6:** a fresh no-paid-billing report, with current usage at or below 1,020 CU.

BUILD-003 certification remains pending G7 `PASS`, all other gates and a later owner decision.

## G4 offline evidence addendum

The final key-unset preflight journal and result SHA-256 values are `4b579e36834bd6aacb0a6cd577ea1e76ca8e36f158dfda617d0966c7d4959baf` and `4b33768f4629ff1f4b40e6adf7fa875bc9f8360eb75a8af6fca5c63bc30dccb4`. The uncommitted proxy and preflight script digests are `1eee3c984ec9df1bcefa73c0484b7c924ceae47ff86d2ef30124a69fa4f46404` and `24fa18e519772e49fda44693b8ed7ded2534743528bd707c34eb230a43a56929`. The repeated G1 synthetic result SHA-256 is `cefb5da97e13a2c0c19699dc127fd488861b6a70340e4e6fe4bba08fe5fa2527`. The replay/harness synthetic check passed 9/9. All preflight files are credential-free and remain under `/tmp/gryloo-build-003d-g4/`, uncommitted.

Final offline verification after the G4 edits: the complete unit suite passed 313/313 in 38 files; typecheck 11/11 tasks, build 7/7 tasks, lint, contracts 79/79 in six files, and 11 schema exports passed. The exact current tree contains 65 created and 22 modified approved paths, zero deletions, renames, mode changes or out-of-list paths. The nine existing v1 schemas, twenty existing compatibility files and twenty-one third-party license files remain byte-identical to HEAD; `git diff --check` passed. Both existing persistent governance programs were run read-only and still reject the partial tree under BUILD-003C rules, pending G8.

## G5 owner-only entrypoint preparation (2026-09-24; historical, before the owner run)

The later explicit owner authorization resolved the prior automatic approval rejection of preparing the entrypoint. It did not authorize an agent-run recording. The private scratchpad `/tmp/gryloo-build-003d-g5-prep/` holds a mode-0600 proxy, preflight, owner wrapper, gate, harness and transcript finalizer. The wrapper strips the credential from the harness environment and passes it only to the owner-controlled proxy process; it prints no key or authorization header. The proxy uses only the fixed Base Mainnet host, requires finalized N/H first, rewrites approved state reads to canonical H, permits only the Amendment 3 local responses, allows one request in flight and 400 ms start-to-start pacing. Each provider request reserves 26 listed CUs and increments attempt/request counters in an fsynced journal **before send**. It enforces three attempts, 900 requests per attempt, 1,800 total requests, 46,800 additional CUs and 47,768 cumulative CUs at the recorded 968-CU baseline. The prepared wrapper permits only its first attempt; an atomic marker and journal states reject every rerun after success, failure, interruption or exhaustion. Later plan attempts would require a separate owner decision and fresh preparation.

The final credential-unset synthetic preflight passed **37/37** with **27 synthetic provider calls**, **zero live requests** and no credential. It exercised durable counters before send, H rewrite, local replies, pacing, disallowed methods/forms/batches, HTTP 402/429, RPC error, oversized response, timeout, changed H, per-attempt/total/CU caps, reflected-secret rejection, interrupted journal and success/failure rerun refusal. A saved synthetic transcript was served by the closed replay process and passed **3/3**; an empty local Anvil accepted the required hash-pinned `eth_simulateV1` parameter. The isolated claim test accepted once and rejected a second claim. The real read-only owner gate passed; it did not claim the continuation journal.

The credential-free `session-validated/journal.json` is `READY` with **0 attempts, 0 provider requests and 0 reserved CUs**. Its SHA-256 is `4dc736c777463935b980c989a9781db4470bd983965f33e5f1b343dc129b4b28`; the preflight result SHA-256 is `a0277a57f04e9aa6087c8e83ac6faad14af1572511c3cacc8be3fdf442354794`. The 49-file owner entrypoint manifest SHA-256 is `9013ae9df611c639a931f5f416ad658fc5ef6cd45912f98433c378e94041c6ef`. Proxy SHA-256: `aef2b8cc7151cf6b9e4f9ef9887cd925dea70eec930b227d5ee9e59620caff37`; wrapper SHA-256: `7b164a81145d397e2881be78de85b407bb223d7ac76473e3d9091def876ead2b`. The owner command is given in the final handoff, not executed by the agent.

Final offline checks: unit suite **313/313** in 38 files; typecheck **11/11** tasks; build **7/7** tasks; lint pass; contract tests **79/79** in six files; schema exports **11**; pinned Anvil compatibility **13/13**, all C1–C10 true. The G2 247-identity dependency verifier was not rerun. Persistent governance still enforces BUILD-003C and is planned for G8; the separate current exact-scope and frozen-file checks pass. The nine-scenario driver and true Base contract behavior remain unproven until the owner-run G5 recording and later replay acceptance. No G5 recording, wallet operation, live RPC, commit, push or PR occurred in the agent environment.

Credential-free final validation log SHA-256 values under `/tmp/gryloo-build-003d-g5-prep/`: complete unit suite `0363119bc9c5d7ae7f72c26f0fea03fab04d61d393d4998fc908bbc7d989c56c`; typecheck `dc7ffb611c95ff2003b7da695b3daa77ed53dbee17ecacdca99efb7176575193`; build `202b50afac390d1d938a77941b8487f7b4b6b95d294ea089bcfc22c72662b606`; lint `d8201492c3fd8d96c54af312cb5435bb0930520ecec23474e61c8f5486220f12`; contracts `ccc882d279036c8c59183c3d28ff17c9e5a8d7600b7032d24132f5ed58028c0e`; schemas `ff3647d12a3766c6a8712faeadc2a5f02b12b6ef96a55daff235e609eaf41563`; Anvil `0f4cd28ec8d47e3e78b9fe7337df47b19bbc1d988c8db96cfc8d5b3d76d9431d`. The two read-only persistent governance logs have SHA-256 `33c9939a2b20e857c3d2de5ccdd49d0eb6464d834bbc2cce801ebcb5f7ef63af` and `1114eaab0aa3aedb310af628033350846e2b11de0b22a2d9bcbc38bc202f493d`; both exit 1 because they still enforce BUILD-003C. The separate amended §11 exact-scope check passes **65/113 created, 22/51 modified**, zero deletions or out-of-list paths; all 9 prior v1 schemas, 20 compatibility files and 21 third-party license files remain byte-identical; `git diff --check` passes.

## G5 owner-run incident and offline repair (2026-09-24)

The full incident record, root cause, defect list and Proposed Amendment 5 are in the [plan](BUILD-003D-PLAN.md), under "G5 owner-run incident and offline repair record". Everything below is credential-free.

**Owner-reported events.**

1. An obsolete BUILD-003C command was entered first. Its read-only Python preflight failed with `AssertionError: continuation/session.json digest changed`, so its `&&`-chained Node process never started.
   - This matches the evidence on disk: every BUILD-003C recording file is older than 15:51:41 WEST.
   - The continuation session and request log still match the BUILD-003C report (`dcf97126…`, `82fbbc20…`).
2. The BUILD-003D command was then run exactly once. It printed `G5 owner run claimed once` and failed with `ANVIL_EXITED … failed to create genesis … Connection refused`. It was not rerun.

**Preserved evidence.** Every file was hashed before any investigation step and verified unchanged afterwards.

| File under `/tmp/gryloo-build-003d-g5-prep/` | SHA-256 |
|---|---|
| `session-validated/journal.json` (now `STOPPED`) | `ee7a3adaa8b10ec2996dad93ea520f49ebc2bb9e4eb79d06e69e37a05d74e220` |
| `session-validated/requests.jsonl` | `221da8290b4cefc271ac31383e6b0418991bd787a02e0bae9dadcaaa0d832ecc` |
| `session-validated/started` (claim marker) | `749c9a89955aa0a014e394e1c39709f28c85ec284c9301a683ae107f871f4757` |
| `session-validated/preflight.json` | `a0277a57f04e9aa6087c8e83ac6faad14af1572511c3cacc8be3fdf442354794` |
| `session/journal.json` (the `READY` copy) | `4dc736c777463935b980c989a9781db4470bd983965f33e5f1b343dc129b4b28` |
| `manifest.json` | `9013ae9df611c639a931f5f416ad658fc5ef6cd45912f98433c378e94041c6ef` |
| `recording-proxy.mjs` | `aef2b8cc7151cf6b9e4f9ef9887cd925dea70eec930b227d5ee9e59620caff37` |
| `owner-run.sh` | `7b164a81145d397e2881be78de85b407bb223d7ac76473e3d9091def876ead2b` |
| `owner-harness.mjs` | `20eb2b28be86f76d071a3edeaa6528056f376442c88039c701323be84d1fe40d` |
| `gate.mjs` | `1cbcc0941bb5cddd2ff61f81bcc6bf7b705091a28df2e6123edd833befd0af43` |
| `finalize-transcript.mjs` | `ed60caadad5b77a02996943f1d0041220c656e2ef846e9eda130b934d36d91e1` |
| Digest list of all 30 evidence files, taken before investigation (agent scratchpad) | `fdedadb5aea78bfd194aabfd9c4241ecde486d55c21e4529cc8689073d24f4a5` |

All 49 manifest-pinned files matched the manifest at investigation start. Scans for Bearer markers, authorization text, key-length tokens and keyed provider paths found nothing in any evidence file.

**Journal counters and terminal state.**

| Field | Value |
|---|---|
| Status | `STOPPED` |
| Stop reason | `UNAPPROVED_UPSTREAM` |
| Attempts | 1 (attempt 1: `STOPPED`, 2 requests) |
| Provider requests, total | 2 |
| Reserved listed CU | 52 |
| Claim marker written | 2026-09-24T20:29:31.975Z |
| Final journal write | 2026-09-24T20:29:33.899Z |
| Upper-bound cumulative CU at the 968 baseline | 1020 |

**Whether Alchemy was reached.** Yes: exactly two requests, both answered with HTTP 200 and a matching JSON-RPC result.
- Request 1 was the harness `eth_getBlockByNumber ["finalized", false]`.
- Request 2 was Anvil's `eth_getBlockByNumber ["0x3159231", false]`.
- Both returned Base block 51,745,329, hash `0x364b9e8c55ac3f79224b33083206ab986edbe4c2cf9e9bb99cfc17c3d49a2a20`, with 483 transactions.
- The proxy logs an exchange only after HTTP 200 and a valid result, and it fsyncs every reservation before sending. The journal counter equals the number of log lines.
- The rejected third request and all 40 genesis reads never reached the provider.

**Root cause.** Pinned Anvil v1.8.3 sent `eth_gasPrice` with the JSON-RPC `params` member omitted. The shared router accepted only an array, so the proxy stopped (`UNAPPROVED_UPSTREAM`), answered HTTP 503 and closed its own 8546 listener. Anvil ignores a gas-price failure, so it went on to genesis, where its first dev-account read found nothing listening.

G1 did not expose this, because its synthetic upstream normalized `params ?? []`. The preparation preflight did not either, because it never drove the proxy over HTTP from Anvil.

**Offline reproduction.** The preserved proxy class, the unmodified harness, the two saved responses and the pinned Anvil, run inside a loopback-only namespace, reproduced the journal and request log byte for byte, and the same Anvil error and stack. The G1 synthetic upstream also normalized away the omitted `params`.

**Repository files changed by the repair.** Each is an approved §11 path.

| Path | SHA-256 before | SHA-256 after |
|---|---|---|
| `packages/reference-compiler/src/profile.ts` | `675da859b8526e248d9ad3197e7161b42d8139dc37a42787e27f4041f323a1f9` | `32b3a5ea2fc0bf6e7568c4224eb7235b863460ec56b7a0f7b8c820c48f9e482d` |
| `packages/reference-compiler/dist/profile.js` (build output, untracked) | `4222e588c81c71a8cceabb4112315fa4d7965d36384061fbfdc531f2cd96545a` | `a9f1f2a5dc2f7915cc3c179f3b0d2e01a354e32df727b7cb7370d8970a0d105c` |
| `apps/reference-dapp/e2e/fork/harness.mjs` | `3cb081797cb562fa4911958b533b990ffb81313afeaf2b13b2bc4d658d23239f` | `1fcbc1fe8f695a9da58a9bcb39a844dd1131970c80935a064901e587ae4cc74e` |
| `apps/reference-dapp/e2e/fork/replay-upstream.mjs` | `131b7533bc8a5ce91734f1faac518a66e8b90fdf10435cdfb62b06786723b2d4` | `ec134d80aea88036847fd915f4a80d4908ef2be09d722cfd1a0cd23c43627551` |
| `apps/reference-dapp/e2e/fork/fork-setup.mjs` | `e820022f15e783e9fd72fb064e239a42397327a1d879cc2a1732ca05bb427c18` | `62712c089ce64285c22a7068725f6a9f0a1a7c00d97086dea3d084dfd23993d7` |
| `packages/reference-compiler/test/anvil-compatibility.fork.test.ts` | not pinned before the repair | `5b78c4e201c8a87d4306e50cd76ff6375e74dfda14edcf6e15a99b0fa2d3a8d3` |
| `packages/reference-compiler/test/compile.fork.test.ts` | new approved path | `80f06444802e2a7209bafb293d88d9c948f5229c4beb01c6443796394801bc93` (updated during attempt-2 preparation to pace and measure with the monotonic clock) |

**Offline tests after the repair.** Pinned Node 24.21.0, pnpm 11.22.0 and Anvil v1.8.3, inside a loopback-only namespace, with no credential.

| Check | Result | Log SHA-256 |
|---|---|---|
| Build | 7/7 tasks | `5d09c37a4e2d204f60c5821c6a40051b72533cd88b6a87338426d3549e8b5f0a` |
| Typecheck | 11/11 tasks | `c00f9b06cead9b027e2ad12a539f79b30a8a0234ad01e5385a71ff1eb3b49de8` |
| Lint | pass | `d8201492c3fd8d96c54af312cb5435bb0930520ecec23474e61c8f5486220f12` |
| Schema exports | 11 verified | `ff3647d12a3766c6a8712faeadc2a5f02b12b6ef96a55daff235e609eaf41563` |
| Unit suite | 313/313 in 38 files | `c00b9ee07df445b28c9e997d1949c3aab223f9b9a34325441f8f1916de5ba12d` |
| Contract tests | 79/79 in 6 files | `b86600fc66c9616191b1a5fca94175fbc5f23a21e9ddf6dae5785ae5964b375e` |
| G1 (`pnpm test | 14/14, C1–C10 true | `ab937a004b343448583b002bc956d2006738c9993d5620eda1d8e5d97dc43741` |
| Fork suites (`pnpm test | 27/27 in 2 files | `0df014ed6ee7398fb3ff734b5e8e10c62830d66d411d199ed4b8a5f78c3ab94f` |
| Persistent governance 1 | exit 1, still BUILD-003C; only new line is the approved `compile.fork.test.ts` path | `e694122129258d91e228404cc1acf9379375fd280155e522a89de1bbd1e2f103` |
| Persistent governance 2 | exit 1, still BUILD-003C; output identical to before | `1114eaab0aa3aedb310af628033350846e2b11de0b22a2d9bcbc38bc202f493d` |
| G1 result JSON | `paramsOmittedMethods` `["eth_gasPrice"]` | `d16353c589ee97704c586d32fe930c1d31f1ba89d4a00e825d78699e04eb1a14` |
| `git diff --check` | clean | — |
| Exact scope and frozen files | 66/113 created, 23/51 modified (after these record updates); nothing outside the lists; no deletion, rename, mode change or executable; 9 v1 schemas, 20 compatibility files and 21 third-party licenses byte-identical | — |

**Saved-replay validation of the proxy corrections.** This used a validation-only candidate proxy in the agent scratchpad. It has an injected provider, no transport and no credential path, so it is not an owner entrypoint. Block reads used the saved Base response; all other state was synthetic. Result SHA-256 `532e956d2a6d129bca2f5b03d66d0fe5b0610b18f09a95c55f4382aa55597aa6`.

- **Consumed code.** With only the router repaired, it stops at `eth_gasPrice` (`PROVIDER_OR_RUNTIME_FAILURE`). Two concurrent reads cause `CONCURRENT_REQUEST`, and 1 request is still sent after the stop.
- **Original harness with the corrected proxy.** `ANVIL_START_TIMEOUT` after 9504 ms and 26 provider calls, and 0 afterwards.
- **Repaired harness with the corrected proxy.** Ready after 14151 ms and 32 attempt-2 provider requests.
  - Fork metadata: chain 8453, block 51745329, the saved hash.
  - Minimum provider send gap: 423 ms.
  - Every reservation fsynced before its send: true.
  - Carried counters: 35 requests and 910 CU, including attempt 1.
- **HTTP 429 on call 10.** Durable `PROVIDER_HTTP_429` with `stopDetail` `{"form": "params-array:2", "method": "eth_getTransactionCount"}`; 0 calls after the stop; the listener stays open.
- **Unapproved forms.** An unapproved form and a `params`-omitted `eth_chainId` stop with a durable detail.
- **Refusals.** The consumed journal, reuse after a claim, an existing request log, a tampered parent and out-of-range billing are all refused.
- **Routing tally.** Over the 42 traced Anvil requests, the consumed rule gives 1 stop and the repaired rule 0.

**Remaining risks.**
- **Request budget.** The real nine-scenario request count is unknown offline. If it exceeds 900, attempt 2 stops at its cap.
- **Dev accounts.** Real Base state may give dev accounts code. Selection then picks other clean indices (the profile pins change before replay), or stops with `DEV_ACCOUNTS_NOT_CLEAN`.
- **Source-block lookup.** A local `[H, true]` lookup returns the transaction-hash block form. That form has not been observed.
- **Payment-capable transport.** The pinned Anvil contains the "MPP" payment transport. It is unreachable while Anvil talks only to the loopback proxy, which never relays HTTP 402.
- **Future fork suites.** They share fixed ports and must run one file at a time.
- **New code.** The corrected proxy must still be prepared, pinned and pass its own HTTP-level preflight under Amendment 5.
- **Billing.** The owner-observable dashboard figure is not verified by the agent.

## Amendment 5 approval and G5 attempt-2 preparation (2026-09-24)

**Approval.** The owner approved Proposed Amendment 5 as one package (A5-1 to A5-6), for offline preparation of attempt 2 only.

**Billing.** The owner reported:

- Free plan;
- no payment method, paid feature or add-on;
- Pay As You Go, overage, auto-scale and automatic upgrades disabled;
- Base Mainnet only;
- current usage "at or below 1,020 CUs".

The exact figure was an unfilled placeholder. It is recorded as an owner-attested upper bound (`currentUsageCuUpperBound: 1020`, `currentUsageCuExact: null`), and every cap uses 1,020.

**Entrypoint.** It lives at `/tmp/gryloo-build-003d-g5-attempt2/` and is uncommitted.

| Artifact | SHA-256 |
|---|---|
| Manifest (865 pinned files) | `03960444a495de85067a782cd8bbd732f5a9a5997b882f8cedea177b7bd02277` |
| `session/journal.json` (`READY`; 2 requests and 52 CU carried) | `01f2cd5009d6713572e32fa18578e2e52284f03044d6e570f0cb1e48933a4857` |
| `session/preflight.json` | `ae5bfbafc0b291443017d389d39ee95fb27886d1ec699645c29e493f05ab92d2` |
| Preflight result (111/111) | `9c6a9555aa2db323d435314e271f5ad91166c2d04fbddc19f976b094259c87e7` |
| `recording-proxy.mjs` | `32408933839b2f0ddf05f79059299082ea4ece40d8dccbd6c77a026497fbc45f` |
| `owner-run.sh` | `d78afb60ac8bebb6906c76efd0427d935c9b6e016fe4be723f47855e250faf39` |
| `gate.mjs` | `e4daeeaf7ff1e5b3e3ca9c7d028ed75e45de8499621a23c5891243323634c472` |

**New finding during preparation.** The WSL2 wall clock stepped by up to −1,803 ms against the monotonic clock. The corrected proxy therefore paces with the monotonic clock (under C-8). The repository lifecycle test was updated to match.

**Validation.** The preflight passed 111/111, offline and with no credential. The real gate `--check` passed read-only, and the directory is not claimed.

The repository battery on the final tree:

| Check | Result |
|---|---|
| Build | 7/7 |
| Typecheck | 11/11 |
| Lint | pass |
| Schema exports | 11 |
| Unit | 313/313 |
| Contracts | 79/79 |
| G1 | 14/14 |
| Fork suites | 27/27 |
| Exact scope | 66/113 created, 23/51 modified |
| `git diff --check` | clean |

**Owner command (single use, attempt 2 only).**

```text
bash /tmp/gryloo-build-003d-g5-attempt2/owner-run.sh 03960444a495de85067a782cd8bbd732f5a9a5997b882f8cedea177b7bd02277
```

**State.** G5 has not passed. It needs a completed attempt-2 run, then the offline byte-identical replay. Any stop consumes attempt 2, and attempt 3 is not pre-authorized.

## G5 attempt-2 stop and go/no-go (2026-09-24)

**Owner run.** The attempt-2 command ran exactly once and printed `G5 attempt 2 claimed once`, followed by `Error: DEV_ACCOUNTS_NOT_CLEAN`. It was not rerun. Attempt 2 is consumed, and attempt 3 is not authorized.

**Dashboard (owner-reported, after the run).** 1,008 / 30,000,000 CU; Free plan; app Gryloo; Base Mainnet. This is within the reserved upper bound of 968 + 884 = 1,852.

**Preserved evidence.** All 23 attempt-2 files were hashed before inspection (digest list `a81b45874764fb50423f1f091cd74e92ab5dfa700208078731066385546bbf5e`) and were unchanged afterwards. The owner-reported digests match:

| File | SHA-256 |
|---|---|
| `session/journal.json` | `7fb21b2cf723e76cb0f6de0a45e636e44dff0956af9954bc3831ad611c028669` |
| `session/requests.jsonl` | `0dd180bfeeebcaa0005ec565b35b17f5635378b0050dcd22d334faad9b3a8487` |
| `session/harness.log` | `8190d0933a4896cbb25f9a36fea1493fe5a3d2bc1630fbed13545ae60df7c237` |
| `session/started` | `907430250974c81e9ce94bee31077e1b57aff2515f0ee8c78bf1d5ccf36fdc89` |

- **Credential scan.** No credential-shaped content was found.
- **Journal.** Attempt 2 is `STOPPED` with reason `HARNESS_FAILED`. Attempt 2 made 32 requests. Totals are 34 requests and 884 reserved CU, of which attempt 2 reserved 832.

**Provider exchanges.** There are exactly 32, all HTTP 200 with valid results:

- the finalized read;
- the block-N read of Base block 51,748,192 (`0x4de73646…1d986`);
- balance, nonce and code for each of the ten dev accounts.

There are also 11 local exchanges: `eth_gasPrice` and ten `eth_getAccountInfo`.

**What happened after readiness.** The fixture made only `eth_chainId`, `eth_accounts` and ten local `eth_getCode` reads, all answered from Anvil's genesis cache. It then threw at `fork-setup.mjs:42`.

**What did not happen.** No timestamp change, local transaction, scenario, signature, wallet operation, scenario result or transcript occurred.

**Candidates.** Anvil's ten default dev accounts, indices 0 to 9, were each examined for code at block N. Every one was rejected for the same reason: its code is the EIP-7702 delegation designator `0xef01008a67b5020ee254ef48e3b6a04927f39baf7e408a`, a delegation to `0x8a67b5020ee254ef48e3b6a04927f39baf7e408a`. Each has a Base balance of 0. Their Base nonces:

| Index | Nonce |
|---|---|
| 0 | 3,440,245 |
| 1 | 31,270 |
| 2 | 18,998 |
| 3 | 18,833 |
| 4 | 30,510 |
| 5 | 171,597 |
| 6 | 10,720 |
| 7 | 12,372 |
| 8 | 8,835 |
| 9 | 11,044 |

**What the check observed.** The check reads `eth_getCode(account, 'latest')` on the fork. Anvil's genesis keeps forked code and nonce, and changes only the balance (to 100 ETH). The check therefore observed real forked Base bytecode. It did not observe the Anvil prefunding, the nonce, or any other property.

**§3.2.3 conformance.** The implementation conforms exactly: the lowest indices with empty code at block N, and a stop for an owner decision when fewer than two qualify. The plan's §12 risk "EIP-7702 or other code on dev accounts … If none is clean, stop for a decision" is the outcome that occurred. The defect is in the plan's assumption that Anvil's publicly known default accounts could be clean on Base, not in the implementation.

**Offline reproduction.** The setup:

- a loopback-only network and mount namespace;
- a scratch copy bind-mounted at the attempt-2 path, so every path is identical and the originals stay untouched;
- the unmodified attempt-2 proxy classes, owner harness, gate, repository harness and pinned Anvil;
- the 32 saved provider responses;
- the `READY` journal recreated byte-identically (`01f2cd50…`);
- a wrapper differing only on its marked proxy line.

It reproduced:

- the journal, harness log and claim marker, **byte-identically**;
- the credential-free summary, field for field;
- the request log, **exchange-identically** (all 43 exchanges). Only arrival order and Anvil's self-assigned JSON-RPC ids differ, because Anvil issues its genesis reads concurrently.

Reproduction digests: request log `cf31dfb42ef97df41829fc89cd0125fcd1f30ee792289e7486acf432e9987b49`, replay launcher `f8fd48eb0738cd50b06bd5554dc24980ff426dad1b802b2b44819329a66d8f1b`.

**Files and counters.** No repository or entrypoint code changed. All pinned attempt-2 files other than the consumed session files, and all 30 attempt-1 files, remain unchanged. D-5 usage now stands at 2/3 attempts, 34/1,800 requests and 884/46,800 reserved CU.

**Bounded go/no-go (owner decision; neither option is prepared).**

- **A. Implementation defect.** Not supported by the evidence. No implementation defect exists: the code observed real state and applied the approved §3.2.3 rule. Every route to an attempt 3 is a design change, not a defect repair:
  - another account source, which changes the approved exact Anvil command;
  - a state override that clears code, which is prohibited: the local balance is the only override;
  - accepting delegated accounts, which reverses the owner-code rule.
- **B. Scope split.** BUILD-003D closes without another recording.
  - **Delivered by BUILD-003D:** G0–G4 as recorded, the G5 incident repairs and their tests, and the governance update for exactly the delivered paths.
  - **Moved out:** the Base-state recording, the transcript, fork app integration (G6), manual-wallet acceptance (G7) and the dependent certification rows. They go to a separately governed build, whose first decision is a reviewed account strategy for recorded Base state and whose recording budget is its own.
  - **D-5 recording authority:** ends at 2/3 attempts and 34/1,800 requests.
  - **BUILD-003:** stays `IN_PROGRESS`, with certification `PENDING_OWNER_DECISION`.
  - **Name of the new build:** BUILD-003E is reserved in §1.4 for public-testnet evidence, so the owner names it.
  - **After approval:** choosing B requires a narrow amendment that reduces §11 to the delivered paths and sets the G8 scope. The agent drafts it only after the owner chooses B.

## Proposed Amendment 6 (drafted 2026-09-24; not approved)

The owner asked for a third option: project-specific deterministic local Anvil accounts. It was found technically valid offline, and governance-compatible through an explicit amendment of §3.2.1, §3.2.3 and D-10. The draft, with its pinned derivation, addresses, command, key hygiene, attempt-3 journal, mechanically recomputed limits (attempt 3 at most 600 requests; 1,766 requests and 45,916 CU remain), stop conditions and required offline validation, is at the end of the plan. Nothing executable has been prepared. If attempt 3 would stop, Option B becomes the required closure path.

## Amendment 6 approval and final attempt-3 preparation (2026-09-24)

**Approval.** On 2026-09-24 the owner explicitly approved Amendment 6 exactly as drafted, A6-1 to A6-10. The approval covers:

- project-specific deterministic Gryloo test accounts, replacing Anvil's public defaults;
- the amended exact Anvil command, §3.2.3 and D-10;
- the empty-code rule preserved: EIP-7702 or any other code disqualifies an account, with no code wiping, override or delegated-account acceptance;
- the pinned derivation, digest, ten addresses and complete arguments;
- the phrase and keys confined to the test harness and the local Anvil process;
- no public-network use, funding or submission;
- verification of the ten pinned addresses and of at least two empty-code accounts before any scenario transaction;
- a separate attempt-3 journal carrying attempts 1 and 2 forward;
- unchanged overall ceilings;
- attempt 3 capped at 600 requests and 15,600 reserved CU.

Any attempt-3 stop ends BUILD-003D recording authority, and Option B becomes mandatory. No Amendment 7 is permitted.

**Repository changes (the six A6-9 paths).**

| Path | SHA-256 after the change |
|---|---|
| `packages/reference-compiler/src/profile.ts` | `0038db259fa3820c55ddbf2b382042695ff1342f1905b92ccb7cb26068c3c746` |
| `apps/reference-dapp/e2e/fork/harness.mjs` | `6d846894b46de0532bcb28593a4743ac80d5d57a49b45ad577bd4af1e9d7c532` |
| `apps/reference-dapp/e2e/fork/fork-setup.mjs` | `0caa84b237c9b24e71ecd12d06c3901876d8212eb830043f9873ee19aaeb8133` |
| `packages/reference-compiler/test/anvil-compatibility.fork.test.ts` | `53f8cbcf6f4a0319cfa96454d354a62fe2f617b721b5e893b46dfa765a6fcd8a` |
| `packages/reference-compiler/test/compile.fork.test.ts` | `2846590ac45a4ce1b8e5cc3cd5d832a55d1a0da21d1d2f9ae931269867b33992` |
| `packages/reference-reconciler/test/raw-transaction.test.ts` | `cab92a6d91f93e2208574165ee401f0e8f0aac48e54a0e5ff94d49a526c606c3` |

What changed:

- **Historical arguments, superseded by DEC-0026.** The pre-removal harness appended the mnemonic and derivation path. The delivered browser-safe profile holds public addresses and the path only; the owner-secret argument is assembled inside the acceptance harness after address validation.
- **Historical phrase check, superseded by DEC-0026.** The delivered harness contains no phrase or phrase digest; final-byte pinned-account revalidation is deferred to BUILD-003F.
- **Account selection.** `selectForkAccounts` enforces, in order:
  1. exactly the ten pinned addresses (otherwise `DEV_ACCOUNTS_DERIVATION_MISMATCH`);
  2. no Anvil default address;
  3. the unchanged empty-code rule;
  4. `DEV_ACCOUNTS_NOT_CLEAN` if fewer than two accounts qualify.

  All of this runs before any transaction.
- **Historical location, superseded by DEC-0026.** The phrase was in the harness before delivery. The delivered tree contains no phrase or reconstruction input; a future owner must supply an untracked secret.
- **Correction during implementation.** A slicing error in `fork-setup.mjs` truncated `send()`. It was restored. A reconstruction of the pre-change file, reversing only the intended edits, matched the attempt-2 pin `62712c08…`.

**Offline validation (A6-8).** Pinned Node, pnpm and Anvil, a loopback-only namespace, no credential.

| Check | Result |
|---|---|
| Build | 7/7 |
| Typecheck | 11/11 |
| Lint | clean |
| Schema exports | 11 |
| Unit | 316/316, including 3 independent derivation tests (the phrase digest, the ten pinned addresses, and the public-defaults control) |
| Contracts | 79/79 |
| G1 | 14/14 with the changed exact command; C1–C10 true; C2 asserts exactly the pinned accounts and no default |
| Fork suites | 31/31, including 4 selection tests: all clean; EIP-7702 designators on indices 0–1 (recording selects 2 and 3, replay refuses the changed pins, code kept); other non-empty code; fewer than two clean; derivation mismatch |
| `git diff --check` | clean |
| Exact scope | 66/113 created, 23/51 modified |
| Frozen files | identical |

**Attempt-3 preflight.** 114/114 passed; result SHA-256 `b710845c4d992dad8758f9038a135d33c88e55be0b150a35fb3e65b531215042`. Measured on the saved attempt-2 block 51,748,192:

- Anvil was ready after exactly 32 attempt-3 provider requests.
- The genesis read only the ten pinned accounts and no default.
- The minimum send gap was 417.7 ms (monotonic clock), with up to 40 requests queued and one in flight.
- The 601st request was refused before sending, at 600 requests and 15,600 CU.
- Through the real proxy, recorded EIP-7702 code was kept and disqualified indices 0 and 1. Selection moved to 2 and 3, and replay pins refused them.
- Every stop class, the caps, pacing, interruption (exit 130, `INTERRUPTED_SHUTDOWN`), cleanup, record-to-replay closure and single-use refusal passed.
- The phrase appears in no attempt-3 file, log or preflight artifact.
- The attempt-1 (30) and attempt-2 (23) evidence files are byte-identical.

**Entrypoint** (`/tmp/gryloo-build-003d-g5-attempt3/`, mode 0700, uncommitted; the manifest pins 868 files).

| File | SHA-256 |
|---|---|
| `recording-proxy.mjs` | `b3a6d25eac35b64021718d0fc3eedb4efe8c6929f0e44060837b18d84ce8a9ec` |
| `owner-run.sh` | `4f96fcebc31c0d6c92f7c3f2f3b9293ee58fb461400314f7b40cb1cbce52a721` |
| `gate.mjs` | `732531ea8935929919babfb14d34f9625d8929e5ca041f09f21f185e7a43b2a5` |
| `owner-harness.mjs` | `4b01117ed13633487e66f3249ce6c92a227244af268303c9e6b2e7e387d405d3` |
| `finalize-transcript.mjs` | `db634f3067b59e4bbfd79fef126b40d72feb080ec13ab50acf160e782f9a1019` |
| `journal-summary.mjs` | `1dc72ddd364966062216f6618b25ee681454d0bb4e056860cc3fa60388f68076` |
| `session/journal.json` | `9441a7fb4f6c8c791d6d0c5eaa01c55e50f76e14c545f3f50ce90bc77c5cc53d` |
| `session/preflight.json` | `9a84c2e51d74b2928e1d03ae8ea7db6d3f5d29af4c4bcbbb8da829d576fdbbc5` |
| `preflight-result.json` | `b710845c4d992dad8758f9038a135d33c88e55be0b150a35fb3e65b531215042` |
| `manifest.json` | `5e55b73bccef36cd60c4bca8172a295c356f947a96aa7de8355be81e4c97bad5` |

**Journal.** `READY`, attempt 3 only. It carries 34 requests and 884 CU, pins attempt 2 (`7fb21b2c…`) and attempt 1 (`ee7a3ada…`), and records the owner's exact 1,008 CU dashboard value. The real gate `--check` passed read-only, and the directory is not claimed.

**Owner command (final, single use, run only after the owner's fresh no-paid-billing confirmation).**

```text
bash /tmp/gryloo-build-003d-g5-attempt3/owner-run.sh 5e55b73bccef36cd60c4bca8172a295c356f947a96aa7de8355be81e4c97bad5
```

## Final delivery-security correction (DEC-0026)

The previously recorded G1 C1–C10 result and its logs and hashes are HISTORICAL_PASS_PRE_SECRET_REMOVAL. The final-byte pinned-account Anvil startup is DEFERRED_TO_BUILD_003F_OWNER_SECRET_REVALIDATION and must use a separately approved owner-secret procedure before any future recording or wallet operation. No phrase was supplied in BUILD-003D after this correction. The harness fails closed on a missing external mode-0600 owner secret file and compares derived public addresses with all ten pins before Anvil startup. The phrase, its reconstruction input and fixed test keys are absent from the delivered tree. The local fork is acceptance infrastructure only. Gryloo remains a global online, non-custodial multichain product with user-wallet signing and no production mnemonic handling. G8 certification and BUILD-003 certification are not achieved; BUILD-003F is NOT_APPROVED and BUILD-004 planning is blocked. The commit, push, PR and remote CI remain pending final verification.

### Final-byte offline verification (DEC-0026 continuation)

- Exact scope: 66 created and 26 modified paths; all 47 excluded creations absent, all 25 excluded modifications unchanged, and protected baseline paths unchanged.
- Pinned Node 24.21.0 and pnpm 11.22.0: typecheck 11/11 tasks, build 7/7 tasks, lint pass, 313/313 unit tests in 38 files, 79/79 workflow-contracts tests in six files, and 11 schema exports verified.
- Current-byte fork/G1 non-secret checks: 12 passed and 21 owner-secret cases deferred; the preserved earlier 14/14 C1–C10 and 31/31 fork suites remain historical pre-removal evidence.
- Guarded browser replay: 28/28 passed with the pinned headless shell. The initial invocation failed to start its server because a nested process used the system pnpm; the corrected pinned-pnpm invocation passed. No provider request occurred.
- Both persistent governance programs passed; each rejected an isolated negative mutation, after which original bytes were restored. Workflow YAML, embedded shell and Python syntax, screenshot-diff self-test, frozen offline pnpm install, and git diff whitespace checks passed.
- Secret scan found no removed phrase in current worktree files or in branch commit ancestry. A separate local Codex capture-tree ref retains a pre-removal snapshot; it is not a commit or branch ancestor and is not included in a branch push. No secret was printed in the scan or written to this report.
- The complete pinned-account Anvil startup was not rerun on final bytes. G8 certification and BUILD-003 certification remain unachieved. Commit, push, PR and remote CI were pending when this report was written.
