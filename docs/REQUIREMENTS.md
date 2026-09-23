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
