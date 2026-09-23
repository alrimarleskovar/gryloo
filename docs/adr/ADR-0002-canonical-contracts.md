# ADR-0002 — Canonical artifact contracts

- Status: `ACCEPTED`
- Decision date: 2026-09-22
- Approval: explicit human approval of the complete revised BUILD-001 plan
- Scope: BUILD-001 only; DEC-0009 and DEC-0010

## Context

Artifact identity must be stable across languages before any reference compiler
or financial executor is implemented. Object validation cannot prove that raw
JSON had unique keys. Hashes need an unambiguous byte profile, fixed field
coverage, and compatible exported contracts.

## Decision

Use two private Apache-2.0 packages at version `0.1.0`:
`@defi-workflow-engine/workflow-contracts` and
`@defi-workflow-engine/action-registry`. They use TypeScript NodeNext and ESM
only. Public export maps contain exactly the root API, `./schemas`,
`./schemas/v1/*.schema.json`, and `./package.json`. TypeBox is the schema source;
Ajv validates Draft 7 schemas. Checked-in schema JSON is generated deterministically
using verified Node and compiled package modules with no additional dependency.

Use reviewed `@streamparser/json@0.0.26` with a bounded tokenizer wrapper that
rejects duplicate decoded keys before object construction. Fatal UTF-8 decoding,
BOM rejection, single-document grammar, unsafe-number rejection, and decoded
string surrogate checks precede schema validation. Tests include escaped-key
aliases and lone `\uD800` and `\uDC00` surrogates.

Structured hashes use explicit field projections, RFC 8785 canonicalization,
and UTF-8 without BOM. The preimage is `ASCII("DWE-HASH")`, byte `0x00`, profile
byte `0x01`, big-endian unsigned 16-bit domain-byte length, ASCII domain bytes,
big-endian unsigned 64-bit payload-byte length, then payload bytes. The domain
is outside canonical JSON. SHA-256 output is `0x` and 64 lowercase hexadecimal
digits. Raw response, payload, and intent fixtures hash exact bytes under their
own domains. See [the profile](../contracts/CANONICALIZATION_V1.md).

Use approved exact pins, an integrity-bearing lockfile, strict peers, seven-day
minimum release age, and disabled lifecycle scripts. CI uses runner Git, Bash,
and Python without third-party Actions. Python verifies official Node.js
`24.21.0` and pnpm `11.22.0` archives before extraction. Corepack and automatic
toolchain substitution are disabled. Any approved-pin, integrity, peer, license,
parser, download, or transitive review discrepancy requires human review before
substitution.

The exact pnpm SBOM command validates temporary CycloneDX 1.6 output and emits
its SHA-256 to logs and the job summary. No uploaded or retained SBOM artifact
is claimed. Package LICENSE files are byte-for-byte copies of the verified
`LICENSES/Apache-2.0.txt`.

## Human-approved parser declaration compatibility correction

TypeScript 5.9.3 with `strict: true`, `exactOptionalPropertyTypes: true`,
and `skipLibCheck: false` identified TS2430 in the pinned parser's base
`ParsedElementInfo` declaration. The owner approved pnpm's built-in
`patchedDependencies` mechanism for `@streamparser/json@0.0.26`.
The upstream tarball SRI remains
`sha512-46597LNFI+MFdUnzX2QJWwmdTRdq0XVD+vVNJTtGVzIrnCuhG9pFo1OAzbNBqci8UJgk/X5KJZ6LcV+y7PTuDQ==`.
The patch SHA-256 and resulting pnpm `patch_hash` are
`3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6`.
The patched-package identity is
`@streamparser/json@0.0.26(patch_hash=3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6)`.

Only `dist/mjs/utils/types/parsedElementInfo.d.ts` and
`dist/cjs/utils/types/parsedElementInfo.d.ts` change: in each base
interface, optional `parent` and `key` types explicitly include
`undefined`. No JavaScript or runtime behavior changes. The patch is
`THIRD_PARTY_PATCH` under upstream MIT, and the official copied MIT text
is `third_party/licenses/streamparser-json-MIT.txt` (SHA-256
`b0022ea53a62be6b1f54f89f80d9271e395df2d12a63b4f8f0bf1a916a4e8094`)
from the verified version 0.0.26 npm tarball. Neither path is classified
as Gryloo-authored Apache material.

## Compatibility and consequences

The v1 wire/hash fixtures are immutable. Patch releases in `0.1.x` cannot alter
v1 meaning. Breaking wire/hash changes require a new schema/profile, migration
fixtures, explicit review, and a package minor increment before 1.0; breaking
public API changes after 1.0 require a major increment. Publication remains
unapproved. Language-neutral hexadecimal vectors and independent Python framing
verification test interoperability without introducing a Rust implementation.

Contract validation, state transitions, and capability declarations create no
financial authority. Authorization mode is `NONE`; financial enforcement is
`NOT_ENFORCED`. BUILD-002, protocol integration, execution, and managed-plane
components are excluded. ADR-0001 remains `PROPOSED` and byte-identical.

## Verification

The [approved plan](../builds/BUILD-001-PLAN.md) defines exact files and gates.
The [build report](../builds/BUILD-001-REPORT.md) records demonstrated results;
accepting this decision does not itself assert test completion.
