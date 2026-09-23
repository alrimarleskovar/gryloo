# License map

This is the authoritative path classification for the multi-licensed Gryloo
repository. Each currently tracked file belongs to exactly one row below.
Paths in a row do not overlap paths in another row. The license texts are
published in `LICENSES/`; the root `LICENSE` routes readers here.

## Current authority

- Pre-incorporation licensing authority: `RESOLVED_FOR_PREINCORPORATION_LICENSING`
- Future legal-entity transfer: `DEFERRED_UNTIL_INCORPORATION`
- License publication: `AUTHORIZED`
- Third-party materials: `EXCLUDED_UNLESS_VERIFIED`
- CLA adoption: `DEFERRED`

DEC-0008 records unanimous founder authorization for publication over eligible
original Gryloo materials. Alrimar Sobrinho is the authorized repository
administrator and license publisher. This role does not establish exclusive
ownership of Gryloo intellectual property.

## Classification of tracked files

| Classification | Exact tracked paths or path patterns | Treatment |
|---|---|---|
| Apache-2.0 | `.gitignore`, `.node-version`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/governance.yml`, `.github/workflows/contracts.yml`, `scripts/bootstrap-ci.py`, `scripts/export-schemas.mjs`, `README.md`, `TRADEMARKS.md`, `NOTICE`, `docs/*.md`, `docs/adr/*.md`, `docs/builds/*.md`, `docs/specs/*.md`, `docs/contracts/*.md`, `prompts/*.md`, `packages/workflow-contracts/**` and `packages/action-registry/**` except each package LICENSE, `tests/compatibility/v1/**` | Eligible original governance, contracts, registry, fixtures, generated schemas, tooling, and policy material; [Apache License 2.0](../LICENSES/Apache-2.0.txt). Only exact paths in the approved BUILD-001 plan are authorized. |
| THIRD_PARTY_PATCH | `patches/@streamparser__json@0.0.26.patch` | Modified `@streamparser/json@0.0.26` declarations under upstream MIT; patch SHA-256 `3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6`. No Gryloo Apache grant. |
| Official third-party legal text | `third_party/licenses/streamparser-json-MIT.txt` | Byte-for-byte upstream MIT `LICENSE` from `https://registry.npmjs.org/@streamparser/json/-/json-0.0.26.tgz`, SHA-256 `b0022ea53a62be6b1f54f89f80d9271e395df2d12a63b4f8f0bf1a916a4e8094`. |
| License routing | `LICENSE` | Multi-license routing document; consult this map for grants. |
| Official legal text | `LICENSES/Apache-2.0.txt`, `LICENSES/AGPL-3.0-only.txt`, `packages/workflow-contracts/LICENSE`, `packages/action-registry/LICENSE` | Unmodified official texts. Both package copies must match `LICENSES/Apache-2.0.txt` byte-for-byte, including its verified SHA-256 and byte length. |
| Excluded third-party references | `docs/assets/1.jpeg`, `docs/assets/2.jpeg`, `docs/assets/3.jpeg` | Visual reference material; no Gryloo license grant. |

The exclusion applies prospectively to all `docs/assets/**`. Unverified
third-party material anywhere in the repository is excluded unless its rights
are verified and this map is amended. Third-party materials remain subject to
their own rights.

The workspace packages are private, version `0.1.0`, and declared Apache-2.0.
Publication is not approved. Third-party dependencies retain their own licenses;
the lockfile records dependency resolution without relicensing dependency code.
The approved direct inventory is in the BUILD-001 plan; transitive license and
integrity evidence must be reviewed before acceptance. Generated SBOMs are
ephemeral validation output and are not tracked or retained artifacts.

The implementation review also identified development tooling under MPL-2.0
(`lightningcss@1.33.0` and its platform binding, through Vite) and BlueOak-1.0.0
(`minimatch@10.2.6`, through ESLint). These dependencies retain their own
licenses; their source and binaries are not copied into tracked original
packages or relicensed by this map. BUILD-001 authorizes local and CI validation,
not package publication or binary redistribution. This inventory records the
reviewed boundary and does not certify compliance for future distribution.

## Reserved future boundaries

No tracked AGPL-3.0-only implementation currently exists. The following paths
are reserved for a separately approved public reference implementation under
AGPL-3.0-only; reservation does not authorize those implementations or create files:

- `apps/reference-dapp/**`
- `packages/reference-compiler/**`
- `packages/reference-linter/**`
- `packages/reference-simulation/**`
- `packages/reference-executor/**`
- `packages/reference-reconciler/**`
- `packages/reference-evidence/**`
- `packages/public-ui/**`

The following private or proprietary managed-plane paths are prohibited in this
public repository:

- `managed/**`
- `private/**`
- `proprietary/**`
- `services/managed/**`
- `services/partner-gateway/**`
- `services/enterprise-policy/**`
- `services/hosted-explorer/**`

No Gryloo trademark rights are granted; see [TRADEMARKS.md](../TRADEMARKS.md).
