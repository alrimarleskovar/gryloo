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

## Governance controls after the BUILD-002 amendment

The BUILD-002 governance rewrite kept its exact-scope, protected-byte,
licensing, patch and attribution checks. It omitted the BUILD-001
secret-indicator, email, Markdown-link, identifier, brand, unsupported-claim,
official-text digest, package-export and heading checks. From the BUILD-002
merge until this amendment, CI did not run those controls. The
[BUILD-002 governance amendment](builds/BUILD-002-GOVERNANCE-AMENDMENT.md)
(DEC-0014) keeps every BUILD-002 check and restores the omitted ones for the
current tree:

- basic secret indicators in every text file, including upstream copies;
- email addresses in Gryloo-authored text, except the two approved patch
  file names;
- relative links in Gryloo-authored Markdown outside fenced code blocks;
- well-formed, unique and registered decision and requirement IDs, gap-free
  decision numbers, and existing ADR files for every ADR reference;
- deprecated names in Gryloo-authored files outside the Master Prompt and the
  governance check itself, and unsupported claims in the README and application
  source;
- official license-text digests and sizes, exact license copies, and digests
  for the specification, prompt, ADRs, historical build records, contract
  profiles, legal notices, assets and visual baselines;
- frozen v1 schema, compatibility-fixture and upstream-legal trees, package
  identities and exports, schema identifiers and strict JSON parsing;
- plan and report headings where the template applies;
- output hygiene: no tracked generated output, local environment file, SBOM,
  CLA file or unapproved manifest, and no whitespace errors in changes.

These remain basic pattern and digest checks. They supplement review and
cannot detect every secret, claim, license issue or runtime vulnerability.
Upstream legal copies are exempt from the checks that concern Gryloo-authored
text but remain pinned by digest and scanned for secret indicators.

## BUILD-003A non-executing authoring boundary

Untrusted chat text, form values, commands and candidate workflow objects are
validated before mutation. The Base registry context is created outside the
editable path and recursively frozen. Exact decimal conversion uses bounded
strings and integers; review findings are deterministic and revision-linked.
Every swap remains unquoted and execution-unavailable, even if a caller forges
review results. The browser request guard still permits only loopback traffic.

The linter is application review, not independent financial enforcement. A
compromised client can misrepresent this UI; no execution authority or financial
safety guarantee exists. The exact BUILD-003A scope gate supplements the
historical BUILD-002 and amendment checks without changing protected files.
