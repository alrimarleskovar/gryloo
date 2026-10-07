> Release-policy update recorded 2026-10-07T01:58:25.935231+00:00: **MAIN_NOT_READY** because the enforced dependency audit fails. Local MOCKED financial failures and owner-bound local fork acceptance have been reclassified under the owner-approved policy. The original NOT_CERTIFIED report below is preserved as history; see the appended deployed policy, matrices, failure classifications and engineering readiness.

# UX-008 certification / release hardening

**FINAL VERDICT: NOT_CERTIFIED**

Certification recorded 2026-10-07T00:53:29.067166+00:00 (Europe/Lisbon: 2026-10-07 01:53:29 UTC+01:00). Branch `codex/build-product-ux-001`; baseline and final HEAD `a26a45055150eb637cb2164b6f24ff8aa9a55498`. Final state is the uncommitted current working tree; no commit, merge, PR or deployment was performed. Machine-readable evidence: [BUILD-PRODUCT-UX-001-CERTIFICATION.json](BUILD-PRODUCT-UX-001-CERTIFICATION.json). Report state: `FINAL`.

Release approval is withheld because required financial browser coverage has failed or cannot be proven. This verdict does not label stale test assertions as proven financial vulnerabilities. Production build, full typecheck, lint, PostgreSQL, schema and SBOM checks pass. Critical safety assertions remain intact; no mocked provenance was promoted to live authority to obtain a passing test.

## Takeover and evidence preservation

The current tree and persisted `.tmp/ux008/` / `.tmp/ux008/resume/` were reconstructed before expensive execution. The initial matrix is `.tmp/ux008/continuation-3/recovered-gates.json`. Recovered passes included full typecheck/lint, 2,038 repository tests plus 2 skips, PostgreSQL 40/40, schema 11 exports, automatable fork 31/60 with 29 skips, Anvil 4/14 with 10 skips, origin guard 10/10, governance and CycloneDX validation. Historical audit reported two HIGH findings. All 11 financial browser profiles had a recorded port-3108 failure; none was counted as passing. Old UX acceptance was interrupted after 67/87 reported cases: 58 passes, 9 failures, 20 not reached, with no conclusive exit/JSON.

All 108 snapshotted old log/result files retain their takeover SHA-256. Historical failures, interrupted logs, browser output and `.tmp/ux008/resume/browser-runs.jsonl` were preserved. New runs use separate labels and `.tmp/ux008/continuation-3/browser-runs.jsonl`. Eleven initial `focused-*` selector attempts matched zero tests because a regex was anchored to the bare title rather than Playwright's full title. They remain recorded, contribute no passes and were corrected by the `focused-v2-*` runs. No broad failed-suite retries were used.

The owner server remains PID 911807 on port 3000 with its original start time. It supplied no certification evidence and was not stopped or modified. Only positively identified orphan certification processes from the interrupted session and new session-owned local servers were stopped. Their provenance is recorded in `results/orphan-cleanup.json`. Port 3108 is free after certification. Every counted browser attempt proves `next start --hostname 127.0.0.1 --port 3108` in its corresponding server log. Production build ID is `aJ8ZB6KcfmwUC_XJ--8JE`.

Toolchain: Node 24.21.0; pnpm 11.22.0; Next 16.3.6; Playwright 1.63.0; Vitest 5.0.0; React 19.3.0; Python 3.14.4; Linux WSL2 kernel 6.6.87.2; pinned Chromium cache `chromium_headless_shell-1243`; cached Anvil foundry-v1.8.3. Local socket/browser/build actions used approved sandbox escalation where required. No public financial transactions or owner signatures were produced by this certification.

## Fixes and diff review

1. Retained the configurable loopback origin guard, context `baseURL`, exact origin interception and `reuseExistingServer: false`. The ten preserved validation cases cover the default, valid ports and injection/invalid-port rejection. External request/WebSocket rejection and financial assertions remain strict.
2. Retained explicit contextual proposal review: proposal artifact → visible popover → explicit Apply. Helpers only open the popover; acceptance remains a separate user action. Current acceptance tests cover Dismiss, click-outside, Escape, no automatic application, one multi-step proposal and acceptance distinct from execution authorization.
3. Retained `next typegen && tsc --noEmit` and Next-generated `.next/types/routes.d.ts` / root-params imports. These are legitimate production route declarations, not an arbitrary restoration to stale dev-generated types. The package diff changes only typecheck, with no dependency/lockfile change.
4. Fixed a real inspection-canvas navigator/CTA overlap by applying compact navigation below 1024px of canvas width. Existing geometry assertions were retained and gained useful failure diagnostics. Focus/geometry initialization now waits for the existing fork startup state and actual keyboard modality.
5. Restored existing explicit local CoW and mocked Across lifecycle controls under the closed Execute technical disclosure before submission and during recorded progress. Main product authorization/store/submission behavior remains unchanged. A component regression proves rendering this disclosure invokes no start/check callback.
6. Migrated CoW's stale selected-card slippage edit to the existing supported command followed by contextual review and explicit Apply. Added zero-signature assertions before explicit signing. Solana environment and wallet-provider fixtures now open contextual proposal review explicitly. Native-wallet tests preserve their exact-provider and one-send requirements and fail visibly at blocked Review rather than bypassing it.

All takeover changes were retained; none was discarded. No D/E coverage-weakening or unrelated feature changes were found in the reviewed diff. Remaining stale assertions are recorded failures, not silently removed. A Python import briefly regenerated an originally clean tracked bytecode cache; only that newly generated artifact was returned to its original bytes. No takeover work or evidence was reset/restored/deleted.

| File | Classification | Disposition |
| --- | --- | --- |
| `apps/reference-dapp/e2e/across.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/base-observation.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/borrow.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/contextual-proposal.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/cow-fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/cow-intent.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/cow-recovery.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/execute-product-workspace.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/global-product-polish.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/journey-fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/journey.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/jupiter-fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/lending-composition.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/liquidity-fork.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/mode-a-adversarial.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/mode-a-fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/network-isolation.spec.ts` | B — current approved workflow title; egress assertions retained | Added in continuation 3 |
| `apps/reference-dapp/e2e/repay.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/robinhood-transfer.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/router.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/solana-devnet-fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/supply-fixtures.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/uniswap-liquidity.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/e2e/wallet-environment.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/wallet-provider.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/e2e/withdraw.spec.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Added in continuation 3 |
| `apps/reference-dapp/next-env.d.ts` | C — legitimate generated Next production route declarations | Retained takeover change |
| `apps/reference-dapp/package.json` | C — Next typegen before full tsc; no dependency change | Retained takeover change |
| `apps/reference-dapp/playwright.config.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |
| `apps/reference-dapp/src/components/app-shell.tsx` | A — bounded product regression fix | Added in continuation 3 |
| `apps/reference-dapp/src/components/canvas-navigator.tsx` | A — bounded product regression fix | Added in continuation 3 |
| `apps/reference-dapp/src/components/execute-workspace.test.tsx` | C — focused regression evidence | Added in continuation 3 |
| `apps/reference-dapp/src/components/execute-workspace.tsx` | A — bounded product regression fix | Added in continuation 3 |
| `apps/reference-dapp/src/components/simulate-workflow-canvas.tsx` | A — bounded product regression fix | Added in continuation 3 |
| `apps/reference-dapp/e2e/app-origin.ts` | B/C — current explicit proposal/disclosure flow or deterministic certification harness | Retained takeover change |

New durable files are this report and its JSON evidence index. Existing untracked `apps/reference-dapp/.tmp/` contains generated certification screenshots and remains uncommitted; it was neither deleted nor staged wholesale. The JSON records SHA-256 for every changed source/test/config file and the untracked origin guard. No backend, API, schema, state store, provider adapter, executor, journal, reconciliation or persistence implementation changed.

## Gate matrix

PASS refers to the exact scope/evidence in each row. It does not certify an unrun financial browser path. Browser, provider and owner-bound coverage gaps prevent release certification despite passing underlying safety suites.

| Gate | Result | Scope / totals | Evidence |
| --- | --- | --- | --- |
| Full typecheck | PASS | pnpm typecheck; 15 successful Turbo tasks, Next typegen plus full tsc. | `.tmp/ux008/continuation-3/results/closing-typecheck.exit.json` |
| Full lint | PASS | pnpm lint; zero errors, zero warnings. | `.tmp/ux008/continuation-3/results/closing-lint.exit.json` |
| Unit/component | PASS | Effective repository unit/integration: 2039 passed, 0 failed, 2 skipped, 2041 total. Components: 266/266; integration overlaps. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/components.json` |
| Integration | PASS | Dedicated frozen-contract integration: 8/8 included in repository totals; 398 server assertions plus journal/recovery/reconciler/package tests also pass. Financial browser integrations remain a separate failed gate. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/safety-proof-index.json` |
| Browser/E2E | FAIL | 445 configured: 94 latest distinct passes, 12 failures, 9 declared skips, 330 not run. No zero-test or owner-port run counts as a pass. | `.tmp/ux008/continuation-3/browser-runs.jsonl`<br>`.tmp/ux008/browser-inventory.json` |
| UX acceptance | FAIL | 87 distinct cases: 84 pass, 3 fail after focused corrections. Last single full run: 79 pass, 8 fail; later subsets do not constitute a new aggregate pass. | `.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-wallets-fixed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-providers-harness-fixed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-provider-final-diagnostics.json` |
| Financial browser profiles | FAIL | CoW full profile passes 9/9; Across focused lifecycle passes 1/1. General and nine other profiles remain unproven/failed. | `.tmp/ux008/continuation-3/results/browser-cow-final-green.json`<br>`.tmp/ux008/continuation-3/results/browser-across-fixed-focus.json`<br>`.tmp/ux008/continuation-3/results/browser-failure-classification.json` |
| Application-origin guard | PASS | 10 preserved cases: default 3108, valid overrides, invalid input rejection; strict app egress and no reuse of owner server. | `.tmp/ux008/resume/results/app-origin.json` |
| Schemas | PASS | 11 current frozen schema exports verified; schemas/API contracts/DB behavior unchanged. | `.tmp/ux008/logs/schemas.log` |
| PostgreSQL | PASS | 40 passed, 0 failed/skipped; retained because no DB code or persistence behavior changed. | `.tmp/ux008/results/postgres.json` |
| Fork/Anvil | OWNER ACTION REQUIRED | Automatable fork group passes 31, fails 0, skips 29 (60 total). Anvil subset: 4 pass, 10 skip (14 total); do not add subset totals. Owner-bound acceptance remains unproven. | `.tmp/ux008/resume/results/fork.json`<br>`.tmp/ux008/results/anvil.json`<br>`.tmp/ux008/resume/logs/transcripts.log` |
| Solana | FAIL | Implemented swap/liquidity compiler, executor, reconciler and server tests pass. Browser profile has 1 failed stale-card assertion, 12 not run; no real public Devnet execution certified. Bridge intentionally unavailable. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-focused-v2-solana.json` |
| Provider/runtime | FAIL | Core implemented adapter validation, artifact mapping, timeout/malformed response, reconciliation and fail-closed tests pass. Nine financial browser profiles do not prove current end-to-end behavior. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-failure-classification.json` |
| Review/Manifest invalidation | PASS | 25 Review projection tests, 5 callback-binding tests, live browser mutation tests, and current CoW semantic-edit case; token/amount/network/provider/slippage/recipient/route/approval/policy bounds fail closed. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-cow-final-green.json` |
| Stale/expired authorization | PASS | Live expiry, click-boundary expiry, stale commitments, wallet/network mismatch, and CoW exact-order expiry block authorization. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-cow-final-green.json` |
| Fail-closed | PASS | Current automated safety tests pass; MOCKED financial results remain unable to authorize the shared production Review. Invalid payload/provider/runtime observations are not promoted to success. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-provider-final-diagnostics.json` |
| No-auto-execution | PASS | Render/navigation/refresh/restoration and recovery tests preserve explicit action boundaries; hydrated production smoke requests only eth_accounts/eth_chainId. All three blocked native-wallet cases assert zero sends after simulation. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/components.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-provider-final-diagnostics.json`<br>`.tmp/ux008/continuation-3/results/production-smoke-v3.json` |
| Duplicate-execution protection | PASS | UI synchronous-click protection, journal/recovery unit assertions, complete CoW recovery and Across uncertain-deposit reload prove no blind resubmission in tested paths. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-cow-final-green.json`<br>`.tmp/ux008/continuation-3/results/browser-across-fixed-focus.json` |
| Recovery | PASS | 26 recovery presentation tests and 6 observation-callback tests plus executor recovery; completed steps/uncertain state/context mismatch retain observation-only behavior. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-cow-final-green.json`<br>`.tmp/ux008/continuation-3/results/browser-across-fixed-focus.json` |
| Reconciliation | PASS | 41 lifecycle tests plus reconciler suites and UI state transitions keep confirmed/failed/partial/unresolved/declined/in-progress meanings distinct. Bridge source confirmation does not imply destination settlement. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json` |
| Evidence | PASS | Recorded-only evidence tests preserve order UID versus tx hash, bridge source versus destination, partial outcomes and unavailable fees. Synthetic local evidence remains explicitly MOCKED. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-cow-final-green.json` |
| Wallet-owner privacy | PASS | Run ownership 5/5, Dashboard query boundary 10/10, Run Details boundary 5/5, plus Dashboard owner-switch/disconnect/guessed-ID browser assertions. Missing owner session never exposes saved history. | `.tmp/ux008/results/unit-integration-unsandboxed.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/production-smoke-v3.json` |
| Light | PASS | Representative Dashboard/Build/Simulate/Review/Execute/Run Details/secondary surfaces, settings, drawer and popovers pass the Light acceptance assertions. | `.tmp/ux008/continuation-3/results/browser-ui-final.json` |
| Dark | PASS | Approved graphite palette and representative product surfaces, long values, icons and overlays pass Dark acceptance assertions. | `.tmp/ux008/continuation-3/results/browser-ui-final.json` |
| Responsive | PASS | Acceptance checks include 320, 375, 768, 1024, 1440 widths; inspection navigator collision fixed with compact breakpoint while existing geometry assertions remain intact. | `.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final-focus.json` |
| Accessibility | PASS | Existing keyboard/focus/drawer/settings/slider/popover/proposal/Escape/decorative-logo and mascot baseline passes relevant acceptance tests; no external audit claim. | `.tmp/ux008/continuation-3/results/browser-ui-final.json`<br>`.tmp/ux008/continuation-3/results/components.json` |
| Production build | PASS | pnpm build; 8 successful Turbo tasks, 8 static page generation entries, Run Details dynamic route; current product sources match build aJ8ZB6KcfmwUC_XJ--8JE. | `.tmp/ux008/continuation-3/results/final-production-build.exit.json`<br>`.tmp/ux008/continuation-3/logs/final-production-build.log` |
| Production smoke | PASS | Six HTTP routes plus seven explicit assets; hydrated Dashboard/Build/Simulate/Execute/Credentials/Agents/Passkeys/guessed Run Details; fonts resolve, no page errors/external requests, optimizer 404, no sends/signatures. | `.tmp/ux008/continuation-3/results/production-smoke-v3.json` |
| Dependency/security audit | FAIL | Raw audit: 2 HIGH, 0 CRITICAL/MEDIUM/LOW. Contextual assessment finds no exposed advisory trigger in current application: trusted build sourcemaps and disabled sharp optimizer; contextual non-blocking limitation, no blanket clean-audit claim. | `.tmp/ux008/results/audit-network.json`<br>`.tmp/ux008/continuation-3/results/security-context-final.json` |
| SBOM | PASS | CycloneDX 1.6: 262 exact registry components, zero workspace components in inventory; 9 exact workspace manifests/importers separately checked, 16 reviewed license exceptions. Dependency graph unchanged. | `.tmp/ux008/logs/sbom-validate.log`<br>`.tmp/ux008/results/sbom-summary.txt` |
| Governance | PASS | Current governance-lite plus 17 retained governance self-tests; dependency controls, licenses/notices and required checks unchanged. | `.tmp/ux008/continuation-3/results/report-governance.exit.json`<br>`.tmp/ux008/logs/governance-tests.log` |
| Secret scan | PASS | Release-content text scan: tracked plus non-ignored untracked files, including final report. Zero credential findings; one unchanged synthetic unit-test bearer string reviewed. Initial flag is preserved; ignored ephemeral runtime artifacts are excluded from release content. | `.tmp/ux008/continuation-3/results/final-secret-scan-reviewed.json`<br>`.tmp/ux008/continuation-3/results/final-secret-scan.json` |
| Temporary debug code | PASS | Changed production source contains no new console.log/info/debug, temporary probes or debug-only attributes; intended existing observability retained. | `.tmp/ux008/continuation-3/results/final-source-scan.json` |
| Product language | PASS | No new primary user-facing engineering language added; accurate local/demo provenance remains in existing technical disclosures. Relevant primary-language assertions pass. | `.tmp/ux008/continuation-3/results/final-source-scan.json`<br>`.tmp/ux008/continuation-3/results/browser-ui-final.json` |
| Placeholder workspaces | PASS | Five secondary-workspace component tests and production route smoke: truthful empty/disabled Credentials, Agents and Passkeys affordances; no invented records or backend functionality. | `.tmp/ux008/continuation-3/results/components.json`<br>`.tmp/ux008/continuation-3/results/production-smoke-v3.json` |

## Exact test accounting

The repository-supported combined test run originally passed 2,038, failed 0, skipped 2, total 2,040 across 208 actual files. Its unchanged non-component results are reused; the full current component run passes 266/266 across 20 actual files, replacing the original 265 component tests. Effective current repository total is **2,039 passed, 0 failed, 2 skipped, 2,041 total**. The dedicated contract integration suite passes **8/8** and the server suites pass **398 with 2 skipped**; these are included in repository totals, not additional tests. PostgreSQL's 40 and fork's 31 are separate suites. Anvil is a subset of fork and must not be added again. Vitest's nested `numTotalTestSuites` field is not a file count.

The authoritative browser inventory contains **445** configured cases. Latest distinct outcomes are **94 passed, 12 failed, 9 declared skipped, 330 not run**. These numbers are merged by file/title from separate actual runs, never by adding repeat attempts. No final full browser aggregate passed. Earlier failures on a different certified production build remain failed where the subsequent bounded product fixes do not affect the failed Build assertion or old sequencing. All passing current browser evidence uses final production build `aJ8ZB6KcfmwUC_XJ--8JE`.

| Authoritative profile | Final result | Configured | Passed | Failed | Declared skipped | Not run |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| general | FAIL | 322 | 85 | 3 | 9 | 225 |
| supply | FAIL | 44 | 0 | 1 | 0 | 43 |
| lending | FAIL | 17 | 0 | 1 | 0 | 16 |
| jupiter | FAIL | 9 | 0 | 1 | 0 | 8 |
| solana | FAIL | 13 | 0 | 1 | 0 | 12 |
| robinhood | FAIL | 7 | 0 | 1 | 0 | 6 |
| uniswap | FAIL | 4 | 0 | 1 | 0 | 3 |
| router | FAIL | 4 | 0 | 1 | 0 | 3 |
| journey | FAIL | 3 | 0 | 1 | 0 | 2 |
| mode-a | FAIL | 13 | 0 | 1 | 0 | 12 |
| cow | PASS | 9 | 9 | 0 | 0 | 0 |

General is the actual eleventh inventory group and includes Across plus the UI suites. Its Across lifecycle passes 1/1; this does not turn all 322 General cases green. The other nine profile failures are classified individually in `results/browser-failure-classification.json`: Supply uses removed legacy Review controls; Lending expects obsolete directly selected editor forms; Jupiter/Solana expect former combined card labels; Robinhood expects former transfer copy; Uniswap expects former position copy; Router/Journey expect former combined route labels; Mode A expects old Review/Execute sequencing. Each focused rerun executed one real test and failed. Remaining tests were not broadened while those entry failures persisted. These fixture/assertion migrations remain unresolved and cannot certify execution, recovery or reconciliation through the current approved browser flow.

UX acceptance now has a conclusive full-run exit: **79 passed, 8 failed, 0 skipped, 87 total**. Focused corrections subsequently pass both Solana wallet-environment cases and three non-execution provider cases; current distinct outcomes are **84 passed, 3 failed**. A passing aggregate is not claimed. The three remaining cases are legacy MetaMask, EIP-6963 MetaMask and Rabby execution journeys. Their final focused run asserts zero `eth_sendTransaction` requests after simulation, then fails because production Review refuses MOCKED financial provenance. `projectSimulation` intentionally excludes MOCKED financial results; `projectReview` therefore reports that an authorizing simulation is required. Classification: **E — the existing loopback fixture cannot supply the supported production authorization dependency**, with earlier **B/C** stale sequencing/harness issues also preserved. Changing provenance labels, bypassing Review or exposing a hidden test shortcut would weaken the approved safety boundary and was not done. This is a test-coverage blocker, not evidence that mocked values successfully authorized funds.

## CoW root cause and current result

The historical page/context-closed error occurred when Playwright timed out waiting for a signing control and tore down the page. The production server remained alive; there is no evidence of a server crash or unsolicited navigation. Contextual proposal acceptance alone did not resolve it. The approved shell suppressed the existing local CoW execution panel for a Mainnet-context wallet and then suppressed its controls while live progress was present. Classification **A: product presentation regression**. The smallest fix retains these existing explicit local controls inside the collapsed disclosure; it does not add a runtime or automatic signing. A subsequent invalidation test had an obsolete `.flow-card` selection: classification **B**, corrected through the supported explicit proposal flow. Final full profile: **PASS — 9/9**, zero failures/skips. Exact order/UID, signature rejection, wrong wallet/network, expiry, uncertainty/restart, no duplicate posting and semantic invalidation are covered by that run. These are disposable signed orders in a local MOCKED orderbook, not public CoW settlements.

## Security, dependencies and SBOM

Raw dependency audit remains **FAIL: two HIGH findings**, with zero critical/moderate/low findings. No dependency upgrades or lockfile changes were made.

- `source-map-js@1.2.1`: [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) concerns denial of service from attacker-controlled indexed sourcemaps. The current application has no sourcemap ingestion/upload endpoint; PostCSS/build inputs are trusted repository sources. Contextual assessment: non-blocking for this scope. The persisted registry-age evidence says patched 1.2.2 reaches the repository's 168-hour minimum age at 2026-10-07 14:08:09.382 UTC, after certification.
- `sharp@0.35.4`: [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) concerns vulnerable SVG decoding under the advisory's affected runtime conditions. The app globally disables image optimization and has no image upload/processing endpoint; production smoke confirms `/_next/image` returns 404. Static brand assets are repository-owned. Contextual assessment: non-blocking while those processing paths remain unexposed. This assessment is not a claim that the installed package is patched or safe for arbitrary SVG decoding.

CycloneDX 1.6 validation is retained: **262 exact registry components; zero workspace components mixed into that registry inventory; nine exact workspace manifests/importers checked separately; 16 reviewed license exceptions**. Normalized SHA-256: `ab0c58f2729180e6bd688ac5c516d42cdd95585b26ea8a59c57e25ca8a022375`. The dependency graph is unchanged, so the SBOM was not regenerated or redundantly revalidated. Governance keeps the license/notice and required metadata controls intact. Secret scanning reports file/category metadata only, never secret values; public addresses are not treated as secrets.

## Owner action and scope limitations

**OWNER ACTION REQUIRED — pinned-owner closed-fork acceptance:** 21 skipped cases require the existing owner-controlled `GRYLOO_FORK_ACCOUNT_PHRASE_FILE`, including the ten Anvil C1–C10 pinned-account checks. Owner action is to configure the private file path locally for the existing approved harness; do not put credential content into this report, logs or chat. Ordinary local Anvil and closed-transcript readiness preconditions pass.

**OWNER ACTION REQUIRED — owner-bound replay profiles:** eight fork cases require approved Mode B/composition/liquidity profiles, executor key-file path and replay artifacts (`GRYLOO_MODE_B_SMOKE_PROFILE`, `GRYLOO_MODE_B_EXECUTOR_KEY_FILE`, `GRYLOO_COMPOSITION_SMOKE_PROFILE`, `GRYLOO_LIQUIDITY_OWNER_REPLAY=1`, `GRYLOO_LIQUIDITY_REPLAY_RUNTIME` as applicable). Two repository server tests also remain skipped without their matching owner-bound runtime. Existing transcript integrity passes (Base 286 provider/37 local; liquidity 207/22; composition 122/30) and three synthetic offline rehearsal checks pass. This does not complete the missing owner-bound identity/execution gate.

Credentials backend, real Agents connections and Passkeys/WebAuthn remain intentionally unimplemented with truthful disabled UI. Real Solana Bridge, Stocks runtime, Privacy/Cloak and Mode C are outside current scope and are not claimed as working. Public wallet/provider execution beyond implemented automated paths may need an owner signature or restricted runtime, but no such completion is fabricated. No new provider, backend or roadmap feature was added.

## Release blockers and final state

1. Nine required financial browser profiles lack a passing approved-flow run; current entry failures remain unresolved.
2. UX acceptance retains three native-wallet execution coverage failures; MOCKED financial provenance cannot certify production authorization.
3. General/full browser aggregate is incomplete: 330 unrun cases plus nine declared skips. Passing subsets cannot prove the missing paths.
4. Owner-bound fork acceptance has 29 skipped cases, including ten overlapping Anvil checks, and two owner-bound repository cases remain skipped.

No conclusive evidence of stale authorization acceptance, automatic fund execution, blind duplicate replay, fabricated live evidence, cross-owner leakage or destructive persistence was found in the passing tested scopes. Missing end-to-end coverage remains a release blocker because those guarantees cannot be generalized to unrun profiles. The two raw HIGH advisories remain documented contextual limitations; no exploitable application path was identified in the inspected/smoked current configuration.

Final full typecheck and lint pass. `git diff --check` passes. The owner server on 3000 remains untouched, and the certification server on 3108 has stopped. Git retains all validated uncommitted changes and generated screenshot artifacts for owner review. Final status/stat/diff and source hashes are preserved under `.tmp/ux008/continuation-3/final-review.*`; no files were staged or committed. Work stops at this certification verdict.

**NOT_CERTIFIED**

## DEPLOYED ACCEPTANCE POLICY — owner-approved release preparation

This section supersedes the historical local financial acceptance blockers and owner-action requirements above. Engineering gate failures remain separate blockers. The original UX-008 **NOT_CERTIFIED** verdict, failed browser attempts, counts, source hashes and engineering evidence remain preserved. Its principal blockers were local financial browser coverage and owner-bound local fork acceptance. They are not a deployed financial acceptance result.

From this release onward, **https://flofi.xyz is the only authoritative environment for product functional acceptance**. Localhost, Anvil, local forks, fixture providers and local wallet journeys provide engineering regression evidence only. They cannot certify real provider truth, signatures, network execution, reconciliation or Evidence. Local owner-bound fork acceptance is no longer required before merging to GitHub main; its skipped cases remain historical engineering coverage gaps. The required owner progression is deployed Testnet/Devnet acceptance, then owner-controlled Mainnet acceptance with small amounts. Neither phase was performed by Codex.

Failures are classified as A (product defect), B (stale UI sequence), C (harness/fixture limitation), D (MOCKED provenance correctly rejected), E (missing live infrastructure), or F (explicitly unsupported scope). A and B must be resolved before MAIN_READY. C/D/E and explicitly excluded F can be non-blocking only with supporting evidence. An unrun test remains unrun; reclassification is not a passing financial journey.

MOCKED provenance remains non-authorizing in shared production Review. No provenance relabeling, Review/Manifest override, automatic execution, fixture selector, hidden E2E shortcut or new lab UI was added. The retained canvas navigator fix prevents CTA overlap. The retained local CoW disclosure fix applies only when the existing, explicitly enabled loopback runtime reports enabled; this runtime must remain unset on deployments. The previous widening of Across demo controls in Execute was removed under the new product policy; that legacy demo is not a supported live bridge. Supported bridges use the Router.

The focused review discovered an additional genuine defect: Wallet Standard identifies Solana clusters as `solana:mainnet`/`solana:devnet`, while Manifests use exact genesis-based chain IDs. The shared Review wallet binding now maps only those two supported aliases to their exact chain IDs. Unknown clusters remain null, Mainnet and Devnet remain distinct, and the raw reported network still participates in latched invalidation. Tests cover the mapping, unknown-network rejection and a network change followed by switching back. MOCKED simulation rejection is unchanged.

### Deployed revision record

Before either owner phase, record the following together with every result. A new deployment or backend revision requires a new record; results from different revisions must not be combined.

| Identity field | Record before testing |
| --- | --- |
| Origin | `https://flofi.xyz` |
| Git revision | Full deployed Git SHA; confirm it is the intended `main` revision |
| Release branch checkpoint | Full `codex/build-product-ux-001` commit SHA from the merged PR |
| Main merge identity | PR number, full merge SHA and UTC merge timestamp |
| Frontend deployment | Deployment ID/immutable URL, UTC deployment timestamp and deployed Git SHA from hosting metadata |
| Backend deployment | API and worker deployed revisions/status; enabled live flows must match this release |
| Acceptance record | Owner test timestamp, action/network, observed run ID, transaction hash or Solana signature, Evidence ID/digest, result and any recovery observation; no keys or secrets |

GitHub merge does not establish deployment success. Retrieve the deployment identity from existing hosting metadata and compare its SHA with main before testing. If identity or live enablement cannot be established, leave that action pending. No new identity/debug product controls are needed.

### Phase 1 — flofi.xyz Testnet/Devnet owner checklist

Repository support is listed below; deployed enablement and provider availability must be verified on the matching release. An unavailable/disabled route is pending infrastructure, not a working acceptance claim. Amounts are suggestions for valueless test tokens, not invented protocol minimums. Reserve native gas/rent separately. Aave's test USDC is distinct from the Uniswap/Router test USDC; use each action's actual asset address.

| Network / wallet | Supported action | Practical amount | Expected lifecycle and Evidence | Expected Dashboard / Run Details |
| --- | --- | --- | --- | --- |
| Base Sepolia (84532), EVM wallet | Uniswap v3 Swap USDC ↔ WETH | Use the smallest valid amount accepted by the live provider; the existing deployment guide uses 2 test USDC | Fresh quote → Simulate → Review/limits → explicit wallet approval if needed → reviewed swap → independent receipt/balance reconciliation; actual tx hash, fees and TESTNET evidence | Actual operation states, recorded amounts and fees, reconciled run and real Evidence download |
| Base Sepolia (84532), EVM wallet | Aave Supply | Use the smallest valid amount accepted by the live provider | Pool state/read-only simulation → Review + Manifest → exact approval if required → Supply signature/tx → observed aToken increase; actual receipts and Evidence | Supply and approval displayed separately; completed supply only after reconciliation |
| Base Sepolia (84532), same collateral owner | Aave Borrow | Smallest valid provider amount comfortably inside available borrowing capacity; preserve product HF ≥ 2 | Safe collateral in place → fresh risk simulation → Review + Manifest → explicit Borrow signature → independently observed debt/balance effects | Debt operation reconciled with recorded effects; blocked risk check never becomes success |
| Base Sepolia (84532), same debt owner | Aave Repay | Smallest valid amount accepted by the live provider, within existing debt; retain gas | Fresh debt read → Simulate → Review + Manifest → exact approval if required → Repay signature → observed debt reduction | Separate approval/repay outcomes and verified debt reduction; no fabricated cleared-debt result |
| Base Sepolia (84532), same collateral owner | Aave Withdraw | Smallest valid amount accepted by the live provider; repay debt first or preserve HF ≥ 2 | Fresh position/risk simulation → Review + Manifest → Withdraw signature → observed aToken/balance effects | Verified withdrawal with actual transaction and Evidence; unsafe withdrawal remains blocked |
| Base Sepolia (84532), EVM wallet | Supply → Borrow → Swap composition | Smallest valid provider amounts; borrow well below collateral capacity and preserve HF ≥ 2 | Review + Manifest for exact plan → separate explicit signatures → reconciliation at each checkpoint; linked Borrow output feeds Swap | Ordered operations with partial/uncertain outcomes retained and completed steps never replayed |
| Base Sepolia (84532), EVM wallet | Uniswap v3 Pool / Liquidity: open USDC/WETH position | Smallest valid live-provider token pair/range; retain test ETH | Verified pool/range and exact token amounts → Simulate → Review → exact approvals → owner-recipient mint → position/receipt/balance reconciliation | Actual mint/approval operations and owned position identity with real Evidence |
| Robinhood Chain Testnet (46630), EVM wallet | Native test-ETH self-transfer | Existing product example: 0.000001 test ETH; use the smallest valid amount accepted by the live provider | Exact owner/recipient/value → Simulate → Review + Manifest → one explicit signature/tx → independent nonce/balance/receipt reconciliation | One transfer with real hash/fees and evidence; no DeFi capability implied |
| Base Sepolia → Arbitrum Sepolia (84532 → 421614), EVM wallet | Router bridge test USDC, permissionless signed-in wallet | Use the smallest valid amount accepted by the live provider; existing guide uses 1 test USDC | Wallet connection + sign-in → live route/quote → source Simulate → Review + Manifest → approval/deposit signatures → source receipt → independently observed destination fill → reconciliation/Evidence | Source confirmation stays in progress until destination reconciliation; both chains' evidence and destination amount appear |
| Solana Devnet, Wallet Standard wallet supporting `solana:devnet` | Orca Swap SOL ↔ devUSDC | Use the smallest valid amount accepted by the live provider; retain Devnet SOL for fees/rent | Verified Devnet pool/mints → quote/Simulate → Review + Manifest → explicit wallet signature → actual Devnet submission → independent token/receipt reconciliation | Owner-matching current run/signature and Devnet Evidence; durable cross-session Solana history unsupported |
| Solana Devnet, same position owner | Orca Pool / Liquidity: open, partial removal, exit/collect/close | Smallest valid live-provider position; remove a small valid portion before exit; retain fees/rent | Separate fresh Simulate/Review + Manifest and signature for each operation → observed position/token/fee/rent effects | Current run records actual position effects/receipts/Evidence; durable cross-session Solana history unsupported |

Solana Dashboard scope is limited to the matching owner’s current execution/current Run Details projection; durable cloud history and cross-session historical queries currently require EVM wallet authentication. Do not claim that Solana history backend as implemented. For Solana, verify actual signature/Evidence in Execute and the current run, reload recovery where provided, and record any unavailable historical view as explicitly unsupported (F), not a passing history test.

For each enabled row, the owner opens flofi.xyz, connects the real wallet on the stated network, uses Build → Simulate → Review/Manifest, explicitly approves/signs and executes, verifies real Evidence and Dashboard/Run Details, then reloads and checks recovery. Approval transactions require their own explicit wallet confirmation. Refresh stale quotes and Review as required. Recovery observes existing transactions; it must not repeat completed or uncertain financial submissions. Check decline, wrong-network blocking and owner/disconnect privacy without submitting another transaction. Mark PASS only after real network/provider observations agree with Evidence. Keep pending/unavailable results explicit.

### Phase 2 — flofi.xyz Mainnet owner checklist

**PENDING AFTER TESTNET PASS.** Do not start until Phase 1 passes on the same intended release. Mainnet execution must already be explicitly enabled by the owner's deployment configuration. Codex does not enable spending, connect a wallet, sign or submit any transaction.

| Network / wallet | Supported Mainnet action | Practical amount | Expected lifecycle and Evidence | Expected Dashboard / Run Details |
| --- | --- | --- | --- | --- |
| Solana mainnet-beta, Wallet Standard `solana:mainnet` wallet | Jupiter exact-input Swap between supported SOL/USDC/USDT | Use the smallest valid amount accepted by the live provider and acceptable to the owner after reviewing fees; retain SOL for fees/rent | Live Jupiter quote/verified message → real Simulate → Review + Manifest + existing real-funds acknowledgment → explicit owner signature → actual network tx → independent reconciliation/Evidence | Owner-matching current run/signature and Mainnet Evidence; durable cross-session Solana history unsupported; pending/declined states remain truthful |
| Base → Arbitrum One (8453 → 42161), EVM wallet | Router USDC bridge through supported LI.FI/Across route | Use the smallest valid amount accepted by the live provider and acceptable to the owner after reviewing bridge/gas fees; retain source gas | Live route/source simulation → Review + Manifest → exact approval/deposit signatures → source receipt → actual destination fill → two-chain reconciliation/Evidence | Source confirmation never implies arrival; destination effects, hashes and real Evidence complete the run; reload remains observation-only |

The current registry has no public Mainnet Aave lending, Uniswap pool execution or public CoW signed-intent execution. No Mainnet lending/borrowing acceptance row is claimed. CoW's 9/9 local engineering result does not establish public orderbook support. Direct Across demo, real Solana Bridge, Stocks execution, Credentials/Agents/Passkeys backends, Privacy/Cloak and Mode C are excluded. Jupiter has no Devnet routing; its separate Orca Devnet path tests the supported Solana wallet lifecycle before any later Mainnet owner test.

**DEPLOYED TESTNET/DEVNET ACCEPTANCE: PENDING OWNER TEST**

**DEPLOYED MAINNET ACCEPTANCE: PENDING AFTER TESTNET PASS**

No FULL LIVE CERTIFIED claim is made.

### Remaining local failure classification

Every recorded first failure was inspected. Stale UI sequences were repaired through current normal controls, without an authorization shortcut. The focused probes below remain failed at their positive authorization assertion; they are **not** relabeled as passing financial execution. Their exact error is: “A simulation that can authorize this workflow is required before approval.” The simulation provenance is MOCKED and shared production Review correctly refuses it.

| Profile | First failure / correction | Current classification and scope | Evidence |
| --- | --- | --- | --- |
| general / direct Across demo | Historical legacy demo Execute disclosure hidden; prior focused recovery passed | F/C — explicitly excluded local demo; historical pass preserved, no current full browser pass claimed | `.tmp/ux008/continuation-3/results/browser-across-fixed-focus.json` |
| general / wallet-provider UX | Legacy MetaMask / EIP-6963 MetaMask / Rabby stop at shared Review after zero-send assertion | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-ui-provider-final-diagnostics.json` |
| journey | Migrated the combined bridge-card label into exact source/destination asset titles, opened explicit proposal/technical disclosures, and used shared Review instead of the retired panel acceptance sequence. Existing Manifest/owner/route/zero-send assertions remain. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-asset-assertions-journey.json` |
| jupiter | Migrated the combined card label into exact USDC/SOL network titles and current proposal/disclosure/Review controls. Fixed the genuine Solana wallet-alias versus Manifest-chain mismatch. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-asset-assertions-jupiter.json` |
| lending | Opened Advanced Settings explicitly, used current Supply/Borrow/Swap labels and card/form Review controls, applied Canvas proposals through their actual explicit Apply path, and used shared Review. Typed linked Borrow input, topology and generated-plan assertions remain. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-final-lending-v3.json` |
| mode-a | Opened contextual proposal review and replaced the retired local Review/accept/connect sequence with strict shared product Review. No signature or execution assertion was deleted to manufacture a pass. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-focus-mode-a.json` |
| robinhood | Migrated the card to Transfer, exact Robinhood Testnet and amount assertions, explicit proposal/disclosure and shared Review. Existing broadcast/refusal/recovery assertions remain. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-focus-robinhood.json` |
| router | Migrated card labels into exact USDC source/destination network titles, explicit proposal/disclosure and shared Review. Exact route/spender/recipient/zero-send assertions remain. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-asset-assertions-router.json` |
| solana | Migrated card to Orca provider plus exact SOL/devUSDC network titles and current disclosure/Review controls. Fixed the genuine Solana wallet-alias versus Manifest-chain mismatch. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-asset-assertions-solana.json` |
| supply | The profile first fails in Borrow, not Supply itself. Migrated the disclosure and retired Borrow/Supply/Repay/Withdraw Review helpers to strict shared Review. Invalid Borrow/debt simulations separately verify locked Review and zero sends. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-focus-supply.json` |
| uniswap | Migrated the card to Pool / Liquidity, Uniswap and both token symbols, opened explicit proposal/disclosure and used strict shared Review. Range/tick/approval/mint/receipt assertions remain. | D/C — LOCAL HARNESS LIMITATION; MOCKED rejected; non-blocking for product acceptance | `.tmp/ux008/continuation-3/results/browser-release-focus-uniswap.json` |

CoW rerun on the current production build: **9/9 PASS**; historical A (suppressed explicitly enabled local execution disclosure) and B (stale semantic-edit selector) are resolved. Across's historical focused uncertain-deposit/recovery **1/1 PASS** remains preserved; after removal of the broad demo disclosure widening, it is not claimed as a current public bridge journey. Supported Router recovery implementation is unchanged. Two focused negative lending cases now **2/2 PASS**, retaining specific unsafe-collateral/debt rejection, locked Review, absence of approval controls and zero sends. Wallet/network UX cases that do not require financial authorization retain their historical pass evidence, with fresh affected component/wallet binding tests.

Additional classifications: E — live external provider/deployment infrastructure and real network execution are not available inside these isolated local profiles; owner acceptance remains pending. F — the roadmap/backend capabilities excluded in the matrices are not silently treated as implemented. Unrun downstream financial cases remain unrun, not automatic passes. No known unresolved A product defect remains from the inspected failures; this does not certify untested deployed behavior.

### Engineering release gates / readiness

Final production build ID: `4zpT02Fh-_mtyL-swdkUU`. This build contains the final production source and configuration, including the Solana chain-binding fix. Subsequent edits affect only E2E tests and these reports, so the forced 8/8 build is reused without another invalidating production change. A sandbox-only build subprocess failure and an initial smoke-runner/browser-cache configuration failure are preserved separately; the complete unsandboxed build and configured smoke pass. An initial CoW runner rejected missing telemetry/download environment controls before running tests; it contributes no passes. The configured current suite passes 9/9.

| Gate | Current result | Scope / evidence |
| --- | --- | --- |
| Full typecheck | PASS | Full repository typecheck with Next typegen; 15 successful tasks. `.tmp/ux008/continuation-3/results/release-final-state-typecheck.exit.json` |
| Full lint | PASS | Full repository lint; zero errors and warnings. `.tmp/ux008/continuation-3/results/release-final-state-lint.exit.json` |
| Production build | PASS | Forced full production build: 8/8 successful tasks, Next pages/routes generated. No production or build configuration changed afterward; later changes are E2E tests and reports only. `.tmp/ux008/continuation-3/results/release-final-build.exit.json` |
| Affected unit/integration and critical safety | PASS | 465/465 passed, 30 files, zero failures/skips: all affected components plus simulation, Review, authorization binding, execution/recovery, reconciliation/Evidence, owner privacy and wallet environment. `.tmp/ux008/continuation-3/results/release-final-affected-tests.exit.json` |
| Governance | PASS | Governance on final release content; dependency-age, licenses, notices and CI checks retained. Historical 17 self-tests reused: governance implementation unchanged. `.tmp/ux008/continuation-3/results/release-final-content-governance.exit.json` |
| Production smoke | PASS | 6 HTTP routes, 7 brand assets, hydrated navigation/fonts/privacy, no external requests/page errors/signatures/sends; optimizer remains disabled (404). Engineering delivery verification only. `.tmp/ux008/continuation-3/results/release-production-smoke-configured.json` |
| CoW local engineering regression | PASS |  `.tmp/ux008/continuation-3/results/browser-release-current-cow-configured.json` |
| Invalid lending simulations fail closed | PASS | Unsafe Borrow and insufficient Repay debt preserve their specific rejection reasons; Review is locked with no approval control and zero wallet sends. `.tmp/ux008/continuation-3/results/browser-release-current-lending-failclosed-locked.json` |
| Dependency audit (enforced CI gate) | FAIL |  `.tmp/ux008/continuation-3/logs/release-audit-network.log` |
| Secret scan | PASS | Zero credential findings; unchanged synthetic bearer test string reviewed. Final-content scan is repeated after writing this report. `.tmp/ux008/continuation-3/results/release-content-secret-preliminary.json` |
| git diff --check | PASS | Passed before report update and required again on final release content; no staged candidate because MAIN_NOT_READY.  |
| Schemas / PostgreSQL / SBOM / unaffected tests | PASS (REUSED) | Historical schema 11 exports, PostgreSQL 40/40, frozen-contract integration 8/8, effective 2039 unit/integration passes plus 2 skips, and exact 262-component SBOM retained for unchanged scopes. Fresh 465 tests overlap those totals and are not added as independent passes. No schemas, API/DB/server adapters, compiler/executor/reconciler, dependency lock or registry versions changed.  |

Raw audit still reports two HIGH advisories, zero CRITICAL/MODERATE/LOW. The inspected configuration exposes no attacker-controlled indexed-sourcemap ingestion or SVG processing endpoint; current production smoke confirms `/_next/image` is disabled. This contextual assessment does **not** turn the enforced CI audit into PASS. CI still runs `pnpm audit --audit-level low` and the command returns 1. The upstream fixes are source-map-js 1.2.2 and sharp 0.35.5; public registry metadata confirms that sharp's fix is age-eligible, while source-map-js 1.2.2 reaches the unchanged 168-hour requirement only at **2026-10-07 14:08:09.382 UTC** (15:08 Lisbon). Replacing dependencies prematurely, reducing the minimum age, ignoring advisories or allowing a failed audit was not done. See `.tmp/ux008/release-prep/patched-dependency-age.json` and the existing primary advisory links in the historical security section.

The existing CI also still invokes local positive financial browser journeys that stop at MOCKED rejection. Those classified C/D results are non-blocking product limitations under the owner-approved policy, but a green remote aggregate CI result is not claimed. No failing check was ignored, disabled or bypassed. Main has no configured branch protection/rules in the read-only GitHub inspection; the owner's requirement for green release engineering checks still applies.

**ENGINEERING RELEASE READINESS: MAIN_NOT_READY**

Exact remaining blocker: The repository CI enforces pnpm audit --audit-level low, which currently exits 1 with source-map-js@1.2.1 and sharp@0.35.4 HIGH advisories. No exposed exploit path was identified in the inspected current configuration, but the enforced audit check is not green. source-map-js@1.2.2 cannot yet satisfy the existing 168-hour dependency release-age check (eligible 2026-10-07T14:08:09.382Z). Do not weaken/ignore either gate to merge.

The new local-financial reclassification, the previous local owner-fork requirement and pending flofi.xyz owner acceptance are **not** release blockers. The clean dependency-audit CI gate is a separate engineering failure. Release preparation stops here under the owner's conditional commit/merge rule: no staging, commit, push, PR, merge or deployment was performed. Branch and HEAD remain `codex/build-product-ux-001` / `a26a45055150eb637cb2164b6f24ff8aa9a55498`. GitHub authentication and remote are available; no remote checks were started and no main merge SHA/PR/deployment identity exists for this task.

Release candidate review retains legitimate product/test/config fixes and both reports. `apps/reference-dapp/.tmp/`, ignored `.tmp/ux008/`, browser caches/logs/private runtime files and generated screenshots remain transient and unstaged. The current source hashes, file roles, reuse scope, exact failures and gate artifacts are recorded under `releasePolicy` in the JSON. Historical fields/results in that JSON are unchanged. No provenance, Manifest, provider backend, schemas, database, execution or recovery safety implementation was weakened.

Final report-content verification: governance PASS, secret scan PASS (1,063 text files; zero credential findings), and `git diff --check` PASS. Exact checks are indexed under `releasePolicy.finalContentVerification`; a closing scan checks this final metadata update. No release files were staged.


## Final dependency remediation — age gate blocked

Recorded 2026-10-07T02:13:37.527326+00:00. **ENGINEERING RELEASE READINESS: MAIN_NOT_READY**. Branch and HEAD remain `codex/build-product-ux-001` / `a26a45055150eb637cb2164b6f24ff8aa9a55498`. All previous UX-008 work, NOT_CERTIFIED history, failure classifications, deployed acceptance policy and owner matrices are preserved.

The two original enforced-audit findings remain unresolved: [source-map-js GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) and [sharp GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), both HIGH; zero CRITICAL in the previous conclusive audit. No exposed trigger found in the earlier inspection does not waive this audit gate.

| Package | Current → intended patch | Dependency path | Seven-day gate |
| --- | --- | --- | --- |
| source-map-js | 1.2.1 → 1.2.2; current version unchanged | Transitive PostCSS dependency in Next 16.3.6 and Vite/Vitest build tooling | FAIL: `ERR_PNPM_NO_MATURE_MATCHING_VERSION` |
| sharp | 0.35.4 → 0.35.5; current version unchanged | Next 16.3.6 optional image/build/runtime dependency | PASS in isolated exact-version resolution |

Public registry metadata was re-fetched and the approved pnpm **11.22.0**, Node **24.21.0** ran `pnpm install --lockfile-only --ignore-scripts` in separate ephemeral projects. The unchanged applicable workspace policy (`minimumReleaseAge: 10080`, `pmOnFail: error`, strict peers and disabled automatic peer installation) was copied into each probe. No exception, excluded package, time override, script execution, release manifest edit or lockfile mutation was used.

The source-map-js probe ran **2026-10-07 02:12:40.942 UTC** (**03:12 Lisbon**). Registry publication is **2026-09-30 14:08:09.382 UTC**. Seven days expire **2026-10-07 14:08:09.382 UTC**, or **15:08:09.382 Lisbon today**. Contrary to the stated current-window assumption, this check is still before the eligibility time. pnpm exits 1 and explicitly rejects 1.2.2 as too young. sharp 0.35.5 was published 2026-09-27 13:46:24.509 UTC, became eligible October 4, and its probe exits 0. Exact outputs, hashes, commands and timestamps are in `.tmp/ux008/release-prep/dependency-remediation-age-check/` and indexed under `dependencyRemediation` in the JSON.

The owner explicitly requires STOP when a patched version legitimately violates policy. Neither dependency was installed in the release graph. `pnpm-lock.yaml`, manifests, workspace settings, bootstrap verifier and CI remain unchanged; no broad refresh, override or audit suppression occurred. No new product or financial semantics were changed. MOCKED provenance remains rejected and no lab controls were exposed.

The previous enforced `pnpm audit --audit-level low` failure is reused; no remediated audit PASS is claimed. The graph is unchanged, so the existing structurally validated CycloneDX 1.6 SBOM remains valid rather than being replaced by evidence for an uninstalled graph: **262 registry components, 0 workspace components, 9 separately checked workspace manifests/importers, 16 reviewed license exceptions**, SHA-256 `ab0c58f2729180e6bd688ac5c516d42cdd95585b26ea8a59c57e25ca8a022375`. No regenerated SBOM is claimed.

Previous full typecheck PASS (15 tasks), full lint PASS (0 errors/warnings), 465/465 relevant unit/integration/safety passes, forced production build PASS (8/8; build ID `4zpT02Fh-_mtyL-swdkUU`), safe production smoke PASS and unchanged license/safety evidence remain valid. No dependency-specific patched image/sourcemap regression or wider suite was run after the prerequisite age failure. Earlier smoke verifies routes, fonts, logos/favicon/mascot/cursor assets, disabled image optimizer, zero page errors, zero external requests, zero signatures and zero sends. These are reused engineering results, not new patched-dependency verification or live product acceptance.

No release files were staged; no commit, push, PR, GitHub checks, merge or deployment was initiated. No release commit/main merge/deployed SHA exists for this attempt. `apps/reference-dapp/.tmp/` and all probe/browser/runtime artifacts remain outside any commit. Final report-content governance, secret scan and whitespace results will be recorded below.

**DEPLOYED TESTNET/DEVNET ACCEPTANCE: PENDING OWNER TEST**

**DEPLOYED MAINNET ACCEPTANCE: PENDING AFTER TESTNET PASS**

The existing flofi.xyz matrices and exact-deployment identity checklist are unchanged. No owner wallet was connected, no signature or authorization was requested and no transaction or funds were sent. Release work stops at the dependency-age blocker.

Final report-content checks: governance **PASS**, secret scan **PASS** (1,063 text files, zero credential findings; unchanged explicit synthetic test credential reviewed), and `git diff --check` **PASS**. Existing dependency files, historical JSON fields, prior policy and matrices are unchanged. The index remains empty. Closing checks are indexed under `dependencyRemediation.finalContentVerification`.


## EMERGENCY DEPENDENCY WAIVER

Owner explicitly approved this temporary, exact security-remediation exception for the Colosseum deadline. The previous **NOT_CERTIFIED** and **MAIN_NOT_READY** records above remain historical evidence. This section records the subsequent remediation, without claiming deployed financial acceptance.

- Package/version: **source-map-js@1.2.2** only.
- Advisory: [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), HIGH.
- Reason: HIGH security advisory remediation required for Colosseum release; waiting until ordinary age eligibility later today is incompatible with delivery.
- Approved by: **Owner**. Temporary: **true**.
- Removal condition: **TEMPORARY WAIVER MUST BE REMOVED AFTER COLOSSEUM DELIVERY**, once normal dependency-age eligibility is no longer needed. No calendar expiration was invented. Do not remove it during this task.

The existing pnpm `minimumReleaseAgeExclude` mechanism contains exactly `source-map-js@1.2.2`. Metadata is in `docs/security/COLOSSEUM-DEPENDENCY-AGE-WAIVER.json`. The existing governance and registry verifier share validation of that exact selector and owner metadata. The threshold remains **10080 minutes** for every other package/version. Sharp has **no waiver**. No audit exception, severity change, ignored advisory or exit-code bypass was added.

| Package | Before → after | Actual dependency route | Age result |
| --- | --- | --- | --- |
| source-map-js | 1.2.1 → **1.2.2** | PostCSS 8.5.23 → Next; PostCSS 8.5.28 → Vite/Vitest | PASS via exact temporary owner waiver |
| sharp | 0.35.4 → **0.35.5** | Next 16.3.6 optional native image dependency | PASS through normal seven-day age policy |

Both are transitive dependencies. The initial exact recursive update made no changes; narrow parent-scoped overrides were required. Reviewed lock changes comprise these two patches plus sharp's 26 required platform/libvips identities (0.35.5 / 1.3.4). No unrelated package identity or workspace importer changed. There are still **262 registry identities** and **nine importers**. The existing frozen inventory hash and 14 affected exact license-exception SRIs/versions were refreshed to the reviewed graph; all license expressions, platforms, optional paths and obligations are unchanged.

| Final dependency-remediation gate | Result |
| --- | --- |
| Frozen approved pnpm 11.22.0 install, scripts disabled | PASS |
| Registry integrity / licenses / seven-day age policy | PASS — all 262 entries; only exact source-map-js@1.2.2 waived |
| Waiver/governance self-tests | PASS — 19 tests, including old/other versions, other package, sharp, wildcard/range/additional exclusion and metadata rejection |
| Enforced `pnpm audit --audit-level low` | PASS — “No known vulnerabilities found”; **0 HIGH, 0 CRITICAL** |
| CycloneDX 1.6 regeneration and exact existing CI structural validation | PASS — 262 registry components, 0 workspace components, nine private manifests/importers independently verified, 16 reviewed license exceptions |
| Full typecheck | PASS — 15/15 tasks |
| Full lint | PASS — **0 errors, 0 warnings** |
| Patched sharp / Next image-processing regression | PASS — 11 existing logo, wordmark, symbol, droplet, mascot/cursor and app/favicon SVG assets decoded and processed through Next's sharp path; no asset changes |
| Source-map-js / PostCSS / Vite regression | PASS — both PostCSS paths resolve exactly 1.2.2; CSS source-map round trips and Vite JS/source-map/CSS outputs valid |
| Focused Vite/Vitest product safety regressions | PASS — 29 tests / two existing wallet and Review files |
| Fresh production build | PASS — 8/8 tasks, build ID **cKpbscqyXuStShy4C_52B** |
| Safe production smoke | PASS — HTTP/static assets and eight hydrated routes; **zero page errors, external requests, signatures or sends**; optimizer remains disabled by existing production configuration |
| Governance | PASS |
| Secret scan | PASS — 1064 text files; zero findings; unchanged explicit synthetic unit-test bearer string reviewed |
| `git diff --check` | PASS |

New validated SBOM SHA-256: `88c476ebf34cc17197ea463f23d7fa31ee0b20417aa582c574fe42d2bd7707eb`. The old SBOM hash was not reused. The SBOM continues the repository's validated pnpm convention: zero emitted workspace components, with all nine exact local manifests and lock importers independently checked.

No production financial source changed in this remediation. Previous unaffected 465-test product/safety evidence, schemas, PostgreSQL, compatibility and local CoW evidence remain reusable. The larger historical test suite and financial browser profiles were not rerun solely for these build/native dependency patches. **MOCKED provenance remains rejected**; no lab/debug/test controls were exposed, and the financial failure classifications, deployed policy and owner acceptance matrices above remain unchanged.

**ENGINEERING RELEASE READINESS: MAIN_READY.** The dependency blockers are resolved. GitHub required checks and merge are still pending; main currently diverges and the read-only merge preview predicts conflicts in 14 product/harness files. Both branches' legitimate changes must be preserved before merging; no direct main overwrite or force merge is authorized.

**DEPLOYED TESTNET/DEVNET ACCEPTANCE: PENDING OWNER TEST.**

**DEPLOYED MAINNET ACCEPTANCE: PENDING AFTER TESTNET PASS.**

Deployment has not been certified. Later acceptance must record the exact deployed main SHA, deployment identifier/timestamp if available, and `https://flofi.xyz` origin. No owner wallet action was performed. Temporary runner failures were retained in the JSON remediation history; only their conclusive corrected runs count as PASS.
