# Authority matrix

`NOT_ENFORCED` means no financial enforcement control exists in BUILD-001. Documentation,
UI checks, and monitoring do not become independent enforcement.

| Rule | Authority | Enforcement location | Current state |
|---|---|---|---|
| Approve governance scope | Human owner | Repository review and Git history | ENFORCED |
| Apply AI financial proposal | User or delegated authority | NOT_ENFORCED | NOT_IMPLEMENTED |
| Mode A exact payload or intent binding | User signature | NOT_ENFORCED | NOT_IMPLEMENTED |
| Mode B maximum policy limits | Independently enforced mechanism | NOT_ENFORCED | PROPOSED_ONLY |
| Mode C managed execution | Explicit future policy | NOT_ENFORCED | NOT_IMPLEMENTED |
| Pause, revoke, cancel, or refund execution | Future authority boundary | NOT_ENFORCED | NOT_IMPLEMENTED |
| Implement BUILD-001 contracts | Human owner | Explicit 2026-09-22 approval, approved plan, and exact-scope governance checks | APPROVED |
| Accept serialized artifact contracts | Pure validation rules | Raw-byte ingress followed by closed schema validation | CONTRACT_VALIDATION_ONLY |
| Validate revision, invalidation, or state transition | Pure contract rules | Contract package functions; no persistence or execution | CONTRACT_VALIDATION_ONLY |
| Review mocked artifact links, revision binding and freshness | Deterministic application review | NOT_ENFORCED; client-side reference linter and access guard only | APPLICATION_REVIEW_ONLY |
| Publish packages or implement later BUILD-003 stages | Human owner | Separate explicit approval | NOT_APPROVED |

| BUILD-002 reference shell, exact dependency exceptions and legal notice copies | Human owner | [Approved BUILD-002 plan](builds/BUILD-002-PLAN.md), [report](builds/BUILD-002-REPORT.md), [third-party notices](../THIRD_PARTY_NOTICES.md) | APPROVED |
| BUILD-003A | Human owner | DEC-0018 and [approved plan](builds/BUILD-003A-PLAN.md), exact Section 11 scope | APPROVED |
| BUILD-003B | Human owner | DEC-0019 and [approved plan](builds/BUILD-003B-PLAN.md), exact Section 11 scope | APPROVED |
| BUILD-003C or financial execution | Human owner | No approval record | NOT_APPROVED |

No Mode B mechanism is selected, certified, deployed, or implemented.

ADR-0002 covers contract and toolchain decisions only. Authorization mode remains
`NONE`. A valid policy, payload hash, journal entry, or evidence bundle is data;
it is not a signature, permission, or independently enforced control.

BUILD-003B mocked Quote/State Artifacts, Artifact Sets and Simulation Bundles
are synthetic data. They carry literal non-executable review results, keep the
canonical workflow state at `DRAFT`, and create no Authorization Policy,
Strategy Manifest, Execution Plan, payload or intent hash. Their hashes and
`MOCKED` provenance identify data; they are not authenticity proof or an
enforcement location.
