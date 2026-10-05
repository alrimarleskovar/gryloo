# BUILD-PRODUCT-UX-001 — Product UX report

Date: 2026-10-04. Branch: `codex/build-product-ux-001`. Base: `1cf923f`.
Plan: [BUILD-PRODUCT-UX-001-PLAN.md](BUILD-PRODUCT-UX-001-PLAN.md).

## Status

**Part A committed; owner-requested Build direction correction implemented and validated separately. Further Part B work awaits owner instruction. Parts C–E have not started; full certification remains pending Part E.**

Part A commit: `UX-001A: product shell and navigation`. Stop after this commit and await owner instruction for Part B. No PR, deployment or public financial execution is performed in Part A.

## Part A — Visual and product changes

- Standardized the primary brand to **FloFi**, retaining the existing logo asset. Updated page metadata to describe the shared Build → Simulate → Execute lifecycle.
- Made the existing three-stage navigation visibly numbered, with a single `aria-current` marker. Numbering describes the lifecycle sequence; selecting a stage does not claim completion or authorization.
- Added a shared workspace heading with persistent **draft** identity, canonical workflow id/revision, action count, deduplicated chain labels, and explicit mock-example labeling. The chain list is context, not a provider route or an execution result.
- Added concise stage-specific guidance explaining composition, simulation/Manifest review, and wallet authorization/reconciliation/evidence. Kept existing flow-specific descriptions and all existing panels.
- Kept the connected wallet's actual account/network distinct from the workflow's required network. Required-network display now covers canonical EVM actions, the Journey router's source chain and supported recovered router context. Existing Base/Arbitrum continuation network selection remains presentation-only.
- Added explicit network-switch shortcuts only for targets already supported by the shared wallet store. They call the same `switchTo` method only on a user click. Connection, reset, errors, account/chain event handling and wallet discovery methods are unchanged.
- Showed the existing Solana wallet connection state for Solana workflows, with connection still handled in the existing workflow panel.
- Shortened the app-only wallet reset label to “Disconnect”; its tooltip explains that wallet permissions are managed in the wallet. It invokes the unchanged app reset method.
- Moved local-fork diagnostic badges and wallet information into expandable technical details, retaining a visible local-fork summary and exact MOCKED/FORK_REPRODUCED labels inside. Retained the detailed mock simulation boundary in an expandable “Simulation context”, alongside a visible statement that mock results/observations cannot authorize execution.
- Added a keyboard skip link, a labelled/focusable workspace landmark, a restrained desktop header/container, consistent stage guidance and continuation styling, and responsive stacking that keeps wallet/network information visible. Removed the old rule hiding header status at intermediate widths.
- Updated existing browser selectors for the intentional brand, disclosure and Disconnect label changes. No assertions about financial gates were removed. Screenshot baselines remain unchanged until Part E's browser validation.

Implementation uses `product-shell.ts` as a read-only presentation projection and `WorkspaceHeading` as shared UI. It creates no second authoring representation. The existing Canvas/command proposal surface remains intact; no Guided Chat work was added.

## Untouched backend and runtime guarantees

No backend, server actions, API contracts, state stores, provider adapters, canonical IR schema/semantics, compiler, linter, executor, journal, worker, recovery engine, reconciler or evidence format was changed.

The existing AppShell flow-routing conditions, execution-surface guards, SummaryBar continuation guards, Review/Manifest bindings, explicit wallet authorization, ownership enforcement and Journey sign-in/run reopening remain intact. Navigation and wallet-network display are not financial authority.

Durable preparation/handoff, ambiguous-submission never-resend behavior, route-change/expiry invalidation, exact approvals, safe-head reconciliation and evidence maturity remain governed by the existing implementation. UI unit tests do not certify those backend guarantees; they confirm presentation does not mutate IR or initiate wallet actions during rendering.

## Validation by phase

### Part A

Used the repository-pinned Node **24.21.0** and pnpm **11.22.0** from the existing approved toolchain cache.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts --store-dir .tmp/pnpm-store --cache-dir .tmp/pnpm-cache` | Passed; no dependency or lockfile changes. Sandbox DNS failure (`EAI_AGAIN`) resolved with an approved network-enabled retry. |
| `pnpm exec turbo run build --filter='./packages/*'` | Seven package compilation prerequisites restored from Turbo cache for workspace imports; no full app/CI build. |
| `pnpm --filter @defi-workflow-engine/reference-dapp typecheck` | Passed. |
| Targeted Vitest: `domain/product-shell.test.ts`, `config/product.test.ts`, `state/build009-wallet-store.test.ts`, `wallet/evm-networks.test.ts`, `domain/router-authoring.test.ts` | **40 tests passed across five files.** Covers canonical chain projection, unknown/empty/mock states, router authoring and existing injected-wallet/network behavior. |
| Targeted Vitest: `components/product-shell.test.tsx` | **5 tests passed.** Server rendering checks single current stage, draft identity across stages, correct Journey required-network display alongside the actual wallet network, and no wallet action initiated during rendering. |
| ESLint on changed TS/TSX UI, presentation tests and adjusted browser selectors | Passed. |
| `git diff --check` | Passed. |

No PostgreSQL, Anvil/fork, browser, dependency audit, SBOM or full certification suite was run. Browser assertion updates were typechecked/linted, not browser-certified.

Workspace hygiene: the pre-existing `.tmp/` directory and an unrelated generated `apps/reference-dapp/next-env.d.ts` change are excluded from the Part A commit.

### Owner-requested Build direction correction

Correction commit: `UX-001: correct Build cards and primary product language`. This supersedes Part A's visible mock-example badge and prototype copy. It establishes the corrected Build direction; it does not claim completion of Part B.

Visual and product changes:

- Removed the mock-example badge and scaffold cards from the primary canvas/context projection. The canonical scaffold is retained internally for compatibility; the starting workspace displays an empty canvas and zero product actions.
- Supply, Borrow, Repay and Withdraw now immediately create and select compact canonical cards through their existing authoring commands. Cards identify action, Aave V3, Base Sepolia and USDC amount; Borrow/Withdraw include debt/collateral context. No setup forms or dialogs are inserted into the canvas.
- Moved the existing selected-node inspector beside the canvas on desktop and below it at narrower widths. Parameter edits retain the existing Review change → Apply proposal boundary; authoring acceptance does not authorize financial execution. Styled inspector controls consistently.
- Added a small external workflow-edit review panel for the existing pending proposal. Kept the old command panel accessible under Technical authoring tools, with its duplicate proposal presentation hidden. No Guided Chat implementation or logic was added.
- Bridge and Pool toolbar actions now use existing canonical router and Uniswap liquidity constructors rather than mock templates. These are editable authoring defaults, with simulation and authorization still required.
- Retained the existing connected Supply → Borrow → Swap flow and its two visible dependency/output links; labels now read “Health factor ≥ 2” and “Borrowed USDC”. Existing IR edges and checkpoint semantics are unchanged.
- Removed primary canvas template/mock copy and moved legacy authoring, simulation/execution diagnostics and lending provenance/evidence classifications into closed technical disclosures. Exact diagnostic provenance remains available; no mock evidence is promoted to live execution evidence.
- Updated affected lending authoring browser helpers and disclosure selectors without removing financial safety assertions. Fixed singular action counts, inspector width and the keyboard skip link's hidden presentation.

Architecture boundary: `canvas-authoring.ts` supplies existing `Command` values, not another workflow representation. Existing reducer validation, history/layout updates, proposal acceptance and review invalidation remain the mutation boundary. No backend, provider, API, IR schema, Manifest, wallet signing, journal/recovery, reconciliation or evidence-format changes were made. Stage-specific financial routing and continuation guards are retained; the added disclosure is presentation only.

| Check | Result |
| --- | --- |
| Targeted Vitest: canvas authoring, product-shell domain/render, Build correction render, supply/borrow/repay/withdraw/lending authoring | **82 tests passed across nine files.** Verifies canonical constructors, unchanged standalone connection rejection, connected lending projection and selected card/inspector rendering with no inline forms or render-triggered edits. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched source/tests/browser helpers | Passed. |
| Focused Chromium checks against the existing loopback development preview | **8 checks passed:** clean primary stage language; four action add/select/edit/apply/reselect paths; canonical Bridge/Pool cards; three-card/two-link lending composition. Browser egress was blocked except the loopback preview and its development HMR; no external browser traffic or signature/send requests occurred. |
| Desktop and 390px responsive inspection | Captured local review images in `.tmp/product-ux-correction-{desktop,mobile,composed}.png`; no mobile document overflow. These are development-preview artifacts, not certified screenshot baselines. |
| `git diff --check` | Passed. |

Browser infrastructure: initial process launch was blocked by sandbox socket restrictions; an approved local-browser retry resolved it. A proposed second development server could not acquire the existing Next lock, so checks used the owner's existing loopback preview without stopping it. Blocking its localhost HMR initially prevented hydration; the focused script allowed only that development socket, with external traffic still blocked. Repository browser egress gates were not changed.

Workspace hygiene: `.tmp/` review artifacts and the unrelated generated `apps/reference-dapp/next-env.d.ts` change remain excluded from this correction commit.

No full browser suite, financial execution, PostgreSQL, Anvil/fork, dependency audit, SBOM or final certification was run for this correction. The focused check uses a stub wallet for account/network access and does not certify server deployment or execution. The existing preview's runtime mode configuration was not changed.

### Owner-directed Part A workflow identity and Privacy affordance

Commit subject: `UX-001A: refine workflow identity and privacy affordance`.

Visual/product changes:

- Removed GRYLOO from Copilot messages; retained ASSISTANT and Copilot. The prompt now reads exactly “Describe your flow”. Replaced the local-command welcome, developer example placeholder, raw command-help footer and parse-error help with concise product copy. Explain displays authored actions using the existing summary, excluding the same hidden scaffold as the canvas; it reports an empty flow when no authored actions exist. User messages remain intact.
- Added a small pencil next to the existing workflow name. Inline input focuses/selects its value; Enter or blur confirms a trimmed, nonempty name, Escape cancels without clearing the selected action, and blank input preserves the previous name. Names are limited to 80 characters and wrap without horizontal page overflow.
- AppShell owns the presentation-only name, defaulting to Your Workflow. It survives section navigation in the current mounted session and resets on reload. It is not persisted to canonical IR, reviewed runs, Manifest or evidence, and renaming does not increment revision.
- Added a disabled Privacy shield immediately after Withdraw in both toolbar placements. Accessible name: Privacy; tooltip: “Privacy · not available yet”. It has no click handler, command factory, canonical action entry or execution capability. No Cloak/Zcash wiring or execution claim was added.
- Fitted the additional entry into the existing 46px floating toolbar by changing its vertical gap from 2px to 0 and orienting its divider horizontally (24×1px). Buttons/icons, existing ordering and behavior are retained; the 620px canvas/Copilot heights, inspector position and bottom-right zoom controls remain unchanged. All icons fit without internal scrolling at tested desktop/mobile widths.
- Updated affected browser input-label selectors and toolbar ordering; added focused identity/Copilot browser coverage and component presentation assertions.

Untouched guarantees: Copilot command parsing, proposal/apply/dismiss flow and revision binding; canvas node operations and inspector forms; canonical IR and runtime; backend/API/provider execution; wallet/session/signature authorization; Manifest semantics; durable recovery, reconciliation and evidence. No Guided Chat implementation or parallel-branch changes. No Simulate/Execute behavior changes. Part B remains pending.

| Targeted validation | Result |
| --- | --- |
| Vitest: `components/copilot-panel.test.tsx`, `components/build-correction.test.tsx`, `components/product-shell.test.tsx` | 14 tests passed across three files. Product copy, untouched render state, inert Privacy placement, title rendering, existing selected lending cards and header/navigation checks. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source and browser tests | Passed. |
| Focused Chromium: `e2e/build-identity.spec.ts`, `e2e/build-layout.spec.ts` against the existing loopback development preview | Five tests passed. Inline Enter/Escape/blur/blank handling, current-session navigation retention, mobile long-title overflow, Privacy inertness/order in both toolbar modes, existing Copilot propose/apply/explain, canvas/Copilot/inspector placement, toolbox fit at 1440px/390px, unchanged add/edit/zoom behavior. |
| `git diff --check` | Passed. |

The first browser pass caught scrolling after the extra toolbar entry; the scoped spacing/divider fix resolved it without changing canvas height. Browser checks used the existing preview at 127.0.0.1:3001 with external HTTP/WebSocket traffic blocked; only the preview and its development HMR were allowed. All five checks verified zero wallet sign/send requests. Repository egress gates and financial test assertions were not weakened. Temporary loopback fixture/config copies and browser artifacts remain in untracked `.tmp/`, excluded from the commit.

Limitations: the workflow name is session-only presentation identity; Privacy remains unavailable; Copilot still accepts its existing supported command grammar without a new model or Guided Chat. Older mock-scaffold browser scenarios remain pending alignment during later UX work. Selector updates outside the two focused browser files were typechecked/linted, not browser-certified. No full CI, PostgreSQL, Anvil/fork, dependency audit, SBOM or final certification was run.

### Owner-directed Part A header controls and advanced expansion

Commit subject: `UX-001A: refine header controls and advanced section`.

Visual/product changes:

- Wrapped the existing concise wallet address/network text and Connect/Disconnect button in a bordered, rounded wallet control. Kept the original text, full-address tooltip, disconnect explanation, handlers and busy disabling. Network requirements, mismatch warnings and switching remain in their existing header row. The box can shrink and its text wrap at narrow widths.
- Added a separate 40×40px bordered Settings control beside the wallet box, vertically centered. It contains only a gear icon, with accessible name/tooltip Settings. It is disabled and has no handler, dropdown, modal or destination.
- Removed the outer Technical authoring tools disclosure and its obsolete style. Advanced action setup is now the single outer expandable section, collapsed by default. All existing forms/provider-specific disclosures remain intact. Conditional ReviewPanel content is passed into that same section without changing its gating, findings or IR disclosure. Selected Action, workflow edit review and Journey controls retain their existing positions and behavior.
- Updated the affected browser assertions and added focused header/advanced-section checks. No Copilot, canvas, runtime, IR, API, wallet/session, Manifest, reconciliation/evidence or Simulate/Execute behavior changes. No Guided Chat work. Part B remains pending.

| Targeted validation | Result |
| --- | --- |
| Vitest: `components/product-shell.test.tsx` | 11 tests passed. Connected/disconnected wallet boxing, inert icon-only Settings, preserved busy disabling, lifecycle navigation, wallet/workflow networks and existing headings. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source and browser tests | Passed. |
| Focused Chromium: `e2e/header-controls.spec.ts`, `e2e/build-layout.spec.ts` | Four tests passed against the existing loopback development preview. Connect/disconnect, Settings inertness, boxed-control alignment at 1440px/900px/390px without document overflow; direct single expansion access to preserved forms and workflow findings; unchanged IR/revision when toggling; existing canvas/Copilot/inspector layout, authoring edits, toolbar fit and zoom behavior. |
| `git diff --check` | Passed. |

Browser checks allowed only the existing preview at 127.0.0.1:3001 and its development HMR, with external browser traffic blocked and zero wallet sign/send requests verified. Temporary fixture/config copies and artifacts remain in untracked `.tmp/`, excluded from the commit. No repository egress gate changed. The unrelated legacy interface-honesty scenarios were typechecked/linted; only their removed outer-disclosure click was adjusted. No full CI, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run. Settings remains an unavailable placeholder.

### Owner-directed Part A canvas CTA and settings dropdown

Commit subject: `UX-001A: refine canvas CTA and settings menu`.

Visual/product changes:

- Moved the primary Build button from SummaryBar into the graph surface. Its exact label is “Simular Fees”; its original navigation callback remains `setTab('Simulate')`. It does not generate quotes/simulations, change workflow revision or authorize execution. The footer keeps its workflow count/revision context. Simulate/Execute footer routing and review guards are unchanged.
- The floating button sits 12px above the graph bottom and 56px from its right edge, beside the existing zoom controls with at least a 12px clear gap. It stays outside React Flow's transformed node layer and does not change pan/zoom, selection or node commands. Existing control positions are retained.
- Build's maximum container width increases from 1600px to 1720px; desktop horizontal padding decreases from 28px to 20px, with 16px mobile padding retained. This adds 16px to the canvas column at a 1440px viewport and 136px at 1920px. Copilot remains 340px wide on desktop with the existing responsive stacking; Selected Action remains below. The canvas now fills its existing column on mobile rather than shrinking to intrinsic content width. Canvas/Copilot heights remain unchanged. Simulate/Execute containers are untouched.
- Settings now toggles an absolute dropdown aligned beneath the gear's right edge with an 8px gap. It contains only Language, Theme and Disconnect. These are visibly disabled placeholders with no language/theme/wallet behavior. The existing wallet-box Disconnect remains functional and unchanged. Outside pointer clicks, Escape and focus leaving the settings control close the dropdown; Escape restores gear focus without clearing the selected canvas node. Opening the menu does not change header/canvas geometry.
- Updated existing browser CTA selectors to the requested label, preserving financial assertions, and added focused CTA/footer/dropdown coverage.

Untouched guarantees: canonical IR, runtime, API/backend/provider adapters, Manifest and wallet/session semantics, simulation/execution gates and behavior, durable recovery/reconciliation/evidence, canvas action semantics/card presentation, inspector forms, Copilot logic, Privacy entry/integration and Guided Chat. Part B remains pending.

| Targeted validation | Result |
| --- | --- |
| Vitest: `components/product-shell.test.tsx`, `components/build-correction.test.tsx`, `components/summary-bar.test.tsx` | 21 tests passed across three files and focused runs. Header/navigation, selected canonical cards, graph-contained CTA rendering, absence of duplicate Build footer action, preserved Supply review gating. An initially incomplete test-only Supply record fixture was corrected and its three-test file rerun successfully; no runtime code was changed for it. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source and browser tests | Passed; reran on the corrected footer fixture and updated CTA test. |
| Focused Chromium: `e2e/canvas-cta.spec.ts`, `e2e/header-controls.spec.ts`, `e2e/build-layout.spec.ts` | Seven tests passed against the existing loopback development preview. CTA placement/spacing and default-card non-overlap in docked/floating modes at 1920px/1440px/390px, wider canvas, retained Copilot/inspector, unchanged authoring/zoom, navigation-only continuation and disabled unsimulated Supply review, settings options/toggle/outside/Escape/Tab, preserved wallet connection/node selection/revision, no dropdown layout shift or document overflow, and preserved single advanced expansion/content. |
| `git diff --check` | Passed. |

The first browser pass found the mobile canvas shrinking to intrinsic width, causing CTA/toolbox overlap. Filling its existing column resolved the layout failure without changing heights, controls or semantics. Browser checks permitted only the existing preview at 127.0.0.1:3001 and its development HMR; external traffic was blocked, and all seven tests verified zero wallet sign/send requests. Temporary fixture/config copies and diagnostics remain in untracked `.tmp/`, excluded from the commit. Repository browser gates were not changed.

Limitations: settings options are presentation-only; “Simular Fees” opens the existing Simulate view and does not imply fees are known or automatically calculated. Browser files with only CTA-selector updates were typechecked/linted, not execution-certified. No full CI, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run.

### Owner-directed Simulate shell cleanup

Commit subject: `UX-001A: simplify Simulate workspace shell`.

Removed the complete Simulate introductory block: draft name, action count, revision, chain context, SIMULATE / WORKFLOW eyebrow, large page title/subtitle, Current stage badge and Understand the outcome guidance strip. No visible replacement was added. The existing simulation content is now the first content in the main workspace. Its accessible label is Simulation workspace rather than a reference to the removed title. Existing empty states and diagnostic disclosures remain intact.

Only heading presentation and landmark labeling changed. Build/Execute behavior and presentation, simulation routing/logic, artifacts, canonical IR, runtime, backend/API, Review/Manifest binding and wallet authorization remain unchanged. No Part B work.

Validation: 12 focused `components/product-shell.test.tsx` tests passed; reference-dapp typecheck, touched-file ESLint and `git diff --check` passed. One focused `e2e/simulate-shell.spec.ts` browser check passed against the existing loopback preview: intro absent in empty and authored flows, existing Aave Supply content first, simulation action still available, unsimulated review disabled, unchanged revision/selection on navigation, and retained Build/Execute UI. External browser traffic was blocked, only the preview/development HMR allowed, and zero wallet sign/send requests verified. Temporary loopback fixture/config copies remain in untracked `.tmp/`, excluded from the commit. No full CI, financial execution, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run.

### Owner-directed Simulate control and return-action cleanup

Commit subject: `UX-001A: simplify Simulate controls and move return CTA`.

Visual/product changes:

- Removed the upper eligibility-information bar and Show/Hide technical details button. No replacement strip/banner/toggle was added above the graph. The fallback simulation graph is directly visible; the redundant preparation card/outer technical wrapper no longer hides it. Existing product-specific simulation panels are unchanged.
- Moved Return to Build into the simulation graph, outside React Flow's transformed node layer, 12px from the right and bottom edges. It uses the original `setTab('Build')` navigation through a presentation callback. Simulation zoom controls remain at their original bottom-left position; Build's CTA/controls and Execute return controls are unchanged.
- Preserved generation/refresh buttons, eligibility disabling, rejection/pending/superseded feedback, artifact values and proof access. Eligibility explanations and all existing observation/fork/Mode B/composition/CoW/liquidity panels remain accessible through a single Technical diagnostics disclosure below the graph/results. Its native toggle updates the existing technical-presentation state; no technical functionality was removed.
- Updated affected technical-disclosure browser selectors without changing financial assertions. Added focused rendering coverage and expanded the Simulate layout/browser checks.

Untouched guarantees: simulation/generation algorithms, artifact bytes and bindings, expiry/invalidation rules and access-time checks, canonical IR/runtime, API/backend/provider adapters, Review/Manifest/authorization semantics, wallet/session behavior, durable recovery/reconciliation/evidence, Build/Execute behavior, Copilot and Guided Chat. No Part B work.

| Minimal targeted validation | Result |
| --- | --- |
| Vitest: `components/simulate-panel.test.tsx`, `domain/artifact-chain.test.ts` | 10 tests passed across two files. Presentation/CTA/technical access, unchanged eligibility and pending-generation gates, hashing-rejection feedback; existing chain transition, race, exact revision/IR binding, invalidation and wall/monotonic expiry checks. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source/browser tests | Passed. |
| Focused Chromium: `e2e/simulate-cleanup.spec.ts`, `e2e/simulate-shell.spec.ts` | Two tests passed against the existing loopback preview. Graph/return visible without opening diagnostics, removed upper controls/message, 12px CTA placement without zoom-control collision at 1440px/390px, no document overflow, original return navigation and retained revision/cards, local synthetic artifact generation/results/JSON access, diagnostic reveal/hide, unsimulated/mocked review still disabled, and preserved product-specific Supply/Build/Execute views. |
| `git diff --check` | Passed. |

Browser checks allowed only the existing loopback preview and its development HMR, blocked external traffic, and verified zero wallet sign/send requests. Temporary fixture/config copies remain in untracked `.tmp/`, excluded from the commit. Financial browser files with selector-only changes were typechecked/linted, not fork/execution-certified. No full CI, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run. Existing synthetic artifact provenance remains explicit; this presentation cleanup makes no live-execution or evidence-maturity claim.

### Owner-directed Simulate canvas actions

Commit subject: `UX-001A: refine Simulate canvas actions`.

Visual/product changes:

- Removed the fallback Simulate panel's SIMULATE eyebrow and Simulation title, without a replacement heading. Existing artifact controls, generation/status/error feedback, graph, results and lower diagnostics remain intact.
- Positioned the existing React Flow zoom-in, zoom-out and fit controls at bottom-right, 12px from the right edge and 68px above the canvas bottom. Their logic is unchanged.
- Grouped Return to Build on the left and Review swap on the right, with an 8px gap, in a floating canvas row 12px from its bottom/right edges. Controls sit above the row with a 12px clear gap.
- Moved the original SummaryBar action through a React portal into the mounted simulation graph. There is one Review swap button, with the same handler, disabled conditions and routing precedence; no second review implementation or eligibility model was added. Footer workflow context remains. Existing product-specific panels without this graph and their footer actions are unchanged.
- Updated focused rendering/review-gate and browser layout checks. No simulation/artifact logic, canonical IR, runtime, backend/API, Review/Manifest or wallet authorization semantics, Build/Execute behavior, Copilot or Guided Chat changes. No Part B work.

| Targeted validation | Result |
| --- | --- |
| Vitest: `components/simulate-panel.test.tsx`, `components/summary-bar.test.tsx` | 14 tests passed. Removed labels and retained diagnostics/generation guards; canvas review remains disabled for unavailable/unprepared/retired/unverified/error states; ready review uses the existing Execute callback; unchanged footer behavior when no graph host exists and on Execute; preserved Supply review gating. |
| Reference-dapp typecheck | Passed. An initial test-only unchecked mock-call access was corrected before the successful rerun. |
| ESLint on touched TS/TSX source/browser tests | Passed. |
| Focused Chromium: `e2e/simulate-cleanup.spec.ts`, `e2e/simulate-shell.spec.ts` | Two tests passed against the existing loopback preview. 1440px/390px canvas action order/alignment/margins, control clearance, no document overflow, single graph-contained Review swap and no footer duplicate; zoom-out/zoom-in/fit on the fitted authored graph; preserved return navigation, revision/cards, artifact generation/JSON/technical access, disabled synthetic review, product-specific Supply and Build/Execute views. |
| `git diff --check` | Passed. |

The first browser attempts tried zoom-in at the existing maximum and then tested zoom during artifact-driven node remeasurement. The final check waits for the authored graph to fit and tests zoom-out first, before generating artifacts. All existing artifact/review assertions remain; no controls, fitting logic or safety gates were altered to pass checks.

Browser traffic was restricted to the existing loopback preview/development HMR, with external requests blocked and zero wallet signing/transaction requests verified. Temporary fixture/config copies and diagnostics remain in untracked `.tmp/`, excluded from the commit. No full CI, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run. This presentation change does not upgrade artifact/evidence maturity.

### Owner-directed Simulate control alignment and shared title

Commit subject: `UX-001A: align Simulate canvas controls and workflow title`.

Presentation changes:

- Shifted the simulation canvas action row left: 56px from the right edge and 12px from the bottom. Return to Build remains left of Review swap with an 8px gap. On mobile, reduced only these buttons' horizontal padding from 16px to 12px, preserving their 44px minimum height and avoiding the canvas edge.
- Existing React Flow controls now occupy the true bottom-right corner, 12px from both edges, with at least 12px horizontal clearance from the action row. Zoom/fit logic and all navigation/review handlers and gates remain unchanged.
- Removed MOCKED OUTPUTS · READ-ONLY and Graph from the canvas header. Its heading now displays the same `workflowName` already held in AppShell and edited in Build, passed through SimulatePanel to the simulation canvas. No second title state, persistence or canonical title was added. The primary canvas title area contains no mock/read-only/synthetic labels; diagnostics, artifact provenance and evidence semantics elsewhere remain intact.
- Preserved simulation/artifact generation, canonical IR and revisions, runtime, backend/API, Review/Manifest and wallet semantics, Build/Execute behavior, product-specific panels and Guided Chat. No Part B work.

| Targeted validation | Result |
| --- | --- |
| Vitest: `components/simulate-panel.test.tsx` | Four tests passed: supplied workflow-name propagation without canonical edits, retained diagnostic access, generation eligibility/pending gates and hashing rejection feedback. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source/browser tests | Passed. |
| Focused Chromium: `e2e/simulate-cleanup.spec.ts`, `e2e/simulate-shell.spec.ts` | Two tests passed. Build rename to ESPARTACUS and then ETH Carry Strategy reflected in Simulate and retained on return, with renaming leaving revision unchanged. Removed header labels, CTA order and spacing, 56px action offset and 12px control edge margins verified at 1440px/390px without overflow or overlap. Existing zoom/fit, artifact generation/proof access, disabled synthetic review, return navigation, Supply and Build/Execute views preserved. |
| `git diff --check` | Passed. |

The first layout check found insufficient left padding for the action row at 390px; scoped mobile button padding resolved it and the browser checks passed on rerun. Browser requests were limited to the existing loopback preview/development HMR, external traffic blocked, and zero wallet signing/transaction requests verified. Temporary fixture/config copies remain in untracked `.tmp/`, excluded from the commit. No full CI, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run. The shared title remains session presentation state and resets on reload, as before.

### Owner-directed Execute shell cleanup

Commit subject: `UX-001A: simplify Execute workspace shell`.

Removed the entire Execute introductory area: Draft · Untitled workflow, action count, revision and chain metadata, EXECUTE / WORKFLOW eyebrow, large Execute title/subtitle, Current stage · Execute badge and Authorize and track execution guidance strip. No visible replacement was added. The existing execution content is first in the main workspace. Its accessible label is Execution workspace instead of a reference to the deleted heading.

Deleted the now-unused WorkspaceHeading component and the shell's description-only constants/expression. Build and Simulate already omitted that component, so their presentation and behavior are unchanged. Existing content routing, empty states, technical disclosures, workflow footer and all authorization/execution/recovery/reconciliation/evidence interfaces remain intact. No canonical IR, runtime, backend/API, wallet/session, Review/Manifest or Guided Chat changes. No Part B work.

| Minimal targeted validation | Result |
| --- | --- |
| Vitest: `components/product-shell.test.tsx` | Nine shell/header/navigation tests passed. Removed unit expectations for the deleted heading component, including its obsolete positive Execute-header assertion; actual workspace absence is covered by the browser test below. Lifecycle numbering/current view, network context and wallet controls remain checked. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source/browser tests | Passed. |
| Focused Chromium: `e2e/simulate-shell.spec.ts` | One test passed against the existing loopback preview: complete intro absent on empty and authored Execute views, accessible landmark intact, existing empty-state/diagnostic content retained, Aave Supply execution panel first, no review acceptance/execution action for an unsimulated Supply, and preserved Simulate/Build content, selected node and revision. |
| `git diff --check` | Passed. |

Browser traffic was limited to the existing loopback preview/development HMR, external requests blocked, and zero wallet signing/transaction requests verified. Temporary fixture/config copies remain in untracked `.tmp/`, excluded from the commit. No full CI, public/fork financial execution, PostgreSQL, Anvil, audit, SBOM or final certification was run.

### Owner-directed Execute workflow surface

Commit subject: `UX-001A: replace Execute placeholder with workflow surface`.

Presentation changes:

- Removed the fallback Prepare for execution card, large Execute unavailable block, EXECUTE / UNAVAILABLE eyebrow, mock/read-only explanatory hero and both inner Return to Build buttons. No replacement warning/empty-state hero was added. Global navigation and the existing footer action remain available.
- The primary fallback Execute area now displays WorkflowCanvas in an Execute overview mode, reusing the existing read-only simulation graph's canonical node/edge projection, layout/fitting and bottom-right zoom controls. Neutral cards show authored action labels, chains, asset amounts and existing risk cues. They show no simulated output, transaction/result status or execution action. Nodes cannot be dragged, connected, selected or edited through this surface. The existing canonical scaffold is excluded as in Build/Simulate; an empty workflow simply shows the graph surface.
- The heading is the same AppShell `workflowName` edited in Build and carried through Simulate. No Execute-only workflow, title state, persistence, canonical metadata or API was introduced.
- Technical diagnostics remains below the graph. It retains capability explanations and local-runtime guidance when execution is unavailable, and the existing exact Manifest/execution/recovery panels when applicable. Existing product-specific public execution panels and all execution-path selection/eligibility conditions are unchanged. The overview describes current authored IR; authoritative reviewed runs remain in their existing runtime panels.

Untouched guarantees: canonical IR/semantic hashes and revisions, simulation/artifact generation and provenance, runtime/backend/API/provider adapters, Review/Manifest binding, explicit wallet authorization, execution ownership and safety gates, journal/recovery/reconciliation/evidence. Build/Simulate behavior and Guided Chat are unchanged. No Part B work.

| Minimal targeted validation | Result |
| --- | --- |
| Vitest: `components/build-correction.test.tsx`, `components/simulate-panel.test.tsx` | 17 tests passed. Empty and authored Execute rendering, shared supplied title, canonical swap/lending inputs, immutable IR and no authoring callbacks, read-only graph options and absence of fake outcomes/actions; existing Build cards/inspector/CTA and Simulate generation/diagnostic gates preserved. |
| Reference-dapp typecheck | Passed. |
| ESLint on touched TS/TSX source/browser tests | Passed. |
| Focused Chromium: `e2e/execute-workflow.spec.ts`, `e2e/simulate-shell.spec.ts`, `e2e/execution-capabilities.spec.ts`, `e2e/simulate-cleanup.spec.ts` | Five distinct tests passed across the initial run and focused capability-file rerun. Shared ESPARTACUS title and 2.25 USDC workflow across Build/Simulate/Execute, graph first without placeholders, 1440px/390px fit/edge margins/no overflow, retained diagnostics/footer/revision, no unprepared authorization/execution controls, preserved Supply/liquidity panels and shared simulation controls/artifact/proof access. |
| `git diff --check` | Passed. |

The initial capability test assumed Add pool still produced an unsupported placeholder. It now authors the existing public Base Sepolia liquidity position, whose real execution panel is intentionally preserved. Corrected that obsolete expectation to verify its wallet requirement and absence of review acceptance/execution before preparation; the two-test file passed on rerun. No runtime code or gates were changed for this failure.

Browser requests were restricted to the existing loopback preview/development HMR, external traffic blocked, and zero wallet signing/transaction requests verified. Temporary fixture/config copies remain in untracked `.tmp/`, excluded from the commit. No full CI, financial execution, PostgreSQL, Anvil/fork, audit, SBOM or final certification was run. Broader visual baselines and legacy visual selectors remain part of final integration/certification; this overview makes no execution/evidence maturity claim.

### Further Parts B–D

Further Part B implementation and Parts C–D remain pending; no full phase completion or certification is claimed.

### Part E — Final certification

Pending. Run the full repository gates specified in the plan after integrating all five parts. No gate has been weakened and no public-execution evidence class is claimed by this build.

## Known limitations and remaining work

- The shell and corrected card/inspector authoring direction are implemented. Further Build workspace refinement, richer simulation/review, execution/recovery/evidence and lifecycle integration remain Parts B–E.
- The initial scaffold remains in canonical IR for compatibility but is excluded from the primary product projection. A reopened run's reviewed workflow and authoritative state remain in its existing panel.
- Targeted browser interactions and desktop/mobile review passed. Full browser coverage and reviewed screenshot baselines remain Part E. Legacy tests that expect scaffold cards or template UI need updating alongside further Part B work; no tests or gates have been skipped to accommodate this change. Canvas viewport resizing may require the existing Fit view control; broader responsive viewport polish remains pending.
- Standalone Supply/Borrow/Repay/Withdraw remain isolated by existing runtime rules. Connecting arbitrary lending nodes is not introduced; the supported connected flow is Supply → Borrow → Swap. Supply/Borrow/Repay still require a connected beneficiary wallet before authoring.
- Guided Chat is outside this branch. Future authoring surfaces must continue to feed the same canonical IR and existing proposal/command boundary.
- BUILD-JOURNEY-001's deployment/public permissionless execution limitations are unchanged. This phase does not establish deployed Journey completion or upgrade evidence maturity.

## UX-002 — Workflow Composer

Implemented on owner-approved UX-001 HEAD `c753ff3`, branch `codex/build-product-ux-001`. UX-001 remains closed. The approved shell and runtime are unchanged.

### Node/card model

Build uses the existing React Flow `workflow` node registration with a Build-specific compact card. Cards are 224px wide, with step number, authoring status, prominent action, actual provider constraints, chain or bridge route, authored amount/assets, optional destination pair and restrained existing risk labels. Selection uses a blue border and subtle shadow; keyboard focus is visible. Cards contain no forms. The internal starting mock scaffold remains hidden. Existing React Flow fitting reserves bottom space for the approved CTA and controls; desktop/mobile checks assert clearance without moving either control.

`domain/composer-presentation.ts` is a read-only projection of canonical IR and existing action readers. It covers Swap (EVM/Solana), Bridge (router/LI.FI/Across), Pool/Liquidity, Supply, Borrow, Repay, Withdraw, the supported lending composition, cross-chain preparation and existing transfer nodes. Lending uses the composition reader because linked Borrow declarations differ from isolated Borrow declarations. Unknown linked amounts read “Amount from linked step”; no quote/output amount is invented. Build no longer subscribes to cross-chain runtime status for card presentation.

### Connection/order model

Smooth directional edges with closed arrowheads represent existing resource links and dependencies; lending retains the existing health-factor checkpoint and Borrow-to-Swap link. Labels describe existing linkage. Multiple resource links between a pair share an edge/label; branching remains visible. Independent actions do not get invented sequence edges. Selected edges receive restrained emphasis, and required edges retain the existing deletion guard.

Step numbers follow the existing visible canonical node array. Dependency/resource arrows show linked sequencing; numbers do not impose an execution schedule on independent actions. Dragging remains layout-only through the existing persisted layout/history store. Semantic reordering is intentionally deferred: there is no safe canonical reorder command. Freehand connections are inactive for real action cards; compositions remain authored through existing commands/constructors.

### Selection and Selected Action

The existing AppShell `selectedId` is the sole active editor selection and drives both card emphasis and Selected Action below Canvas. Existing auxiliary group-selection IDs serve layout/bulk operations only; dashed group styling distinguishes them from the active editor. External selection changes synchronize the auxiliary selection. Mouse click or Enter/Space selects a node; Escape/pane click clears it. Selecting a connection clears the editor selection.

Toolbar actions use unchanged canonical commands, preview/rejection handling and authoring defaults. A new accepted node becomes selected. Lending retains its existing proposal acceptance and then selects Supply. Existing editors, proposal review and Apply proposal controls remain. Selected Action adds the step number, matching card summary and node-specific findings. Clearing selection shows the existing empty editor; the cross-chain composition editor now requires a selected node.

Accepted parameter changes immediately reproject card summaries from the same canonical draft. Unsaved form values and unaccepted proposals do not mutate cards. Changing lending Borrow updates its card and the linked Swap amount through the existing composition constructor. No duplicated editable workflow data, schema, runtime, adapter, API, database, Manifest, authorization, execution, recovery, reconciliation, evidence or simulation semantics were introduced.

### Validation/warnings

Cards consume the existing workflow-store `review.findings` scoped by node ID. Existing authoring blockers show “Needs attention”; warnings show a small warning badge and “Check settings”, with detailed finding messages in Selected Action. Quote/output and simulation requirements stay distinct from authoring errors and remain visible in the editor. “Configured” means draft parameters are saved; it does not mean simulated, authorized, confirmed or executable. When lint has no result, cards say “Draft”. Rejected local form inputs retain their existing form feedback and never create a second invalid canonical draft.

### Targeted validation

- Vitest: `components/build-correction.test.tsx`, `domain/canvas-authoring.test.ts`, `domain/lending-authoring.test.ts`, `domain/editor-history.test.ts`: **67 passed across four files**. Includes real toolbar summaries, unchanged IR, single active editor/card, lending link/amount updates, existing warning/block findings, no invented independent edges, cross-chain output-reference summaries, Solana swap/liquidity assets and existing history behavior. Existing compact-card assertions were updated to the new presentation while retaining form absence, canonical immutability and inspector-binding checks.
- Focused Chromium: `e2e/workflow-composer.spec.ts`: **4 passed**. Four scenarios cover all supported toolbar actions/editors, lending selection and accepted linked edits, keyboard selection, layout-only dragging, protected edge selection/deletion, saved Swap amount/warnings, removal, and 1440px/390px compact card/editor/control placement. Browser requests are restricted to loopback preview and development HMR; external traffic is blocked and zero wallet signing/transaction requests are asserted. Temporary config/fixture copies and visual-review captures live in untracked `.tmp/`.
- App-only TypeScript `tsc --noEmit`, ESLint on all five touched TypeScript/TSX files and `git diff --check`: **passed**.

Initial checks caught and fixed a composition-vs-isolated Borrow reader mismatch. Browser setup initially hit sandbox restrictions and an existing preview lifecycle; final checks use a Playwright-managed loopback development preview. New test selectors were corrected to match the existing default Base Swap chain, lending editor labels and the clickable edge-label background. The preview cold-start wallet assertion allows hydration time; all assertions remain mandatory. Visual review found mobile CTA overlap, resolved with asymmetric graph-fit padding and verified by card/CTA clearance assertions at both widths. No existing test or safety gate was disabled. No full CI, fork suite, PostgreSQL suite, dependency audit, SBOM, financial execution or full browser matrix was run.

### Limitations and future integration touchpoints

- Semantic reordering is deferred. Existing isolated-action restrictions still reject unsupported mixed strategies; the composer does not imply arbitrary action composition.
- Future runtime-dependent amounts remain symbolic until existing reconciliation/quote stages supply them. Validation exceptions without node attribution do not get assigned to guessed nodes.
- Cross-chain composition settings retain the existing whole-composition authoring form when one of its nodes is selected. No new per-field cross-chain canonical commands were added.
- Privacy retains the approved disabled shield/accessible label; actual privacy integration is UX-005 work.
- Shared integration touchpoints are limited to `components/workflow-canvas.tsx` (Build projection/selection; Simulate/Execute branches unchanged), `components/artifact-inspector.tsx` (selected-node context/findings) and appended composer-scoped CSS. `app-shell.tsx`, workflow store, Copilot panel, Guided Chat and chat-to-IR logic were not edited. Future Copilot proposals enter through the same existing draft; newly accepted nodes are selected by the Build projection.
- Final visual baselines and broader financial/runtime certification remain UX-005 work. UX-003 was not started.

Changed files: `src/domain/composer-presentation.ts`, `src/components/workflow-canvas.tsx`, `src/components/artifact-inspector.tsx`, `src/app/globals.css`, `src/components/build-correction.test.tsx`, `e2e/workflow-composer.spec.ts`, and both `docs/builds/BUILD-PRODUCT-UX-001-{PLAN,REPORT}.md`.

## UX-003A — Simulate Workflow Canvas

Implemented from owner-approved UX-002 `8c9337354612fc5a08f18107621e0786e1558bda` on `codex/build-product-ux-001`. This is only UX-003A; subsequent UX-003 parts are not implemented.

### Workflow projection and card reuse

`SimulateWorkflowCanvas` reads the existing `useWorkflow().state.workflow`, review context and saved canvas layout. Its nodes are derived React Flow presentation props, with no editable action data or second workflow store. UX-002's `composerActions`, `composerSummary` and `composerConnections` are reused unchanged. Step numbers, IDs, known providers/chains/routes, authored assets/amounts and typed linkage therefore match Build. Unknown future amounts stay symbolic. Saved Build positions, including lending's default vertical sequence, carry through.

The compact UX-002 card markup was extracted into `ComposerCard`. Build's existing props and rendered authoring markup are preserved; the inspection variant omits authoring status badges, warning/editor instructions and selected-state emphasis. It retains action, provider, chain, authored amount/pair and existing action-derived risk labels. Simulate introduces no output, fee, gas, slippage, health-factor, ETA, success or authorization values. Existing result overlays do not replace the authored card summary; their numbers remain available in the retained artifact/result surfaces.

`WorkflowCanvas` dispatches only its Simulate mode to the new projection. Execute's existing overview and Build's composer behavior are preserved. AppShell adds this graph above existing product simulation panels for routes that previously bypassed the fallback graph, passing its existing shared workflow name and Return to Build callback. The existing SummaryBar action is relocated through its already-established portal host; its labels, route precedence, eligibility and navigation handlers are untouched. Existing product-panel simulation/result controls remain below the graph.

### Connections, inspection and empty states

Smooth, non-animated arrows project the same canonical dependencies/resource links as Build. Lending retains Supply → Borrow → Swap, and cross-chain branching is preserved. Edges do not display policy metrics as simulated results or create links between independent steps. Canonical order remains unchanged.

Simulate nodes cannot be dragged, connected, selected, keyboard-focused as editable controls or deleted. There are no node editing handlers, forms or Selected Action editor in the graph. Zoom, pan and fit remain available. The viewport uses React Flow's measured bounds and direct `setViewport`, with a remeasurement fallback and asymmetric bottom padding to keep cards above the approved Return/Review controls. The lending graph gets enough vertical room to retain its Build sequence and readable compact cards. Narrow action rows wrap their existing labels within canvas bounds without moving the zoom/fit controls or changing Review behavior.

An untouched workflow projects no internal mock scaffold. Empty drafts get a compact “Add an action to your workflow” prompt. Existing validation exceptions produce “Check your workflow” with guidance to complete configuration in Build; no guessed nodes or new validation rules are introduced. The shared title is forwarded directly from AppShell without additional title state or persistence.

### Technical surfaces and preserved behavior

Fallback artifact generation controls, explanations, genuine current artifact tables/JSON, binding/expiry/rejection/retirement feedback and existing diagnostic child panels remain intact under the existing Technical diagnostics disclosure. The main fallback workflow surface no longer exposes MOCK/MOCKED, LOCAL, SYNTHETIC or internal artifact language. Its product-accessible labels are “Workflow simulation details”, “Workflow simulation” and “Simulation workflow graph”. No backend diagnostics were removed and no results presentation redesign was undertaken. Existing product-specific results remain in their original panels.

No canonical schemas/semantics, runtime, adapters, API/database, Manifest, wallet authorization, execution, recovery, reconciliation, evidence, Copilot or Guided Chat code changed. AppShell's six-line addition is a Simulate-only integration touchpoint, not a routing or shared-state refactor. UX-002 card extraction is the other shared presentation touchpoint; focused regression assertions retain Build/Execute markup and behavior.

### Targeted validation and visual review

- **52 Vitest tests passed in four files:** `simulate-workflow-canvas.test.tsx`, `simulate-panel.test.tsx`, `build-correction.test.tsx`, `summary-bar.test.tsx`. Coverage includes all toolbar action summaries, lending order/links, cross-chain branching and symbolic amounts, saved positions, shared title, read-only React Flow flags/no authoring handlers, ignored result overlays, compact empty/incomplete states, retained artifact/generation checks and existing Build/Execute/Review gates.
- **Six Chromium tests passed in three focused files:** `simulate-workflow-canvas.spec.ts`, `simulate-cleanup.spec.ts`, `simulate-shell.spec.ts`. Coverage includes Build/Simulate summary and position parity, shared title/rename and accepted edit propagation, directional links, drag/delete refusal, return navigation and retained Build selection, all isolated toolbar action routes, current diagnostic artifacts/JSON and disabled synthetic Review, existing simulation controls/panels, desktop/mobile action order/clearance, zoom and fit restoration, and absence of the removed shell introductions. Existing selector/visibility expectations were updated to the new graph labels, product-route graph placement and diagnostic disclosure; no assertion or gate was skipped.
- App-only `tsc --noEmit`, ESLint on all ten touched TypeScript/TSX files and `git diff --check`: **passed**.
- Desktop (1440px) and mobile (390px) canvas captures were visually reviewed in untracked `.tmp/`. Node hierarchy/sequence are readable and controls do not overlap cards. Browser traffic is guarded to loopback preview/development HMR; external traffic is blocked and zero wallet signing/transaction requests are asserted.

Initial browser checks caught a pending fitted viewport: queuing `fitView` before controlled read-only node initialization did not complete. The final projection sets the viewport directly from measured bounds, following the existing canvas's measurement recovery pattern, and verifies actual zoom/fit restoration. A transient automatic-approval reviewer capacity failure prevented one rerun from executing; a later approved rerun succeeded. No full repository CI, full browser matrix, fork/PostgreSQL suite, audit, SBOM or financial execution was run.

### Scope, limitations and owner inspection

The projection shows authored parameters, not simulation outcomes. Result presentation is deferred to UX-003B. Existing composition restrictions, recovery-only panel behavior and provider-specific simulation controls remain; a recovered run does not fabricate a current canonical workflow graph. Broader certification remains deferred. Localhost is the inspection surface; the existing development preview is reused where available. No UX-003B/C/D/E work was started.

Changed files: shared/new card and graph components (`composer-card.tsx`, `simulate-workflow-canvas.tsx`, `workflow-canvas.tsx`), Simulate integration (`app-shell.tsx`, `simulate-panel.tsx`, appended Simulate-scoped `globals.css`), focused unit/browser coverage (`simulate-workflow-canvas.test.tsx`, `simulate-panel.test.tsx`, `simulate-workflow-canvas.spec.ts`, `simulate-cleanup.spec.ts`, `simulate-shell.spec.ts`) and both build documents. The pre-existing generated `next-env.d.ts` modification is excluded from the commit.


### UX-003A refinement — responsive toolbar and Selected Action

The top Build toolbar now uses a single non-wrapping flex row. Its existing action order and handlers are preserved, followed by the docking utility and existing count. Canvas-width container queries reduce button padding and gaps before overflow. All supported action labels remain available, including on mobile; the action region scrolls horizontally with hidden scrollbars and scroll padding for complete button/focus-outline visibility. The existing floating vertical toolbox, title editing, canvas dimensions, controls and Copilot layout are preserved.

Selected Action is a compact disclosure below the canvas. It starts collapsed with no selection; accepted toolbar creations and card selection open the existing editor. Its header reads “Selected Action · N. Action”, with an accessible chevron button, `aria-expanded` and a unique `aria-controls` target. Manual collapse changes only the disclosure flag. Clicking a different or already-selected card, or selecting with Enter/Space, opens it again. Clearing selection makes it compact and disables the disclosure button. The editor forms remain mounted while hidden, so manual collapse/reopen preserves unsaved form input.

The shared integration touchpoint is limited to AppShell's existing `selectedId` setter: a stable callback also opens/closes the disclosure, and the same selected ID is passed to Canvas and Inspector. There is no second selection or workflow model. Existing inspector form state, proposal commands, editing keys and handlers are unchanged. No Copilot/Guided Chat logic, canonical IR, node order, simulation/runtime, API, wallet, lifecycle, execution or Manifest behavior changed.

This commit also includes the prior requested, uncommitted Build card refinements: blue numbered titles with a trailing action icon reused from the toolbar; combined provider/network metadata; compact amount/pair lines; simplified Bridge provider wording and unchanged chain route; removal of the Configured badge; and a selection footer anchored by flex spacing at the bottom of each card. Existing warning badges/findings, selection emphasis and card sizing remain intact. Simulate's inspection card keeps its current presentation. Its parity test compares the same action number, action, provider, chain, amount and pair across the two title formats.

Targeted validation:

- **37 component tests passed:** `build-correction.test.tsx` and `simulate-workflow-canvas.test.tsx`, including canonical summaries/order/links, editor binding, warnings and read-only projection.
- **12 focused Chromium cases passed across three files:** six composer cases, four Simulate projection/regression cases and two existing Build layout/floating-toolbox cases. The toolbar case covers 1920, 1440, 1200, 1024, 768 and 390px widths; 125%, 150% and 200% CSS page zoom; and a 360px canvas inside a wider window. Geometry assertions verify a single tool row, centered utility controls, visible labels, exact action order and horizontal reachability for every action. Smaller CSS viewports also exercise the layout-width reduction caused by browser zoom; native browser chrome zoom was not automated.
- Disclosure coverage verifies the compact empty state, automatic opening, manual collapse, reopening the same/different node, retained unsaved values, Enter/Space selection, cleared selection and unchanged workflow revision. Browser fixtures block external requests and assert zero wallet signing/transaction requests.
- The first toolbar check caught fractional scroll-edge clipping; adding scroll padding fixed it and the focused toolbar rerun passed. The other eleven browser cases passed in the initial run. No existing assertion was skipped or weakened.

App-only `tsc --noEmit`, ESLint on all eight touched TypeScript/TSX files, and `git diff --check` passed. Desktop (1440px) and mobile (390px) toolbar and inspector captures were reviewed from untracked `.tmp/`, including empty, selected/collapsed and expanded states. Visual review tightened the spacing breakpoints so desktop tools fit before scrolling; the final width/zoom toolbar check passed again.

Remaining limitations: narrow top toolbars require horizontal scrolling to access later tools; no supported action is removed. Broader browser/runtime certification stays deferred to UX-005. UX-003B/C/D/E were not started. Generated `next-env.d.ts` changes predated these refinements and are excluded from the commit.


### UX-003A refinement — toolbar resilience and action amount cards

The top toolbar now separates “Workflow actions” and “Workflow utilities” into accessible groups within the existing toolbar. Only the primary Swap-through-Privacy group scrolls horizontally. Duplicate, Undo, Redo and the existing docking control stay anchored on the right without horizontal clipping or wrapping. Existing action order, labels, tooltips, eligibility and handlers remain intact. Container queries reduce padding/gaps first; below 850px canvas width, utilities use their existing icons with retained accessible names/tooltips, and the non-action count is omitted to reserve space. Primary action labels remain visible. The vertical floating toolbar keeps the same tools, dimensions and behavior; its docking control stays in the header.

Build Swap and Bridge cards replace only the plain amount row with a compact bordered blue amount/token box. Known amounts use larger type, the actual token sits alongside them, and a small pencil indicates editing through Selected Action. Numeric/token pieces are derived at render time from the existing canonical summary, with no new editable state or authoring commands. Symbolic linked amounts remain descriptive text without invented numbers or symbols. The box is not an inline form: its click bubbles through existing node selection, including reopening a manually collapsed editor. Existing title/icon order, provider/network line, pair summary, validation states, shell dimensions and flex-anchored selection footer are preserved. Other action cards and Simulate inspection cards retain their amount presentation.

Integration touchpoints are limited to the existing `workflow-canvas.tsx` toolbar markup, `composer-card.tsx` Build presentation branch and scoped CSS. AppShell, Inspector, workflow source/IR, node order, proposals, simulation/runtime, adapters/APIs, wallet, Copilot/Guided Chat, lifecycle, execution and privacy runtime are unchanged by this refinement.

Targeted validation:

- **37 component tests passed** in `build-correction.test.tsx` and `simulate-workflow-canvas.test.tsx` for canonical summaries, order/links, editor binding/warnings and read-only projection.
- **13 focused Chromium cases passed** across `workflow-composer.spec.ts` (seven), `simulate-workflow-canvas.spec.ts` (four) and `build-layout.spec.ts` (two). Toolbar checks cover 1920/1440/1200/1024/768/390/320px widths, 125/150/200% CSS page zoom, and a 360px canvas inside a wider window. They assert exact action/control order, one-row vertical alignment, unclipped utilities already in view, visible primary labels, horizontal reachability of each action and an unchanged utility position while primary actions scroll. Smaller CSS viewports exercise browser zoom's layout-width reduction; native browser chrome zoom is not automated.
- Amount-card checks cover Swap and Bridge at desktop/mobile widths, actual amount/token/pencil rendering, absence of inline forms, pinned footer padding, card/amount-box selection reopening the editor, and working Undo/Redo restoring the canonical amount. Existing accepted edit tests verify that the card updates through the original proposal workflow. Disclosure, keyboard selection, history and Build/Simulate continuity regression cases remain intact.
- Twelve browser cases passed initially. The new card/history case needed the test to return vertically to the canvas header after narrow-page inspector interaction; its focused rerun passed with all visibility/history assertions retained.
- App-only `tsc --noEmit`, touched-file ESLint and `git diff --check` passed. No full CI, runtime/fork matrix or backend certification suite was run. Browser traffic stays guarded to localhost and wallet signing/transaction requests remain absent.

Desktop (1440px) and mobile (390px) captures of both amount cards and the pinned toolbar were visually reviewed from untracked `.tmp/`; the utility group stays visible and the amount boxes/footer retain the compact blue product styling.

Limitations: narrow primary action groups require horizontal scrolling; utility labels become icon-only at compact widths but their buttons remain visible and accessible. Amount editing continues in Selected Action. UX-003B/C/D/E remain out of scope. The pre-existing generated `next-env.d.ts` change is excluded from the commit.


### UX-003A correction — Advanced Settings header and card controls

The disclosure header now contains only “Advanced Settings” beside its existing chevron, including the compact empty state. The action number/name and empty-selection hint were removed from that header only. Its accessible expansion controls, current `selectedId`, automatic opening, manual collapse, mounted editor forms and all editor content/handlers remain intact. Cards retain the requested “Editing in Selected Action” footer.

The top toolbar adds Delete card immediately after Redo and before the existing docking control. It uses the same `canDeleteCanvasNode` guard and canonical REMOVE authoring command as the existing inspector removal. It applies only to the current card, clears that editor selection after removal, and preserves the existing history/Undo/Redo path. No-selection, locked, required/dependent and other protected cards disable it, with a concise tooltip. It does not alter keyboard deletion, edge deletion, batch deletion or canonical protections. The approved floating toolbar is unchanged. Narrow top layouts use compact utility icons plus slightly tighter primary text/spacing to retain all five utilities on one row without clipping; primary actions remain horizontally reachable.

Swap pair text is now inside a compact blue box matching the existing amount box family. Supported router/legacy Bridge readers provide an additional presentation-only `bridgePair` for the known USDC → USDC route, consumed only by Build cards. Existing `detail` fields and Simulate/Execute rendering remain unchanged. No inferred output amounts, new asset guesses or inline forms were introduced. Provider/network summaries, amount boxes, action title/icon order, card shell and bottom-anchored footer are preserved.

Targeted validation:

- **41 component/deletion tests passed** across `build-correction.test.tsx`, `simulate-workflow-canvas.test.tsx` and existing `canvas-keyboard.test.ts`, including canonical summaries/order, editor binding, read-only projection and removal protections.
- **14 focused Chromium cases passed** across the composer (eight), Simulate projection (four) and existing Build/floating layout (two) specs. Header checks assert the exact “Advanced Settings” button while preserving collapse/reopen, same-node/different-node selection, keyboard selection and retained drafts. The new deletion case verifies disabled empty/locked/protected selections, successful current-card removal, cleared selection, Undo restoration and Redo removal.
- Toolbar geometry checks retain exact action/control order with Delete card after Redo, visible/unclipped anchored utilities, single-row alignment and primary reachability at 1920/1440/1200/1024/768/390/320px, 125/150/200% CSS page zoom and a separately narrowed 360px canvas. Native browser chrome zoom is not automated; smaller CSS viewports also cover its layout-width reduction.
- Desktop/mobile Swap and Bridge cases assert boxed amount/token/pencil, boxed USDC → WETH / USDC → USDC pair, pinned footer padding and existing selection/history behavior. Build edits and shared Simulate continuity continue to pass. Browser fixtures remain localhost-only and assert zero signing/transaction requests.
- App-only `tsc --noEmit`, ESLint on the six touched TypeScript/TSX files, and `git diff --check` passed. Full CI and UX-005 certification suites were not run.

Desktop (1440px) and mobile (390px) captures were visually reviewed from untracked `.tmp/`, confirming the exact Advanced Settings header, visible delete icon next to Redo, compact matched amount/pair boxes and pinned card footers.

Shared integration touchpoints are limited to existing presentation components/helpers and scoped CSS; AppShell, workflow state, IR schemas, runtime, APIs/adapters, simulation, Copilot, wallet, execution and privacy runtime are unchanged. Delete card intentionally honors existing protection rules rather than enabling unsupported removals. Generated `next-env.d.ts` remains excluded. UX-003B/C/D/E were not started.


### UX-003A refinement — canvas controls and Swap/Bridge value cards

Build gains 60px of vertical workspace: standard canvas 530 → 590px, floating-toolbar canvas 620 → 680px and lending canvas 760 → 820px. The existing desktop Copilot container matches each height; its column width, content, state and responsive stacking remain intact. The editor stays below the canvas. Build zoom/fit controls now have a 70px bottom inset, above Simular Fees, which moves from 56px to 12px from the right while retaining its 12px bottom spacing. Simulate/Execute layout and controls are unchanged.

The header keeps the wallet display and gear, and removes the standalone Disconnect button. Settings retains Language and Theme and now invokes the same existing EVM wallet reset handler through Disconnect. Busy/disconnected disabling is preserved; the action is disabled for the existing Solana-specific header path rather than introducing a new wallet operation. The menu closes and returns focus to the gear after disconnecting. Outside/Escape dismissal remains, and keyboard Tab can reach Disconnect before leaving the popover. Language/Theme remain the existing disabled entries; no new settings functionality was added. This relocation changes no wallet/session/authentication logic.

The top utility action is now labeled Delete, with the same trash icon, current selection, canonical removal guard/command and Undo/Redo behavior. The pinned utility group and scrollable primary actions retain their existing one-row behavior.

Only Build Swap/Bridge cards replace the amount and pair lines with two matching blue value boxes. The upper box shows the authored source value on the left, pencil affordance and source token on the right. The lower box shows Not quoted on the left and the known destination token on the right. Token labels come from the existing amount/pair summaries; unavailable tokens remain a dash. Symbolic linked source amounts remain symbolic. No draft minimum-output guard is misrepresented as an output estimate, no amounts are inferred and no quote state or inline editor is added. Existing title/icon, provider/network row, compact shell, selected state and bottom-anchored Editing in Selected Action footer remain. Both boxes remain part of the existing card selection surface and the same editor handles all changes.

Targeted validation:

- **50 component/guard tests passed** across `build-correction.test.tsx`, `simulate-workflow-canvas.test.tsx`, `product-shell.test.tsx` and `canvas-keyboard.test.ts`. Wallet rendering tests verify relocation uses the original reset handler and preserves connected/disconnected and busy disabling. Existing authoring summaries, selection binding, order/connections, deletion protections and read-only projection pass.
- **19 focused Chromium cases passed** across composer (eight), Simulate projection (four), Build layout (two), header controls (three) and canvas CTA (two). The initial run passed 18 cases; the remaining existing CTA lifecycle test still located Review Supply in the old footer. Its locator now targets the owner-approved Simulate canvas, retaining the disabled review gate and workflow revision/return-selection checks; the focused rerun passed. No simulation code or guard was changed.
- Card checks cover Swap/Bridge at 1440px and 390px, two stacked equal-width boxes, value-left/token-right centering, truthful Not quoted output, pinned footer, no inline forms, selection reopening Advanced Settings and working history. Existing accepted-edit and shared Build/Simulate summary checks remain; the latter compares the token route across the new Build boxes and unchanged Simulate pair text.
- Geometry checks verify the taller standard/floating workspace, desktop Copilot column, 12px CTA edge clearance, raised controls with at least 12px CTA separation, node/control clearance, footer/editor position, working zoom/fit and no page overflow. Toolbar checks cover widths down to 320px, 125/150/200% CSS page zoom and independently reduced 360px canvas width, retaining all actions and anchored utilities in one row. Native browser chrome zoom is not automated.
- App-only `tsc --noEmit`, touched-file ESLint and `git diff --check` passed. No full CI or backend certification suite was run. Browser fixtures remain localhost-only and avoid wallet signing/transactions.

Desktop/mobile captures of the cards and canvas were reviewed from untracked `.tmp/`. Shared integration touchpoints are limited to header presentation/Settings props, the existing toolbar label, card presentation and Build-scoped CSS. Canonical IR, authoring/proposal state, simulation/runtime, adapters/APIs, Selected Action model, Copilot/Guided Chat, execution and privacy behavior are unchanged. Destination quotes are intentionally unavailable in these authoring cards. The pre-existing generated `next-env.d.ts` change is excluded. UX-003B/C/D/E were not started.
