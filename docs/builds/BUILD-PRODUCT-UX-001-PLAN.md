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

## Owner direction correction before Part B

The owner superseded Part A's visible mock-example labeling and the old inline lending setup direction. The primary workspace must have no internal/demo/mock wording. Legacy provenance, rehearsal controls and diagnostics may stay inside closed technical disclosures; they must not be relabeled as live financial evidence.

The corrected authoring flow is **Add action → canonical canvas card → select card → edit in the external inspector**. Supply, Borrow, Repay and Withdraw use their existing ADD/SET commands and canonical constructors. The initial scaffold stays in the IR for compatibility but is excluded from the primary canvas/context projection. Primary action counts reflect visible canonical product actions.

Supported connections retain existing semantics: standalone lending actions remain isolated; the existing Supply → Borrow → Swap composition retains its dependency, output reference and health-factor checkpoint. The UX must not invent arbitrary connections or promise that unsupported compositions execute.

Create a separate focused correction commit, report back and stop before further Part B implementation. Part B continues from this corrected direction after owner instruction.

## Current status

Part A committed. The owner-requested Build direction correction is implemented and targeted validation passed; it is recorded as a separate correction commit. Further Parts B–E work has not started. Final integration/certification is reserved for Part E.

## Owner-directed Part A identity and Privacy refinement

Keep the existing Copilot parser, proposal/revision checks and integration. Remove internal branding and command-help examples from its primary presentation; use exactly “Describe your flow”. Its explanation should display authored actions rather than the hidden canonical scaffold.

Add inline naming beside the existing canvas title. No canonical title persistence exists, so the name belongs to AppShell presentation state only: Enter/blur confirm, Escape cancels, navigation preserves the name during the current session, and reload resets it. Naming must not edit IR, increment revision or rename a reviewed run/Manifest.

Place a disabled shield labeled Privacy immediately after Withdraw, outside the canonical action definitions. It has no handler or execution claim. Keep the existing toolbar width, icon sizes, canvas/Copilot heights, inspector and zoom positions; fit the extra entry by tightening floating-toolbar vertical spacing if necessary. Cloak/Zcash integration remains deferred to final integration/certification after the UX parts.

Validate component/header/toolbar presentation, inline keyboard naming and existing Copilot proposal handling with targeted unit/browser checks, app typecheck and touched-file lint. Commit `UX-001A: refine workflow identity and privacy affordance`, then stop. Part B is not authorized.

## Owner-directed Part A header controls and advanced expansion

Box the existing wallet identity/network and Connect/Disconnect actions without changing their handlers, busy states or wallet/session semantics. Add a separate, aligned, icon-only Settings box with no functionality. Remove the outer Technical authoring tools disclosure; preserve its conditional workflow checks inside the existing Advanced action setup disclosure, together with all existing forms and provider-specific disclosures. Validate header/navigation presentation, wallet controls, single expansion access and preserved Build layout with targeted checks only. Commit `UX-001A: refine header controls and advanced section`, then stop without proceeding to Part B.

## Owner-directed Part A canvas CTA and settings dropdown

Move the existing Build navigation button into a floating bottom-right canvas action labeled exactly “Simular Fees”, retaining the `setTab('Simulate')` callback and leaving simulation/review/authorization gates unchanged. Preserve zoom controls at their existing bottom-right location and leave a clear gap beside the CTA. Retain footer workflow context without a duplicate Build button. Widen only the Build container slightly by reducing desktop horizontal padding and increasing its maximum width; preserve Copilot and Selected Action placement.

Replace the inert gear with a toggled, absolutely positioned dropdown containing Language, Theme and Disconnect. Keep those options disabled/presentation-only; retain the real wallet Disconnect control and its existing handler. Support outside-click, Escape and focus-out dismissal without clearing canvas selection. Validate only relevant component, CTA/settings/browser UI, typecheck and touched-file lint checks. Commit `UX-001A: refine canvas CTA and settings menu`, then stop. Part B is not authorized.

## Owner-directed Simulate shell cleanup

Remove the entire Simulate WorkspaceHeading: draft/action/revision/chain metadata, eyebrow/title/subtitle, current-stage badge and guidance strip. Add no visible replacement. Correct the main landmark's accessible labeling after removing its title. Preserve existing content routing, empty states, artifacts, simulation/review/Manifest/authorization logic and Build/Execute presentation. Validate with focused shell tests, one browser smoke check, app typecheck and touched-file lint; commit `UX-001A: simplify Simulate workspace shell`, then stop without proceeding to Part B.

## Owner-directed Simulate control and return-action cleanup

Remove the upper eligibility-message strip and Show/Hide technical details button. Make the existing fallback simulation graph directly visible instead of hiding it beneath the preparation card/outer disclosure. Move its existing Return to Build callback into a floating bottom-right canvas action. Preserve generation controls, eligibility/binding/expiry checks and error/status feedback. Keep explanations and existing diagnostic panels accessible in one disclosure below the graph, using the existing technical-presentation state. Leave product-specific simulation panels, Build and Execute unchanged. Run only targeted UI/artifact, browser, typecheck and touched-file lint checks; commit `UX-001A: simplify Simulate controls and move return CTA`, then stop before Part B.

## Owner-directed Simulate canvas actions

Remove the fallback Simulate panel's SIMULATE eyebrow and Simulation title without replacing either. Keep artifact controls and graph/results intact. Move the existing React Flow controls to the bottom-right with a 12px right margin, above a floating action row 12px from the bottom/right edges. Keep Return to Build on the left and Review swap on the right with an 8px gap.

Relocate the existing SummaryBar action through a presentation-only portal into the mounted simulation canvas; preserve its exact review eligibility, route precedence and navigation handler. Remove its footer rendering when the canvas host exists. Preserve footer context and existing product-specific panels without that canvas, plus Build/Execute behavior. Validate only focused Simulate/footer unit tests, desktop/mobile browser layout and controls, app typecheck and touched-file lint. Commit `UX-001A: refine Simulate canvas actions`, then stop. Part B remains unauthorized.

## Owner-directed Simulate control alignment and shared title

Shift the existing Return to Build / Review swap row left to reserve the bottom-right corner for React Flow controls. Keep the action order, existing handlers and review gates; retain small canvas-edge margins and mobile clearance. Remove the canvas header's MOCKED OUTPUTS · READ-ONLY eyebrow and Graph heading. Render the existing AppShell workflow name already used by Build, passed as presentation props without new state, persistence, IR edits or execution meaning. Keep diagnostic/artifact provenance elsewhere intact. Validate title propagation and renaming across Build/Simulate, focused desktop/mobile layout and existing controls, app typecheck and touched-file lint. Commit `UX-001A: align Simulate canvas controls and workflow title`, then stop before Part B.

## Owner-directed Execute shell cleanup

Remove the complete Execute introductory block: draft/action/revision/chain metadata, EXECUTE / WORKFLOW eyebrow, large title/subtitle, Current stage badge and Authorize and track execution guidance. Add no visible replacement. Remove the now-unused WorkspaceHeading component and its description-only shell code; give the existing main landmark an accessible Execution workspace label. Preserve content routing, existing empty states and diagnostic access, wallet authorization, execution/recovery/reconciliation/evidence and Build/Simulate behavior. Replace obsolete heading-rendering expectations with focused browser assertions on the actual workspace and retained shell/navigation checks. Run targeted validation only; commit `UX-001A: simplify Execute workspace shell`, then stop. Part B remains pending.
