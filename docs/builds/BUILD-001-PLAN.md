# BUILD-001 — Canonical artifact contracts

Approved plan: **Revised proposed BUILD-001 plan — Canonical artifact contracts**.
The human owner explicitly approved implementation on 2026-09-22, including the
six compatibility and CI resolutions and the additional lone-surrogate tests.
This record does not authorize BUILD-002, publication, financial execution, or
selection of Mode B. Work starts from clean, synchronized `main` at
`4055b39153046db59195c58270862f321ea75e5f` on
`codex/build-001-canonical-contracts`.

## 1. Single objective

Define and verify versioned, interoperable canonical artifact contracts, their
hashes, invalidation rules, revision conflicts, hierarchical states, and a
declarative Action Registry without protocol integration or financial execution.

## 2. Relationship to v3.2

- Sources, in authority order: Master Prompt, Master Spec v3.2, repository
  governance documents, and preserved BUILD-000 records and licensing amendment.
- Master Spec sections 7, 8, 12, 19, and 20; Master Prompt Build 001.
- Requirements: B001-ARTIFACT-001, B001-RAW-001, B001-HASH-001,
  B001-INVALIDATION-001, B001-REVISION-001, B001-STATE-001, B001-REGISTRY-001,
  B001-COMPATIBILITY-001, B001-TOOLCHAIN-001, B001-DEPENDENCY-001,
  B001-LICENSE-001, B001-GOVERNANCE-001, and B001-EVIDENCE-001.
- Preserve separation of semantic intent, observations, simulation, requested
  authority, manifest, execution description, journal, and evidence.
- BUILD-000 and its licensing amendment are historical dependencies. No
  financial primitive has P1–P14 certification.

## 3. Authorized scope

- Two private Apache-2.0 workspace packages, TypeScript contracts, TypeBox Draft 7
  schemas, Ajv validation, pure state and revision checks, and an Action Registry.
- Nine workflow schema documents: the eight artifact families plus Artifact Set;
  one registry schema. Fixtures represent data contracts only.
- Raw serialized-input validation before object construction; deterministic JCS
  projection and domain-separated SHA-256; explicit field coverage.
- Compatibility fixtures, security-negative tests, independent hash-vector
  verification, deterministic schema export, and package export checks.
- Exact dependency pins, lockfile, release-age and peer checks, dependency and
  license review, ephemeral SBOM validation, and CI without external Actions.
- ADR-0002 and scope-aware governance updates, with truthful plan and report.

## 4. Out of scope

BUILD-002; DApp, chat, canvas, API, database, worker, wallet connection, protocol
adapter, transaction construction, signing, submission, live quote, financial
simulation, reconciliation implementation, and managed-plane components.
No Mode A/B/C execution, financial enforcement, primitive certification, package
publication, deployment, CLA adoption, or modification of ADR-0001.

## 5. Acceptance criteria

- All declared artifacts reject invalid shapes, unknown properties, unsafe
  numbers, float money, malformed identities, and broken required links.
- Duplicate decoded keys are rejected at byte ingress, including escaped-key
  aliases, before ordinary object validation. Malformed/trailing JSON, invalid
  UTF-8, BOM, and escaped unpaired surrogates are rejected.
- Hashes conform byte-for-byte to the profile below; every field is classified;
  independent-language vectors cover every domain and meaningful edge case.
- Material changes invalidate the documented downstream artifacts and authority;
  stale base revisions fail without silently replacing current state.
- All four journal levels are represented; unknown submission outcomes and
  recovery states do not imply permission to retry or execute.
- Public package identities, exports, schema IDs, ESM behavior, and version rules
  match this plan. Exported schema bytes are reproducible.
- Exact toolchain bootstrap, dependency checks, tests, governance, workflow
  syntax, whitespace, license copies, preserved hashes, and changed-file scope
  pass. Report any unmet gate honestly.
- Commit and push the approved branch with the requested message and open a PR
  to `main` with the same title; never merge. If SSH blocks noninteractive push,
  stop after the validated local commit and give the manual push command.

## 6. Required tests

- Unit: schemas, canonical projections, hash framing, registry capabilities,
  revisions, invalidation, and hierarchical transitions.
- Contract integration: raw bytes through parser and Ajv to canonical hashes;
  all fixture links; package exports and deterministic generated schemas.
- Failure/adversarial: duplicates at root/nesting and escape-equivalent keys;
  valid repeated keys in distinct objects; malformed JSON, trailing document,
  invalid UTF-8, BOM, `\uD800`, `\uDC00`, unsafe integers, forbidden runtime
  fields, numeric monetary values, invalid hashes, revision conflicts, and
  impossible state transitions.
- Compatibility: frozen v1 fixtures and independent Python standard-library
  framing/digest verification, with language-neutral hexadecimal byte vectors.
- Supply chain: exact versions and integrities, engines, peers, seven-day
  minimum age for new resolutions, transitive licenses, audit, and SBOM.
- Governance: exhaustive path classification, exact create/modify scope, no
  external Actions, basic secret checks, protected hashes, and ADR-0001 status.
- Product E2E, network/protocol integration, and financial tests:
  `NOT_APPLICABLE`.

## 7. Authority and artifacts

Authorization mode: `NONE`. Contracts may describe modes and enforcement
locations; descriptions grant no authority. Financial enforcement:
`NOT_ENFORCED`. ADR-0002 records only the approved contract/toolchain decisions.
ADR-0001 stays `PROPOSED` and byte-identical.

Raw ingress is `parseArtifactBytes(bytes: Uint8Array, artifactKind)`.
`@streamparser/json@0.0.26` provides the reviewed tokenizer and parser; a narrow
wrapper tracks object grammar and per-object sets of decoded keys before
forwarding tokens to object construction. UTF-8 decoding is fatal, without BOM;
each decoded string is checked for unpaired UTF-16 surrogates. Only one complete
JSON document is accepted. Bounds cover input length, nesting, and key count.
Schema validation follows raw validation. Object-only validation cannot attest
to the absence of duplicate source keys. No Unicode normalization is applied.

Structured hashes use explicit validated projections, RFC 8785 JCS, and UTF-8
without BOM. `schemaVersion: "1.0.0"` is included. Own hash fields, signatures,
and runtime fields are excluded or rejected as documented for each artifact.
Raw response, payload, and intent hashes use exact bytes only; this build does
not construct executable payloads or intents.

The exact preimage is:

```text
ASCII("DWE-HASH") || 0x00 || 0x01 ||
uint16_be(domainAsciiByteLength) || ASCII(domain) ||
uint64_be(dataByteLength) || dataBytes
```

The domain is outside the JSON envelope. Profile version is the single byte
`0x01`. Lengths are unsigned big-endian integers. String concatenation without
these lengths is prohibited. Output is `0x` followed by 64 lowercase hexadecimal
characters from SHA-256. No platform newline or terminator is appended.

| Hash | Exact domain |
|---|---|
| semanticWorkflowHash | defi-workflow-engine/semantic-workflow |
| quote/state artifact hash | defi-workflow-engine/quote-state-artifact |
| artifactSetHash | defi-workflow-engine/artifact-set |
| simulationHash | defi-workflow-engine/simulation-bundle |
| policyHash | defi-workflow-engine/authorization-policy |
| manifestHash | defi-workflow-engine/strategy-manifest |
| execution plan hash | defi-workflow-engine/execution-plan |
| journal entry hash | defi-workflow-engine/execution-journal-entry |
| evidenceBundleHash | defi-workflow-engine/evidence-bundle |
| rawResponseHash | defi-workflow-engine/raw-response |
| payloadHash | defi-workflow-engine/payload |
| intentHash | defi-workflow-engine/intent |

Artifact-set member hashes sort by raw digest bytes and reject duplicates.
Set-valued graph fields have documented stable order; meaningful sequences
retain order. Journal entries bind sequence and predecessor hash; superseding
evidence binds its predecessor. `hash-vectors.json` contains input value or raw
hex, canonical payload hex, full preimage hex, and digest for every domain.
TypeScript, Rust, and other SDKs can independently implement these byte rules;
BUILD-001 adds no Rust implementation or dependency.

Material semantic edits invalidate dependent observations, simulations,
policies, manifests, execution plans, and authorization. Observational refresh
does not mutate semantic intent. Expiration, authority-affecting changes,
revocation, cancellation, and reconciliation remain distinct concepts.
Transition validation does not persist state or enact these operations.

## 8. Security impact

Protected assets are contract meaning, hash identity, provenance, repository
integrity, and future authority boundaries. Trust boundaries are raw bytes to
objects, objects to canonical hashes, declarations to enforcement, dependencies
to CI, and AI proposals to human authorization. Controls include bounded strict
ingress, closed schemas, integer native-unit amounts, explicit hash projections,
fail-closed revision/state checks, fixed toolchain and package integrities,
ignored lifecycle scripts, license and dependency review, and preserved hashes.
No private keys, credentials, founder records, or local machine information
belong in committed files or reports.

## 9. Evidence target

Build evidence environment and financial outcome are `NOT_APPLICABLE`.
Synthetic contract fixtures may carry enum values to exercise schemas; they
are not demonstrations of simulation, execution, reconciliation, or enforcement.
No financial permission or active asset authority is created.

## 10. License impact

Every Gryloo-authored created or modified path listed below is Apache-2.0.
The pnpm parser patch and copied upstream MIT license have separate third-party
classifications under MIT and are not Gryloo-authored Apache material. The two
package `LICENSE` paths are unmodified official-text copies, copied byte-for-byte
from `LICENSES/Apache-2.0.txt`; no reconstructed or customized license text.
Third-party dependencies retain their declared licenses. No AGPL implementation
is introduced. Asset exclusions and reserved/prohibited boundaries remain.

| Direct dependency | Exact version | Declared license | Scope |
|---|---|---|---|
| @streamparser/json | 0.0.26 | MIT | Runtime |
| @sinclair/typebox | 0.34.52 | MIT | Runtime |
| ajv | 8.20.0 | MIT | Runtime |
| canonicalize | 5.0.0 | Apache-2.0 | Runtime |
| typescript | 5.9.3 | Apache-2.0 | Development |
| turbo | 2.10.12 | MIT | Development |
| vitest | 5.0.0 | MIT | Development |
| vite | 8.3.0 | MIT | Development; required Vitest peer |
| eslint | 10.10.0 | MIT | Development |
| @eslint/js | 10.0.1 | MIT | Development |
| typescript-eslint | 8.70.0 | MIT | Development |
| @types/node | 24.13.4 | MIT | Development |
| pnpm | 11.22.0 | MIT | Verified toolchain |

Use exact manifest versions, `workspace:0.1.0`, a committed integrity-bearing
lockfile, strict peer checking, `minimumReleaseAge: 10080`, and
`--frozen-lockfile --ignore-scripts` in CI. No floating ranges, silent upgrades,
automatic package-manager substitution, or unreviewed install-script execution.
Any discrepancy with the approved versions, digests, licenses, peer constraints,
parser behavior, downloads, or transitive review stops work for human review.

## 11. Expected files

The following is the exhaustive create list. All implied parent directories are
in scope; no additional tracked file is authorized.

```text
.node-version
.npmrc
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
tsconfig.base.json
eslint.config.mjs
scripts/bootstrap-ci.py
scripts/export-schemas.mjs
.github/workflows/contracts.yml
packages/workflow-contracts/package.json
packages/workflow-contracts/tsconfig.json
packages/workflow-contracts/LICENSE
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/src/schemas.ts
packages/workflow-contracts/src/common.ts
packages/workflow-contracts/src/semantic-workflow.ts
packages/workflow-contracts/src/quote-state.ts
packages/workflow-contracts/src/artifact-set.ts
packages/workflow-contracts/src/simulation.ts
packages/workflow-contracts/src/authorization-policy.ts
packages/workflow-contracts/src/strategy-manifest.ts
packages/workflow-contracts/src/execution-plan.ts
packages/workflow-contracts/src/execution-journal.ts
packages/workflow-contracts/src/evidence-bundle.ts
packages/workflow-contracts/src/raw-json.ts
packages/workflow-contracts/src/canonical.ts
packages/workflow-contracts/src/invalidation.ts
packages/workflow-contracts/src/revision.ts
packages/workflow-contracts/src/state-transitions.ts
packages/workflow-contracts/test/contracts.test.ts
packages/workflow-contracts/test/raw-json.test.ts
packages/workflow-contracts/test/canonical.test.ts
packages/workflow-contracts/test/invalidation.test.ts
packages/workflow-contracts/test/revision-state.test.ts
packages/workflow-contracts/schemas/v1/semantic-workflow.schema.json
packages/workflow-contracts/schemas/v1/quote-state-artifact.schema.json
packages/workflow-contracts/schemas/v1/artifact-set.schema.json
packages/workflow-contracts/schemas/v1/simulation-bundle.schema.json
packages/workflow-contracts/schemas/v1/authorization-policy.schema.json
packages/workflow-contracts/schemas/v1/strategy-manifest.schema.json
packages/workflow-contracts/schemas/v1/execution-plan.schema.json
packages/workflow-contracts/schemas/v1/execution-journal.schema.json
packages/workflow-contracts/schemas/v1/evidence-bundle.schema.json
packages/action-registry/package.json
packages/action-registry/tsconfig.json
packages/action-registry/LICENSE
packages/action-registry/src/index.ts
packages/action-registry/src/schemas.ts
packages/action-registry/src/actions.ts
packages/action-registry/src/capabilities.ts
packages/action-registry/test/registry.test.ts
packages/action-registry/schemas/v1/action-registry.schema.json
tests/compatibility/v1/semantic-workflow.json
tests/compatibility/v1/artifact-set.json
tests/compatibility/v1/simulation-bundle.json
tests/compatibility/v1/authorization-policy.json
tests/compatibility/v1/strategy-manifest.json
tests/compatibility/v1/execution-plan.json
tests/compatibility/v1/execution-journal.json
tests/compatibility/v1/evidence-bundle.json
tests/compatibility/v1/hash-vectors.json
tests/compatibility/v1/revision-conflicts.json
tests/compatibility/v1/invalidation-cases.json
tests/compatibility/v1/state-transitions.json
tests/compatibility/v1/action-registry.json
tests/compatibility/v1/raw-json/valid-distinct-nested-keys.json
tests/compatibility/v1/raw-json/valid-escaped-string-value.json
tests/compatibility/v1/raw-json/invalid-duplicate-root.json.txt
tests/compatibility/v1/raw-json/invalid-duplicate-nested.json.txt
tests/compatibility/v1/raw-json/invalid-escaped-equivalent-key.json.txt
tests/compatibility/v1/raw-json/invalid-trailing-document.json.txt
tests/compatibility/v1/raw-json/invalid-utf8.hex
docs/adr/ADR-0002-canonical-contracts.md
docs/contracts/CANONICALIZATION_V1.md
docs/contracts/INVALIDATION_V1.md
docs/contracts/COMPATIBILITY_V1.md
docs/builds/BUILD-001-PLAN.md
docs/builds/BUILD-001-REPORT.md
patches/@streamparser__json@0.0.26.patch
third_party/licenses/streamparser-json-MIT.txt
```

Modify only:

```text
.gitignore
.github/workflows/governance.yml
README.md
docs/STATUS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/AUTHORITY_MATRIX.md
docs/EVIDENCE_LEVELS.md
docs/DECISIONS.md
docs/LICENSE_MAP.md
```

Do not touch any other existing path, especially all BUILD-000 records,
ADR-0001, Master Spec, Master Prompt, root LICENSE/NOTICE/TRADEMARKS, official
license texts, and `docs/assets/**`. Ignored build output, dependency stores,
and ephemeral toolchain/SBOM evidence are not tracked deliverables.

## 12. Risks and rollback

Risks include parser normalization before checks, ambiguous hashes, accidental
wire changes, incomplete field coverage, generated-schema drift, supply-chain
mismatch, authority overclaims, and false evidence. Stop for approved-pin or
behavior discrepancies. Correct implementation errors without weakening tests.
Rollback is a reviewable revert of the single build commit; never rewrite
BUILD-000 history or alter frozen v1 compatibility records silently.

Implementation sequence: verify clean synchronized main and create the exact
branch; reverify pins and parser; record this plan; bootstrap the verified
toolchain; resolve and review dependencies; implement schemas and strict ingress;
implement projections, hashes, revision/invalidation/state contracts and registry;
export schemas and create fixtures; update governance and ADR-0002; run the full
suite; write the truthful report; commit; push and open an unmerged PR, subject to
the explicit SSH fallback.

## 13. Questions requiring human decision

BUILD-001 implementation and ADR-0002 are explicitly approved. Mode B selection,
BUILD-002, package publication, protocol integration, and financial execution
remain unapproved. Any approved-pin, integrity, parser, download, or dependency
review discrepancy requires a new human decision before substitution.

## Package identity and compatibility

The root workspace is private. Package identities are
`@defi-workflow-engine/workflow-contracts` and
`@defi-workflow-engine/action-registry`, each version `0.1.0`, `private: true`,
Apache-2.0, ESM-only (`type: module`, TypeScript NodeNext). Each exposes exactly:

```json
{
  ".": {"types": "./dist/index.d.ts", "import": "./dist/index.js"},
  "./schemas": {"types": "./dist/schemas.d.ts", "import": "./dist/schemas.js"},
  "./schemas/v1/*.schema.json": "./schemas/v1/*.schema.json",
  "./package.json": "./package.json"
}
```

Root exports contain documented types, guarded parsing, and pure validation or
transition functions. Schema exports contain read-only schema objects. Source,
tests, and arbitrary internal modules are not public. Checked-in Draft 7 schema
JSON is generated from TypeBox using the verified Node runtime and compiled
package modules; `scripts/export-schemas.mjs --check` compares exact bytes and
adds no dependency. Schema IDs use the neutral namespace and explicit v1 path.
Wire/hash v1 fixtures are immutable. Versions `0.1.x` cannot change v1 meaning;
breaking wire or hash changes need a new schema/profile version, migration
fixtures, package minor change before 1.0, and explicit review. After 1.0,
breaking public API changes require a major version. Publication is unapproved.

## Exact CI bootstrap and SBOM

CI uses runner-provided Git, Bash, and Python on `ubuntu-24.04` (Linux x64) and
contains no `uses:` steps. `scripts/bootstrap-ci.py` uses Python's standard
library and isolated temporary directories. Official sources:

- `https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz`
- `https://nodejs.org/dist/v24.21.0/SHASUMS256.txt`
- `https://registry.npmjs.org/pnpm/-/pnpm-11.22.0.tgz`

Verify Node SHA-256
`fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`
against both the archive and the exact official checksum filename entry.
Verify pnpm publisher SRI before extraction:
`sha512-H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ==`.
Invoke the extracted `bin/pnpm.mjs` with the verified Node binary. No Corepack
activation, automatic package-manager installation, `npx`, floating installer,
or runner-Node fallback; pnpm `pmOnFail: error` makes version mismatch fatal.

Before installation/tests, print `git --version`, `python3 --version`, expected
and actual archive digests, `node --version` (`v24.21.0`), `process.platform` and
`process.arch` (`linux`, `x64`), `node <pnpm>/bin/pnpm.mjs --version` (`11.22.0`),
and root `packageManager` (`pnpm@11.22.0`). Missing archives, checksum entries,
wrong architecture, integrity, or version fail closed without substitution.

After frozen installation, the exact verified pnpm command is:

```sh
node <verified-pnpm>/bin/pnpm.mjs sbom --sbom-format cyclonedx --sbom-spec-version 1.6 --out "$RUNNER_TEMP/build-001.cdx.json"
```

This command and flags were verified against the pnpm `v11.22.0` tagged source
at `pnpm11/deps/compliance/commands/src/sbom/sbom.ts`. Validate the generated
CycloneDX JSON and its component inventory; emit its SHA-256 to logs and
`GITHUB_STEP_SUMMARY`. SBOM generation is ephemeral validation only. No upload
Action, committed SBOM, or retained SBOM artifact is claimed. Timestamps can
change its digest between runs.

## Human-approved declaration compatibility deviation

On 2026-09-22 the human owner approved a declaration-only pnpm
`patchedDependencies` correction for `@streamparser/json@0.0.26` after
TypeScript 5.9.3 reported TS2430 with `strict: true`,
`exactOptionalPropertyTypes: true`, and `skipLibCheck: false`. The
original upstream registry tarball SRI remains
`sha512-46597LNFI+MFdUnzX2QJWwmdTRdq0XVD+vVNJTtGVzIrnCuhG9pFo1OAzbNBqci8UJgk/X5KJZ6LcV+y7PTuDQ==`.
The committed patch SHA-256 and pnpm lockfile `patch_hash` are
`3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6`.
The resulting patched-package identity is
`@streamparser/json@0.0.26(patch_hash=3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6)`.

Only `dist/mjs/utils/types/parsedElementInfo.d.ts` and
`dist/cjs/utils/types/parsedElementInfo.d.ts` change. In each base
`ParsedElementInfo` interface, `parent?: JsonStruct` becomes
`parent?: JsonStruct | undefined` and `key?: JsonKey` becomes
`key?: JsonKey | undefined`. Runtime JavaScript, parsing, tokens,
`ParsedTopLevelElement`, version, compiler settings, and tests are unchanged.
The patch is `THIRD_PARTY_PATCH` under upstream MIT. The copied official
upstream `LICENSE` is `third_party/licenses/streamparser-json-MIT.txt`,
from `https://registry.npmjs.org/@streamparser/json/-/json-0.0.26.tgz`;
its SHA-256 is
`b0022ea53a62be6b1f54f89f80d9271e395df2d12a63b4f8f0bf1a916a4e8094`.
These two paths are the only additions to the approved create list. No
`patch-package` or other patching dependency is added. If this exact correction
fails or another dependency incompatibility appears, stop for human review.

## Approved registry preflight record

The following is the approved planning-time registry record, retained as the
expected metadata for implementation checks. The statement that no package was
installed describes that earlier verification step; installation is now authorized.


I queried the official npm registry’s version metadata and publication history on **22 September 2026**. Every selected exact version exists and predates the seven-day cutoff of **15 September 2026 16:59 UTC**. `—` means the package does **not declare** an engine, not that all engines are supported. Each full `sha512-…` value is the registry `dist.integrity` for that exact version. **No package was installed.**

| Direct package | Version | Published UTC | Node engine | License | Registry integrity |
|---|---:|---|---|---|---|
| `@streamparser/json` | `0.0.26` | 2026-08-21 14:59 | — | MIT | `sha512-46597LNFI+MFdUnzX2QJWwmdTRdq0XVD+vVNJTtGVzIrnCuhG9pFo1OAzbNBqci8UJgk/X5KJZ6LcV+y7PTuDQ==` |
| `@sinclair/typebox` | `0.34.52` | 2026-07-11 21:08 | — | MIT | `sha512-XiMQh7qqVlxZzcVD+kkGMNGMzcTrDMLWI7S4x7z1MkCkbDPrekpZXEUK0eZqZFMuHQg2a2DZOcDIh9o5v3Gonw==` |
| `ajv` | `8.20.0` | 2026-04-24 15:22 | — | MIT | `sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==` |
| `canonicalize` | `5.0.0` | 2026-09-08 20:16 | `>=22` | Apache-2.0 | `sha512-O/NCg79G0/TWoD3Fo6scOMfP4p7/TsxRXVmRo9mEfD6h/5y5o1wtVbKyBO0E2i7FEcqe5tRijyAH/IWHIHMH4w==` |
| `typescript` | `5.9.3` | 2025-09-30 21:19 | `>=14.17` | Apache-2.0 | `sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==` |
| `turbo` | `2.10.12` | 2026-08-25 18:38 | — | MIT | `sha512-AswgMPnpOoaVZHrrSBejETzEbuIA69OVGwfkHwfrY0A23VjWXBANzgq9+OymWOHAIArB7D1+1z498WY8fGg1Jw==` |
| `vitest` | `5.0.0` | 2026-09-03 12:24 | `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` | MIT | `sha512-gpsMNoRhMjMktVxPtstOH4/PJuPyovVaMDr4oDilXaGH1EcqM2OE96SoHT2VIQ6fTGtTjqmHDrEu2X9RQiXf8Q==` |
| `vite` | `8.3.0` | 2026-09-10 11:30 | `^20.19.0 \|\| >=22.12.0` | MIT | `sha512-lhZBVvEHefgE+HQZC9O7EBJgCU/nVzFNl7vkS4RE0APtWLP02/8QVIkQtzBxPquh7lq5/78NHipTj7ODQ6XuyQ==` |
| `eslint` | `10.10.0` | 2026-09-04 14:34 | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | MIT | `sha512-NPXn6r5zl4uET1DAVPaOwzX3rut4c0wcmw3dWJAfOsTM5+TogXo0DDjz8pwm/hL8cyVNpHqeK4JpN0NjnyFFNw==` |
| `@eslint/js` | `10.0.1` | 2026-02-06 22:34 | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | MIT | `sha512-zeR9k5pd4gxjZ0abRoIaxdc7I3nDktoXZk2qOv9gCNWx3mVwEn32VRhyLaRsDiJjTs0xq/T8mfPtyuXu7GWBcA==` |
| `typescript-eslint` | `8.70.0` | 2026-09-07 18:18 | `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` | MIT | `sha512-P/W5cz70/cQAuKfY3xwQMWWTV7BvJ0mAQmi+9mBcsVPaBUpd6Ohpa+fECv9rBFrQcig86jAiNBFNWUqnTjr4pw==` |
| `@types/node` | `24.13.4` | 2026-09-09 18:10 | — | MIT | `sha512-YJ7EqCstVTzIr0fMr7qul/977en+pQHrfmuKIo6Zr9i75Be21dr3MovcfvGtyvi2HAUrRerWps5sMO9I7WaxDw==` |
| `pnpm` toolchain | `11.22.0` | 2026-08-15 17:15 | `>=22.13` | MIT | `sha512-H/hwxMYTPf2I+yr8Rt0T1H8JyXlLQ4xv20fKmMrzvBY4HuC+k6CRuOOCTPAfiJ9G19niCRD7C+GrD7W6qA3WIQ==` |

Registry peer checks resolve the earlier plan’s errors:

- `@eslint/js@10.10.0` **does not exist**. `10.0.1` exists and its optional `eslint: ^10.0.0` peer accepts `10.10.0`.
- Vitest’s **required** `vite: ^6.4.0 || ^7.0.0 || ^8.0.0` peer is satisfied by the newly explicit `vite@8.3.0`.
- Vitest’s optional `@types/node: ^22.0.0 || >=24.0.0`, and Vite’s optional `@types/node: ^20.19.0 || >=22.12.0`, accept `24.13.4`. Vite’s other listed peers are optional and are not proposed.
- `typescript-eslint@8.70.0` requires `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0` and `typescript: >=4.8.4 <6.1.0`; the selected versions satisfy both. [Its published support range](https://typescript-eslint.io/users/dependency-versions/) agrees.

All direct manifests will use exact versions, `save-exact=true`, and no `^`, `~`, or `latest`. Internal dependencies use `workspace:0.1.0`. One committed lockfile pins transitive resolutions and integrity; CI uses `--frozen-lockfile`. A seven-day minimum release age applies to new resolution, with no automatic exception. Transitive license and vulnerability review remains an implementation acceptance gate; this registry check does not replace it.
