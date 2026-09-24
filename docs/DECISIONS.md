# Decision register

| ID | Decision | Status |
|---|---|---|
| DEC-0001 | Use `docs/specs/MASTER_SPEC_V3.2.md` as the canonical Master Spec path. | APPROVED |
| DEC-0002 | Keep BUILD-000 governance-only. | APPROVED |
| DEC-0003 | Keep ADR-0001 proposed until separate human approval. | APPROVED |
| DEC-0004 | Record legal files as blocked pending formal team IP ownership. | SUPERSEDED_BY_DEC-0008 |
| DEC-0005 | Defer a CLA until external contributions or dual licensing are relevant. | APPROVED |
| DEC-0006 | Use runner-provided shell and Python for governance CI with no external actions. | APPROVED |
| DEC-0007 | Treat BUILD-001 only as a candidate with status `NOT_APPROVED`. | APPROVED |
| DEC-0008 | On 2026-09-22, record unanimous founder authorization for pre-incorporation publication of the approved Apache-2.0 and AGPL-3.0-only licenses over eligible original Gryloo materials. Alrimar Sobrinho is authorized as repository administrator and license publisher; this role does not confer exclusive ownership of Gryloo intellectual property. Future legal-entity transfer is deferred until incorporation. | APPROVED |
| DEC-0009 | On 2026-09-22, the human owner explicitly approved BUILD-001 implementation under the complete revised canonical-contracts plan, superseding DEC-0007 for BUILD-001 only. The original DEC-0007 statement remains historical. BUILD-002, package publication, Mode B selection, protocol integration, and financial execution remain unapproved. | APPROVED |
| DEC-0010 | Accept ADR-0002 for the approved BUILD-001 contract packages, strict raw ingress, canonical hash profile, pinned toolchain, license classification, and CI checks. This decision does not change ADR-0001 from PROPOSED. | APPROVED |
| DEC-0011 | On 2026-09-23, the human owner approved BUILD-002 visual shell and shared state, the two-file XYFlow patch, and after complete 245-package review the exact 16-package license/SRI exception and preserved upstream legal evidence. BUILD-003, publication and financial execution remain unapproved. | APPROVED |
| DEC-0012 | On 2026-09-23, the human owner approved a governance-only BUILD-002 amendment before any BUILD-003 work. It creates only `docs/builds/BUILD-002-GOVERNANCE-AMENDMENT.md` and may modify only the root `LICENSE`, both workflows, `docs/STATUS.md`, `docs/NEXT_BUILD.md`, `docs/DECISIONS.md`, `docs/REQUIREMENTS.md` and `docs/SECURITY_MODEL.md`, plus `docs/SCOPE_GUARD.md` or `README.md` only where required for consistency. No application, package, dependency, schema, fixture, patch, legal copy, visual baseline or functional change is approved. | APPROVED |
| DEC-0013 | On 2026-09-23, the human owner approved a minimal correction of the root `LICENSE` so it truthfully records that `apps/reference-dapp/**` contains tracked AGPL-3.0-only implementation. The correction changes no license grant, relicenses no path, modifies no official Apache or AGPL text and alters no package classification. | APPROVED |
| DEC-0014 | On 2026-09-23, the human owner approved restoring, in this separate amendment and before BUILD-003, the governance checks unintentionally removed during BUILD-002, while retaining every BUILD-002 scope, licensing, patch, attribution and protected-byte check. | APPROVED |
| DEC-0015 | On 2026-09-23, the human owner decided that Mode A planning and non-executing authoring work may be separately approved while ADR-0001 remains PROPOSED. This decision does not mark Phase 0 fully complete, does not approve Mode B, does not approve wallet, signing, submission or financial execution, does not approve BUILD-003B or BUILD-003C, and does not change ADR-0001. | APPROVED |
| DEC-0016 | On 2026-09-23, the human owner placed the deterministic linter in the scope of candidate BUILD-003A, Uniswap swap authoring and deterministic lint, rather than in a separate build. BUILD-003A remains `NOT_APPROVED` until this amendment is merged and a revised BUILD-003A plan is explicitly approved; this amendment does not approve it. | APPROVED |
| DEC-0017 | On 2026-09-23, the human owner approved one final scope correction to the BUILD-002 governance amendment, adding `docs/LICENSE_MAP.md` to the DEC-0012 modify scope so the license map recognizes that an explicitly approved tracked build plan or governance or licensing amendment may authorize paths. The correction changes no license classification, license grant or official license text, reclassifies no Gryloo-authored or third-party material, and does not approve BUILD-003A. | APPROVED |

| DEC-0018 | On 2026-09-24, the human owner explicitly approved the complete BUILD-003A plan at `docs/builds/BUILD-003A-PLAN.md`, including its exact Section 11 file scope, acceptance criteria, visual changes, workspace changes, governance transition, and O-1–O-14 choices as incorporated in that plan. Implementation, the named local commit, SSH push and a PR into `main` are authorized. This does not approve merging, BUILD-003B/003C, Mode B, live protocol access, wallet, signing, submission or financial execution; ADR-0001 remains PROPOSED. | APPROVED |

Accepted decisions may be changed only through an explicit superseding record.
The date in DEC-0008 is the public repository decision date, not a statement of
when private consent occurred.
