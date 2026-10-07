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

## Owner-directed Execute workflow surface

Replace the fallback Execute preparation/unavailable blocks and their inner Return to Build buttons with a read-only workflow overview. Reuse the existing simulation graph projection of canonical editor IR, with neutral overview cards showing authored inputs and no simulation outputs, execution status or financial actions. Use the same AppShell title already shared by Build/Simulate; introduce no workflow/title state or persistence. Keep necessary capability explanations and existing real execution/recovery panels in Technical diagnostics below, with unchanged routing/authorization gates. Preserve product-specific execution panels, global navigation, footer, Build and Simulate. Validate canonical read-only rendering, shared title, desktop/mobile layout, retained unprepared-execution gates and shared-canvas regressions, plus app typecheck/touched-file lint. Commit `UX-001A: replace Execute placeholder with workflow surface`, then stop before Part B.

## UX-002 — Workflow Composer

Owner-approved UX-001 is closed. This section supersedes older Part B scheduling only for the expressly authorized composer work; UX-003 is not authorized.

- Keep the approved header, navigation, title behavior, Build columns, right-side Copilot, Selected Action below Canvas, CTA/control placement and Simulate/Execute shells.
- Project compact React Flow cards from the existing canonical `state.workflow.nodes`. Show action, actual provider constraints, chain/route, known authored assets/amounts and draft order. Hide the internal mock scaffold. Use existing action readers, including the composition reader for lending; never create an editable UI workflow model.
- Project directional, non-animated edges from canonical dependencies/resource edges and the existing lending checkpoint projection. Preserve branching; never connect independent adjacent steps. Keep protected connection deletion guards.
- Use AppShell's existing `selectedId` for the active card and Selected Action. Preserve auxiliary group-selection IDs only for existing layout/bulk operations, with distinct understated group styling. Synchronize external selection; support mouse and Enter/Space selection, Escape and deletion.
- Keep canonical/proposal creation and edits. Select newly accepted real nodes, including the first step of an accepted lending composition. Identify the selected step in the editor and refresh card summaries only when the existing draft accepts an edit.
- Show existing node-specific lint findings. Distinguish authoring warnings/errors from later quote/simulation/review requirements. Configured means saved draft parameters, never execution readiness. Preserve form-local rejected-input feedback.
- Preserve layout dragging and history. Intentionally defer semantic reordering and freehand connections: the real action graph is constrained by existing canonical constructors; no reorder command exists. Step numbers reflect the draft array; dependency arrows define linked sequencing.
- Keep Privacy disabled and accessible. No Cloak/Zcash/Manifest integration. Keep Copilot architecture and chat-to-IR logic externally owned.
- Validate only the changed composer: targeted component/canonical projection and existing authoring/history tests, focused Chromium interactions and desktop/mobile review, app typecheck, touched-file ESLint and `git diff --check`.
- Update this report with results, limitations and shared-file integration touchpoints; commit `UX-002: productize workflow composer`, then stop.

## UX-003A — Simulate Workflow Canvas

UX-001 and UX-002 (`8c9337354612fc5a08f18107621e0786e1558bda`) are owner-approved. Only UX-003A is authorized here; stop for localhost visual inspection after committing it.

- Project the current shared canonical draft in Simulate for every existing product route, including lending, isolated actions and fallback workflows. Preserve current product simulation panels, artifact logic and Review gates.
- Reuse UX-002's card component, summary readers, action order, dependency/resource projection and saved Build positions. Introduce no editable workflow state or simulation-only action model.
- Keep the shared workflow title, directional arrows, compact authored asset/amount summaries and existing canvas action/control placement. Disable node editing, dragging, connections, selection and keyboard deletion.
- Omit authoring instructions and result/status badges from inspection cards. Show no inferred outputs, fees, gas, health factor, ETA or execution/authorization state. Keep existing artifacts/results intact in their existing controls; move fallback technical artifact content under Technical diagnostics.
- Show compact empty/incomplete messaging from the existing draft/validation result, without fabricated nodes or workspace introductions. Reserve enough graph-fit space for existing canvas actions and controls.
- Validate only projection/order/branching, shared title, read-only behavior, existing diagnostics and Review gates, relevant Chromium desktop/mobile checks, app typecheck, touched-file lint and diff checks. Keep Build/Execute regression coverage focused.
- Commit `UX-003A: project workflow into Simulate canvas`. Do not start UX-003B/C/D/E.

### UX-003A refinement — responsive toolbar and Selected Action

- Keep all top toolbar tools in their current order on one non-wrapping row. Use canvas container queries to reduce spacing before horizontal overflow; retain labels, blue icons, utility controls and the existing floating toolbar behavior.
- Make Selected Action a compact disclosure below the canvas, initially collapsed. Existing node selection opens it, including clicks on the already-selected card and Enter/Space selection. Manual collapse changes only the disclosure flag; retain the same selected ID, canonical editor and mounted form drafts.
- Include the previously requested Build card presentation refinements: numbered blue titles with trailing toolbar icons, combined provider/network metadata, compact amount/pair content, no Configured badge and a bottom-anchored selection footer. Preserve the Simulate card presentation.
- Validate toolbar geometry/reachability at multiple viewport widths, CSS page zoom and independently reduced canvas width; disclosure collapse/reopen, keyboard selection and retained drafts; focused Build/Simulate regressions, app typecheck, touched-file lint and diff checks.
- Commit `UX-003A: refine responsive toolbar and action inspector`, then stop. UX-003B remains out of scope.

### UX-003A refinement — toolbar resilience and action amount cards

- Split top tools into a scrollable primary action group and an anchored utility group containing Duplicate, Undo, Redo and the existing docking control. Preserve order, handlers and availability. Compress spacing first; retain visible utility icons with accessible labels/tooltips at narrow canvas widths. Preserve the floating toolbox.
- Give only Build Swap/Bridge cards a compact blue amount/token box with larger known amounts and a pencil affordance. Keep symbolic linked amounts truthful. Card clicks still open the same Selected Action editor; no inline form or new workflow/amount state.
- Preserve blue numbered titles with trailing icons, compact provider/network and pair summaries, and the bottom-anchored selection footer. Leave other actions and Simulate cards unchanged.
- Validate pinned utilities/reachable primary actions at narrow/zoomed widths, Swap/Bridge amount boxes, footer placement, selection and history, focused regressions, app typecheck, touched-file lint and diff checks. Commit `UX-003A: refine toolbar resilience and action amount cards`, then stop before UX-003B.

### UX-003A correction — Advanced Settings header and card controls

- Rename only the existing disclosure header to “Advanced Settings”; keep its content, selection source, mounted form drafts and collapse/reopen behavior.
- Add a top-toolbar-only Delete card control immediately after Redo. Use the existing current selection, deletion guard and REMOVE command; retain lock/dependency protection and Undo/Redo. Keep utilities pinned on one row and primary actions reachable at narrow/zoomed widths.
- Box only Build Swap/Bridge pair summaries to match the existing blue amount box. Derive Bridge token routes from supported bridge/router presentation readers, leave inspection cards unchanged, and retain the bottom-anchored footer.
- Validate exact header text, deletion/guard/history behavior, toolbar geometry and reachability, paired boxes/footer/selection, focused regressions, app typecheck, lint and diff checks. Commit `UX-003A: refine advanced settings header and card controls`, then stop before UX-003B.


### UX-003A refinement — canvas controls and Swap/Bridge value cards

- Add 60px to Build canvas heights (590px standard, 680px floating toolbar, 820px lending), matching the desktop Copilot container while retaining the existing responsive column behavior. Preserve the canvas footer, graph interactions and editor below it.
- Raise Build zoom/fit controls to a 70px bottom inset and move Simular Fees to a 12px right inset, retaining its 12px bottom inset. Leave Simulate and Execute controls unchanged.
- Relocate the existing header wallet reset handler into Settings → Disconnect. Preserve the wallet display, busy/disconnected disabling and existing Solana wallet handling; keep Language and Theme in the popover. Retain outside/Escape dismissal and keyboard focus behavior.
- Rename the existing top-toolbar Delete card action to Delete, preserving its guards, handler, history and single-row layout.
- Replace only Build Swap/Bridge amount/pair presentation with stacked source/destination boxes, values on the left and known tokens on the right. Use existing summary data only; preserve symbolic source amounts and show Not quoted for unavailable destination amounts. Retain the blue title, compact provider/network metadata and pinned editing footer without inline editing or quote logic.
- Validate focused component/browser regressions, wallet menu interaction, card value/token alignment, footer/selection/history, canvas/control geometry and narrow/zoomed toolbar reachability. Run app typecheck, touched-file lint and diff checks only. Commit `UX-003A: refine canvas controls and swap-bridge value cards`, then stop before UX-003B.


### UX-003A refinement — card value boxes and canvas CTA emphasis

- Raise only Build's Simular Fees and zoom/fit controls another 12px (24px CTA bottom inset, 82px controls bottom inset), preserving the CTA's 12px right inset and clearance between controls, attribution and footer.
- Add a restrained 3.6-second shadow pulse to the Build CTA only, without blinking text, opacity changes, scaling or layout movement. Disable it for reduced motion and while hovered/focused.
- Give only Build Swap/Bridge boxes a large numeric amount and smaller fiat line underneath, with a compact rounded token chip and local icon/avatar on the right. Keep actual authored source numbers; use 0 and US$ 0,00 placeholders for unavailable values. Preserve visible unquoted/symbolic context, and add no quote state or runtime logic.
- Rename Build card footers to Advanced Settings with a gear icon, retaining bottom anchoring and the existing card → editor selection path.
- Validate focused card/selection/history/projection and CTA geometry/motion cases, app typecheck, touched-file lint and diff checks. Commit `UX-003A: refine card value boxes and canvas CTA emphasis`, then stop before UX-003B.


### UX-003A authoring correction — unconfigured Swap/Bridge and inline amounts

The owner explicitly authorizes a contained authoring-model extension: adding Swap/Bridge must start at 0 without creating an executable amount of 1. This supersedes the earlier presentation-only restriction for this correction, while preserving canonical IR, runtime and provider semantics.

- Extend the existing editor history with required-field setup for one new Swap/Bridge and shared amount-input buffers for editable existing actions. Keep unfinished actions out of canonical IR; create the validated node only through the existing add/edit commands and proposal acceptance.
- Render the unfinished card in the existing React Flow projection, with an editable source 0, unquoted destination 0, Advanced Settings bound to the same field, normal selection/deletion/layout/history, and product-level amount validation feedback.
- Refuse zero, empty, malformed and negative amounts through the existing validators. Prevent stale reviewed amounts from being accepted after the field changes. Disable and guard both Simulate and Execute, including the Build CTA and artifact/observation generation, while any action amount needs acceptance.
- Keep the canonical workflow valid while an existing amount is being replaced; allow Cancel to restore its previous value. Do not duplicate action parameters, change canonical schemas or introduce zero-valued executable nodes.
- Add a small network badge to token avatars from known chain summaries and local token/fiat display-priority toggles. Fiat/output zero remains visibly unquoted; toggling never changes financial values or requests quotes. Preserve linked/protected amounts as non-editable.
- Keep user-facing wording focused on configuring amounts, reviewing changes and applying them. Implementation state and IR diagnostics remain in existing diagnostic surfaces.
- Validate new-action creation, invalid/positive amounts, stale acceptance, shared editor binding, incomplete-stage gates, history/selection, card display toggles/badges, existing composer/Simulate/header/layout regressions, app typecheck, touched-file lint and diff checks only. Document the one-new-action-at-a-time limitation, isolated Bridge safety and shared-file integration touchpoints. Commit `UX-003A: refine card amount toggle and network token badges`, then stop before UX-003B.


## UX-003B — Product card and settings cleanup

This owner-directed pass is limited to card presentation, explicit settings disclosure and a header environment selector. It does not authorize simulation-results, runtime or execution redesign.

- Remove visible Swap/Bridge validation badges, red warning messages/borders, dashed/dotted amount styling and the pencil. Preserve the same editable source field, amount validators and incomplete-action gates; retain detailed checks in Advanced Settings and nonvisual product feedback for assistive technology.
- Strengthen numeric typography with the product font, tabular figures, larger amounts and smaller USD sublines. Retain token chips/network badges and truthful unavailable-value presentation without inventing estimates.
- Make card clicks and Enter/Space select only. Open the lower panel only through its disclosure button or the card's accessible Advanced Settings button. Preserve the same selected ID, editor binding, explicit disclosure state and history. Preserve an explicitly opened panel when an unfinished card becomes a configured canonical node.
- Add Testnet/Mainnet next to the header wallet using the existing environment selection hook and capability gates. Keep legacy simulation environments neutral in the selector until a public environment is selected; never relabel them as live networks. Preserve action chains, wallet/session, APIs and runtime.
- Update focused interaction fixtures to open settings explicitly; retain existing financial and protection assertions. Validate quiet card rendering, source editing/acceptance, explicit disclosure/keyboard/history, environment selection and wallet/IR immutability, desktop/mobile/zoom layout, focused Build/Simulate regressions, app typecheck, touched-file lint and diff checks. Stop after this cleanup and report; no additional UX phase work.

### UX-003B refinement — in-card amount review and apply

- Place Review amount and Apply amount together inside Build Swap/Bridge cards. Derive Apply availability from the existing proposal's validity, action ID, reviewed amount and workflow revision; retain the existing review and explicit acceptance callbacks. Editing, stale reviews, history and incomplete-stage gates continue through the same authoring safeguards.
- Remove the standalone amount review/acceptance panel and duplicated amount-only review buttons in Advanced Settings. Keep shared amount fields, Enter-to-review validation and reviews for other parameters/proposed edits. Do not change proposal state, canonical IR, validators or runtime.
- Add a restrained blue hover glow with a 160ms transition and visible keyboard focus. Disable transitions for reduced motion, avoid animation/layout shifts, and keep Review/Apply adjacent at narrow widths.
- Validate Swap/Bridge invalid/positive acceptance, editing after review, action/revision scoping, zero mutation before Apply, one visible amount flow, shared editor/Simulate values, keyboard focus, hover geometry, existing targeted composer regressions, typecheck, touched-file lint and diff checks. Stop after reporting this refinement.


### UX-003B refinement — inline Supply proposal controls

- Put Review Supply change and its corresponding Apply proposal in the Supply card using the existing Bridge button row, hover/focus styles and compact spacing.
- Associate the card submit button with the existing Advanced Settings form through its HTML form ID. Keep required fields and their local form state in that editor; submit the same validators and SET_SUPPLY / AUTHOR_LENDING commands.
- Project the existing proposal's Supply target and workflow revision into the card. Apply remains explicit and uses the existing acceptance callback. A lending proposal that changes Borrow, slippage or multiple parameters retains the generic review controls.
- Retain the lower review details and Dismiss action while suppressing the duplicated Supply Apply button. Other proposal types and Bridge remain unchanged.
- Validate invalid Supply amounts, unchanged lending values, collapsed-editor submission, dismissal, explicit acceptance, one Apply control, card sizing at 1440/390/320px, and Bridge regressions with focused component/browser checks, app typecheck, touched-file lint and diff check.

### UX-003B refinement — inline Supply amount and larger token pills

- Make the Supply source value editable through the same ValueBox input and shared amount buffer as Bridge. Bind Advanced Settings to that buffer and associate the card input with the existing form for keyboard review. Preserve existing Supply/lending validators, commands, explicit Review/Apply, stale-review guards and required-field stage gates.
- Retain the lower Supply proposal details and Dismiss action without duplicate acceptance controls. Creation forms and other lending fields retain their existing behavior.
- Enlarge the shared token pill to a 30px minimum height, 20px avatar and 11px ticker with slightly more padding. Preserve the network badge and check Supply, Swap and both Bridge boxes at desktop and narrow widths.
- Validate invalid/positive Supply input, shared field binding, proposal invalidation, explicit acceptance, history, lending linkage and Bridge regressions with focused tests, app typecheck, touched-file lint and diff check only. Stop after this refinement.

### UX-003B refinement — consistent numeric entry

- Share a token amount input across editable card fields and their bound Advanced Settings amounts. Replace a starting zero on typing/paste, remove redundant integer zeros using string operations, preserve decimal digits, allow an empty field during editing and restore zero on empty blur. Leave financial parsing, precision limits and raw-unit conversion unchanged.
- Start new standalone Supply cards at zero through the existing unconfigured-card path. Preserve the known wallet beneficiary and use the existing ADD_SUPPLY validation and explicit Review/Apply before creating a canonical node. Existing configured Supply/lending amounts remain unchanged.
- Synchronize React Flow's existing card projection before paint so rapid typing does not restore an outdated controlled input value. Preserve the same amount buffer, selection, layout and proposal guards.
- Validate keyboard entry, pasted/replaced values, decimals, empty/blur, shared settings, incomplete-stage gates, invalid-zero rejection, guarded acceptance, history and existing card/layout behavior with targeted checks only.

### UX-003B refinement — token pill sizing and compact value stacks

- Enlarge the shared Supply/Swap/Bridge token pill slightly: 34px minimum height, 22px avatar, 18px icon, 12px ticker and a little more horizontal padding. Retain the rounded shape, palette and network badge.
- Reduce the amount/USD stack gap from 4px to 2px. Preserve typography, readability, card layout, editing, proposal controls and Advanced Settings.
- Check token and fiat-priority box fit at desktop and narrow widths, focused card/projection tests, app typecheck, touched-file lint and diff check only; stop after this visual pass.

### UX-003B refinement — readable network badges and paired display mode

- Increase the shared network badge from 9px to 12px and its lettering from 6px to 8px, preserving its circular overlay, accessible network label and secondary position within the existing pill.
- Move fiat/token display state from individual ValueBoxes to their ComposerCard. Pass one controlled mode to both Swap/Bridge boxes; either fiat subline switches both, and either return control restores both to token-primary display.
- Preserve source editing, unavailable-value placeholders, amounts and all authoring/financial semantics. Validate synchronized mouse/keyboard toggles, accepted amount continuity, badge fit at 1440/390/320px, focused component/browser checks, app typecheck, touched-file lint and diff check only.

### UX-003B refinement — badge and value-stack proportions

- Increase the network overlay to 14px with 9px lettering, keeping it smaller than the main token icon and clear of the ticker.
- Reduce primary token amounts from 26px to 24px and primary fiat values from 22px to 21px. Align the editable line height with that typography and reduce the main/subline gap to 1px, preserving supporting text sizes and strong primary weight.
- Keep the shared pair toggle, all amounts and financial behavior unchanged. Validate both display modes and Supply/Swap/Bridge fit at desktop/narrow widths using focused checks only, then stop.


### UX-003B refinement — single lending value blocks and compact fiat sublines

- Reuse Supply's single value/token block for Build Borrow, Repay and Withdraw cards using their existing action summaries. Preserve action labels, metadata, risks, selection, Advanced Settings and existing editor behavior; add no inline authoring controls to these cards.
- Reduce token-primary values from 24px to 22px and fiat-primary values from 21px to 20px; retain supporting text and the 1px stack gap.
- Replace the fixed 45px fiat-mode source input width with a content-length width and right-align it next to the token symbol. Render noneditable token sublines as one label with a single space. Preserve the existing shared pair display mode and editable amount component.
- Validate all six affected card types at 1440/390/320px, existing settings bindings, numeric entry and guarded acceptance, component/projection tests, app typecheck, touched-file lint and diff check only; stop after this presentation pass.


### UX-003B refinement — editable lending cards and paired liquidity layout

- Extend Supply's existing zero-based required-field authoring setup to standalone Borrow, Repay and Withdraw. Retain wallet-bound beneficiaries/connected-owner recipient semantics, existing Add/Set constructors and canonical validators. Unconfigured or unapplied amounts reuse the existing Simulate/Execute gates.
- Bind one shared amount buffer to each card and its existing settings form, including Borrow in the lending composition. Card Review/Apply buttons submit those same forms and accept the same proposals. Preserve linked Borrow edits through AUTHOR_LENDING, including unchanged-value acceptance scoped to the selected node.
- Project actual Uniswap, Orca and existing liquidity quantities into two shared value/token blocks, with the same circular arrow and paired display mode as Swap. Both blocks describe liquidity contributions; neither is a fabricated swap output or quote. Liquidity editing remains in its existing position settings.
- Preserve card sizes, action labels, metadata, network badges, Advanced Settings, canonical IR, provider/runtime behavior and financial parsing. Validate zero rejection, positive acceptance, stale review protection/history, shared settings, linked lending, real liquidity assets and layout at desktop/narrow widths using targeted checks only.


### UX-003B refinement — Pool Tick/Price selector and strategy tiles

- Add a compact Build-only Tick/Price selector below the liquidity pair line, defaulting to Tick. Preserve the existing two contribution blocks, metadata and Advanced Settings.
- Price reveals four native radio tiles: Estável (± 0.03%), Amplo (–50% — +100%), Unilateral inferior (–50%) and Unilateral superior (+100%), with the requested Portuguese descriptions. Keep selection local to the presentation, with no authoring command or range mutation.
- Keep Tick at the existing card width; widen only the expanded Price card to 300px for readable tiles. Use React Flow's existing fit operation after measurement, without animation, reserving space below for the existing CTA. Keep shell and canvas controls unchanged.
- Validate collapse/reveal, exclusive and keyboard selection, real contribution/position continuity, untouched workflow revision/proposal flow, desktop/narrow fit and existing card regressions with focused checks, typecheck, touched-file lint and diff check only.


### UX-003B refinement — Pool segmented mode control and Amplo default

- Replace the native dropdown with a compact rounded Tick/Price segmented button group. Tick remains the initial mode; show the active segment in FloFi blue and keep the inactive segment neutral, with accessible pressed/focus states.
- Keep the existing Price-only 2x2 grid and requested copy. Make the strategy name strongest, the range secondary and the explanation smaller/muted; add a subtle check and clear blue border/background to the selected tile, with neutral unselected/hover styling.
- Select Amplo whenever the user switches from Tick to Price. Clicking an already-active Price segment preserves an explicitly chosen preset. Keep both mode and preset as presentation state with no authoring command, runtime mapping or IR mutation.
- Validate defaults, reveal/hide, exclusive selection, keyboard/focus and hover geometry, unchanged position/revision, narrow-width fit and unrelated card regressions; run focused checks, typecheck, touched-file lint and diff check only.

### UX-003B refinement — Pool provider selector and Custom range preview

- Replace Build Pool's provider/network text with a compact native Uniswap/Solana selector, initially reflecting the authored provider. Keep selection as a UI preview; preserve actual assets, network badges and all position settings.
- Replace the redundant token-pair chip with a small Custom percentage input, initially 10%, and a secondary Price range line below it. Keep its value local to presentation, without changing authored bounds or creating proposals.
- Preserve Tick/Price behavior, presets, contribution blocks, Advanced Settings and unrelated cards. Validate default provider, preview interactions, untouched workflow/position data, compact layout at 1440/390/320px and focused card regressions; run only targeted tests, app typecheck, touched-file lint and diff check.

### UX-003B refinement — attached right-side Pool presets

- Keep the Pool card at its compact size in both Tick and Price modes. Place Price's existing 2x2 presets in a sibling panel to its right, connected by a short line, with a subtle reveal that respects reduced motion. Include both surfaces in the existing React Flow node measurement/fit, keeping the panel inside the canvas without changing workflow order or financial nodes.
- Replace Uniswap/Solana's dropdown with the same blue/neutral segmented-button styling as Tick/Price. Retain local UI preview state and the actual provider default; preserve all assets, position settings and runtime behavior.
- Add a thin decorative control placeholder directly above Custom and remove the Price range text. Retain the local Custom percentage control and the Advanced Settings footer.
- Validate right-side attachment, unchanged compact dimensions, two-column presets, viewport/CTA clearance, provider segments, placeholder placement, absence of price text and unrelated card regressions at 1440/390/320px. Run only focused tests, app typecheck, touched-file lint and diff check.


### UX-003B refinement — compact Pool controls and remembered Price presets

The Pool-only lower controls now show a decorative horizontal line with two outlined endpoints and a blue center marker, followed by Custom and Tick/Price on one vertically centered row. The percentage remains a local editable preview with no nested input frame; keyboard focus is indicated on the containing Custom control. The old thin rectangle and visible Range label are removed. The percentage and preset choices remain presentation state, independent of authored liquidity bounds.

The attached right-side 2x2 Price panel adds a compact double-chevron hide button. Hiding leaves Price selected; clicking Price again reopens it. Preset selection is held by the existing card and survives panel collapse, Tick/Price switches and reopening. Amplo remains the first-entry default. The panel still fits within the canvas and does not increase the compact card height.

Review and Apply now appear directly below the Custom/mode row and above Advanced Settings. Review submits the selected Pool's existing position form through a native form association. Apply uses the existing proposal acceptance callback and is disabled unless the matching proposal is valid and its base revision matches the workflow. The standalone lower proposal surface is hidden for Pool position edits; other proposal surfaces remain unchanged. Parameter editing and validation still live in the same Advanced Settings form. No new financial commands or range/preset mappings are introduced.

Integration touchpoints: optional reviewFormId on UniswapLiquidityForm/SolanaLiquidityForm associates the in-card Review button with the existing submit handlers and suppresses only their duplicate edit CTA. ArtifactInspector supplies these IDs (and the existing legacy Pool form ID); WorkflowCanvas projects the current proposal eligibility; WorkflowEditReview suppresses the redundant Pool proposal panel. Creation forms without reviewFormId preserve their previous controls. Runtime, adapters, canonical IR, validators, authoring reducers, simulation/execution and unrelated card interactions are unchanged.

Affected files: apps/reference-dapp/src/components/composer-card.tsx, workflow-canvas.tsx, artifact-inspector.tsx, uniswap-liquidity-panel.tsx, solana-liquidity-panel.tsx, workflow-edit-review.tsx, build-correction.test.tsx; apps/reference-dapp/src/app/globals.css; apps/reference-dapp/e2e/composer-product-cleanup.spec.ts; this plan/report pair.

Targeted validation passed: 39 Build/Simulate component tests, eight focused Chromium cases, app typecheck, touched-file ESLint and git diff check. Browser checks cover borderless percentage focus, three range markers, same-row alignment, inline Review/Apply, disabled Apply before review, unchanged values until acceptance, valid position application, invalid position rejection without revision change, no duplicate lower proposal panel, right-side panel containment, collapse/reopen preset persistence and keyboard selection at 1440/390/320px. Existing Swap/Bridge/Supply/Borrow/Repay/Withdraw checks pass. One additional visual capture case covers Tick/Price at all three widths; desktop Tick and narrow Price were inspected. Captures remain ignored in .tmp. No full CI or further refinement was run. Stopped after this refinement.


### UX-003B refinement — symmetric custom Price range

Price mode now presents the Pool's reference price above a fixed dark center marker, two draggable white boundary handles, a highlighted symmetric interval, live -X%/+X% labels and Custom ±X%. The available track represents ±100%; a ±10% selection places handles at 45%/55% rather than its endpoints. Pointer capture supports dragging either side, with the opposite boundary mirrored immediately; arrow keys, Shift+arrow, Home/End and the compact percentage input update the same shared value. Tick remains the default native configuration view and hides the Price slider/Custom input. Switching back to Tick returns editing to the native form. Entering Price again binds the remembered percentage to the shared editable configuration, so Review always validates the visible range; reopening the already active Price panel preserves any current review. The four right-side preset tiles, collapse control and remembered selection remain unchanged and are not mapped to financial commands.

A small PoolPriceRangeProvider holds only per-node UI editing buffers (one percentage, a price reference and review eligibility), shared by each card and its existing selected position form. It introduces no alternate workflow graph or persisted financial model. The reference comes from the existing Uniswap/Orca price stores and existing read-only fetchPrice paths, matched to the actual authored node rather than the preview provider segment. Until a genuine reference is available the label shows --; editing the custom percentage then keeps Review/Apply unavailable. Known prices retain their actual USDC/devUSDC quote denomination, without inventing a USD conversion. An edit captures its reference so the reviewed range stays tied to the price displayed.

Uniswap custom percentages reuse uniswapBandInput; only the existing rangeUnit/lower/upper editing fields enter the proposal. Solana derives exact decimal percentage bounds from its existing price string; the existing Orca authoring validator performs protocol alignment. The current Uniswap band limit (0.01%–90%) bounds this first symmetric control. Amount parsing, token units, schemas, adapters and runtime are unchanged. Manual native-bound editing restores the existing editor path. Dragging creates no canonical edit or proposal; Review submits the existing validated position form, and only explicit Apply accepts the matching valid proposal. Changing the percentage again dismisses its previous position proposal and requires a new Review. No zero/invalid range is silently accepted.

Integration touchpoints: AppShell adds the UI-only provider wrapper without shell/Copilot redesign; ComposerCard and WorkflowCanvas bind the Pool node identity and editor controls; UniswapLiquidityForm/SolanaLiquidityForm derive their editable range from the shared buffer before their existing validation/proposal calls. ResizeObserver watches both the available canvas size and measured Pool surfaces, and refits only the Pool Price view when these dimensions change, keeping handles and the attached preset panel accessible. A 56px right fitting gutter keeps the expanded panel clear of the unchanged lower-right zoom controls. No other card interaction or lifecycle behavior changes.

Affected files: apps/reference-dapp/src/components/pool-price-range.tsx (new), pool-price-range.test.tsx (new), composer-card.tsx, workflow-canvas.tsx, app-shell.tsx, uniswap-liquidity-panel.tsx, solana-liquidity-panel.tsx, build-correction.test.tsx; apps/reference-dapp/src/app/globals.css; apps/reference-dapp/e2e/composer-product-cleanup.spec.ts; this plan/report pair.

Targeted validation: 39 existing Build/Simulate component tests plus 11 symmetric-range tests passed; nine focused browser regression cases passed, covering both mouse handles, keyboard and input synchronization, reference-marker stability, close-to-center proportional positions, mirrored live labels, Price-only display, missing-price safeguards, unchanged revision during editing, inline position validation/acceptance, preset collapse persistence and Swap/Bridge/Supply/Borrow/Repay/Withdraw regressions. A further test-only browser price-response fixture in ignored .tmp verifies quoted-source display, existing Review/Apply acceptance, review invalidation after another range edit, stored position bounds after Apply and no wallet signing/broadcast. Typecheck, touched-file ESLint and git diff check passed. Visual captures cover Tick/Price at 1440/390/320px; browser geometry waits for measured React Flow transforms before comparing bounds. No full CI, schema/runtime/API changes or subsequent UX work were performed. Stopped after this refinement.


### UX-003B refinement — linked Pool presets and stronger range control

Scope: Build Pool/Liquidity Price view only. Strengthen the track, outlined handles and fixed reference marker; raise reference and percentage legend sizes slightly. Move the attached preset panel hide button to the center of its left edge. Preserve provider segments, Tick/Price, inline Review/Apply, Advanced Settings and canvas controls.

Keep preset selection in the same per-node range editing buffer as the slider. Selecting Estável projects −0.03%/+0.03%; Amplo −50%/+100%; Unilateral inferior −50%/0%; Unilateral superior 0%/+100%. The center remains fixed. Use a closer visual scale for the small stable interval so its handles remain distinguishable, and headroom for wide intervals so boundaries do not sit against track endpoints. Display exact boundary labels. Manual handle/percentage edits return to the existing symmetric Custom path; preset selection survives panel collapse and reopening. The initial Custom ±10% shows no false preset highlight.

Reuse existing native PRICE range fields and existing authoring validation for preset Review/Apply. Selection or dragging alone changes no workflow revision. Changing the selected preset invalidates its preceding proposal. Missing real price keeps Review/Apply unavailable; genuine reference labels retain their quote-token denomination. No runtime/schema/adapter changes. Validate all four preset positions and existing protocol constructors, mouse/keyboard selection, collapse geometry/persistence, native Review/Apply, adjacent card regressions, app typecheck, touched-file lint and diff check.


Recovery completion: resumed from `ae2bc45` with all inherited changes preserved; completed stronger track/handles/marker/legend styles and verified the four preset projections, retained highlighting and centered left-edge collapse control. Final targeted checks: 136 unit/component tests, 32 browser interaction cases, one visual capture case, app typecheck, lint on all 42 touched TS/TSX files and whitespace validation. See the report's recovery entry and complete file manifest. Commit the accumulated post-`ae2bc45` UX work once as `UX-003B: productize workflow card interactions`, then stop without starting another UX phase.
