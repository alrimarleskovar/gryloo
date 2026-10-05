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
