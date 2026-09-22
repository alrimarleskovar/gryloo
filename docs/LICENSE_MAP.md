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
| Apache-2.0 | `.gitignore`, `.github/workflows/governance.yml`, `README.md`, `TRADEMARKS.md`, `NOTICE`, `docs/*.md`, `docs/adr/*.md`, `docs/builds/*.md`, `docs/specs/*.md`, `prompts/*.md` | Eligible original Gryloo governance, specification, prompt, repository-administration and public-policy material; [Apache License 2.0](../LICENSES/Apache-2.0.txt). |
| License routing | `LICENSE` | Multi-license routing document; consult this map for grants. |
| Official legal text | `LICENSES/Apache-2.0.txt`, `LICENSES/AGPL-3.0-only.txt` | Unmodified official license texts, not Gryloo-authored implementation. |
| Excluded third-party references | `docs/assets/1.jpeg`, `docs/assets/2.jpeg`, `docs/assets/3.jpeg` | Visual reference material; no Gryloo license grant. |

The exclusion applies prospectively to all `docs/assets/**`. Unverified
third-party material anywhere in the repository is excluded unless its rights
are verified and this map is amended. Third-party materials remain subject to
their own rights.

## Reserved future boundaries

No tracked AGPL-3.0-only implementation currently exists. The following paths
are reserved for a separately approved public reference implementation under
AGPL-3.0-only; reservation does not authorize BUILD-001 or create files:

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
