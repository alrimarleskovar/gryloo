# Contract compatibility v1

The private `@defi-workflow-engine/workflow-contracts@0.1.0` and
`@defi-workflow-engine/action-registry@0.1.0` packages are ESM-only.
Their public exports are exactly `.`, `./schemas`,
`./schemas/v1/*.schema.json`, and `./package.json`. Internal source,
tests, and arbitrary modules are outside the export map. The ten checked-in
Draft 7 schema files are deterministic outputs of the pinned Node 24.21.0,
TypeScript 5.9.3, and declared workspace dependencies; `pnpm schemas:check`
compares their exact bytes. No floating schema generator is used.

The [v1 fixtures](../../tests/compatibility/v1/hash-vectors.json) freeze
artifact shapes, links, and byte-level hashes for all twelve domains. Raw
ingress fixtures include positive distinct object scopes and negative
duplicate root/nested/escaped-equivalent keys, trailing documents, malformed
JSON, invalid UTF-8, and escaped lone high/low surrogates. The parser uses
the reviewed `@streamparser/json@0.0.26` upstream tarball with the
human-approved declaration-only pnpm patch recorded in
[ADR-0002](../adr/ADR-0002-canonical-contracts.md). Its runtime parser and
security-negative tests are unchanged.

A `0.1.x` patch must preserve v1 wire and hash meaning. Breaking wire/hash
changes require a new schema and hash profile, migration fixtures, explicit
review, and a package minor increment before 1.0. After 1.0, breaking public
API changes require a major increment. Publication is not approved.

Authorization mode is `NONE`; financial enforcement is `NOT_ENFORCED`.
Fixtures are synthetic data-contract examples, not evidence of live quotes,
financial simulation, transaction construction, execution, reconciliation, or
financial outcomes. BUILD-002 and Mode B remain outside this build.
