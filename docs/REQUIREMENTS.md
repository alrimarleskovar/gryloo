# Requirements registry

Current product name: **Flofi** (formerly Gryloo); see the
[branding transition](builds/BUILD-BRAND-001-PLAN.md). Historical entries below
retain the name used at the time. Runtime identifiers remain compatible.

Source references below point to `docs/specs/MASTER_SPEC_V3.2.md` and the Master
Prompt. BUILD-000 rows retain their historical evidence. BUILD-001 adds contract
and governance evidence; neither build provides financial execution evidence.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B000-BRAND-001 | Gryloo is the display brand. | Product principles | README and scope review | SATISFIED |
| B000-NAMESPACE-001 | Persistent technical namespaces remain neutral. | Naming | Scope guard | SATISFIED |
| B000-SOURCE-001 | One canonical Master Spec path exists. | Source hierarchy | SHA-256 and path checks | SATISFIED |
| B000-ARTIFACT-001 | Canonical artifact names and separation are frozen. | Artifact model | This registry | SATISFIED |
| B000-HASH-001 | Canonical identifiers are frozen. | Artifact identity | This registry | SATISFIED |
| B000-EVIDENCE-001 | Evidence and outcome terms are explicit. | Evidence model | Evidence levels | SATISFIED |
| B000-AUTHORITY-001 | Authority modes and enforcement vocabulary are fixed. | Authorization | Authority matrix | SATISFIED |
| B000-AUTHORITY-002 | Mode B analysis stays proposed. | Authorization | ADR-0001 | SATISFIED |
| B000-LICENSE-001 | Approved licenses, path boundaries, and exclusions are explicit. | Open-source strategy | License map and governance CI | SATISFIED |
| B000-IP-001 | Pre-incorporation licensing authority is recorded; future legal-entity transfer is deferred. | Legal gate | DEC-0008 and licensing amendment | RESOLVED_FOR_PREINCORPORATION_LICENSING |
| B000-SECURITY-001 | Governance CI and basic secret checks exist. | Security | Workflow | SATISFIED |
| B000-TRACEABILITY-001 | Requirements map to sources, checks, evidence, and status. | Acceptance | This registry | SATISFIED |
| B000-SCOPE-001 | BUILD-000 is governance-only. | Phase 0 | Scope checks | SATISFIED |
| B000-NEXT-001 | At BUILD-000 completion, BUILD-001 remained a non-approved candidate. | Build protocol | Preserved BUILD-000 report; subsequently superseded by DEC-0009 | SATISFIED_AT_BUILD_000 |
| B001-ARTIFACT-001 | Versioned closed schemas distinguish all artifact families and their required links. | Artifact model, sections 7–8 | Contract fixtures and schema tests | SATISFIED_LOCALLY |
| B001-RAW-001 | Reject duplicate decoded keys, invalid UTF-8, BOM, malformed or trailing JSON, unsafe numbers, and unpaired surrogates at raw-byte ingress. | Canonical input, security | Raw JSON positive and negative tests | SATISFIED_LOCALLY |
| B001-HASH-001 | Apply explicit field projections, RFC 8785 canonicalization, and the frozen byte-level domain-separated SHA-256 profile. | Artifact identity | All-domain vectors and independent Python verification | SATISFIED_LOCALLY |
| B001-INVALIDATION-001 | Distinguish semantic edits, observation refresh, expiration, authority changes, revocation, and cancellation; invalidate dependent artifacts. | Invalidation model | Invalidation matrix and tests | SATISFIED_LOCALLY |
| B001-REVISION-001 | Reject stale base revisions without silent replacement. | Revision model | Revision conflict fixtures and tests | SATISFIED_LOCALLY |
| B001-STATE-001 | Validate four journal levels and fail-closed transitions without execution or persistence. | Execution journal | State transition fixtures and tests | SATISFIED_LOCALLY |
| B001-REGISTRY-001 | Define neutral declarative actions and capability contracts without executable adapters. | Action Registry | Registry schema and tests | SATISFIED_LOCALLY |
| B001-COMPATIBILITY-001 | Freeze private package identities, ESM exports, schema IDs, deterministic schema bytes, and v1 compatibility policy. | SDK and compatibility | Export checks and schema-export check | SATISFIED_LOCALLY |
| B001-TOOLCHAIN-001 | Bootstrap exact Node.js 24.21.0 and pnpm 11.22.0 with verified official integrity and no external Actions or Corepack fallback. | Supply chain | Bootstrap logs and workflow checks | SATISFIED_LOCALLY |
| B001-DEPENDENCY-001 | Use verified exact direct pins, frozen integrity-bearing resolutions, strict peers, seven-day release age, disabled lifecycle scripts, and reviewed transitive licenses. | Supply chain | Registry evidence, lockfile review, audit, and ephemeral SBOM checks | SATISFIED_LOCALLY |
| B001-LICENSE-001 | Classify every authorized path and copy package LICENSE files byte-for-byte from the verified official Apache text. | Licensing | Exhaustive classification and byte checks | SATISFIED_LOCALLY |
| B001-GOVERNANCE-001 | Enforce exact changed-file scope, preserved baseline bytes and hashes, human approval boundaries, and ADR-0001 PROPOSED. | Build protocol | Governance suite and BUILD-001 report | SATISFIED_LOCALLY |
| B001-EVIDENCE-001 | Report only demonstrated contract results; financial environment and outcome remain NOT_APPLICABLE and authority remains NONE. | Evidence model | BUILD-001 report and evidence levels | SATISFIED_LOCALLY |

Canonical artifacts are Semantic Workflow IR, Quote and State Artifacts,
Simulation Bundle, Authorization Policy, Strategy Manifest, Execution Plan,
Execution Journal, and Evidence Bundle. Canonical identifiers are
`semanticWorkflowHash`, `artifactSetHash`, `simulationHash`, `policyHash`,
`manifestHash`, `payloadHash` or `intentHash`, `executionAttemptId`, and
`evidenceBundleHash`.

BUILD-002 requires one shared revisioned Semantic Workflow IR across its
mock chat, action library and canvas; local-only mocked interactions; strict
network isolation; honest unavailable Simulate and Execute shells; and exact
license/SRI disclosure for all 245 locked packages, including inactive
platforms. No wallet, transaction, signing or financial execution is
authorized.

## Retrospective BUILD-002 index

These `B002-*` IDs were assigned on 2026-09-23 by the
[BUILD-002 governance amendment](builds/BUILD-002-GOVERNANCE-AMENDMENT.md)
as a retrospective governance index. They did not exist while BUILD-002 was
planned or implemented, and they add no scope. Each row points to evidence
already committed at merge commit `606174f0bd944e5a1c31baf8dad685d7558b7cc8`
or to the CI runs recorded in the amendment. `SATISFIED` covers the mocked,
non-financial shell only: the interface is labelled `MOCKED`, build evidence
and financial outcome are `NOT_APPLICABLE`, authorization is `NONE` and
enforcement is `NOT_ENFORCED`. No primitive has P1–P14 certification.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B002-BRAND-001 | Display the Gryloo brand from one typed, frozen configuration value. | Master Prompt §0.1 and Build 002 | `apps/reference-dapp/src/config/product.ts` and `product.test.ts` | SATISFIED |
| B002-LAYOUT-001 | Provide the white Build → Simulate → Execute shell with Simulate and Execute shown as unavailable. | Master Prompt §9.1–9.2 and Build 002 | `top-bar.tsx`, `app-shell.tsx`, `interface-honesty.spec.ts` and three visual baselines | SATISFIED |
| B002-STATE-001 | Chat and canvas edit one immutable, revisioned Semantic Workflow IR through one reducer. | Master Spec §5.1 and §7.8 | `editor.ts`, `editor.test.ts`, `build-roundtrip.spec.ts` and `contracts.integration.test.ts` | SATISFIED |
| B002-REVISION-001 | Reject stale `baseRevision` edits without overwriting the current IR. | Master Spec §7.8 | `editor.ts` and `editor.test.ts` | SATISFIED |
| B002-LOCK-001 | Keep a locked amount parameter from being edited through chat. | Master Spec §5.3 and §9.2 | `editor.ts`, `commands.ts` and `editor.test.ts` | SATISFIED |
| B002-CHAT-001 | Provide deterministic local mock chat that proposes only typed edits, with no model or network service. | Master Prompt §8.3–8.4 | `commands.ts`, `commands.test.ts` and `copilot-panel.tsx` | SATISFIED |
| B002-CANVAS-001 | Edit the same IR on a React Flow canvas. | Master Prompt §6.1 and Build 002 | `workflow-canvas.tsx` and `build-roundtrip.spec.ts` | SATISFIED |
| B002-ROUNDTRIP-001 | Prove the chat and canvas round trip automatically for mocked nodes. | Master Prompt Build 002 | `build-roundtrip.spec.ts` and `editor.test.ts` | SATISFIED |
| B002-LABEL-001 | Show the `MOCKED`, `NONE`, `NOT_ENFORCED` and `NOT_APPLICABLE` states visibly. | Master Prompt §9.6 | `summary-bar.tsx`, `top-bar.tsx`, `interface-honesty.spec.ts` and `product.test.ts` | SATISFIED |
| B002-ACCESSIBILITY-001 | Provide landmarks, labelled controls and keyboard access. | Master Prompt §9.7 | `interface-honesty.spec.ts` | SATISFIED |
| B002-VISUAL-001 | Hold zero-pixel visual baselines for Build, Simulate and Execute. | Master Prompt §9.7 | `visual-shell.spec.ts` and its three snapshots | SATISFIED |
| B002-NETWORK-001 | Allow only the loopback application origin in browser tests and prove the guard with one synthetic negative attempt. | BUILD-002 plan, network controls | `e2e/fixtures.ts`, `network-isolation.spec.ts` and the governance source URL scan | SATISFIED |
| B002-TELEMETRY-001 | Disable Next telemetry and Playwright browser downloads for build, test and runtime processes. | BUILD-002 plan, network controls | application `package.json` scripts, `playwright.config.ts` and `contracts.yml` | SATISFIED |
| B002-BROWSER-001 | Use only the approved headless-shell archive, verified against its locally observed, human-approved digest. | BUILD-002 plan, bootstrap | `scripts/bootstrap-playwright.py` and the BUILD-002 report | SATISFIED |
| B002-DEPENDENCY-001 | Verify all 245 locked registry entries with exactly 16 reviewed license exceptions, audit, and validate an ephemeral SBOM. | BUILD-002 plan, license-evidence amendment | `scripts/bootstrap-ci.py`, `contracts.yml` and the BUILD-002 report | SATISFIED |
| B002-LICENSE-001 | Classify the application as AGPL-3.0-only with an official text copy, and keep the patch and upstream notice classifications. | Master Prompt §7.3 | `apps/reference-dapp/LICENSE`, `docs/LICENSE_MAP.md` and `THIRD_PARTY_NOTICES.md` | SATISFIED |
| B002-SCOPE-001 | Exclude wallet, backend, transaction, signing, financial execution, Mode B and BUILD-003 work. | BUILD-002 plan | BUILD-002 report and exact-scope governance | SATISFIED |
| B002-DELIVERY-001 | Merge through PR #5 with branch, pull-request and post-merge CI passing. | Master Prompt §5.5 | merge commit `606174f0bd944e5a1c31baf8dad685d7558b7cc8` and the run IDs in the amendment | SATISFIED |

## BUILD-002 governance amendment

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B002-GOVERNANCE-001 | Restore the persistent governance controls removed during BUILD-002 without weakening any BUILD-002 check. | DEC-0014; Master Prompt Build 000 and §8.6 | `.github/workflows/governance.yml` and the amendment report | SATISFIED_LOCALLY |
| B002-LICENSE-002 | Record the tracked AGPL application truthfully in the root `LICENSE` without changing any grant. | DEC-0013 | `LICENSE` and the amendment report | SATISFIED_LOCALLY |
| B002-RECORDS-001 | Make the status, next-build, decision and requirement records match the demonstrated state. | DEC-0012; Master Prompt §5.3 | `docs/STATUS.md`, `docs/NEXT_BUILD.md` and this registry | SATISFIED_LOCALLY |
| B002-NAMING-001 | Name the contracts workflow for what it validates. | DEC-0012 | `.github/workflows/contracts.yml` | SATISFIED_LOCALLY |

`SATISFIED_LOCALLY` means the amendment's local gates passed. Its remote CI
result is shown by its pull request and is not claimed here.

B000-SECURITY-001 keeps its historical row. Its basic secret checks were absent
from governance CI from the BUILD-002 merge until B002-GOVERNANCE-001 restored
them.

## BUILD-003A approved implementation index

DEC-0018 approved the exact BUILD-003A plan. `SATISFIED_LOCALLY` records passed local acceptance only. The preserved
build report states that remote CI had not been performed when it was written; B003A-DELIVERY-001 below records the
later pull-request and post-merge CI results.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B003A-REGISTRY-001 | Exact action and capability declarations with immutable Base asset context. | Master Spec §7.4 | Registry tests and provenance review | SATISFIED_LOCALLY |
| B003A-AUTHORING-001 | Author both isolated Base swap directions through chat and canvas. | Master Spec §5.1, §6.1 | Browser surface tests | SATISFIED_LOCALLY |
| B003A-REVISION-001 | Apply explicit proposals with locks, conflicts and invalidation. | Master Spec §7.8 | Reducer and browser tests | SATISFIED_LOCALLY |
| B003A-VALIDATION-001 | Reject malformed and forged authoring inputs at runtime. | Master Spec §7.4, §9 | Linter validation tests | SATISFIED_LOCALLY |
| B003A-LINT-001 | Deterministic non-enforcing prototype review rules. | Master Prompt P5; Master Spec §8.5 | Linter tests and findings UI | SATISFIED_LOCALLY |
| B003A-EQUIVALENCE-001 | Real surface and mixed-edit semantic equivalence. | Master Prompt P2–P4 | Guarded browser hashes | SATISFIED_LOCALLY |
| B003A-HONESTY-001 | Non-executing UI and evidence labels. | Master Spec §7.7 | Interface tests and report | SATISFIED_LOCALLY |
| B003A-VISUAL-001 | Reviewed visual changes followed by zero-pixel regression. | Master Prompt §9.7 | Before/after/diff images and visual tests | SATISFIED_LOCALLY |
| B003A-COMPATIBILITY-001 | Frozen wire and hash behavior with additive exports. | ADR-0002 | Compatibility regression and schema check | SATISFIED_LOCALLY |
| B003A-SUPPLY-001 | Existing resolutions, approved browser and ephemeral SBOM. | Master Prompt §8 | Dependency verifier, browser and SBOM log | SATISFIED_LOCALLY |
| B003A-GOVERNANCE-001 | Preserve historical and enforce current exact scope. | Master Prompt §5 | Local and remote governance jobs | SATISFIED_LOCALLY |

## BUILD-003B approved implementation index

DEC-0019 approved the exact BUILD-003B plan. `SATISFIED_LOCALLY` records passed
local acceptance only; remote CI is reported separately in the
[BUILD-003B report](builds/BUILD-003B-REPORT.md). Every artifact in this build
is `MOCKED`: the rows below are internal-logic evidence, not quotes, financial
simulation, authorization, execution or reconciliation evidence.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B003B-QUOTE-001 | One `MOCKED` Quote/State Artifact per swap node, with synthetic provenance, freshness and hashed mock markers. | Master Spec §7.5; Master Prompt P6, P10 | Chain review tests, frozen-ingress integration test and E2E JSON verification | SATISFIED_LOCALLY |
| B003B-SIMULATION-001 | `MOCKED` Simulation Bundle bound to one IR revision and one Artifact Set, with exact round-down outputs and a failure path. | Master Spec §7.6, §10; Master Prompt P7, P10 | Arithmetic vectors, floor-property oracle and E2E | SATISFIED_LOCALLY |
| B003B-LINK-001 | Every cross-artifact hash and revision link is recomputed; tampered or mislinked chains fail closed. | Master Spec §7.1, §7.9; Gate 2 | Chain review tamper table and E2E frozen-hash comparison | SATISFIED_LOCALLY |
| B003B-HASH-001 | The browser digest equals frozen DWE-HASH v1 for every supported type, rejects what the frozen implementation rejects, and self-checks before use. | ADR-0002; Master Spec §7.9 | Differential digest tests on the pinned toolchain and E2E self-check failure | SATISFIED_LOCALLY |
| B003B-INVALIDATION-001 | Semantic edits, refresh, expiry and stale completions follow the frozen matrix; expiry is checked on access and tab resume. | Master Spec §7.8; invalidation contract | State and guard tests and E2E clock tests | SATISFIED_LOCALLY |
| B003B-BOUNDARY-001 | Mocked artifacts cannot create or unlock authorization or execution. | Master Spec §8.5, §16.1; Master Prompt §8.3 | Source scans, literal non-executable results, `DRAFT` state and E2E | SATISFIED_LOCALLY |
| B003B-HONESTY-001 | Every generated number shows `MOCKED` and the synthetic rate; unmodeled values are disclosed, never estimated. | Master Spec §7.7; Master Prompt §9.4, §9.6 | E2E label and wording checks | SATISFIED_LOCALLY |
| B003B-VISUAL-001 | Reviewed visual changes followed by zero-pixel regression. | Master Prompt §9.7 | Before/diff images, report counts and eight zero-pixel snapshots | SATISFIED_LOCALLY |
| B003B-COMPATIBILITY-001 | Frozen schemas, fixtures, hash profile and contract packages unchanged; linter exports additive. | ADR-0002; compatibility contract | Protected-byte governance and schema check | SATISFIED_LOCALLY |
| B003B-SUPPLY-001 | No new registry resolution; one new direct edge to the approved `canonicalize@5.0.0` pin. | Master Prompt §8 | Dependency verifier, lockfile section digest and SBOM accounting | SATISFIED_LOCALLY |
| B003B-GOVERNANCE-001 | BUILD-003A scope pinned historically and the exact BUILD-003B scope enforced. | Master Prompt §5 | Governance jobs and isolated negative checks | SATISFIED_LOCALLY |
| B003A-DELIVERY-001 | Retrospective: BUILD-003A merged through PR #7 with pull-request and post-merge CI passing. | Master Prompt §5.5 | Merge commit `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd` and the run IDs recorded in [status](STATUS.md) | SATISFIED |

| B003B-DELIVERY-001 | Retrospective: BUILD-003B merged through PR #8 with pull-request and post-merge CI passing. | Master Prompt §5.5 | Merge `0faec71207628dfe27fb23c81680d2c27827f5ea`; runs in the BUILD-003C plan and [status](STATUS.md) | SATISFIED |

## BUILD-003C approved implementation index

DEC-0020 approved the read-only scope; DEC-0021 approved Alchemy Free, a separate persistent 3-attempt/63-request cap and the synthetic CSP guard fixture change. The public session remains stopped at 2/4 attempts and 24/84 requests after two HTTP 429 responses. The original Alchemy attempt received HTTP 403 and remains byte-identical at 1/3 attempts and 1/63 requests. After the owner enabled Base Mainnet only, Amendment 3/DEC-0022 authorized one carried-counter continuation. The owner-run attempts 2 and 3 verified both canonical hash-pinned methods and recorded both directions in 42 additional requests; final Alchemy usage is 3/3 attempts and 43/63 requests. Real replay, pins, positive E2E, ten visual baselines and local governance acceptance passed. Each BUILD-003C row below is `SATISFIED_LOCALLY`; remote PR CI remains pending and no later build is approved.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B003C-OBSERVATION-001 | Read-only pinned Base quotes with transcript and validated Quote/State Artifact. | Master Spec §7.5 | Two verified real transcripts, derivation and positive replay E2E | SATISFIED_LOCALLY |
| B003C-VERIFICATION-001 | Verify chain, block, code, asset metadata and deployments; fail closed. | Master Prompt §2.5 | Four matching code pins, real replay and scripted failure tests | SATISFIED_LOCALLY |
| B003C-NETWORK-001 | Fixed server-only local development RPC with limits; replay-only CI and E2E. | Master Spec §17 | Transport tests, CSP, clean browser guard and governance scan | SATISFIED_LOCALLY |
| B003C-FAILURE-001 | Explicit failures without partial values. | Master Prompt Build 003 | Linter, server and browser tests | SATISFIED_LOCALLY |
| B003C-PROVENANCE-001 | Bind mode, host, block, times and hashes into visible observation. | Master Prompt P6 and §2.6 | Both replay directions with visible block, host, times and hashes | SATISFIED_LOCALLY |
| B003C-BOUNDARY-001 | Separate observations from `MOCKED` data and authority. | Master Spec §7.2 | Domain, cross-rejection, positive guarded E2E and governance | SATISFIED_LOCALLY |
| B003C-VISUAL-001 | Review visual changes and pass zero-pixel regression. | Master Prompt §9.7 | Eight reviewed diffs and ten zero-pixel snapshots | SATISFIED_LOCALLY |
| B003C-COMPATIBILITY-001 | Keep contracts, schemas, fixtures, registry and dependencies unchanged. | ADR-0002 | Protected-byte and exact-scope governance passed | SATISFIED_LOCALLY |
| B003C-GOVERNANCE-001 | Pin BUILD-003B historically and enforce exact BUILD-003C scope and consumer boundary. | Master Prompt §5 | Historical and current exact-scope governance passed | SATISFIED_LOCALLY |

## BUILD-003D implementation index

DEC-0023 approves BUILD-003D, including Amendments 1–6. DEC-0024 accepts ADR-0003. DEC-0025 closes BUILD-003D under Option B. `SATISFIED_LOCALLY` covers only offline evidence on the final tree: historical unit 316/316, contracts 79/79, G1 14/14 and fork suites 31/31 before secret removal, plus guarded browser suite 28/28, typecheck, build, lint, schema exports and the updated persistent governance programs. `DEFERRED_TO_BUILD-003F` marks requirements that need a recorded Base fork, fork application integration or a manual wallet. The three owner-run recording attempts stopped, so no such evidence exists. BUILD-003 certification remains pending. DEC-0026 removes the phrase from Git; final-byte pinned-account Anvil startup is deferred to BUILD-003F owner-secret revalidation.

| ID | Requirement and source | Check or evidence | Status |
|---|---|---|---|
| B003D-FORK-001 | Controlled fork, exactly specified by: the pinned anvil; recorded finalized, hash-pinned Base state; offline replay; local chain 31337; the mainnet refusal guard. Master Spec §21 Phase 2; Master Prompt P11 | Fork harness, closed replay upstream, exact Anvil command (Amendment 6), mainnet-refusal profile and readiness tests delivered offline; no recorded Base state | DEFERRED_TO_BUILD-003F |
| B003D-RECORDING-001 | One bounded, owner-run, credential-isolated state recording with persistent caps and stop rules; the transcript is committed without credentials. It is preceded by the offline compatibility gate and by the owner's recorded no-paid-billing confirmation. Master Prompt §10.4 | Three owner-run attempts stopped (68/1,800 requests, 1,768 reserved CU); no transcript; D-5 authority exhausted | DEFERRED_TO_BUILD-003F |
| B003D-QUOTE-001 | A fresh fork quote, with on-fork code, metadata and deployment checks, recorded as Quote/State artifacts that are authorization inputs only on the fork. Master Spec §7.5 | Scripted-transport fork-quote unit tests only | DEFERRED_TO_BUILD-003F |
| B003D-SIMULATION-001 | Exact-path Simulation Bundle, consistent with the quote; failure paths and residual effects. Master Spec §7.6, §10 | Scripted two-pass simulation unit tests and G1 C7 only | DEFERRED_TO_BUILD-003F |
| B003D-AUTHORIZATION-001 | Canonical policy, Manifest and Execution Plan with payload hashes; material changes alter the correct hashes. Master Prompt §2.2, P8 | Deterministic policy, Manifest, plan and payload-hash compile tests with scripted inputs | SATISFIED_LOCALLY |
| B003D-MATRIX-001 | Additive enforcement-matrix artifact and EVM payload profile; v1 bytes and fixtures unchanged. Master Spec §8.4; ADR-0002 | G2 schema export, 79 contract tests, frozen-byte and vector checks | SATISFIED_LOCALLY |
| B003D-PREVIEW-001 | Decoded preview re-derived in the browser from the exact bytes sent to the wallet. Master Prompt P9, §8.3 | Browser re-derivation needs the fork application integration | DEFERRED_TO_BUILD-003F |
| B003D-WALLET-001 | EIP-1193 authorization with chain and account guards; Gryloo holds no key and never broadcasts. Master Spec §16.4; Master Prompt §8.5 | EIP-1193 bridge not delivered | DEFERRED_TO_BUILD-003F |
| B003D-WALLET-002 | Owner-run manual acceptance with a real injected EIP-1193 wallet and a recorded dev account on chain 31337 only. Automated and manual wallet evidence are labelled separately. Any other outcome is recorded as `LIMITED`: the claim is limited, the PR may be delivered and BUILD-003 stays `IN_PROGRESS`. A G7 `PASS` is required for certification. Master Prompt §8.5; Master Spec Gate 3 | G7 not run | DEFERRED_TO_BUILD-003F |
| B003D-TOOLCHAIN-001 | Offline compatibility gate for the exact pinned anvil binary, before any credentialed request; no silent substitution. Master Prompt §10.2, §10.4 | G1 C1–C10 offline compatibility record | SATISFIED_LOCALLY |
| B003D-CERTIFICATION-001 | P1–P14 are conditional criteria. No completion or certification claim before cited passing evidence and the owner's certification decision. Master Prompt §5.5, §14 | No completion or certification claim; governance enforces the pending markers | SATISFIED_LOCALLY |
| B003D-JOURNAL-001 | Attempt persisted and fsynced before the wallet request; append-only, hash-chained v1 journal; idempotent attempts. Master Prompt §2.3, §6.4 | Executor unit tests: persisted and fsynced attempt before any scripted request, hash chain, idempotent prepare; wallet integration deferred | SATISFIED_LOCALLY |
| B003D-RECOVERY-001 | Unknown result, server restart, pending, revert and residual-allowance revocation; reconciliation precedes any retry. Master Spec §12.3 | Recovery decision-table unit tests only; fork recovery paths need recorded state | DEFERRED_TO_BUILD-003F |
| B003D-RECONCILIATION-001 | Independent invariants on receipt, signed payload, signer, balances, allowance, fees and recipient. Master Prompt §2.6, §11 Uniswap evidence | Reconciler invariant unit tests only; chain-data reconciliation needs recorded state | DEFERRED_TO_BUILD-003F |
| B003D-EVIDENCE-001 | Evidence Bundle linking every hash; `FORK_REPRODUCED`; outcome labels honest. Master Spec §7.7 | Evidence Bundle build and validation unit tests only; no FORK_REPRODUCED bundle | DEFERRED_TO_BUILD-003F |
| B003D-ADVERSARIAL-001 | Build 003 injections and applicable §8.7 cases, with results recorded. Master Prompt Build 003, §8.7 | Adversarial decode and reconciliation unit cases only; browser adversarial suite deferred | DEFERRED_TO_BUILD-003F |
| B003D-VISUAL-001 | Reviewed visual changes, then zero-pixel regression. Master Prompt §9.7 | Existing ten baselines unchanged at zero pixels (28/28); the planned visual changes moved to BUILD-003F | DEFERRED_TO_BUILD-003F |
| B003D-DETERMINISM-001 | Measurement-independent Simulate canvas viewport and screenshot-diff forensics. Master Prompt §9.7 | Convergent viewport, settled-viewport waits and forensics; local stress passed; CI without rerun pending on the pull request | SATISFIED_LOCALLY |
| B003D-SUPPLY-001 | Exact new npm pins and a pinned anvil binary, verified in CI. Master Prompt §8.6 | 247 locked identities, exact Noble pins and the Anvil pin verified by the bootstrap script and G1 C1; CI audit and SBOM pending on the pull request | SATISFIED_LOCALLY |
| B003D-COMPATIBILITY-001 | v1 schemas, fixtures and hash vectors are byte-identical; additions are versioned. ADR-0002 | G2 schema export, 79 contract tests, frozen-byte and vector checks | SATISFIED_LOCALLY |
| B003D-GOVERNANCE-001 | BUILD-003C pinned historically; exact BUILD-003D scope and boundaries enforced. Master Prompt §5 | Updated persistent governance programs pass: BUILD-003C historical, exact reduced BUILD-003D scope and Mode A source boundaries | SATISFIED_LOCALLY |
| B003C-DELIVERY-001 | Retrospective: BUILD-003C merged through PR #9, with its pull-request CI and post-merge CI (after one rerun) passing. Master Prompt §5.5 | PR #9 merge and CI facts recorded in STATUS and the BUILD-003D plan section 2.3 | SATISFIED_LOCALLY |

## BUILD-003F local acceptance resolution (2026-09-27)

The BUILD-003D index above is the historical Option B closure state; its deferred labels describe what BUILD-003D itself did not deliver. DEC-0028 approved their completion in BUILD-003F. Current local evidence is in the [BUILD-003F report](builds/BUILD-003F-REPORT.md):

- Controlled fork and toolchain: the F2 final-byte account boundary passed 51/51 fork cases and G1 C1–C10. One owner F3 recording pinned finalized Base block 51,797,365 at 286 requests/7,436 reserved CU, and F4 reproduced the real transcript byte-identically. This resolves the local acceptance evidence for B003D-FORK-001, B003D-RECORDING-001 and B003D-TOOLCHAIN-001. BUILD-003D's earlier attempt budget remains exhausted and is not reused.
- Quote, simulation, review and authorization: seven real replay scenarios and the owner G7 WETH→USDC path used on-fork code/state, exact quote/simulation artifacts, deterministic policy, Manifest, plan, enforcement matrix and two reviewed signed payloads. The local evidence for B003D-QUOTE-001, B003D-SIMULATION-001, B003D-AUTHORIZATION-001, B003D-MATRIX-001 and B003D-PREVIEW-001 is `FORK_REPRODUCED`, limited to chain 31337.
- Wallet, journal, recovery and independent effect checks: automated synthetic and replay browser suites passed 42/42 each, the guarded real-replay checkpoint passed 18/18, and the owner-operated MetaMask/Brave G7 independently verified two exact signed payloads and two successful receipts. The resulting Evidence Bundle is `RECONCILED:EXACT`, output 2,685.012130 USDC, residual WETH router allowance zero. This is local acceptance for B003D-WALLET-001, B003D-WALLET-002, B003D-JOURNAL-001, B003D-RECOVERY-001, B003D-RECONCILIATION-001, B003D-EVIDENCE-001 and B003D-ADVERSARIAL-001. The wallet is owner-operated; Gryloo stores no key and submits nothing to a public chain.
- Visual and supply gates: the reviewed BUILD-003F baselines reproduce at zero pixels in the local suites; the prior F6 check passed 334/334 unit/contract tests, typecheck 13/13, build 7/7, five-pass rehearsal, 247 locked registry identities, eight workspace manifests and 16 reviewed exceptions. Final local gates and remote PR/post-merge CI passed before DEC-0030 certification. The historical B003D-VISUAL-001, B003D-SUPPLY-001, B003D-COMPATIBILITY-001, B003D-DETERMINISM-001 and B003D-GOVERNANCE-001 facts remain distinct from BUILD-003F delivery.

B003D-CERTIFICATION-001 is resolved for the controlled local-fork evidence by DEC-0030: after final gates, PR #11 4/4 on `45dc852c88810be41ec2a703c163f4e41bcfa2eb`, merge `4bf7d4f6e96c5ef433b0c930dad067d4001f2956`, and successful post-merge Governance `36286360276` and Contracts/app `36286360265`, the owner accepted ADR-0004 and certified BUILD-003 `FORK_REPRODUCED` on chain 31337 only. P1–P14 claims are limited to that local evidence level; `TESTNET_EXECUTED` and `MAINNET_EXECUTED` are absent. No mainnet, public-testnet, production, live-provider, wallet-custody or financial-execution authority is granted.

## BUILD-004 finite authority verification

The approved [BUILD-004 plan](builds/BUILD-004-PLAN.md) maps its finite Mode B acceptance checks to the existing requirement register without redefining historical IDs. Automated local-fork tests exercise exact target/function/parameters, one-time cumulative budget under same-block contention, protocol expiry, browser-independent recovery, reconciliation and four-step revocation. The owner-operated injected-wallet acceptance passed, as recorded in the [BUILD-004 report](builds/BUILD-004-REPORT.md). PR #13 merged, and both post-merge checks passed; DEC-0033 certifies the result at `FORK_REPRODUCED` on local chain 31337.

## BUILD-005 CoW signed-intent acceptance mapping

DEC-0035 closes BUILD-005 after PR #15 merged and both post-merge checks passed. The rows below are accepted for the deterministic MOCKED local profile only; IMPLEMENTED_LOCAL does not imply public CoW, public-chain or production certification. That BUILD-005 closure statement is historical; DEC-0036 subsequently approved the bounded BUILD-006 implementation.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B005-IR-001 | Reuse the semantic exact-input swap IR and require CoW preauthorization without silently rerouting legacy nodes. | Master Spec workflow and adapter model; Master Prompt BUILD-005 | Compiler, registry, linter and browser tests | IMPLEMENTED_LOCAL |
| B005-REVIEW-001 | Discover capability and review quote, simulation, Manifest, exact EIP-712 order, limits, spender and expiry before signing. | Master Spec §§7–8, 11–13; Master Prompt BUILD-005 | Compiler and browser acceptance | IMPLEMENTED_LOCAL |
| B005-LIFECYCLE-001 | Persist before post, never duplicate an uncertain order, recover after restart, track, cancel with a separate signature and show expiry/failure. | Master Spec execution/recovery; Master Prompt BUILD-005 | Executor, service and browser tests | IMPLEMENTED_LOCAL |
| B005-EVIDENCE-001 | Reconcile receipt, trade, balances, allowance and fee with explicit MOCKED provenance and no public-chain claim. | Master Spec evidence model; Master Prompt BUILD-005 | Reconciler, service and browser tests | IMPLEMENTED_LOCAL |
| B005-ROADMAP-001 | Preserve global non-custodial multichain scope and Solana priority. | Master Spec roadmap | Plan, scope and report review | PRESERVED |

## BUILD-006 approved local liquidity acceptance mapping

DEC-0036 approves the isolated Uniswap v3 Mode A local-fork lifecycle in the [BUILD-006 plan](builds/BUILD-006-PLAN.md). As of 2026-09-28 every row is satisfied locally on chain 31337. The evidence is the owner-recorded Base transcript, the closed byte-identical replay, the independent raw-RPC verifier, the fork tests and the real-transcript browser specs; see the [BUILD-006 report](builds/BUILD-006-REPORT.md). SATISFIED_LOCALLY is not itself certification. After PR #16 merged and the post-merge checks passed, DEC-0037 certifies BUILD-006 at FORK_REPRODUCED on local chain 31337 only.

| ID | Requirement | Source area | Check or evidence | Status |
|---|---|---|---|---|
| B006-IR-001 | Author liquidity through chat and canvas in one revisioned semantic IR, separated from mutable state. | Master Spec §7; Master Prompt BUILD-006 | Round-trip and invalidation tests | SATISFIED_LOCALLY |
| B006-POOL-001 | Verify Base USDC/WETH v3 pool, tier, current state, ticks, tokens, Position Manager and deployed code. | Master Spec §15; Master Prompt BUILD-006 | Closed fork readback and adversarial identity tests | SATISFIED_LOCALLY |
| B006-MATH-001 | Calculate native-unit token composition from range and current price, never fixed 50/50. | Master Spec §10; Master Prompt BUILD-006 | Independent integer-math vectors and boundary tests | SATISFIED_LOCALLY |
| B006-AUTH-001 | Review and sign each exact finite approval or lifecycle payload through a user wallet on chain 31337 only. | Master Spec §16; ADR-0003 | Wallet mutation and exact-byte tests | SATISFIED_LOCALLY |
| B006-LIFECYCLE-001 | Mint, inspect, increase, partially decrease, collect, fully remove and conditionally burn one position. | Master Prompt BUILD-006 | Local-fork and browser journey | SATISFIED_LOCALLY |
| B006-RECOVERY-001 | Persist before submit and reconcile ambiguity, restart and duplicate attempts before continuation. | Master Spec §12 | Fault-injection and restart tests | SATISFIED_LOCALLY |
| B006-EVIDENCE-001 | Independently reconcile position owner, token ID, ticks, liquidity, token flows, fees, allowances and residues. | Master Spec §7.7; Master Prompt BUILD-006 | Reconciler and Evidence Bundle tests | SATISFIED_LOCALLY |
| B006-ROADMAP-001 | Preserve the global non-custodial multichain roadmap, Solana priority and separate BUILD-007 composition gate. | Master Spec §21; DEC-0036 | Scope and governance review | SATISFIED_LOCALLY |


## BUILD-007 finite composition acceptance mapping

DEC-0038 approves the [BUILD-007 plan](builds/BUILD-007-PLAN.md). The first recording attempt stopped; under DEC-0039 and DEC-0040, attempt 2 produced the Base transcript. Every row is satisfied locally on chain 31337: the transcript, byte-identical closed replay, independent verifier, fork tests and real-transcript browser specs are the evidence. After PR #17 merged, DEC-0043 certifies BUILD-007 at FORK_REPRODUCED on local chain 31337 only.

| ID | Requirement | Check or evidence | Status |
|---|---|---|---|
| B007-IR-001 | One revisioned two-node swap→mint IR with typed WETH output and strict invalidation. | Linter, domain and guarded browser tests | SATISFIED_LOCALLY |
| B007-SIM-001 | One-block verified quote, pool state, chained simulation and bounded native-unit mint planning. | Compiler, service and synthetic closed replay | SATISFIED_LOCALLY |
| B007-AUTH-001 | Exact owner-reviewed approvals and two one-use Safe/Roles permissions; direct mint limits enforceable onchain. | Direct fork bypass and readback tests | SATISFIED_LOCALLY |
| B007-EXEC-001 | Fixed two-step worker, actual swap-output dependency and Safe-owned NFT. | Browser-independent worker and guarded browser journey | SATISFIED_LOCALLY |
| B007-RECOVERY-001 | Durable reservation, restart, known-hash observation and fail-closed unknown submission or partial completion. | Worker and recovery tests | SATISFIED_LOCALLY |
| B007-EVIDENCE-001 | New bounded Base transcript, closed byte-identical replay and independent raw-RPC reconciliation before any fork claim. | Preflight, recording, verifier and browser gates | FORK_REPRODUCED on local chain 31337 (not certified) |
| B007-ROADMAP-001 | Preserve certified BUILD-003–006 evidence and global non-custodial multichain/Solana roadmap. | Exact protected-byte governance | SATISFIED_LOCALLY |

## BUILD-011B approved editor stabilization mapping

DEC-0051 approves the [BUILD-011B plan](builds/BUILD-011B-PLAN.md) from merged BUILD-011 main. These are local acceptance requirements; they grant no new financial or evidence authority.

| ID | Requirement | Check or evidence | Status |
|---|---|---|---|
| B011B-DRAG-001 | Live node dragging is stable; position persists without changing semantic revision or CURRENT artifacts. | Canvas unit and browser tests | IMPLEMENTED_LOCAL |
| B011B-EDGE-001 | Mock connections preserve edge, dependency and output reference consistency; protected edges remain guarded. | Reducer and browser tests | IMPLEMENTED_LOCAL |
| B011B-UX-001 | Selection and keyboard guards, Selected Action inspector, iconized toolbox modes, Review JSON and clean default Build/Copilot surfaces work. | Canvas, visual and regression browser tests | IMPLEMENTED_LOCAL |
| B011B-STORAGE-001 | Toolbox preference uses only the bounded presentation key `gryloo:toolbox-mode`, separate from layout and semantic IR. | Layout tests and exact source governance | IMPLEMENTED_LOCAL |
| B011B-GOVERNANCE-001 | BUILD-011 is checked historically at its merged commit; BUILD-011B has its own exact create/modify paths and preserves prior checks. | Local governance passed; PR-head governance pending | SATISFIED_LOCALLY |

## BUILD-011C-1 bounded happy-path mapping

DEC-0052 approves the [BUILD-011C-1 plan](builds/BUILD-011C-1-PLAN.md) from `89415eb3574ddd28ab8b1cb0d39e221791c5521f`. The path is the successful-composition half of Master Prompt Build 011; financial evidence remains MOCKED.

| ID | Requirement | Check or evidence | Status |
|---|---|---|---|
| B011C-IR-001 | One bridge → destination preparation → optional calculated swap → Uniswap mint semantic graph with real output references; chat and canvas produce the same IR. | Graph and browser tests | IMPLEMENTED_LOCAL |
| B011C-POOL-001 | Extend existing v3 adapter only to the verified Arbitrum WETH/native-USDC fee-500 pool while retaining Base. | Single-block factory, manager, token, fee, spacing and code read; adapter regression | IMPLEMENTED_LOCAL |
| B011C-VALUE-001 | Use reconciled Arbitrum USDC rather than estimated bridge output; compute a range-aware partial/one-sided split and reconcile destination swap debit/output before mint. | Compiler, executor and browser tests | IMPLEMENTED_LOCAL_MOCKED |
| B011C-AUTH-001 | Bind provider, quote freshness, target/function, source and destination cumulative spend, gas reserve and refreshed destination Manifest. | Artifact and Manifest tests | CONTRACT_VALIDATED_NOT_ENFORCED |
| B011C-EVIDENCE-001 | Journal each non-atomic boundary and report reconciled LP NFT, deposits, allowances, gas and residual WETH/USDC in a canonical Evidence Bundle. | Journal and reconciler tests | IMPLEMENTED_LOCAL_MOCKED |
| B011C-BOUNDARY-001 | Preserve BUILD-011/011B and prior evidence limits; defer destination failure, compensation authority, recovery and manual intervention to BUILD-011C-2. | Exact-path governance and report | IN_PROGRESS |

## BUILD-011C-2 bounded failure and recovery mapping

DEC-0053 approves the [BUILD-011C-2 plan](builds/BUILD-011C-2-PLAN.md) from `0ac839738e9aa198007fbf354ea2f14894459c38`. Composed recovery evidence remains MOCKED.

| ID | Requirement | Evidence | State |
| --- | --- | --- | --- |
| B011C-FAILURE-001 | Preserve settled bridge and swap effects on destination failure; report actual asset location and costs. | Executor and browser failure fixtures | IMPLEMENTED_LOCAL_MOCKED |
| B011C-UNKNOWN-001 | Persist mint attempt before submission; independently classify unknown result before retry or completion. | Attempt journal, shared classifier and restart fixture | IMPLEMENTED_LOCAL_MOCKED |
| B011C-COMPENSATION-001 | Require current authority, Manifest, artifacts and budget for bounded retry; compensation uses a new authorized attempt. | Recovery and compensation tests | IMPLEMENTED_LOCAL_MOCKED |
| B011C-MANUAL-001 | Expose partial state, balances, costs, authority and safe/manual choices in the canonical DApp. | Browser recovery acceptance | IMPLEMENTED_LOCAL_MOCKED |
| B011C-RECOVERY-001 | Keep partial evidence outcome and maturity truthful; never imply global rollback or public execution. | Partial Evidence Bundle and governance checks | IMPLEMENTED_LOCAL_MOCKED |

## BUILD-011D-1 capability and environment mapping

DEC-0054 approves the [BUILD-011D-1 plan](builds/BUILD-011D-1-PLAN.md) from `33a83ce9de18d8bbbfe4ccfb73811b00c09f290d`. Public financial execution remains disabled.

| ID | Requirement | Evidence | State |
| --- | --- | --- | --- |
| B011D-CAPABILITY-001 | Resolve exact semantic action, adapter/version, chain, authorization mode and environment; unknown inputs fail closed. | Registry and resolver unit tests | IMPLEMENTED_LOCAL |
| B011D-WEAKEST-001 | Require every financial node for workflow execution and cap composed evidence at its weakest demonstrated level. | Resolver composition tests | IMPLEMENTED_LOCAL |
| B011D-ENVIRONMENT-001 | Keep environment selection separate from Semantic Workflow IR, revision and canvas layout. | Browser environment inspection | IMPLEMENTED_LOCAL |
| B011D-EXECUTE-001 | Gate Execute through capability resolution and show typed product-facing blockers while retaining existing artifact and wallet guards. | Browser and resolver tests | IMPLEMENTED_LOCAL |
| B011D-EVIDENCE-001 | Preserve Base Uniswap local-fork evidence, MOCKED provider/composition evidence, authoring-only templates, and disabled Public Testnet/Mainnet. | Capability matrix and governance | IMPLEMENTED_LOCAL |

## BUILD-011D-2 public testnet acceptance (DEC-0055)

| ID | Requirement | Check or evidence | Status |
|---|---|---|---|
| B011D-PUBLICUX-001 | Remove normal Build environment selector and permanent readiness diagnostics while preserving canvas, toolbox and navigation. | Browser and visual tests | IMPLEMENTED_LOCAL |
| B011D-PUBLICWALLET-001 | Reuse a connected EIP-1193 session; connect contextually at Execute; author and quote without wallet. | Wallet and browser tests | IMPLEMENTED_LOCAL |
| B011D-PUBLICCHAIN-001 | Verify Base Sepolia 84532, official Uniswap deployments, bytecode, canonical pool and live quote. | Public RPC observation and service checks | VERIFIED_READ_ONLY |
| B011D-PUBLICEXEC-001 | Persist bounded approval/swap attempts before wallet send and hashes immediately; fail closed on unknown result. | Deterministic service and recovery tests | IMPLEMENTED_LOCAL |
| B011D-PUBLICEVIDENCE-001 | Promote only the exact swap profile after a real canonical DApp transaction, successful receipt, independent token reconciliation, gas and Evidence Bundle. | [Public swap receipt](https://sepolia.basescan.org/tx/0xb5dd3f4bb4d2f5a101ff5da371636fde917894eb03ef3c5f1ac0e71605799ff8) and [BUILD-011D-2 report](builds/BUILD-011D-2-REPORT.md) | TESTNET_EXECUTED_EXACT_PROFILE |
| B011D-PUBLICSCOPE-001 | Keep other public profiles and Mainnet unavailable and preserve Mock/Fork evidence. | Registry and regression tests | IMPLEMENTED_LOCAL |

## BUILD-012A — Supply requirements (DEC-0056)

| ID | Requirement | Validation / acceptance |
| --- | --- | --- |
| B012A-SUPPLY-001 | Canonical supply / aave-v3 IR from chat and canvas with explicit chain, asset, amount and beneficiary | Focused shared IR, linter and authoring tests; execution acceptance pending |
| B012A-REVIEW-001 | Read-only exact simulation and revision/account/chain/Pool/allowance/calldata-bound review | Compiler and service tests; fresh public RPC reads |
| B012A-EXECUTION-001 | Owner DApp Execute, exact finite approval if required, then real public Supply through injected wallet | Deterministic browser journey; owner public acceptance pending |
| B012A-RECOVERY-001 | Durable attempt/account/nonce/calldata identity before wallet request; observe uncertainty after restart without duplicate intent | Executor, service and browser recovery tests |
| B012A-EVIDENCE-001 | Independent canonical transaction/event/position delta verification before RECONCILED and exact-profile TESTNET_EXECUTED | Reconciler mismatch tests and honest MOCKED classification; public evidence pending |
