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
| Publish packages or advance to BUILD-002 | Human owner | Separate explicit approval | NOT_APPROVED |

No Mode B mechanism is selected, certified, deployed, or implemented.

ADR-0002 covers contract and toolchain decisions only. Authorization mode remains
`NONE`. A valid policy, payload hash, journal entry, or evidence bundle is data;
it is not a signature, permission, or independently enforced control.
