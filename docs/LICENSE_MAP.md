# License map

## BUILD-007 license impact

The additive composition permission domain and v2 compatibility vector in `packages/workflow-contracts/**` remain Apache-2.0. New reference compiler, linter, executor, reconciler and DApp files follow their existing AGPL-3.0-only path rules. Official Safe, Zodiac Roles, ERC-2470 and Uniswap artifacts are digest-pinned temporary test inputs outside Git; this build adds no registry dependency, vendored binary or third-party legal text. `workflow-contracts` advances to private workspace version 0.3.0 with exact consumer pins; publication is not authorized.

This is the authoritative path classification for the multi-licensed Flofi
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
| Apache-2.0 | `.gitignore`, `.node-version`, `.npmrc`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/workflows/governance.yml`, `.github/workflows/contracts.yml`, `scripts/bootstrap-ci.py`, `scripts/export-schemas.mjs`, `README.md`, `CLAUDE.md`, `TRADEMARKS.md`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `docs/*.md`, `docs/adr/*.md`, `docs/builds/*.md`, `docs/specs/*.md`, `docs/contracts/*.md`, `docs/developer/**`, `prompts/*.md`, `packages/workflow-contracts/**`, `packages/action-registry/**` and `packages/developer-sdk/**` except each package LICENSE, `tests/compatibility/v1/**` | Eligible original governance, contracts, registry, fixtures, generated schemas, tooling, and policy material; [Apache License 2.0](../LICENSES/Apache-2.0.txt). Only exact paths in an explicitly approved tracked build plan or an explicitly approved tracked governance or licensing amendment are authorized: including the approved BUILD-006 plan under DEC-0036; earlier build plans and amendments retain their recorded authority. |
| THIRD_PARTY_PATCH | `patches/@streamparser__json@0.0.26.patch`, `patches/@xyflow__system@0.0.82.patch` | Modified `@streamparser/json@0.0.26` declarations under upstream MIT; patch SHA-256 `3232498480ccaaab0643460d8c365f143109561324575b05feff987eb45278e6`. No Gryloo Apache grant. The XYFlow two-declaration patch has SHA-256 `4420c4eab49ef56325c7cb81898894b1c9f08fe39621216e8cf77532ce98f6d5`. |
| Official third-party legal text | `third_party/licenses/streamparser-json-MIT.txt`, `third_party/licenses/xyflow-system-MIT.txt` and the 19 exact preserved files listed in `THIRD_PARTY_NOTICES.md` | Byte-identical upstream legal and licensing materials, retaining their own licenses. The parser MIT copy has SHA-256 `b0022ea53a62be6b1f54f89f80d9271e395df2d12a63b4f8f0bf1a916a4e8094`; the XYFlow MIT copy has SHA-256 `023119ac20fb1c8c9930abe0bcd196989a1960388529a96fc43cebf96f07c9ff`. The exact BUILD-002 package/file/digest mappings are in the third-party notice register. |
| AGPL-3.0-only implementation | `apps/reference-dapp/**` except `apps/reference-dapp/LICENSE`, `packages/reference-linter/**` except `packages/reference-linter/LICENSE`, and the BUILD-003D packages `packages/reference-compiler/**`, `packages/reference-executor/**` and `packages/reference-reconciler/**`, each except its `LICENSE` | Gryloo-authored private reference application, tests, baseline images and deterministic linter under [AGPL-3.0-only](../LICENSES/AGPL-3.0-only.txt). Local fork and loopback financial operations have only their recorded evidence ceilings; public financial execution is not authorized. |
| License routing | `LICENSE` | Multi-license routing document; consult this map for grants. |
| Official legal text | `LICENSES/Apache-2.0.txt`, `LICENSES/AGPL-3.0-only.txt`, `packages/workflow-contracts/LICENSE`, `packages/action-registry/LICENSE`, `packages/developer-sdk/LICENSE`, `apps/reference-dapp/LICENSE`, `packages/reference-linter/LICENSE`, `packages/reference-compiler/LICENSE`, `packages/reference-executor/LICENSE`, `packages/reference-reconciler/LICENSE` | Unmodified official texts. The contracts, registry and developer SDK copies match `LICENSES/Apache-2.0.txt`; the application, linter, compiler, executor and reconciler copies match `LICENSES/AGPL-3.0-only.txt` byte-for-byte. |
| Excluded third-party references | `docs/assets/1.jpeg`, `docs/assets/2.jpeg`, `docs/assets/3.jpeg` | Visual reference material; no Flofi license grant. |

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
implementation. BUILD-003D (DEC-0023, DEC-0025) populates `packages/reference-compiler/**`,
`packages/reference-executor/**` and `packages/reference-reconciler/**` as AGPL-3.0-only
implementation. The following other paths remain reserved:
- `packages/reference-simulation/**`
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

No Flofi or Gryloo trademark rights are granted; see [TRADEMARKS.md](../TRADEMARKS.md).


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

## BUILD-003D classification

**AGPL-3.0-only.** The three private BUILD-003D packages, `packages/reference-compiler/**`, `packages/reference-executor/**` and `packages/reference-reconciler/**`, are AGPL-3.0-only implementation. Each carries a byte-identical copy of `LICENSES/AGPL-3.0-only.txt`. The `apps/reference-dapp/**` additions, including the e2e fork harness, remain AGPL-3.0-only.

**Apache-2.0.** The `workflow-contracts` 0.2.0 additions, the new compatibility fixtures, both new scripts, the ADRs, the contract documents and the records follow the existing Apache-2.0 classification.

**New dependencies.** `@noble/hashes` and `@noble/curves` 2.4.0 are MIT-licensed registry dependencies, with no new license exception.

**Anvil.** Foundry Anvil v1.8.3 (MIT or Apache-2.0) is a downloaded, digest-verified test tool. It is never vendored or redistributed.

**Unchanged.** No official license text or third-party notice changes.

## BUILD-003F classification

The new and modified `apps/reference-dapp/**` Mode A fork service, browser, acceptance harness, tests, snapshots and credential-free transcript remain AGPL-3.0-only implementation under the existing path rule. BUILD-003F plan, report, ADR and living governance records remain Apache-2.0 documentation under the existing rule. The private owner phrase, public-pin manifest, billing report, credential file, journal and wallet profile live outside Git and receive no repository license classification. The only new package relationships use already locked workspace packages; there are still 247 registry identities and 16 reviewed license exceptions. No official license text, third-party notice or license grant changes.

## BUILD-004 classification

DEC-0031 adds no registry identity, redistributed Safe/Roles binary, license text or notice. The Mode B app, compiler, executor, reconciler, tests and browser harness remain AGPL-3.0-only under their existing path rules. The additive `workflow-contracts` 0.2.1 API and compatibility vector remain Apache-2.0. Safe/Roles artifacts, the ERC-2470 singleton-factory init code (CC0-1.0 specification text) and disposable local keys are confined to digest-pinned temporary local test inputs outside Git. Relinking Roles to local library and factory deployments happens only in the running local fork and is not redistributed; the 247 pinned registry identities and 16 reviewed exceptions are unchanged.

## BUILD-006 classification

The additive Uniswap v3 local liquidity contract profile, BUILD-006 plan and report, governance records, registry declarations and compatibility vectors fall under the Apache-2.0 row above. The reference linter, compiler, executor, reconciler, DApp, fork recorder and browser tests fall under the AGPL-3.0-only row. The new recording reuses approved locked dependencies and vendors no Uniswap source or legal text. The offline dry-run alone loads the published `@uniswap/v3-core` 1.0.1 (BUSL-1.1, which permits non-production use; its change license is GPL-2.0-or-later from 2023-04-01) and `@uniswap/v3-periphery` 1.4.4 (GPL-2.0-or-later) npm artifacts. The operator verifies each tarball against the registry integrity digest and unpacks it outside Git. The recorder pins the reviewed creation-bytecode SHA-256 and deploys that code only to a synthetic loopback chain-8453 source. Those artifacts are temporary local test inputs; they are not tracked, redistributed or added as dependencies. No package publication or public-chain authority follows.

## BUILD-DEVELOPER-001 classification

The Developer API (`apps/reference-dapp/src/developer/**`, its route, the operator CLI and every test) is AGPL-3.0-only implementation under the existing application row; migration `0007_developer_platform.sql` is AGPL-3.0-only like the rest of `packages/cloud-runtime` (its manifest license). The thin TypeScript client `packages/developer-sdk/**` (private workspace version 0.1.0, zero dependencies; npm publication not authorized) and the developer documentation `docs/developer/**`, including the OpenAPI document generated from the server's schemas, are Apache-2.0 so integrators may embed them. The SDK's `LICENSE` is the unmodified Apache-2.0 text. No registry identity, vendored code, legal text or notice is added: the 265 pinned registry identities and 16 reviewed exceptions are unchanged, and the lockfile gains only the SDK's empty importer.
