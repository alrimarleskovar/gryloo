# Requirements registry

Source references below point to `docs/specs/MASTER_SPEC_V3.2.md` and the Master
Prompt. Evidence for this build is governance evidence, not financial evidence.

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
| B000-NEXT-001 | BUILD-001 remains a non-approved candidate. | Build protocol | Next-build file | SATISFIED |

Canonical artifacts are Semantic Workflow IR, Quote and State Artifacts,
Simulation Bundle, Authorization Policy, Strategy Manifest, Execution Plan,
Execution Journal, and Evidence Bundle. Canonical identifiers are
`semanticWorkflowHash`, `artifactSetHash`, `simulationHash`, `policyHash`,
`manifestHash`, `payloadHash` or `intentHash`, `executionAttemptId`, and
`evidenceBundleHash`.
