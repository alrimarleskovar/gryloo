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
by explicit `NOT_APPLICABLE` statuses; licensing ambiguity by DEC-0008 and the preserved licensing amendment; and
unapproved advancement by the next-build gate.

This document does not claim that future runtime threats are mitigated.

## BUILD-001 contract boundary

Authorization mode remains `NONE`; financial enforcement is `NOT_ENFORCED`.
Contracts describe intent, observations, requests for authority, and execution
records. Validating those descriptions grants no financial permission.

Untrusted serialized artifacts enter through `parseArtifactBytes`. Fatal UTF-8
decoding rejects invalid bytes and BOM. The reviewed tokenizer feeds a bounded
grammar and decoded-key guard before object construction: duplicate keys,
escape-equivalent aliases, trailing documents, malformed JSON, and unpaired
surrogates are rejected. Closed schemas then validate shapes and links. Native
monetary quantities use integer strings; unsafe numeric values are rejected.
Object-only validation cannot establish whether original JSON had duplicate keys.

Explicit field projections and length-framed domain separation bind canonical
artifact meaning. Revision conflicts, invalidation, and impossible hierarchical
transitions fail closed. These functions neither persist state nor authorize
retry, signature, submission, cancellation, or reconciliation.

Fixed Node and pnpm archives are verified before extraction. Direct versions
and registry integrities are pinned; new resolutions observe a seven-day release
age, strict peers, and license review. CI disables lifecycle scripts, checks the
frozen lockfile, audits dependencies, and validates an ephemeral SBOM. No
third-party Actions, automatic package-manager substitution, or retained SBOM
artifact is claimed. Dependency or parser discrepancies require human review.

Governance preserves baseline source, legal, historical, and asset bytes,
enforces the exact authorized path list, scans repository sources for basic
secret indicators, and requires explicit approval before any subsequent build.
These checks supplement review; they cannot detect all secrets or future
runtime vulnerabilities.

The BUILD-002 reference application is a local-only mocked shell. Browser
tests abort and report every unexpected external request; a dedicated negative
test proves the guard fails on an intercepted synthetic attempt. The locked
dependency verifier checks all 245 registry entries, including optional
platform packages, and pins 16 reviewed exceptions by exact identity, SPDX,
SRI and graph route. Future distribution of Sharp/libvips binaries has a
separate release-compliance gate.
