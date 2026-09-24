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
| Apache-2.0 | `.gitignore`, `.node-version`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/governance.yml`, `.github/workflows/contracts.yml`, `scripts/bootstrap-ci.py`, `scripts/export-schemas.mjs`, `README.md`, `TRADEMARKS.md`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `docs/*.md`, `docs/adr/*.md`, `docs/builds/*.md`, `docs/specs/*.md`, `docs/contracts/*.md`, `prompts/*.md`, `packages/workflow-contracts/**` and `packages/action-registry/**` except each package LICENSE, `tests/compatibility/v1/**` | Eligible original governance, contracts, registry, fixtures, generated schemas, tooling, and policy material; [Apache License 2.0](../LICENSES/Apache-2.0.txt). Only exact paths in an explicitly approved tracked build plan or an explicitly approved tracked governance or licensing amendment are authorized: currently the BUILD-001 and BUILD-002 plans, the later BUILD-002 legal-evidence amendment and the BUILD-002 governance amendment, the approved BUILD-003A plan and the approved BUILD-003B plan. |
| THIRD_PARTY_PATCH | `patches/@streamparser__json@0.0.26.patch`, `patches/@xyflow__system@0.0.82.patch` | Modified `@streamparser/json@0.0.26` declarations under upstream MIT; patch SHA-256 `3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6`. No Gryloo Apache grant. The XYFlow two-declaration patch has SHA-256 `4420c4eab49ef56325c7cb81898894b1c9f08fe39621216e8cf77532ce98f6d5`. |
| Official third-party legal text | `third_party/licenses/streamparser-json-MIT.txt`, `third_party/licenses/xyflow-system-MIT.txt` and the 19 exact preserved files listed in `THIRD_PARTY_NOTICES.md` | Byte-identical upstream legal and licensing materials, retaining their own licenses. The parser MIT copy has SHA-256 `b0022ea53a62be6b1f54f89f80d9271e395df2d12a63b4f8f0bf1a916a4e8094`; the XYFlow MIT copy has SHA-256 `023119ac20fb1c8c9930abe0bcd196989a1960388529a96fc43cebf96f07c9ff`. The exact BUILD-002 package/file/digest mappings are in the third-party notice register. |
| AGPL-3.0-only implementation | `apps/reference-dapp/**` except `apps/reference-dapp/LICENSE`, and `packages/reference-linter/**` except `packages/reference-linter/LICENSE` | Gryloo-authored private reference application, tests, baseline images and deterministic linter under [AGPL-3.0-only](../LICENSES/AGPL-3.0-only.txt). No financial execution. |
| License routing | `LICENSE` | Multi-license routing document; consult this map for grants. |
| Official legal text | `LICENSES/Apache-2.0.txt`, `LICENSES/AGPL-3.0-only.txt`, `packages/workflow-contracts/LICENSE`, `packages/action-registry/LICENSE`, `apps/reference-dapp/LICENSE`, `packages/reference-linter/LICENSE` | Unmodified official texts. The contracts and registry copies match `LICENSES/Apache-2.0.txt`; the application and linter copies match `LICENSES/AGPL-3.0-only.txt` byte-for-byte. |
| Excluded third-party references | `docs/assets/1.jpeg`, `docs/assets/2.jpeg`, `docs/assets/3.jpeg` | Visual reference material; no Gryloo license grant. |

The exclusion applies prospectively to all `docs/assets/**`. Unverified
third-party material anywhere in the repository is excluded unless its rights
are verified and this map is amended. Third-party materials remain subject to
their own rights.

The workspace packages are private, version `0.1.0`; the contracts and registry are Apache-2.0 and the reference linter is AGPL-3.0-only.
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

The BUILD-002 reference application is the approved AGPL-3.0-only
implementation. The following other paths remain reserved and are not
authorized by BUILD-002:
- `packages/reference-compiler/**`
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


## BUILD-002 dependency boundary

The exact 16 reviewed packages and actual SPDX expressions are mapped in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and pinned with registry
SRIs in `scripts/bootstrap-ci.py`. The ten libvips platform packages retain
LGPL-3.0-or-later. The Sharp WASM and Windows packages retain all components
of their compound expressions. `caniuse-lite` data remains CC-BY-4.0 and
`tslib` remains 0BSD. Optional or inactive packages remain disclosed in the
full dependency evidence and SBOM. These are unmodified registry packages;
no source or binary is vendored as Gryloo-authored application code.

Future distribution of a Sharp/libvips binary requires a separate release
compliance gate for notices, corresponding-source availability and user
replacement/relink rights. This review is not a universal legal certification.

## BUILD-003A linter classification

DEC-0018 authorizes the private `packages/reference-linter/**` implementation
under AGPL-3.0-only. Its `LICENSE` is an exact copy of the official AGPL text.
This adds no external dependency, changes no existing grant, and does not
authorize publication or execution.

## BUILD-003B dependency note

DEC-0019 adds one direct dependency edge from the AGPL-3.0-only reference
linter to the already approved and locked `canonicalize@5.0.0` (Apache-2.0).
The package is unmodified, not vendored and not relicensed. No new registry
package, license exception, path classification or official text change is
introduced, and bundle distribution remains unapproved.

## BUILD-003C classification

The BUILD-003C `apps/reference-dapp/**` and `packages/reference-linter/**` additions remain AGPL-3.0-only. BUILD-003C governance and report files follow the existing Apache-2.0 documentation classification. DEC-0021 adds only the existing AGPL-classified `apps/reference-dapp/e2e/fixtures.ts` to the permitted modify scope for the synthetic CSP guard self-test. No dependency, official license text or grant changes.
