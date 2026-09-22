# BUILD-000 — Constitution, naming, and governance decisions

## 1. Single objective

Establish Gryloo's versioned product constitution, governance controls,
traceability, proposed Mode B decision framework, evidence taxonomy, licensing
boundaries, and governance-oriented CI without application scaffolding,
dependencies, runtime code, or financial functionality.

## 2. Relationship to v3.2

The canonical sources are `docs/specs/MASTER_SPEC_V3.2.md` and
`prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md`. This build covers
product principles, canonical artifact separation, authorization, security,
Phase 0, acceptance criteria, open-source strategy, and decision gates.

Requirements are `B000-BRAND-001`, `B000-NAMESPACE-001`, `B000-SOURCE-001`,
`B000-ARTIFACT-001`, `B000-HASH-001`, `B000-EVIDENCE-001`,
`B000-AUTHORITY-001`, `B000-AUTHORITY-002`, `B000-LICENSE-001`, `B000-IP-001`,
`B000-SECURITY-001`, `B000-TRACEABILITY-001`, `B000-SCOPE-001`, and
`B000-NEXT-001`. Identifiers follow `BUILD-NNN`, `ADR-NNNN`, `DEC-NNNN`, and
`B000-CATEGORY-NNN`.

Chat, canvas, and partner surfaces must share one Semantic Workflow IR. Intent,
observations, simulation, policy, Manifest, planning, journal state, and evidence
remain separate. AI is not financial authority. No P1–P14 primitive is certified.
Build 001 is only a candidate and is `NOT_APPROVED`.

## 3. Authorized scope

- Move the Master Spec to its canonical path without changing a byte and update
  new references.
- Establish the permanent governance documents, terminology, identifier rules,
  scope controls, traceability, truthful status, and Build 000 report.
- Treat visual references as direction only; prohibit copied branding and safety
  claims unsupported by a named enforceable control.
- Freeze the artifact and hash vocabulary listed in `docs/REQUIREMENTS.md`.
- Create only a `PROPOSED` Mode B ADR covering alternatives, selection and
  enforcement criteria, threats, bypass tests, and unresolved decisions.
- Document intended licensing boundaries, `BLOCKED_PENDING_IP_OWNERSHIP`, the
  repository prohibition on proprietary managed implementation, and a `DEFERRED`
  CLA decision.
- Add GitHub Actions governance CI using runner-provided shell and Python only.
- Mark dependency scanning and SBOM generation `NOT_APPLICABLE` while no
  dependency manifest exists; produce no placeholder evidence.
- Record Build 000's evidence environment and outcome as `NOT_APPLICABLE`.

## 4. Out of scope

Application or monorepo scaffolding, package or lock files, dependencies,
schemas, adapters, runtime configuration or code, wallets, signatures,
transactions, intents, protocols, contracts, Mode A/B/C execution, financial
tests, fork/testnet/mainnet activity, proprietary managed implementation, final
legal files, a CLA, an SBOM, and any Build 001 work are out of scope. The Master
Spec contents, Master Prompt, visual assets, `.gitignore`, and history are not
modified.

## 5. Acceptance criteria

- [x] The baseline and byte-preserving Master Spec move are recorded.
- [x] New references use the canonical path; governing source contents are intact.
- [x] Brand, namespace, artifact, hash, evidence, authority, and ID terms are fixed.
- [x] Requirements map to source, checks, evidence, and status.
- [x] The authority matrix names an enforcement location or `NOT_ENFORCED`.
- [x] ADR-0001 remains `PROPOSED` and selects or implements nothing.
- [x] Intended licenses and `BLOCKED_PENDING_IP_OWNERSHIP` are explicit; no final
  license or notice file exists; CLA adoption is `DEFERRED`.
- [x] Governance CI uses no external action and makes no application-coverage claim.
- [x] Dependency scanning and SBOM generation are `NOT_APPLICABLE` and no SBOM exists.
- [x] Status and next-build documents state no product exists and Build 001 is
  `NOT_APPROVED`.
- [x] No dependency, scaffolding, runtime code, or financial operation was added.

## 6. Required tests

Unit, integration, E2E, typecheck, application lint, dependency scanning, SBOM,
and financial checks are `NOT_APPLICABLE`. Governance checks validate required
files/headings, internal paths, unique and well-formed IDs, deprecated-name and
unsupported-claim exclusions, basic secret patterns, authority enforcement
locations, forbidden files, and the byte-preserving source move. Manual review
confirms all decision statuses.

## 7. Authority and artifacts

Authorization mode is `NONE`. ADR-0001 is only a `PROPOSED` selection framework;
final selection needs separate explicit human approval. No runtime canonical
artifact or product hash exists. The file digest proving the specification move
is not a Gryloo artifact hash. Runtime invalidation, revocation, and cancellation
are `NOT_APPLICABLE`. Documentation, UI, monitoring, and application checks must
never be represented as independent enforcement.

## 8. Security impact

Protected assets include thesis, repository and source provenance, future
artifact and authorization boundaries, secrets, CI provenance, IP status, and
brand identity. Trust boundaries include human versus AI authority, canonical
sources versus implementation, proposed versus approved decisions, application
checks versus independent enforcement, public versus private components, and CI
versus external actions. Controls include source digests, stable IDs, registries,
scope and authority matrices, explicit statuses, secret checks, no external CI
actions, and truthful reports.

## 9. Evidence target

Environment: `NOT_APPLICABLE`. Outcome: `NOT_APPLICABLE`. Build 000 must not use
financial environment or outcome labels. Governance evidence comprises the Git
baseline, identical before/after SHA-256 digest, CI results, and manual review.

## 10. License impact

The intended model is Apache-2.0 for integration and standardization surfaces,
AGPL-3.0-only for the public reference implementation, and private/proprietary
for managed operational components. No proprietary managed implementation may
enter this repository. IP ownership and final legal files are
`BLOCKED_PENDING_IP_OWNERSHIP`; `LICENSE`, `LICENSE-APACHE-2.0`, and `NOTICE` are
not created. CLA adoption is `DEFERRED`. There are no dependencies. No external
GitHub Action is used.

## 11. Expected files

Move `docs/MASTER_SPEC_V3.2.md` to `docs/specs/MASTER_SPEC_V3.2.md`. Create the
Build 000 plan/report, status, next-build, decisions, requirements, scope,
security, authority, evidence, license-map, proposed ADR, trademark, and
governance-workflow files. Modify only `README.md`. Do not modify the governing
source contents, assets, `.gitignore`, or history. Do not create legal files,
CLA files, manifests, lockfiles, workspace configuration, application/package
directories, schemas, adapters, runtime code, tests for a nonexistent app, or SBOM.

## 12. Risks and rollback

Risks include source mutation or duplication, stale references, premature Mode B
selection, false licensing or evidence claims, public inclusion of private code,
mutable CI dependencies, misleading coverage, copied branding, unsupported
safety claims, and automatic advancement. A digest mismatch requires immediate
restoration. Rejection after commit is handled by reverting the single Build 000
commit without rewriting history; decisions are superseded, not silently edited.

## 13. Questions requiring human decision

- Mode B mechanism, chain, account model, deployment, executor boundary, and
  revocation path: unresolved; explicit later approval required.
- Formal IP ownership and final legal files: `BLOCKED_PENDING_IP_OWNERSHIP`.
- CLA: `DEFERRED` until contributions or dual licensing matter.
- Build 001 canonical artifact contracts: candidate only, `NOT_APPROVED`.
