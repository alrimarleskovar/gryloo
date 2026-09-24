# Gryloo

Gryloo is a non-custodial, conversational and visual compiler plus bounded
executor for multichain DeFi workflows. Chat, canvas, and integrations will use
one canonical Semantic Workflow IR; AI proposals never constitute financial
authority.

## Current status

**BUILD-001** is approved for canonical artifact contracts, strict serialized
input validation, deterministic hashes, revision and state checks, and a
declarative Action Registry. The private ESM packages grant no financial
authority and do not execute workflows. See [status](docs/STATUS.md), the
[Build 001 plan](docs/builds/BUILD-001-PLAN.md), and its
[report](docs/builds/BUILD-001-REPORT.md) for demonstrated results. BUILD-002 is complete. BUILD-003A non-executing Base swap authoring and deterministic lint are approved under DEC-0018; BUILD-003B/003C, package publication, Mode B and financial execution remain unapproved. The
[Build 000 licensing amendment](docs/builds/BUILD-000-LICENSING-AMENDMENT.md)
records the approved pre-incorporation license publication.

## Licensing

Gryloo is multi-licensed. [LICENSE](LICENSE) routes to the official license
texts, and [the license map](docs/LICENSE_MAP.md) classifies each path.
`docs/assets/**` is excluded as third-party reference material. The licenses
grant no Gryloo trademark rights; see [TRADEMARKS.md](TRADEMARKS.md).

## Sources of truth

- [Master Product Specification v3.2](docs/specs/MASTER_SPEC_V3.2.md)
- [Astra Development Master Prompt v1.2](prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md)
- [Governance decisions](docs/DECISIONS.md)

The files in `docs/assets/` are visual direction only. They do not authorize
copying third-party branding, interface text, or unsupported safety claims.

## Contract packages

- `@defi-workflow-engine/workflow-contracts@0.1.0`: artifact contracts, raw-byte
  ingress, canonical hashes, invalidation, revision checks, and state transitions.
- `@defi-workflow-engine/action-registry@0.1.0`: declarative action definitions
  and capability contracts.

Both packages are private and Apache-2.0. Exports are limited to the documented
root API, `./schemas`, `./schemas/v1/*.schema.json`, and `./package.json`.
See [compatibility](docs/contracts/COMPATIBILITY_V1.md),
[canonicalization](docs/contracts/CANONICALIZATION_V1.md), and
[invalidation](docs/contracts/INVALIDATION_V1.md).

CI bootstraps verified official Node.js `24.21.0` and pnpm `11.22.0` archives
with runner Python, Git, and Bash and no third-party Actions. Dependencies use
exact pins and a frozen lockfile; install scripts are disabled. SBOM validation
emits a digest; no retained SBOM artifact is claimed.

BUILD-002's approved private [reference application](apps/reference-dapp)
provides the local mocked Gryloo visual shell and shared revisioned workflow
state. Its source is AGPL-3.0-only. The exact third-party license and
attribution inventory is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md);
the current validation record is the
[BUILD-002 report](docs/builds/BUILD-002-REPORT.md).

## BUILD-003A

The private `@defi-workflow-engine/reference-linter@0.1.0` package adds
deterministic, non-enforcing review of isolated Base USDC↔WETH exact-input
intent. The existing [reference application](apps/reference-dapp) supports the
same intent through local chat and canvas controls. It provides no quote,
protocol connection, wallet or execution. Both the app and linter are
AGPL-3.0-only. See the [approved plan](docs/builds/BUILD-003A-PLAN.md) and
[implementation report](docs/builds/BUILD-003A-REPORT.md) for exact scope and
separate local and remote evidence.
