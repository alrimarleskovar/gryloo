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

## BUILD-003B mocked artifact boundary

The browser digest mirrors the frozen DWE-HASH v1 profile for four artifact
kinds and the raw-response domain only; it has no payload, intent or authority
domain. It runs a known-vector self-check before every generation and review;
a failure prevents generation and shows an explicit error. Differential tests
on the pinned toolchain require equal digests and that every input the frozen
implementation rejects is rejected too.

The chain review recomputes every cross-artifact hash and revision link and
rejects tampered, mislinked, authority-bearing or fee- and gas-bearing mocked
artifacts. One synchronous access guard binds content to the exact IR revision
and object and checks expiry by wall clock, backwards clock and monotonic time
on every access and when the tab resumes. Non-current chains hide their numbers
and JSON.

These are application review controls in a client that a compromised browser
could misrepresent. Mocked provenance and hashes are not proof of authenticity
and are not independent financial enforcement. New governance scans reject
authority types, wallet and RPC tokens, network primitives, raw HTML injection
and browser storage in the application and linter sources.

## BUILD-003C read-only observation boundary

The local server alone can send allowlisted JSON-RPC reads to Base when explicitly enabled in development. The browser stays same-origin under a `connect-src 'self'` CSP and the unchanged E2E network guard. The server permits only chain/head/final-block checks, hash-pinned `eth_getCode` and hash-pinned `eth_call` to fixed Base USDC, WETH, factory and QuoterV2 targets with six selectors. Every state read has `{ "blockHash": H, "requireCanonical": true }`; an unsupported form stops the read with no block-number fallback. Size, timeout, rate, attempt, request and breaker limits fail closed. Replay mode makes no network request.

The provider sees the local server IP, request timing, token pair, exact input amount and queried contracts; it sees no user wallet address or browser cookie. The public endpoint is rate-limited and unsuitable for production use. Two HTTP 429 responses stopped its recording at 2/4 attempts and 24/84 requests. DEC-0021 approved Alchemy Free as the sole read provider with a server-only Bearer credential on the fixed `/v2` URL and a separate 3-attempt/63-request cap. The original Alchemy `eth_chainId` request returned HTTP 403, preserving its stopped attempt-1 files at 1/3 attempts and 1/63 requests. The owner reported that the app then had no active network, enabled Base Mainnet only, and approved the DEC-0022 carried-counter continuation. Owner-run attempts 2 and 3 returned 42 HTTP 200 responses, verified both EIP-1898 pinned methods and produced the two required transcripts. Final Alchemy use is 3/3 attempts and 43/63 requests. No further live request is authorized. The credential-free fixture, transcripts and logs contain no key, serialized authorization header or Bearer marker; the key value was never inspected. No paid plan or charge is authorized. The [BUILD-003C report](builds/BUILD-003C-REPORT.md) records the separate immutable stop evidence, final hashes and local acceptance. Observations remain `NOT_EVIDENCE`, never authorization inputs and never a financial execution result.
