# BUILD-001 — Report

Status: **LOCAL_ACCEPTANCE_PASSED — delivery pending**.
Validation date: 2026-09-23. Remote GitHub Actions execution is not yet demonstrated.

## 1. Approved objective

Define and verify versioned, interoperable canonical artifact contracts, their
hashes, invalidation rules, revision conflicts, hierarchical states, and a
declarative Action Registry without protocol integration or financial execution.

The owner approved the complete revised plan and subsequently approved the exact
declaration-only parser compatibility patch. Both approvals apply to BUILD-001.

## 2. What was implemented

Two private ESM packages at version 0.1.0 provide closed TypeBox/Ajv contracts,
guarded raw JSON ingress, canonical field projections and hashes, pure revision,
invalidation and state helpers, and a declarative Action Registry. Ten generated
Draft 7 schemas, linked v1 fixtures, twelve domain vectors, and positive and
negative tests define compatibility. No package is published.

The workspace includes exact pins, an integrity-bearing lockfile, the approved
pnpm declaration patch, verified Node/pnpm bootstrap, deterministic schema export,
dependency and license verification, two workflows without external Actions,
ADR-0002, contract documents, scope-aware governance, and this report.

## 3. What was not implemented

No BUILD-002, DApp, chat, canvas, API, database, worker, wallet connection,
protocol adapter, transaction construction, signing, submission, live quote,
financial simulation, reconciliation service, or managed-plane component exists.
Mode B was not selected or implemented. ADR-0001 remains PROPOSED and unchanged.

Commit, push, PR creation, and remote CI are delivery steps following this
validated report. This report does not claim those steps have already succeeded.
The final delivery message must identify their actual outcomes.

## 4. Changes by component

- Frontend, backend, adapters and financial execution: none.
- Semantic IR/artifacts: nine workflow schemas, parsing, validation and hashes.
- Policy/Manifest/authority: descriptive contracts with NONE and NOT_ENFORCED.
- Journal/evidence: four-level state and hash-chain contracts with synthetic data.
- Action Registry: versioned declarations and capability compatibility checks.
- Security: raw ingress guards, closed schemas, native-unit strings, safe numeric
  bounds, explicit hash projections, revision conflicts and fail-closed transitions.
- DevOps: verified toolchain, strict frozen dependency installation, audit,
  license inventory, temporary SBOM validation and governance.
- Documentation: approved plan, ADR-0002, contract profiles, evidence and status.

## 5. Evidence and tests

All build evidence environment and financial outcome values are NOT_APPLICABLE.
Synthetic artifact fixtures are contract examples and do not demonstrate financial
execution or independent reconciliation.

| Requirement / gate | Result | Demonstrated evidence |
|---|---|---|
| Clean synchronized main and exact branch | PASS | Baseline 4055b39153046db59195c58270862f321ea75e5f; initial remote comparison ahead 0 / behind 0; codex/build-001-canonical-contracts. |
| Exact toolchain bootstrap | PASS locally | Official Node checksum listing/archive and pnpm publisher SRI verified; Node v24.21.0 linux/x64 and pnpm 11.22.0 executed. |
| Direct pins, engines and peers | PASS | Approved registry versions, SRI, engines, publication dates, licenses and relevant peer ranges reviewed; strict-peer and engine-strict install passed. |
| Frozen patched installation | PASS | pnpm install --frozen-lockfile --ignore-scripts succeeded with the committed patch hash. |
| Upstream parser provenance | PASS | Verified original tarball SRI; comparison of all installed published files found only the two authorized declaration corrections. No runtime JavaScript changed. |
| Package build and typecheck | PASS | pnpm check ran TypeScript 5.9.3 with strict true, exactOptionalPropertyTypes true and skipLibCheck false. Both packages build. |
| Lint | PASS | Pinned ESLint completed without errors. |
| Raw JSON/security-negative tests | PASS | 30 tests, including duplicate root/nested/escaped-equivalent keys, trailing document, malformed JSON, invalid UTF-8, BOM, unsafe numbers, escaped lone high and low surrogates, and resource bounds. |
| Complete unit/contract/compatibility suite | PASS | 82 tests across 6 files; artifact links, schema rejection, monetary bounds, journal links, revision conflicts, invalidation, state transitions and registry compatibility. |
| Hash compatibility | PASS | All 12 exact domains, payload/preimage hex and lowercase digest vectors; independent Python standard-library canonical payload, framing and SHA-256 verification. |
| Canonical field coverage | PASS | Every structured schema field is explicitly covered by its canonical projection; unknown/runtime properties reject. |
| Deterministic schema export | PASS | Ten schemas generated using verified Node and compiled declared dependencies; pnpm schemas:check verifies exact bytes. |
| Full registry inventory | PASS | 170 lock entries checked against publisher SRI and seven-day minimum age, including inactive platform packages. |
| Vulnerability audit | PASS at verification time | pnpm audit --json reports zero info, low, moderate, high and critical advisories. |
| Transitive license inventory | REVIEWED | MIT 125, Apache-2.0 16, BSD-2-Clause 6, BSD-3-Clause 3, ISC 7, MPL-2.0 12, BlueOak-1.0.0 1. |
| SBOM command and validation | PASS | Pinned pnpm help confirms the command; exact CI step produced CycloneDX 1.6 with 140 components and all 12 exact direct dependencies. |
| Workflow YAML / shell / Python syntax | PASS locally | Both YAML files parsed; every embedded Bash block passed bash -n; bootstrap parsed with Python AST. No additional dependency installed for these checks. |
| Governance and licensing | PASS locally | Workflow checks passed: scope, links, requirement/decision IDs, authority, package exports, license classes/copies, basic secret patterns, no external Actions and ADR boundaries. |
| Preserved bytes and hashes | PASS | All 14 protected baseline files match exactly, including BUILD-000 records, ADR-0001, Master Spec/Prompt, root legal texts and assets. |
| Changed-file scope | PASS | Exactly 82 authorized created paths and 12 authorized modified paths. |
| Whitespace | PASS | git diff --check plus scan of new/modified text; pnpm patch context whitespace is preserved as required by unified-diff syntax. |
| Remote GitHub Actions | NOT_RUN | Local validation does not claim a remote CI result. |

The sanitized dependency metadata evidence SHA-256 is
`b60a0a150f0fe8a1255e81d7fb177777d17715db54aba4f26d805c9ac694bcf0`.

The final local SBOM validation emitted SHA-256
`19e599223f1380ec23e379ee709af4a860baa2276d02402e7b714a4b7e856b25`
to its log and job-summary equivalent, then deleted the SBOM. The lock inventory
includes platform-specific packages beyond the 140 generated SBOM components.
No retained, uploaded or committed SBOM artifact is claimed. CI likewise emits
its own digest to logs and GITHUB_STEP_SUMMARY and deletes its temporary SBOM.
Timestamp changes can change that digest.

## 6. Acceptance criteria

- [x] Authorized initial state, branch and exact implementation scope verified.
- [x] Strict package build, typecheck and lint pass.
- [x] Raw-input and all contract/security/compatibility tests pass.
- [x] Deterministic schema export, registry, audit, license and SBOM gates pass.
- [x] Governance, workflow syntax, whitespace and protected hashes pass locally.
- [x] Report describes only demonstrated contract evidence.
- [ ] Commit and remote delivery recorded in final delivery message.
- [ ] Remote CI result available after push.

Local implementation acceptance is demonstrated. Delivery remains incomplete
until the authorized commit/push/PR sequence succeeds or the specified SSH
fallback is reported. No full remote completion is claimed.

## 7. Security

Authorization mode is NONE. Financial enforcement is NOT_ENFORCED. Contract
validation and transition declarations grant no financial authority and perform
no external effect. No financial primitive has P1–P14 certification.

No secret, private founder record, local machine identifier, dependency store or
build-output directory is part of the tracked scope. The governance email check
has one exact literal exception for the approved pnpm patch path, whose filename
resembles an email address; all other text remains checked. Basic pattern checks
do not constitute comprehensive secret detection.

## 8. Licenses

Gryloo-authored files use the Apache-2.0 classification. Package LICENSE files
are exact 11,358-byte copies of LICENSES/Apache-2.0.txt, SHA-256
`cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

The parser patch is THIRD_PARTY_PATCH under upstream MIT. The copied upstream
MIT license is official third-party legal text. Neither is represented as
Gryloo-authored Apache material. Root official legal texts are unchanged.

Unmodified development tooling includes lightningcss 1.33.0 and eleven platform
packages under MPL-2.0, and minimatch 10.2.6 under BlueOak-1.0.0. These remain
third-party dependencies with their own licenses. No publication, bundled
dependency distribution, or relicensing is approved. No AGPL implementation was
introduced.

## 9. Human-approved compatibility deviation

The original pinned parser declarations produced TS2430 because the base
ParsedElementInfo optional parent/key types did not explicitly permit the
undefined values declared by ParsedTopLevelElement under exact optional typing.
The owner approved the precise declaration-only correction through pnpm's
built-in patch / patch-commit workflow.

- Package: `@streamparser/json@0.0.26`.
- Original upstream tarball SRI:
  `sha512-46597LNFI+MFdUnzX2QJWwmdTRdq0XVD+vVNJTtGVzIrnCuhG9pFo1OAzbNBqci8UJgk/X5KJZ6LcV+y7PTuDQ==`.
- Patch path: `patches/@streamparser__json@0.0.26.patch`.
- Patch SHA-256 and lockfile patch_hash:
  `3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6`.
- Resulting package identity:
  `@streamparser/json@0.0.26(patch_hash=3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6)`.
- Exact declaration files: `dist/mjs/utils/types/parsedElementInfo.d.ts`
  and `dist/cjs/utils/types/parsedElementInfo.d.ts`.
- In each base interface, `parent?: JsonStruct` becomes
  `parent?: JsonStruct | undefined`, and `key?: JsonKey` becomes
  `key?: JsonKey | undefined`. No other declaration or runtime file changes.
- Official MIT source:
  `https://registry.npmjs.org/@streamparser/json/-/json-0.0.26.tgz`,
  member `package/LICENSE`, copied to
  `third_party/licenses/streamparser-json-MIT.txt`.
- Copied license: 1,068 bytes; SHA-256
  `b0022ea53a62be6b1f54f89f80d9271e395df2d12a63b4f8f0bf1a916a4e8094`.

TypeScript 5.9.3, strict true, exactOptionalPropertyTypes true, skipLibCheck false,
all pins/integrities and runtime parser behavior remain unchanged. No
patch-package dependency, test suppression, compiler relaxation or substitute
package was used. The exact correction resolves compilation.

## 10. Demonstrable state

The working tree implements only BUILD-001 and passes its local acceptance
gates. The complete command is `pnpm check`, supplemented by registry
verification, audit, the exact CI SBOM step, governance, workflow syntax,
protected-byte comparison and changed-file checks. CI definitions are present;
a remote CI run is not yet evidence.

## 11. Technical debt created

Future SDKs must reproduce the frozen v1 vectors. Future execution components
must implement their own separately approved authority and persistence
boundaries. The narrow parser declaration patch requires review when a future
approved dependency update supplies compatible upstream declarations.
Publication and distribution license review remain outside BUILD-001.

## 12. Suggestions for the next build — NOT APPROVED

BUILD-002 remains a candidate only. No next-build planning, scaffolding,
dependency installation or implementation was performed under this approval.

## 13. Next-build options

The owner may separately authorize BUILD-002 planning after reviewing BUILD-001.
No automatic advancement occurs on a local pass, commit, push or PR.

## 14. Delivery and human decision

No new implementation approval is needed to complete the authorized delivery.
Create the commit and PR with the exact title
`Implement Build 001 canonical artifact contracts`, push
`codex/build-001-canonical-contracts`, target main, and do not merge.

If noninteractive SSH authentication blocks push, stop after the validated local
commit and provide `git push -u origin codex/build-001-canonical-contracts`.
Do not substitute another transport or claim a pushed branch, PR or remote CI
without evidence.
