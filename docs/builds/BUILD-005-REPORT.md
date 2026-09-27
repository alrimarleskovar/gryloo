# BUILD-005 report — CoW signed-intent local profile

**Status:** BUILD-005 COMPLETE / CERTIFIED: MOCKED under DEC-0035 after the owner merged PR #15 and both post-merge checks passed. **Base:** synchronized main, origin/main and GitHub main at 9c5484db1a78602cb6603744b03fb1b4096266da. **Implementation branch:** codex/build-005-cow-signed-intent. **Authority:** DEC-0034, DEC-0035 and the approved [BUILD-005 plan](BUILD-005-PLAN.md).

The user-facing CoW lifecycle is implemented for the same semantic exact-input swap IR. It is off by default and runs only against the deterministic loopback orderbook with a disposable injected local wallet. Quote, posting, tracking, cancellation and settlement observations are MOCKED; no public CoW provider, public chain, credential, production wallet or financial transaction is used. BUILD-003/004 local-fork evidence is unchanged.

## Delivered scope

The existing exact-input swap IR has an explicit, preauthorization CoW choice. Leaving that choice off preserves the legacy swap bytes, hashes and protected screenshots. The CoW path adds capability discovery, a fixed local quote, exact Manifest-linked order and EIP-712 review, independent signature verification, an fsynced one-attempt posting journal, UID-only recovery after ambiguous posting, lifecycle tracking, separately signed cancellation, scripted settlement reconciliation and a MOCKED Evidence Bundle. It is disabled unless the server is configured for the loopback profile. The v1 schemas, historical compatibility corpus, dependency pins and BUILD-003/004 records remain protected. The implementation uses all 20 approved created paths and 26 of 27 approved modified paths; apps/reference-dapp/e2e/network-isolation.spec.ts required no edit. No path outside the approved set changed.

## Local acceptance and gates, 2026-09-27

| Gate | Result |
| --- | --- |
| Pinned toolchain | Node 24.21.0, pnpm 11.22.0, Anvil 1.8.3 and headless shell revision 1243 used. |
| Typecheck, lint, build, schema drift | Passed; seven workspace builds and 11 schema exports verified. Screenshot summary self-test and linter export/digest self-check passed. |
| Unit and integration | Full default-worker pnpm test timed out in two, then five, journal tests under local WSL disk contention. The unchanged full suite with --maxWorkers=2 passed: 49 files, 367 tests; one file/test skipped. The seven CoW service tests also passed alone with default timing. Assertions and CI command were not changed. |
| Anvil compatibility | 4 passed, 10 owner-only cases skipped, in a loopback-only network namespace. |
| Offline fork suite | 30 passed, 24 skipped across seven files, in a loopback-only namespace. Protected replay transcript identity and structure verified: 286 provider requests and 37 local replies. |
| Five-process synthetic rehearsal | PASS, five of five, rerun after the final executor source change in a loopback-only namespace. |
| Default and legacy browser | 29 passed, four owner-only Mode B cases skipped; all protected visual baselines matched. |
| Mode A browser | 13 passed, including recovery and adversarial cases. |
| CoW browser | 9 passed, including signature, cancellation, restart recovery, ambiguity, expiry, failure, semantic invalidation, keyboard access and narrow viewport. All browser suites used the verified shell and loopback-only namespace. |
| Dependency integrity and licenses | 247 exact registry entries/integrities/release ages and 16 reviewed license exceptions verified; evidence SHA-256 cf3c4a591d084028a53b34c76b70a3f7fee8565ac338a7e511d2e802c799bb75. |
| Dependency audit | Passed: no known vulnerabilities at --audit-level low. |
| Governance | Historical and BUILD-005 exact scope, modes, protected bytes, source and legal checks passed. Persistent controls scanned 339 text files for secrets, 318 Gryloo-authored files for brand/claim rules, 48 Markdown files for links, 29 protected digests, 34 decision IDs and 109 requirement IDs. |
| Ephemeral SBOM | CycloneDX 1.6 validation passed for 247 exact registry components and eight separately checked workspace manifests/importers; 16 reviewed exceptions. Validated SBOM SHA-256 7f19407233c2c831d7c476973ff69757c0c738388301cb740050038fede2e877; the temporary SBOM was removed. |

The default-worker unit timeouts are a local test-runner limitation, not a passing result. The two-worker run covers the same tests without changing source, assertions or timeout thresholds. Remote CI runs the unchanged default command and is reported separately. The owner-only cases were skipped, not passed. The browser and fork results above are scripted or local-fork engineering checks; BUILD-005 financial evidence remains MOCKED.

## Remote CI and merge

Both implementation and final report-head checks completed successfully.

| Head and event | Governance | Contracts, reference app, dependencies and SBOM |
| --- | --- | --- |
| Implementation push, 61c4bad | PASS, run [36343566660](https://github.com/alrimarleskovar/gryloo/actions/runs/36343566660) | PASS, run [36343566715](https://github.com/alrimarleskovar/gryloo/actions/runs/36343566715) |
| Implementation PR, 61c4bad | PASS, run [36343589132](https://github.com/alrimarleskovar/gryloo/actions/runs/36343589132) | PASS, run [36343589142](https://github.com/alrimarleskovar/gryloo/actions/runs/36343589142) |
| Final-head push, 171fc02 | PASS, run [36343976596](https://github.com/alrimarleskovar/gryloo/actions/runs/36343976596) | PASS, run [36343976598](https://github.com/alrimarleskovar/gryloo/actions/runs/36343976598) |
| Final-head PR, 171fc02 | PASS, run [36343981039](https://github.com/alrimarleskovar/gryloo/actions/runs/36343981039) | PASS, run [36343981022](https://github.com/alrimarleskovar/gryloo/actions/runs/36343981022) |

The CI contracts/app jobs passed the default-worker unit command, offline compatibility and fork gates, guarded browser suites, dependency audit and ephemeral SBOM validation. [PR #15](https://github.com/alrimarleskovar/gryloo/pull/15) was CLEAN and MERGEABLE at final head 171fc02857b43318460de6b25a2a013d3edbd24e and the owner merged it into main as 37a0782ece81f83c362b50f68adfc1accb37ccff at 2026-09-27T19:30:00Z. Post-merge main [Governance run 36344564513](https://github.com/alrimarleskovar/gryloo/actions/runs/36344564513) and [contracts/app run 36344564511](https://github.com/alrimarleskovar/gryloo/actions/runs/36344564511) both passed.

## Certification

DEC-0035 marks BUILD-005 COMPLETE / CERTIFIED: MOCKED. The evidence covers the local deterministic CoW signed-intent profile only: scripted quote, posting, lifecycle and settlement with a disposable injected local wallet. No public CoW fill, public-chain receipt, production-wallet safety, real funds or production financial outcome is certified. BUILD-003/004 FORK_REPRODUCED evidence remains separately bounded. BUILD-006 is authorized for planning only; no implementation is approved. The records-only closure passed both local governance programs: exact scope/protected bytes and persistent secret, legal, link and decision checks (35 decision IDs, 109 requirement IDs).
