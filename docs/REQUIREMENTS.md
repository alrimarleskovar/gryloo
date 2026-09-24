# Requirements registry

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
