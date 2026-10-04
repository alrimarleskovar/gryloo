# BUILD-PRODUCT-UX-001 — Product UX plan

Date: 2026-10-04. Branch: `codex/build-product-ux-001`. Base: `main` at `1cf923f`.

## Objective and boundary

Make FloFi's existing non-custodial workflow lifecycle understandable through three primary areas: **Build → Simulate → Execute**.

The canonical lifecycle remains: author workflow → canonical IR → Quote / Artifacts → Simulation → Review → Strategy Manifest → explicit wallet Authorization → Execute → durable journal / recovery → reconciliation → Evidence.

Presentation adapters may read existing state. They must not introduce another workflow representation, financial authority, execution or recovery path. API contracts, canonical IR, provider adapters, Manifest binding, wallet authorization, ownership, journals, reconciliation, evidence maturity and safety gates remain intact. Guided Chat is outside this branch; future Chat and Canvas must feed the same canonical IR through the existing authoring boundary.

## Inspection before Part A

- The requested branch is already checked out at the requested base. The pre-existing untracked `.tmp/` directory is excluded from commits.
- `AppShell` already holds the selected lifecycle area and routes the shared workflow and recovered records into existing flow panels. Keep that routing and its guards.
- `WorkflowProvider` owns canonical IR and authoring commands. Canvas and the existing command/proposal panel already share it. Do not implement or extend Guided Chat.
- `TopBar` already exposes Build / Simulate / Execute and injected wallet controls, but mixes local diagnostics into the primary header, hides some status at narrower widths, and only identifies required networks for a subset of workflows.
- Page headings lose visible workflow context outside Build. The shell needs persistent identity, revision, action count and chain context without implying that visiting a stage completed its checks.
- `SummaryBar` has flow-specific guarded continuation controls. Retain those guards; stage navigation itself is not authorization.
- BUILD-JOURNEY-001's plan and report document wallet-session authentication, principal-bound run reads, account-change invalidation, chain-explicit Review, server-held run reopening, never-resend recovery and safe-head reconciliation. Its testnet entry, sign-in, run list, router panels and stores must remain accessible.
- Journey's report claims MOCKED tests and PUBLIC_READ_ONLY preflight, with deployed permissionless execution still unverified. This UX build must not upgrade that claim.
- No applicable `AGENTS.md` was found in the repository or its ancestor directories.

## Phased delivery

| Part | Scope | Validation | Commit / stop |
| --- | --- | --- | --- |
| A | FloFi header, wallet/network visibility, numbered lifecycle navigation, persistent workflow context, stage guidance, responsive shell, technical disclosure | Targeted presentation/wallet/canonical authoring unit tests; app typecheck; lint of touched UI files. No browser, PostgreSQL, Anvil, audit or SBOM suite. | `UX-001A: product shell and navigation`; stop for owner instruction |
| B | Professional Canvas workspace, action library, node selection and contextual supported-parameter inspector; preserve canonical IR and authoring seam | Relevant canvas/editor/authoring checks only | `UX-001B: workflow build workspace`; stop |
| C | Simulation economics, material warnings, Review and Manifest summaries with progressive disclosure; display only known facts | Relevant simulation/review tests only | `UX-001C: simulation and review experience`; stop |
| D | Truthful execution, wallet requests, durable recovery, reconciliation, explorer references and evidence presentation | Relevant execution/recovery/evidence tests only | `UX-001D: execution recovery and evidence experience`; stop |
| E | End-to-end integration, state/error/responsive polish, existing run reopening and permissionless Journey regression checks | Full repository gates, including dependency verification, typecheck, lint, build, schema, unit, PostgreSQL, Anvil/fork, browser, audit, SBOM and governance | `UX-001E: integrate and certify product UX` |

All parts stay on this branch; no separate A–D PRs. Record actual validation and limitations per phase in [BUILD-PRODUCT-UX-001-REPORT.md](BUILD-PRODUCT-UX-001-REPORT.md). Infrastructure failures must be distinguished from product regressions. Never weaken a gate.

## Part A implementation approach

Use a read-only shell view model for lifecycle copy and canonical chain/network display. A selected stage describes the current **view**, not runtime success or authorization. Add semantic landmarks, keyboard focus, persistent workflow facts and restrained layout styles. Keep financial status and actions in their existing panels. Keep existing wallet discovery, connection, reset and switch methods; any network-switch button remains explicitly user-driven. Retain mock/testnet/local-fork labels and technical diagnostics without presenting them as certification.

## Current status

Part A complete with targeted validation passed. Stop after its focused commit and await owner instruction. Parts B–E have not started. Final integration/certification is reserved for Part E.
