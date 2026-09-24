# BUILD-003C — Report

Status: **LOCAL_ACCEPTANCE_PASSED; REMOTE_CI_PENDING**. Branch: `codex/build-003c-mode-a-requirements-review`. Baseline: `0faec71207628dfe27fb23c81680d2c27827f5ea`. The read-only scope in the [approved plan](BUILD-003C-PLAN.md) remains the target. The owner-run Amendment 3 recording completed within its final cumulative budget; local acceptance and remote CI are recorded separately. At the time of this report update, no BUILD-003C commit, push or PR has been made.

## 1. Approved objective

Show a read-only Base/Uniswap v3 quote observation for each authored swap, with every `eth_call` and `eth_getCode` pinned to `{ "blockHash": H, "requireCanonical": true }`. Keep observations separate from BUILD-003B `MOCKED` artifacts. Workflow authorization, wallet, signing, submission and execution remain unavailable.

## 2. What was implemented

The uncommitted implementation includes a fixed read plan, strict response and transcript parsing, a server-only Base transport and replay mode, browser re-verification, separate observation state, a visible observation panel and a same-origin CSP. Offline tests cover the request sequence, hash pinning, limit and failure behavior. Both real recordings have now been checked offline and their reviewed code digests pinned. The original failed sessions remain preserved.

## 3. What was not implemented

Wallet, signing, transaction, authorization input and execution remain unavailable. Both usable real transcripts, the reviewed replay fixture, code pins and successful quote display are now present. Remote pull-request CI remains to be observed after delivery. Alchemy Free and its server-only Bearer credential boundary are approved by DEC-0021. On 2026-09-24 the owner confirmed an Alchemy Free account with no payment method, paid subscription or charge, and a key privately exported in an open WSL terminal. The owner ran the recording command once; it stopped on the first request with HTTP 403. No credential value was inspected or recorded. The original session remains stopped and byte-identical. DEC-0022 subsequently authorized only the separate Amendment 3 continuation after its offline preconditions pass.

## 4. Changes by component

- Linter: read plan, transcript collector and re-derivation tests.
- Server: opt-in local-only read transport, process limits, replay parser and Server Action.
- Browser: separate observation state, access guard and panel.
- Tests: domain access and failure tests, transcript-derived positive replay E2E for both directions, expiry and edit retirement, visual baselines and current-copy assertions.
- Governance and delivery records: local exact-scope, protected-digest, source-scan and dependency gates passed; remote CI is pending.

### Current changed-file inventory

The uncommitted worktree contains **36 modified and 30 created paths**. The original handoff already contained observation implementation and UI work; this inventory records the complete current tree, including the offline E2E, visual and governance additions. No path was deleted, staged or committed.

```text
 M .github/workflows/contracts.yml
 M .github/workflows/governance.yml
 M README.md
 M apps/reference-dapp/e2e/fixtures.ts
 M apps/reference-dapp/e2e/interface-honesty.spec.ts
 M apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
 M apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
 M apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
 M apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
 M apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
 M apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
 M apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
 M apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
 M apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
 M apps/reference-dapp/next.config.ts
 M apps/reference-dapp/playwright.config.ts
 M apps/reference-dapp/src/app/globals.css
 M apps/reference-dapp/src/app/layout.tsx
 M apps/reference-dapp/src/components/app-shell.tsx
 M apps/reference-dapp/src/components/simulate-panel.tsx
 M apps/reference-dapp/src/components/summary-bar.tsx
 M apps/reference-dapp/src/components/workflow-canvas.tsx
 M apps/reference-dapp/src/config/product.test.ts
 M apps/reference-dapp/src/config/product.ts
 M apps/reference-dapp/src/domain/contracts.integration.test.ts
 M apps/reference-dapp/src/state/workflow-store.tsx
 M docs/AUTHORITY_MATRIX.md
 M docs/DECISIONS.md
 M docs/EVIDENCE_LEVELS.md
 M docs/LICENSE_MAP.md
 M docs/NEXT_BUILD.md
 M docs/REQUIREMENTS.md
 M docs/SCOPE_GUARD.md
 M docs/SECURITY_MODEL.md
 M docs/STATUS.md
 M packages/reference-linter/src/index.ts
?? apps/reference-dapp/e2e/base-observation.spec.ts
?? apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
?? apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
?? apps/reference-dapp/e2e/observations/base-recorded-observations.json
?? apps/reference-dapp/e2e/visual-evidence/build-003c/build-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/build-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/execute-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/execute-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/proposal-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/proposal-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/review-blocked-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/review-blocked-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-current-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-current-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-expired-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-expired-diff.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-invalidated-before.png
?? apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-invalidated-diff.png
?? apps/reference-dapp/src/app/observation-action.ts
?? apps/reference-dapp/src/components/observation-panel.tsx
?? apps/reference-dapp/src/domain/base-observation.test.ts
?? apps/reference-dapp/src/domain/base-observation.ts
?? apps/reference-dapp/src/server/base-rpc.test.ts
?? apps/reference-dapp/src/server/base-rpc.ts
?? docs/builds/BUILD-003C-PLAN.md
?? docs/builds/BUILD-003C-REPORT.md
?? packages/reference-linter/src/base-observation.ts
?? packages/reference-linter/test/base-observation.test.ts
```

## 5. Evidence and tests

| Check | Result | Limit |
|---|---|---|
| Pinned Node 24.21.0 and pnpm 11.22.0 observation suites | 86 tests passed in two files | Scripted and stubbed transports only |
| Full unit and integration suite | 22 files, 245 tests passed | Real transcripts absent |
| Browser observation domain suite | 4 tests passed | Does not replace a real transcript |
| `pnpm typecheck` | 7 tasks passed | Current TypeScript source |
| `pnpm build` | 4 tasks passed | Replay data absent |
| `pnpm lint` | Passed | Current source and E2E tests |
| `pnpm schemas:check` | 10 schema exports verified | Frozen schemas unchanged |
| Persistent governance block | Passed: 206 text files, 27 protected digests, 22 decisions, 82 requirements | Exact-scope block still requires three recording-dependent files |
| Governance mutation checks | 13 isolated negative mutations rejected | Temporary copy only; worktree unchanged |
| Guarded `base-observation.spec.ts` | 2 tests passed | Unrecorded amount fails closed with `REPLAY_MISMATCH` while the mocked chain stays current; keyboard and 375/768/1280 widths pass; no successful replay path |
| Full guarded browser suite | 25/25 passed after the approved negative self-test CSP bypass and updated Simulate baselines | Local replay only; the two successful-observation snapshots still await real transcripts |

At the pre-recording checkpoint, the first browser run failed on an assertion for a `DRAFT` text label that the UI does not render; the assertion was removed, and the guarded test then passed. The workflow revision and disabled Manifest review control remain asserted. No live RPC was used in these checks.

Before the owner-run continuation, after DEC-0022 approval, `pnpm check` passed again (7 typecheck tasks, lint, 4 build tasks, 10 schema exports, 22 Vitest files/245 tests). The full guarded Playwright suite passed 25/25 in replay mode with the Alchemy key unset. The persistent governance block passed (206 text files, 27 protected digests, 22 decisions and 82 requirements), and `git diff --check` passed. The exact-scope block still fails solely on the absent real replay fixture and two observation snapshots. These checks made no RPC request.

### Stopped public RPC session

The original session files in Claude's scratchpad were read, not run or modified. The authoritative session JSON reports two attempts, 24 requests, `PROVIDER_RATE_LIMITED`, no transcript and no completed head. Its SHA-256 is `71e37622baee63d44f9d3be5a176b9c6485a62040e776742d0921d7369a02d17`; the 24-line request log SHA-256 is `9a9e06412eddc75fc9cf49d0c6664367d16c637fd12819e91232971e9b7caff1`. The original and resumed harness digests are `97ce03eb197187bab0349107a9ce101e91e7ddf5054ce511e55749491259baff` and `f847466833995c21b31f9d34e248717c08788a5027bb03c193b5d1b665c468bf` respectively.

Attempt 1 stopped at 2026-09-24T11:29:25.502Z. Amendment 1 resumed at 2026-09-24T11:40:01.700Z with the persisted counters of 1 attempt and 12 requests. Attempt 2 stopped at 2026-09-24T11:40:08.029Z. Both received HTTP 429 on request 12, QuoterV2 `WETH9()` (`0x4aa4a4fc`), with no `Retry-After` header. Requests 3–11 of each attempt were hash pinned and answered. Cumulative usage is **2 of 4 attempts and 24 of 84 requests**. The approved public-endpoint recording is stopped permanently under Amendment 1; the nominal unused capacity is not permission to restart it.

The request log below records each method, target, selector, pin status and HTTP outcome. Full canonical request bytes and timing remain in the unchanged scratchpad JSONL identified by the digest above.

| Attempt | Request | UTC start | Method | Target | Selector | Hash pinned | HTTP | Outcome |
|---:|---:|---|---|---|---|---|---:|---|
| 1 | 1 | 2026-09-24T11:29:19.496Z | `eth_chainId` | `-` | `-` | n/a | 200 | OK |
| 1 | 2 | 2026-09-24T11:29:20.108Z | `eth_getBlockByNumber` | `-` | `-` | n/a | 200 | OK |
| 1 | 3 | 2026-09-24T11:29:23.472Z | `eth_getCode` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `-` | yes | 200 | OK |
| 1 | 4 | 2026-09-24T11:29:23.641Z | `eth_getCode` | `0x4200000000000000000000000000000000000006` | `-` | yes | 200 | OK |
| 1 | 5 | 2026-09-24T11:29:23.777Z | `eth_getCode` | `0x33128a8fc17869897dce68ed026d694621f6fdfd` | `-` | yes | 200 | OK |
| 1 | 6 | 2026-09-24T11:29:23.952Z | `eth_getCode` | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | `-` | yes | 200 | OK |
| 1 | 7 | 2026-09-24T11:29:24.089Z | `eth_call` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `0x313ce567` | yes | 200 | OK |
| 1 | 8 | 2026-09-24T11:29:24.456Z | `eth_call` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `0x95d89b41` | yes | 200 | OK |
| 1 | 9 | 2026-09-24T11:29:24.668Z | `eth_call` | `0x4200000000000000000000000000000000000006` | `0x313ce567` | yes | 200 | OK |
| 1 | 10 | 2026-09-24T11:29:24.866Z | `eth_call` | `0x4200000000000000000000000000000000000006` | `0x95d89b41` | yes | 200 | OK |
| 1 | 11 | 2026-09-24T11:29:25.221Z | `eth_call` | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | `0xc45a0155` | yes | 200 | OK |
| 1 | 12 | 2026-09-24T11:29:25.373Z | `eth_call` | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | `0x4aa4a4fc` | yes | 429 | RATE_LIMITED |
| 2 | 1 | 2026-09-24T11:40:01.728Z | `eth_chainId` | `-` | `-` | n/a | 200 | OK |
| 2 | 2 | 2026-09-24T11:40:02.636Z | `eth_getBlockByNumber` | `-` | `-` | n/a | 200 | OK |
| 2 | 3 | 2026-09-24T11:40:04.250Z | `eth_getCode` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `-` | yes | 200 | OK |
| 2 | 4 | 2026-09-24T11:40:04.651Z | `eth_getCode` | `0x4200000000000000000000000000000000000006` | `-` | yes | 200 | OK |
| 2 | 5 | 2026-09-24T11:40:05.051Z | `eth_getCode` | `0x33128a8fc17869897dce68ed026d694621f6fdfd` | `-` | yes | 200 | OK |
| 2 | 6 | 2026-09-24T11:40:05.452Z | `eth_getCode` | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | `-` | yes | 200 | OK |
| 2 | 7 | 2026-09-24T11:40:05.853Z | `eth_call` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `0x313ce567` | yes | 200 | OK |
| 2 | 8 | 2026-09-24T11:40:06.254Z | `eth_call` | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `0x95d89b41` | yes | 200 | OK |
| 2 | 9 | 2026-09-24T11:40:06.654Z | `eth_call` | `0x4200000000000000000000000000000000000006` | `0x313ce567` | yes | 200 | OK |
| 2 | 10 | 2026-09-24T11:40:07.055Z | `eth_call` | `0x4200000000000000000000000000000000000006` | `0x95d89b41` | yes | 200 | OK |
| 2 | 11 | 2026-09-24T11:40:07.455Z | `eth_call` | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | `0xc45a0155` | yes | 200 | OK |
| 2 | 12 | 2026-09-24T11:40:07.857Z | `eth_call` | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | `0x4aa4a4fc` | yes | 429 | RATE_LIMITED |

### Visual evidence completed offline

The eight changed BUILD-003B snapshots have preserved baseline copies and visual diffs. The Simulate empty and current images were inspected. The relevant 18 guarded E2E tests passed on a rerun with zero-pixel snapshot tolerance. At that pre-recording checkpoint, the two new observation snapshots still depended on real transcripts.

| Screen | Before SHA-256 | Current SHA-256 | Diff SHA-256 |
|---|---|---|---|
| build | `c21899cdb7f355bd5d7391906ebe3961d1e3c34ae575dd2f034424532e377268` | `dd39b3e7c0c81435d37e9a0210131fd2c74306e27625be855bbfde5e47f0f7cf` | `c0415b1ddc22f5c34785f33e3c1f6cb7eddd905960e5ec9e94027f5d323d01e4` |
| simulate | `575822399c07b491d36b056c19addf4020e46e7bbef4e873bec340cd897988ea` | `607c7627604ac89badc0cd79091ce008a9f514bde81717bd7041fcdc956fb098` | `cea807f2c45a9d80e406b6b7f932ff3d37bcd4cbcdc722ac684738a2d240ad5b` |
| execute | `73d2e48cc04228c5ed48aa2154607958515a86272f9425f9e23c8d39af8bc395` | `162287df9b73b3e3de681f3c95b1a19fcef7f4acebd179863280816db876e73b` | `3f90d57ad7e2ffce80ee91ce02c635efb3317b5ea534b4c261a1b0151b24bab9` |
| proposal | `4ba686dbcb28391da053ca0701fa922ac594046d42202752507718fed83ac97e` | `03fc19e5a06b16cab247e441ef6b14ad5ce78bb3c8451b0f7a4bed77ef5f8e6d` | `c0415b1ddc22f5c34785f33e3c1f6cb7eddd905960e5ec9e94027f5d323d01e4` |
| review-blocked | `029f95d9577900a8f5988df6c522ad54a2517a2ad93d55134adc47261be6170d` | `d86820659048d1eb63e3caa44df5fbab3dcf20ba5c19e7b8fec3cc213f5c50f8` | `79d1306a03c43f1f3af2d36db1b4b8380f689f105631e16fe9b1a3838b13d31d` |
| simulate-current | `352547e98c9f1504ed64e6f25e41fe2efa35009f774f105bd2ca5d49f018eaa3` | `c02b9c88052b3a41ec404e875d8d2f24a56b52fa45db0604c21ce8b19e147a33` | `9b61942291d251ab4da5e21cf24d43e8e9f916c00ad271a241d1c6b41759c28e` |
| simulate-invalidated | `df82b185fc2b0ad087ed4924ae2aa329a2db2a0aa79673dbd829c5c0f14f2467` | `c7d79e2e1acbd57b701b8f36a506257a6f26b18f8917123b2196e901f0c1190c` | `7f84130f3f831f89c1e10e820637676d3de6da12144614b971c48020ff74411a` |
| simulate-expired | `e4b907e663f7e9383390fb6ab38f3832666c6c54a947cecf49c59f46b8344707` | `497bcea7ee54569d26d34cf501dcfd81e09404caff948148b6943a0cc378b285` | `942d6f8598d96ccb9b5a13fdcdec8974e08ccc5180c29649b260955bd4a59d9d` |

### Final owner-run Alchemy continuation and local replay acceptance — 2026-09-24

The owner ran the Amendment 3 command once after its credential-free preflight passed. I inspected only the saved credential-free files; I did not run a recording command or make an RPC request. The original Alchemy attempt-1 files remain byte-identical at SHA-256 `b3747100197bb3656f4df0e9b1166f60ea1a10fe4909c72624dc0e23259c3ec3` and `d2c97c097d8c1444c094e6b80201fa26ae346b09cb62f4e2a49c90c81c5bacec`, preserving HTTP 403 on `eth_chainId` at 1/3 attempts and 1/63 requests. The stopped public Base session remains at 2/4 attempts and 24/84 requests, both HTTP 429 on request 12. The completed Alchemy continuation is separate and links the two original digests. Its `session.json` is SHA-256 `dcf97126049eb3500c8fc7ac846ead487afe7dff80476f0abb4f0125de2d1d2c`; its 42-line `requests.jsonl` is SHA-256 `82fbbc206f9b2bdd12ee8cbdedf3219f601575c073a5c14c419d08dfd7201135`.

Attempt 2 recorded **1 WETH → USDC** in 21 requests, and attempt 3 recorded **2,500 USDC → WETH** in 21 requests. All 42 continuation requests have HTTP 200 and an `OK` outcome, with cumulative log totals 2 through 43. Final Alchemy usage is **3/3 attempts and 43/63 requests**; the remaining 20 nominal requests have no approved use. Both directions answered `eth_getCode` at request 3 and `eth_call` at request 7. In each transcript, requests 3–20 (four code reads and fourteen calls) carry exactly `{ "blockHash": H, "requireCanonical": true }`, with the same H as its head and final block response. Neither method fell back to a number, bare hash or tag. The session records both support flags true, no stop, no active attempt, and two completed transcripts. The one negative `ms` duration at attempt 2/request 8 is a wall-clock telemetry anomaly in the credential-free log; its persisted request and response are successful and the transcript's block/time checks pass. It did not change request counts or pinning.

| Direction | Block and hash | UTC block time | Transcript SHA-256 | Raw response hash |
|---|---|---|---|---|
| 1 WETH → USDC | `51736067`, `0x2d7f98dc13fb2d72c61d1122c7338d8e77f4fae2fc61f7b21cdc69a1fb9a95d1` | 2026-09-24T14:51:21Z | `412609a4e3fcbb53968a2b4440e8a1062049c2abbb19a8ed8262def2e940cc8a` | `0xdf85f9510ff3d0fabdd5fa5eddb7de4cd4c04ec1d0fd3ea794a8c67f036d2d8c` |
| 2,500 USDC → WETH | `51736072`, `0xfd64239ba46da2700adea0b0a5fd47bcb5f3c3fe2378d1b035312c259619342e` | 2026-09-24T14:51:31Z | `a16f2269f393334d381492c7e1316ac42c782a7f2c776e6b2c9216e073070f39` | `0x4f15202fb165bf717f2ef2e0f669487bcbf32119b034fb0ccc585d5262ee07ec` |

The four SHA-256 code pins were recomputed from the `eth_getCode` bytes independently for both transcripts and match exactly:

| Contract | Reviewed pin |
|---|---|
| USDC | `0x98d785fcb1bf847f287adc2310759fd94cc13e754b974bc72131382e8266f607` |
| WETH | `0x667c900c2c6da80d452501a9c6332e046384a0c438c3334ce6f71c86dd7b8735` |
| Factory | `0x8545609892cc8d7d608dd4420ee110ab98448730570824fb029228e33846d28c` |
| QuoterV2 | `0xa204e355059d9c809bfc026503d49b4ecf8655f482a76040dec4bcb4618047b4` |

The approved replay wrapper contains exactly those two raw transcripts, with SHA-256 `29a4ae63f96d0332450cf083ce627832b01f72fa95186d4b7ad1d59144997d00` at `apps/reference-dapp/e2e/observations/base-recorded-observations.json`. Its two inspected full-page screenshots are `observation-recorded` SHA-256 `62b67362b5cf2634901415a892fd41f6bed130b3a026338a590caae707d2e4b2` and `observation-expired` SHA-256 `49ff2daceb7074c9184e2e58080d7b53003712f0c2ca482ab7db9b910c859ead`. All ten browser snapshots passed with zero differing pixels. The new images visibly separate the recorded observation from the empty mocked chain and hide values and JSON after expiry.

After the fixture and pins were installed, `pnpm check` passed: seven typecheck tasks, lint, four builds, ten schema exports and 246 tests in 22 files. A permanent server test independently verifies both original transcript SHA-256 digests, the wrapper digest, every EIP-1898 request, final block hashes and all four code pins; its focused run passed 35/35. The complete guarded Playwright suite passed **28/28** in replay mode with the key removed from its environment. Positive E2E re-derives and validates the frozen artifact, checks displayed artifact and transcript hashes, all four fee tiers in both directions, no authority-shaped outputs, unchanged revision, edit and expiry retirement, and a clean browser network guard. The exact-scope governance block passed (30 created, 36 modified paths); the persistent block passed (207 text files, 27 protected digests, 22 decision IDs, 82 requirement IDs). `pnpm audit --audit-level low` found no known vulnerabilities. `scripts/bootstrap-ci.py --verify-dependencies` verified 245 registry identities/integrities/release ages and 16 reviewed license exceptions, with evidence SHA-256 `20aca46436a4692cef9ec7c2c04f7a91f9e0bf2d9768f8ca11e21f5f4ba177ea`. The exact CI CycloneDX 1.6 validator accepted the ephemeral SBOM: 245 registry components, five workspace manifests/importers separately checked, 16 exceptions, SHA-256 `10e6cfe30621d3905f518f7e868447aa23c89e6c5194f47d8fbcdffec9b978f8`; it removed the generated SBOM. The repository, fixture, both transcripts and both session/request logs contain no serialized credential, authorization header, Bearer marker or key field. The static source scans pass; the key value was never inspected.

The latest owner instruction authorizes the agent to commit, push this BUILD-003C branch and open a PR **only after all local acceptance and governance gates pass**. Merge remains reserved for the owner. Remote CI results will be recorded after PR creation.

## 6. Acceptance criteria

All local BUILD-003C acceptance and governance gates passed on the approved replay fixture. The public RPC and original Alchemy stop evidence are preserved. No further Alchemy request is authorized. Remote pull-request CI remains pending until delivery.

## 7. Security

All current state reads use the same canonical block-hash parameter. Failed reads return no partial quote. Browser results are re-derived and cannot flow into the workflow or authority path. The public RPC session ended after two rate limits. DEC-0021 approved Alchemy Free with one fixed `/v2` destination and a server-only Bearer credential. The original Alchemy request received HTTP 403 before any pinned read; the separate owner-run DEC-0022 continuation then verified both required pinned methods and completed both recordings. The credential cannot enter a URL, file, transcript, log, browser result or commit.

## 8. Licenses

The planned app and linter source remains AGPL-3.0-only; governance prose is Apache-2.0 under the existing map. No dependency, schema or license text changed.

## 9. Deviations from the plan

The approved public RPC session stopped after two HTTP 429 responses. The original Alchemy attempt stopped on HTTP 403 before hash-pinned support was tested. The owner corrected the existing Free app to Base Mainnet only, approved Amendment 3/DEC-0022, and ran the bounded continuation once. It succeeded within 3/3 cumulative attempts and 43/63 requests. No fallback, extra provider, extra attempt or extra source path was used. The owner subsequently authorized agent push and PR after complete acceptance, superseding the earlier delivery assignment while retaining owner-only merge.

## 10. Demonstrable state

Both real recorded swaps replay locally into fully re-derived, read-only observations with code pins, block provenance and four quoted fee tiers. The recordings are historical, single-provider facts and `NOT_EVIDENCE`. Authorization is `NONE`, financial enforcement is `NOT_ENFORCED`, and the workflow remains `DRAFT`. Wallet, signing, submission and execution remain unavailable.

## 11. Technical debt created

The code pins are trust on first use from one provider, and implementation code behind a proxy is not pinned. Replay is historical and does not prove a current market quote. The observation has no route choice, minimum output, slippage bound, gas model or authorization path. No new dependency or schema debt was introduced.

## 12. Suggestions for the next build — NOT APPROVED

No next build is proposed. Complete BUILD-003C acceptance first. Mode B, publication and execution remain outside this work.

## 13. Next-build options

`NONE_APPROVED`. BUILD-003C has passed local acceptance; PR review and remote CI are the remaining delivery checks. No later build, publication, Mode B or execution work is approved.

## 14. Required human decision

**Amendment 2 — APPROVED by the owner on 2026-09-24 (DEC-0021).** The following terms are retained as the decision record. Approval did not make a credential available or authorize a request before the owner confirms Free-account setup and the private local-server key. No spending is authorized.

1. **Provider and support gate.** Use only Alchemy's Base mainnet JSON-RPC host (`base-mainnet.g.alchemy.com`) from the local development server. Alchemy lists Base `eth_call` and `eth_getCode`, but its method pages describe a block number, tag or bare hash and do not explicitly promise the EIP-1898 object with `requireCanonical: true`. [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898) defines that object for both methods. The first authorized attempt must verify object support for both `eth_getCode` and `eth_call` on Base. A rejection ends the new session without fallback, a second provider or a block-number read. The final block consistency check stays.
2. **Credential boundary.** An Alchemy account and Base app/API key are required by [Alchemy's pricing and setup page](https://www.alchemy.com/pricing). Use a key supplied by the owner to a server process environment variable only, with `Authorization: Bearer` on the fixed `/v2` URL as documented in [Alchemy's header guide](https://www.alchemy.com/docs/how-to-use-api-keys-in-http-headers). Never place the key in a URL, browser bundle, Server Action result, transcript, log, test fixture, `.env` file or Git. Reject missing or malformed configuration before any request; the browser remains same-origin. The owner set up the Free account and privately supplied the key to the WSL process environment. Its value was not inspected or recorded here.
3. **Cost and account choice.** The published [Free plan](https://www.alchemy.com/pricing) lists 30 million compute units monthly and 25 requests/s; [Alchemy's method table](https://www.alchemy.com/docs/reference/compute-unit-costs) lists `eth_chainId` at 0, `eth_getBlockByNumber` and `eth_getCode` at 20 each, and `eth_call` at 26. A full 21-request observation is at most 484 listed CUs, so three full attempts would be at most 1,452 listed CUs. This is an estimate, conditional on the provider's actual metering and current account terms. The published paid rate is $0.525 per million CUs, but **no paid plan, billing upgrade or charge is proposed**. If the free account requires a payment method or a chargeable plan for these calls, stop and seek a new decision. The owner must confirm the account setup requirements before enabling recording.
4. **New recording budget.** The public RPC session remains frozen at **2/4 attempts and 24/84 requests**, with both 429 results preserved. A new Alchemy session would have its own persistent cap of **3 attempts and 63 requests**, counting before send, solely to obtain one transcript for 1 WETH → USDC and one for 2,500 USDC → WETH. The support checks consume this new budget. Allow only the existing `eth_chainId`, `eth_getBlockByNumber`, hash-pinned `eth_getCode` and hash-pinned `eth_call` read plan, with the same strict target and selector allowlists. Keep the 400 ms spacing, 1-second head pause, 15-second freshness, 20-second duration, one-in-flight and no automatic retry. Stop the session on any HTTP 429, other non-200 status, unsupported pin form, non-quote RPC error or inconsistency. A no-response transport failure may consume one remaining attempt after 10 seconds; never reset counters. Stop as soon as both transcripts are complete.
5. **Code, E2E and governance scope.** Add one protected modify path, `apps/reference-dapp/e2e/fixtures.ts`, solely to set `bypassCSP: true` for its existing synthetic negative self-test context. This allows the unchanged `network-isolation.spec.ts` to prove the Playwright guard intercepts that external request; normal guarded E2E contexts still enforce the production CSP, which remains `connect-src 'self'`. The approved BUILD-003C scope therefore changes from 30 created/35 modified paths to 30 created/36 modified paths. Replace the fixed public destination with the fixed Alchemy host and header authentication only in the server transport, update the observation provider-host binding and UI disclosure, and extend tests and governance network/secret scans for that one host. Keep all other BUILD-003C file paths, frozen contracts, schemas, BUILD-003B artifacts, workflow and authority boundaries unchanged. Re-run offline tests, full replay E2E, visual and governance gates before any BUILD-003C commit or PR.

**Decision recorded:** Proposed Amendment 2 was approved as stated. On 2026-09-24 the owner confirmed Free-account, no-charge and private local-server key readiness. No key has been supplied in chat, file or log.

### Amendment 3 — Base Mainnet configuration correction; APPROVED under DEC-0022

On 2026-09-24 the owner reported that the existing Alchemy Free app had **no active endpoint or network** when attempt 1 received HTTP 403. The owner has enabled **Base Mainnet only**; Base Sepolia and every other network remain disabled. No RPC request followed this correction, and the stopped evidence above is preserved. The saved HTTP response itself does not prove the 403's underlying cause. Hash-pinned method support is still unverified.

On 2026-09-24 the owner explicitly approved this narrow exception to DEC-0021's stop-after-non-200 rule **only for one controlled continuation following that specific corrected configuration**. The approval requires offline preparation and validation before the owner receives a command. The approved terms are:

1. Keep the public session at **2/4 attempts, 24/84 requests** and the original Alchemy session at **1/3 attempts, 1/63 requests**. Preserve the original Alchemy JSON and JSONL byte-for-byte at the digests above. A separate credential-free continuation journal must verify and link those digests, carry the 1/1 usage forward, persist counters before send, and refuse inconsistent or interrupted state. Never clear the original stopped flag or reset a counter.
2. Permit attempt 2 only for **1 WETH → USDC**. If and only if it completes and confirms both hash-pinned methods, permit attempt 3 for **2,500 USDC → WETH**. This is one retry of the first direction plus one attempt for the second; no extra attempts. Each observation is capped at 21 requests. At most **2 more attempts and 42 more requests** may be sent, yielding cumulative maxima of **3/3 attempts and 43/63 requests**. The remaining 20 nominal requests are unavailable for any other use.
3. Use only the existing Free app, Base Mainnet, fixed `https://base-mainnet.g.alchemy.com/v2` destination and server-only `Authorization: Bearer` credential from the owner-controlled WSL process environment. Never expose, print, inspect, log, persist, put in a URL or browser bundle, commit, or request the key in chat. No Base Sepolia, other network, provider, account, paid plan, payment method or charge is approved.
4. Attempt 2 must verify `{ "blockHash": H, "requireCanonical": true }` for `eth_getCode` on request 3 and `eth_call` on request 7. Keep all existing read allowlists, timing, freshness, one-in-flight and final block consistency rules. Stop on any HTTP 429 or other non-200 response, unsupported pin, non-quote JSON-RPC error, inconsistency, code-digest mismatch, timeout or no-response transport failure, interrupted journal or cap breach. **No retry follows any failure**, including a no-response failure. Never fall back to a block number, bare hash, tag, alternate URL or provider.
5. Before any approved retry, verify offline the original hashes and counters, the owner-reported dashboard correction, continuation-journal safeguards and eligible checks. Persist a credential-free request log and stop record. Successful acceptance still requires both complete real transcripts, matching reviewed code digests, committed code pins and replay fixture, transcript-derived assertions, positive replay E2E, visual snapshots and full governance. No BUILD-003C commit, push or PR before all gates pass; push and merge remain with the owner.

**Approval recorded:** The owner explicitly approved Amendment 3 and DEC-0022 exactly as documented. This permits offline preparation and, after its preconditions pass, only attempts 2 and 3 within the stated limits. The original stopped session cannot be restarted or edited. No commit, push or PR is permitted before all BUILD-003C acceptance and governance gates pass.

### Amendment 3 offline continuation preflight

The original Alchemy attempt-1 session JSON and request log remain byte-identical at SHA-256 `b3747100197bb3656f4df0e9b1166f60ea1a10fe4909c72624dc0e23259c3ec3` and `d2c97c097d8c1444c094e6b80201fa26ae346b09cb62f4e2a49c90c81c5bacec`. The original Amendment 2 harness also remains unchanged at `9e31a09fa95625707669b8792c9ea0e72cf70d9f9b0eaa25965093cde70e1ce2`. No original stopped file was edited or reopened for sending.

The separate scratchpad continuation harness is `/tmp/gryloo-build-003c-alchemy-recording/continue-amendment3.mjs`, SHA-256 `0f143ade6821670685baa0a2797404e48834caba26d293138e416ad30fc09018`, mode `0600`. It uses only the fixed Base Mainnet `/v2` URL and server-only Bearer credential. It validates the two original digests before and during reads, carries the cumulative 1/1 state, counts each request before send, enforces attempt 2 then conditional attempt 3, caps each attempt at 21 requests and all new requests at 42, and stops on every failure without retry. The credential is read only from process environment in live mode; dry runs explicitly unset it.

The separate prepared live journal is `/tmp/gryloo-build-003c-alchemy-recording/continuation/session.json`, SHA-256 `e573aa904b4e8b4e4ccf16a7454e388b5079ace362f8e42235d80885151dd563`, mode `0600` inside a mode `0700` directory. It links the original digests and remains pristine: **1/3 cumulative attempts, 1/63 cumulative requests, 0 new requests**, `runStarted: false`, no stop, no continuation log and no transcript. The credential-free preflight script `/tmp/gryloo-build-003c-alchemy-recording/preflight-amendment3.py` has SHA-256 `61b8a60fd240f768446ca0cbb293b904bee172320b153fe6b463e7d12e507644` and passed without accessing any key or network.

Scripted offline rehearsals: both directions completed with 36 new requests (**3/3 attempts, 37/63 cumulative requests**) and attempt 2 verified successful pinned `eth_getCode` at request 3 and `eth_call` at request 7. HTTP 403, HTTP 429 and no-response failures stopped on attempt 2/request 1 at cumulative 2/2. Pinned `eth_getCode` and `eth_call` rejects stopped at attempt 2/request 3 (cumulative 2/4) and request 7 (cumulative 2/8). A simulated 403 on attempt 3/request 1, after attempt 2 succeeded, stopped at cumulative 3/20. Completed and stopped journals refused reruns; altered parent digest, interrupted state, reset counter and exhausted-attempt seeds all refused before any request. No dry run touched the prepared live journal or the original stopped session.

At the pre-recording checkpoint, the remaining acceptance dependencies were real provider support, two complete real transcripts, matching reviewed code pins, the committed replay fixture, successful-observation E2E and visual snapshots, and the exact-scope governance gate. The existing missing paths are `apps/reference-dapp/e2e/observations/base-recorded-observations.json`, `apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png` and `apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png`.

### Owner-run Amendment 3 recording — completed; command retired

The owner executed the approved command once after the credential-free preflight passed. It succeeded as documented in the final evidence subsection of §5. The command is retired and must not be run again; no further live Alchemy request is authorized.

### Historical WSL2 handoff checkpoint before the owner-run continuation — 2026-09-24

- **Checkout:** `/home/asus/projects/gryloo`, branch `codex/build-003c-mode-a-requirements-review`, baseline `0faec71207628dfe27fb23c81680d2c27827f5ea`. The Section 4 inventory is the exact file-level worktree inventory: 36 modified and 27 created paths; `git status --porcelain` abbreviates the new visual-evidence directory. No files are staged, deleted, reset, stashed or committed. No push, PR or merge occurred. Preserve all work in this same WSL2 checkout. A continuation on another machine would first need the owner's decision on a clearly labeled incomplete checkpoint; none has been made.
- **Offline checks completed:** `pnpm check` passed (7 typecheck tasks, lint, 4 build tasks, 10 frozen schema exports, 22 Vitest files/245 tests); full guarded Playwright local-replay suite passed 25/25 with zero-pixel snapshots, including the synthetic negative network guard. Thirteen isolated governance mutations were rejected. The persistent governance block passed (206 text files, 27 protected digests, 22 decisions, 82 requirements). The exact-scope block fails only because the real replay fixture and two successful-observation snapshots are absent. `git diff --check` passed. The refreshed Simulate snapshot and before/diff digests are recorded in Section 5.
- **Public RPC session:** still stopped after HTTP 429 at request 12 in both attempts, **2/4 attempts and 24/84 requests**, zero transcripts. Original session and log hashes remain `71e37622baee63d44f9d3be5a176b9c6485a62040e776742d0921d7369a02d17` and `9a9e06412eddc75fc9cf49d0c6664367d16c637fd12819e91232971e9b7caff1`. Never resume this session.
- **Alchemy scripted rehearsal:** The scratchpad harness at `/tmp/gryloo-build-003c-alchemy-recording/record.mjs` has SHA-256 `9e31a09fa95625707669b8792c9ea0e72cf70d9f9b0eaa25965093cde70e1ce2`. Its final scripted rehearsal completed two synthetic transcripts (2 attempts, 36 requests), verifying both pinned methods in attempt 1. Separate scripted rejects of `eth_getCode` and `eth_call` stopped on attempt 1 at requests 3 and 7 with `PINNED_READ_REJECTED`; a scripted HTTP 429 stopped at request 1. Synthetic cap and interrupted-state cases sent zero requests. These dry counters are separate from the live budget and are not acceptance evidence.
- **Alchemy live session:** The owner executed the approved command once. The credential-free persisted record in `/tmp/gryloo-build-003c-alchemy-recording/session/` shows **1/3 attempts and 1/63 requests**, stopped at `2026-09-24T13:52:11.303Z` with `PROVIDER_ERROR` for `weth-to-usdc`. Request 1 was `eth_chainId` with no params and returned **HTTP 403**, logged as `HTTP_ERROR`. The attempt log has `noResponse: false`; the stopped record has `providerErrorCode: null` and `supportUnverified: true`. There is no completed head, transcript or successful observation. The session JSON SHA-256 is `b3747100197bb3656f4df0e9b1166f60ea1a10fe4909c72624dc0e23259c3ec3`; the one-line request log SHA-256 is `d2c97c097d8c1444c094e6b80201fa26ae346b09cb62f4e2a49c90c81c5bacec`. Both files are mode `0600`. Their SHA-256 digests were rechecked after the owner-reported dashboard correction and remain unchanged. The session and public RPC counters remain separate.
- **Diagnosis and stop decision:** The precise recorded failure is HTTP 403 on `eth_chainId`, before request 3 (`eth_getCode`) or request 7 (`eth_call`). The harness does not read or persist non-200 response bodies, so the provider's reason for refusing the request is unavailable in these files; `providerErrorCode: null` is not a JSON-RPC diagnosis. The owner subsequently reported that the app had no active endpoint or network at the time and has enabled Base Mainnet only. This is owner-provided dashboard evidence, not a diagnosis from the saved HTTP response. [Alchemy's error reference](https://www.alchemy.com/docs/reference/error-reference) identifies several possible reasons for HTTP 403, but this record cannot distinguish among them. The capability of canonical EIP-1898 hash-pinned reads was **not tested**; there is no evidence that Alchemy rejected the pin form or supports it. Plan §3.5 and Amendment 2 stop the session on any non-200 HTTP response. Their sole within-budget retry exception is a transport failure **without an HTTP response**, which did not occur. The persisted `stopped` flag also makes the harness refuse another run. The nominal remaining 2 attempts and 62 requests are not permission for a retry. Apply the unverified-support stop rule: no fallback, no block-number read, no alternate destination and no further request under DEC-0021.
- **Next safe action:** The owner corrected the app configuration to Base Mainnet only, with no request after the change, and explicitly approved Amendment 3/DEC-0022. The original Alchemy session stays byte-identical and stopped. The separate continuation journal and preflight have passed offline validation. Provide the owner the single bounded command for the same WSL terminal; the agent makes no live request. No replay fixture, code pin, positive E2E observation snapshot or complete governance acceptance can be produced from the failed attempt. Do not commit, push or open a PR before every BUILD-003C acceptance gate passes.
