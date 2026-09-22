# Security model

## Build 000 posture

BUILD-000 has authorization mode `NONE`, no assets under execution, and no
financial functionality. It protects governance integrity, provenance, secrets,
future trust boundaries, IP status, and brand identity.

## Trust boundaries

- Human approval versus AI proposals.
- Canonical specification and prompt versus implementation.
- Proposed ADRs versus approved decisions.
- Application checks and monitoring versus independent enforcement.
- Public repository content versus private managed operations.
- Repository workflow versus third-party automation.

## Threats and controls

Source mutation is controlled by a byte digest; scope drift by the registry and
scope guard; false authority claims by the authority matrix; premature Mode B
selection by `PROPOSED` status; secret disclosure by basic pattern checks;
supply-chain exposure by using no external workflow actions; misleading evidence
by explicit `NOT_APPLICABLE` statuses; licensing ambiguity by the IP blocker; and
unapproved advancement by the next-build gate.

This document does not claim that future runtime threats are mitigated.
