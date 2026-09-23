# BUILD-002 — Governance amendment

Status: **LOCAL_ACCEPTANCE_PASSED — delivery pending**. Date: 2026-09-23.
Approval: DEC-0012 to DEC-0017. Branch: `codex/build-002-governance-amendment`.
Baseline: `606174f0bd944e5a1c31baf8dad685d7558b7cc8`, the BUILD-002 merge commit.

This is a governance-only amendment to BUILD-002. It is not a new build. It
approves no BUILD-003 build, sub-build or plan.

## 1. Approved objective

Restore the governance checks unintentionally removed during BUILD-002,
correct the obsolete root `LICENSE` statement and the incomplete license-map
path-authorization statement, and bring the status,
next-build, decision and requirement records in line with demonstrated
evidence, without changing any application, package, dependency, schema,
fixture, patch, legal copy or visual baseline.

## 2. What was implemented

- A minimal factual correction of the root [LICENSE](../../LICENSE) (DEC-0013).
- A one-sentence correction of the path-authorization statement in the
  [license map](../LICENSE_MAP.md) (DEC-0017).
- A [governance workflow](../../.github/workflows/governance.yml) that keeps
  every BUILD-002 check and adds a separate step restoring the persistent
  controls (DEC-0014).
- A truthful display name for the
  [contracts workflow](../../.github/workflows/contracts.yml) and its job.
- Corrected [status](../STATUS.md) and [next-build](../NEXT_BUILD.md) records,
  decisions DEC-0012 to DEC-0017, a retrospective `B002-*` index and the
  amendment requirements in [the registry](../REQUIREMENTS.md), and matching
  [security model](../SECURITY_MODEL.md) and [scope guard](../SCOPE_GUARD.md)
  text.
- This record, including the BUILD-002 evidence observed after its report.

## 3. What was not implemented

- No application source, test, visual baseline, package, schema, compatibility
  fixture, manifest, lockfile, patch, upstream legal copy, `NOTICE`,
  `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`, ADR, Master Spec, Master Prompt
  or historical plan or report changed.
- No dependency was installed or updated, and no application or package
  build, test run, schema export or baseline regeneration was performed.
- `README.md` is unchanged because none of its statements became
  inconsistent.
- No path classification, license grant or official license text changed.
- [The BUILD-002 report](BUILD-002-REPORT.md) is unchanged. Later BUILD-002
  evidence is recorded in section 5 instead.
- No BUILD-003A plan, branch or implementation exists. ADR-0001 remains
  PROPOSED and byte-identical.

## 4. Changes by component

- Frontend, backend, adapters, Semantic IR, policy, journal and evidence: none.
- Security and DevOps: restored governance controls, a two-stage scope check
  and a renamed contracts workflow. No validation step was removed or weakened.
- Licensing: one factual correction to the root routing document and one
  path-authorization sentence in the license map.
- Documentation: status, next-build, decisions, requirements, security model,
  scope guard and this record.

### Changed files

| Path | Change | Approval |
|---|---|---|
| `docs/builds/BUILD-002-GOVERNANCE-AMENDMENT.md` | Created | DEC-0012 |
| `LICENSE` | Modified: factual AGPL statement | DEC-0013 |
| `.github/workflows/governance.yml` | Modified: two-stage scope check and restored controls | DEC-0014 |
| `.github/workflows/contracts.yml` | Modified: workflow and job display names only | DEC-0012 |
| `docs/STATUS.md` | Modified | DEC-0012 |
| `docs/NEXT_BUILD.md` | Modified | DEC-0012 |
| `docs/DECISIONS.md` | Modified: DEC-0012 to DEC-0017 | DEC-0012 |
| `docs/REQUIREMENTS.md` | Modified: retrospective `B002-*` index | DEC-0012 |
| `docs/SECURITY_MODEL.md` | Modified | DEC-0014 |
| `docs/SCOPE_GUARD.md` | Modified, for consistency with the `LICENSE` correction and DEC-0017 | DEC-0012 |
| `docs/LICENSE_MAP.md` | Modified: the Apache-2.0 row's path-authorization sentence only | DEC-0017 |

### Exact LICENSE diff

This is the exact output of `git diff -U0 -- LICENSE` against `606174f`. The
zero-context form is used because a unified diff marks a blank context line
with a trailing space.

```diff
--- a/LICENSE
+++ b/LICENSE
@@ -13 +13,7 @@ is governed by [the license map](docs/LICENSE_MAP.md).
-No tracked AGPL-3.0-only implementation currently exists. `docs/assets/**` and
+The reference application at `apps/reference-dapp/**` is tracked AGPL-3.0-only
+application code, except its `LICENSE` copy of the official text. The
+`packages/workflow-contracts/**` and `packages/action-registry/**` packages
+remain Apache-2.0, except their `LICENSE` copies of the official text, and
+patches and copied upstream legal files retain their upstream licenses. This
+factual correction changes no license grant, path classification, official
+license text or legal boundary. `docs/assets/**` and
```

Line 13 was the only line removed; lines 1-12 and the following lines are
unchanged. Only the obsolete sentence was replaced. The routing bullets, the exclusions,
the trademark statement and the managed-plane prohibition are byte-identical.
The historical statement in the
[BUILD-000 licensing amendment](BUILD-000-LICENSING-AMENDMENT.md) that no AGPL
implementation was tracked is preserved as a record of its date.

### Exact LICENSE_MAP diff

This is the exact output of `git diff -U0 -- docs/LICENSE_MAP.md` against
`606174f`. Line 25 is the only changed line.

```diff
--- a/docs/LICENSE_MAP.md
+++ b/docs/LICENSE_MAP.md
@@ -25 +25 @@ ownership of Gryloo intellectual property.
-| Apache-2.0 | `.gitignore`, `.node-version`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/governance.yml`, `.github/workflows/contracts.yml`, `scripts/bootstrap-ci.py`, `scripts/export-schemas.mjs`, `README.md`, `TRADEMARKS.md`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `docs/*.md`, `docs/adr/*.md`, `docs/builds/*.md`, `docs/specs/*.md`, `docs/contracts/*.md`, `prompts/*.md`, `packages/workflow-contracts/**` and `packages/action-registry/**` except each package LICENSE, `tests/compatibility/v1/**` | Eligible original governance, contracts, registry, fixtures, generated schemas, tooling, and policy material; [Apache License 2.0](../LICENSES/Apache-2.0.txt). Only exact paths in the approved BUILD-001 and BUILD-002 plans and the later BUILD-002 legal-evidence amendment are authorized. |
+| Apache-2.0 | `.gitignore`, `.node-version`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/governance.yml`, `.github/workflows/contracts.yml`, `scripts/bootstrap-ci.py`, `scripts/export-schemas.mjs`, `README.md`, `TRADEMARKS.md`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `docs/*.md`, `docs/adr/*.md`, `docs/builds/*.md`, `docs/specs/*.md`, `docs/contracts/*.md`, `prompts/*.md`, `packages/workflow-contracts/**` and `packages/action-registry/**` except each package LICENSE, `tests/compatibility/v1/**` | Eligible original governance, contracts, registry, fixtures, generated schemas, tooling, and policy material; [Apache License 2.0](../LICENSES/Apache-2.0.txt). Only exact paths in an explicitly approved tracked build plan or an explicitly approved tracked governance or licensing amendment are authorized: currently the BUILD-001 and BUILD-002 plans, the later BUILD-002 legal-evidence amendment and the BUILD-002 governance amendment. |
```

Only the final sentence of the Apache-2.0 row's treatment cell changed. The
classification cell, every path pattern, the license grant and link, and every
other line are byte-identical. No path is reclassified, and BUILD-003A is not
named or approved.

### Scope check

The BUILD-002 check compared the working tree with `fb285da` and could not
accept any later change. It now runs in two stages:

1. The approved BUILD-002 create and modify sets, copied unchanged, are
   checked between `fb285da` and the merge commit `606174f`, including removed
   and protected paths.
2. The current tree is checked against `606174f`. It must add exactly this
   record, change only the DEC-0012 and DEC-0017 paths, and keep every other
   file byte-identical.
   In the license map, only the Apache-2.0 row's path-authorization sentence
   may change. Its classification and path cells, the rest of its treatment
   text and every other line must remain byte-identical, and the approved
   authorization rule must be present.

Every other BUILD-002 check is retained verbatim: symlinks, private-plane
paths, retained SBOMs, external Actions, the application AGPL copy, the XYFlow
patch digest and scope, the upstream legal digests and notice mapping, the
license-map markers, ADR-0001 status, BUILD-002 authority markers, the remote
URL scan of application source and exhaustive classification.

### Restored controls

| Category | Pre-BUILD-002 source | Restored behaviour for the current tree |
|---|---|---|
| Secret indicators | `fb285da` governance workflow, lines 144-146 and 400-405 | Same assignment pattern plus private-key, GitHub, AWS, Slack and API-key token formats, in every text file including upstream copies |
| Email addresses | Lines 363-366 | All Gryloo-authored text, with both approved patch file names excepted |
| Markdown links | Lines 156-162 | All Gryloo-authored Markdown, ignoring fenced code blocks |
| Identifiers | Lines 114-131 | Well-formed, unique and registered `DEC-NNNN` and `B000`–`B999` requirement IDs, gap-free decision numbers, and an ADR file for each ADR reference |
| Deprecated names | Lines 138-140 | All Gryloo-authored files except the Master Prompt, which defines them, and the governance check itself |
| Unsupported claims | Lines 141-142 | README and application source, adding guaranteed returns, best investment and best route from the Master Prompt's forbidden claims, and risk-free |
| Prohibited standalone token | Lines 147-148 | All Gryloo-authored Markdown |
| Official license texts | Lines 214-240 and 273-276 | Official digests and sizes, no Gryloo additions, exact package and application copies |
| Package exports and schemas | Lines 378-399 | Package identities and export maps, application and workspace manifests, reserved-directory boundary, schema file set and identifiers, strict JSON, and frozen v1 schema and fixture trees |
| Report and plan headings | Lines 92-95 and 105-109 | BUILD-000 plan, BUILD-001 plan and report, and this record |
| Protected integrity | Lines 214-237 | Pinned digests for the Master Spec, Master Prompt, both ADRs, every historical plan and report, contract profiles, `NOTICE`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`, assets and visual baselines |
| Decision, licensing and private records | Lines 278-372 | DEC-0003, DEC-0004, DEC-0007, DEC-0008 and DEC-0009 wording, markers for DEC-0012 to DEC-0017, licensing states, routing and notice markers, private-record fields and paths, and the administrator record |
| Parser patch | Lines 242-271 | Digest, touched files, exact declaration lines and lockfile identity, extended to the XYFlow patch |
| Output hygiene | Lines 150-154 and 197-211 | No generated output, environment file, SBOM, CLA or unapproved manifest; read-only workflows without privileged triggers or repository secrets; LF endings, a final newline and no whitespace errors in changed files |

## 5. Evidence and tests

All results are local observations on 2026-09-23 of the working tree staged
for the single amendment commit. They are not remote CI results.

| Requirement | Test | Result | Environment | Outcome status | Evidence |
|---|---|---|---|---|---|
| B002-GOVERNANCE-001 | Both governance steps run from the parsed workflow in the working tree and in a clean clone | PASS | NOT_APPLICABLE | NOT_APPLICABLE | 163 text files scanned for secret indicators, 142 Gryloo-authored files, 27 Markdown files link-checked, 23 protected digests, 17 decision and 49 requirement IDs |
| B002-GOVERNANCE-001 | Negative mutation tests in disposable clones | PASS | NOT_APPLICABLE | NOT_APPLICABLE | All 34 injected violations were rejected with their expected messages: the 31 original cases and 3 for the DEC-0017 license-map rule. The unmutated clone passed. The decision-gap case now skips one number after the last decision, so adding DEC-0017 does not turn it into a valid sequence |
| B002-GOVERNANCE-001 | YAML parsing, `bash -n` of every `run` block, Python compilation of every embedded script | PASS | NOT_APPLICABLE | NOT_APPLICABLE | Both workflows |
| B002-GOVERNANCE-001 | Fresh depth-1 checkout emulating the CI fetch of the commit, `fb285da` and `606174f` | PASS | NOT_APPLICABLE | NOT_APPLICABLE | Both governance steps |
| B002-LICENSE-002 | Exact diff review, digest checks for both official texts and all LICENSE copies | PASS | NOT_APPLICABLE | NOT_APPLICABLE | Section 4 |
| B002-RECORDS-001 | Identifier, link, marker and heading checks | PASS | NOT_APPLICABLE | NOT_APPLICABLE | Restored-controls step |
| B002-NAMING-001 | Workflow diff limited to two display names | PASS | NOT_APPLICABLE | NOT_APPLICABLE | `contracts.yml` |
| Scope | Exact amendment scope and byte identity against `606174f` | PASS | NOT_APPLICABLE | NOT_APPLICABLE | One created and ten modified paths |
| Hygiene | `git diff --check` against `606174f` and review of the staged diff | PASS | NOT_APPLICABLE | NOT_APPLICABLE | No whitespace errors in changed files |

The application, lockfile, schemas, compatibility fixtures, patches, legal
copies and visual baselines were confirmed byte-identical to `606174f`.

### BUILD-002 evidence observed after its report

PR #5 was merged on 2026-09-23 at 17:19:41 UTC as merge commit
`606174f0bd944e5a1c31baf8dad685d7558b7cc8`. Every step of both workflows
succeeded, including the browser suite, audit and SBOM validation.

| Event | Commit | Governance run | Contracts and reference app run | Result |
|---|---|---|---|---|
| Branch push | `ace3a27` | [35894522329](https://github.com/alrimarleskovar/gryloo/actions/runs/35894522329) | [35894522255](https://github.com/alrimarleskovar/gryloo/actions/runs/35894522255) | success |
| Pull request #5 | `ace3a27` | [35894541671](https://github.com/alrimarleskovar/gryloo/actions/runs/35894541671) | [35894541653](https://github.com/alrimarleskovar/gryloo/actions/runs/35894541653) | success |
| Post-merge push to `main` | `606174f` | [35894840128](https://github.com/alrimarleskovar/gryloo/actions/runs/35894840128) | [35894840406](https://github.com/alrimarleskovar/gryloo/actions/runs/35894840406) | success |

These runs used the BUILD-002 governance workflow, which lacked the controls
restored here. They show BUILD-002 passed its own gates remotely. They do not
show that it would have passed the restored controls; the restored controls
pass against the unchanged BUILD-002 tree in this amendment.

## 6. Acceptance criteria

- [x] Branch created from clean, synchronized `main` at `606174f`.
- [x] The root `LICENSE` correction is limited to the obsolete statement.
- [x] The license-map correction is limited to the path-authorization
  sentence, and no classification changed.
- [x] Every BUILD-002 governance check is retained.
- [x] Every requested control category is restored for the current tree,
  without external Actions.
- [x] The workflow display names describe what it validates, and no validation
  step changed.
- [x] Status, next-build, decision and requirement records match the evidence;
  `NEXT_BUILD.md` states `NONE_APPROVED`.
- [x] Only approved paths changed; protected files are byte-identical.
- [x] All local gates passed.
- [ ] Remote CI result for this amendment, observable only after push.
- [ ] Merge, which is not performed by this change.

## 7. Security

- Threats tested: secret disclosure, email leakage, broken provenance links,
  malformed or unregistered identifiers, deprecated brand names, unsupported
  claims, altered protected or legal bytes, out-of-scope changes and generated
  output. Each was tested by a negative mutation.
- Authority bypasses tested outside the UI: `NOT_APPLICABLE`; authorization
  mode is `NONE`.
- Effective enforcement locations: repository CI and human review only; no
  financial enforcement exists (`NOT_ENFORCED`).
- Remaining active permissions: none. Both workflows keep read-only
  `contents` permission.
- Findings: CI omitted the BUILD-001 secret and related checks from the
  BUILD-002 merge until this amendment.
- Open findings: none known. The restored checks are basic patterns and
  digests and cannot detect every secret or claim.
- Secrets and logs reviewed: YES.

## 8. Licenses

- AGPL code changed: none.
- Apache code changed: the two workflows and the governance documents.
- Dependencies added: none.
- Incompatibilities found: none.
- The root routing document now states the tracked AGPL application
  truthfully. No grant, classification, official text or legal boundary
  changed.
- The license map now recognizes that an explicitly approved tracked build
  plan or governance or licensing amendment may authorize paths. No path is
  reclassified.

## 9. Deviations from the plan

- The contracts workflow was displayed as "Build 001 and 002 acceptance",
  not "Build 001 contracts" as described in the instruction. It is renamed
  "Repository contracts and reference app", and its job is named
  "Contracts, reference app, dependencies and SBOM". There is no branch
  protection that requires the old names.
- `NEXT_BUILD.md` holds no candidate details, because the Master Prompt limits
  it to the next approved build. Candidate details are in DEC-0016 and
  section 12.
- `docs/SCOPE_GUARD.md` was modified because its BUILD-001 statement that root
  legal texts remain byte-identical would otherwise read as contradicting
  DEC-0013. `README.md` was not modified.
- The link check now ignores fenced code blocks so that quoted diffs are not
  read as links. Upstream legal copies remain pinned by digest and scanned for
  secret indicators, but are exempt from the Gryloo-authored text rules.
- Before push, the owner approved one scope correction (DEC-0017) that adds
  `docs/LICENSE_MAP.md`. The single local commit was amended rather than
  followed by a second commit.
- The BUILD-001 plan-scope comparison is not restored as a separate check. The
  pinned BUILD-001 plan digest makes it redundant and is stronger.
- The heading check does not apply to the BUILD-000 report or the BUILD-002
  plan and report, which predate or do not follow the template. They are
  protected by digest and cannot be edited.

## 10. Demonstrable state

- Now demonstrable: governance checks and records only, with authorization
  mode `NONE`.
- `MOCKED`: the unchanged BUILD-002 reference shell.
- `FORK_REPRODUCED`, `TESTNET_EXECUTED` and `MAINNET_EXECUTED`: none.
- `CONFIRMED_NOT_RECONCILED`, `RECONCILED`, `INCONCLUSIVE` and `DIVERGENT`:
  none.

## 11. Technical debt created

- The governance workflow names the `fb285da` and `606174f` baselines and this
  amendment's scope. The next approved change must update them.
- The status section of `README.md` still describes BUILD-001 and BUILD-002 as
  approvals rather than completed builds. It is not inconsistent, but it is
  dated.
- The BUILD-002 report still lacks the template's numbered sections, and is
  preserved as history.

## 12. Suggestions for the next build — NOT APPROVED

1. Suggestion: candidate BUILD-003A, Uniswap swap authoring and deterministic
   lint, covering gates P1 to P5 with no quote, adapter, calldata, wallet,
   signing, submission, network access or financial execution. DEC-0016 puts
   the deterministic linter in its scope.
   - Benefit: completes the authoring and lint half of the first Mode A
     primitive without crossing the financial-execution boundary.
   - Cost: application code, tests, one visual baseline decision and a
     governance scope update.
   - Risk: low. It needs no dependency or network change.
   - Relationship to v3.2: Master Prompt Build 003 and Master Spec Phase 2,
     authoring only. DEC-0015 permits separate approval while ADR-0001 remains
     PROPOSED.
   - Recommendation: implement only after this amendment is merged and a
     revised plan is approved.
2. Suggestion: a later records-only change to `README.md` for the dated
   status wording in section 11.
   - Benefit: removes dated wording. Cost: low. Risk: low.
   - Relationship to v3.2: governance truthfulness.
   - Recommendation: defer, or fold into the next approved scope.

The earlier planning questions on primary chain, asset pair, linter and action
locations, swap authorization class, browser-archive reuse, visual-baseline
policy, requirement IDs for lettered sub-builds and the branch prefix remain
open.

## 13. Next-build options

- Option A — recommended: after this amendment is merged, prepare the revised
  BUILD-003A plan for explicit approval, resolving the open questions above.
- Option B: first approve a records-only change for section 11.
- Option C — defer: keep `NONE_APPROVED` and make no further change.

## 14. Required human decision

After this amendment is merged, do you approve preparing the revised
BUILD-003A plan for your review, without implementation?
