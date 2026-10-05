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


### UX-003A refinement — card value boxes and canvas CTA emphasis

Build's Simular Fees and zoom/fit controls move another 12px upward. The CTA stays 12px from the right and is now 24px above the graph bottom; controls have an 82px bottom inset, retaining their 14px separation above the CTA. The existing canvas/footer layout, graph interactions and navigation handler remain unchanged. The CTA has a subtle 3.6-second eased blue shadow pulse with no opacity blink, scaling or position changes. Hover/focus and prefers-reduced-motion disable the animation. Simulate/Execute controls and buttons are unaffected.

Only Build Swap/Bridge cards gain the mini trade presentation: two stacked boxes with large numeric values and smaller US$ 0,00 fiat placeholder lines beneath, plus compact rounded token chips on the right. USDC/WETH chips use local SVG avatars; other known symbols use a letter avatar and unavailable tokens retain a dash with an unknown avatar. These are non-interactive presentation elements, with no asset picker or external asset fetching. Known source amounts still come directly from the existing draft summary. Unavailable destination/source quantities display a muted 0 placeholder, while the existing symbolic source description remains visible when applicable. The visible Output / fiat not quoted note, placeholder accessibility labels and tooltips distinguish unavailable estimates from real zero-valued outputs. No quote or fiat prices are inferred and no canonical output guard is used as an estimate.

All Build cards now have the bottom-anchored Advanced Settings footer with a small gear. Footer clicks bubble through the existing node selection path and reopen the same editor below the canvas; no second selection, editor state or inline editing was introduced. The selected border and selected footer color retain their existing behavior. Inspection cards remain unchanged.

Targeted validation:

- **37 component tests passed** across `build-correction.test.tsx` and `simulate-workflow-canvas.test.tsx`, retaining canonical summaries/order, editor binding, warning rendering and read-only projection. Inspector labels/gear footer expectations reflect the requested wording; Simulate tests also assert that token chips, fiat placeholders and Advanced Settings do not leak onto its read-only surface.
- **16 focused Chromium cases passed** across composer (eight), Simulate projection (four), Build layout (two) and canvas CTA (two). The initial run passed 15; the CTA focus check exposed that programmatic focus after a pointer interaction does not necessarily match focus-visible. The animation now pauses for all focus, and the focused geometry/motion case passed on rerun with the original assertions retained.
- Desktop/mobile Swap/Bridge checks verify two boxes, authored numeric source, symbolic destination 0, visible unquoted note, fiat lines beneath the amount in smaller type, value-left/token-chip-right alignment, visible avatars, pinned Advanced Settings/gear footer, footer selection reopening the editor, no inline forms and working Undo/Redo. Accepted canonical edits and Build/Simulate source amount/token continuity remain covered. The projection test normalizes only presentation layout so fiat placeholders are not compared with the unchanged Simulate amount summary.
- CTA geometry covers 1920/1440/390px and standard/floating toolbars, keeping 24px bottom/12px right clearance, node separation, editor placement and no overflow. Motion checks verify a slow ease-in-out pulse without opacity or transform changes, focus pause and reduced-motion suppression. Existing toolbar reachability/one-row checks cover widths down to 320px, CSS page zoom at 125/150/200% and a separately reduced 360px canvas; native browser chrome zoom is not automated.
- App-only `tsc --noEmit`, touched-file ESLint and `git diff --check` passed. Desktop/mobile card and canvas captures were visually reviewed from untracked `.tmp/`. No full CI or backend certification suite was run.

Integration touchpoints are limited to the shared card's Build-only presentation branch and scoped CSS; summary source data, IR, proposals, quoting/simulation semantics, runtime, wallet/session, Selected Action model, Copilot, execution and privacy behavior are unchanged. Numeric zero/fiat values are explicitly unavailable-value placeholders and do not represent quotes. The pre-existing generated `next-env.d.ts` change remains excluded. UX-003B/C/D/E were not started.


### UX-003A authoring correction — unconfigured Swap/Bridge and inline amounts

**Architectural change.** The existing `EditorHistory` now holds required-field setup for one new Swap/Bridge plus shared amount inputs for editable existing actions. These are authoring fields, not a second executable workflow. Add Swap/Bridge no longer constructs amount 1: it creates an unfinished canvas card with source 0. No financial node is added to `state.workflow` until the original command validators accept a positive amount and the user applies its review. The canonical IR schemas, quantity validators, runtime, provider adapters, simulation and execution stores are unchanged.

The React Flow projection appends that unfinished card to the authored action order. It shows only the same known defaults the existing constructors use: Uniswap USDC → WETH on the current authoring chain, or Router USDC from Base Sepolia → Arbitrum Sepolia. No dependency edge is fabricated. Acceptance transfers its canvas position to the validated canonical node and retains selection/Advanced Settings binding. The existing history records creation, acceptance, layout and deletion; Undo can return a configured action to its unfinished form without introducing invalid IR.

The source field is genuinely editable. It shares its value with the existing Advanced Settings editor, and Review amount → Apply amount uses the existing proposal mechanism. Zero, empty, negative and malformed amounts are refused by existing validators with concise product feedback. Changing the field after review removes the acceptance action; the reducer also checks the reviewed field and command to reject stale acceptance. Replacing an existing configured amount keeps its last valid canonical node until acceptance, blocks stage use while replacement is unfinished, and supports Cancel. Linked/protected amounts remain non-editable.

Simulate and Execute navigation and the Build CTA are disabled while an amount needs configuration/acceptance. AppShell guards stage changes and stage-content mounting; artifact generation and observation reads also refuse incomplete authoring. These are authoring eligibility guards, not changes to runtime authorization or execution ownership. Existing runtime/session/recovery operations are untouched.

Token chips retain their local avatars and gain a small circular network badge derived from the existing chain/route summary. Each value box can switch token/fiat display priority without changing the amount. Unavailable output and fiat values remain 0 / US$ 0,00 with a visible unquoted note; no quote or fiat conversion is invented. Primary labels use Configure, Review amount, Apply amount and Advanced Settings rather than internal workflow-state terminology. The existing technical diagnostics are retained.

**Limitations and integration touchpoints.** Configure one new toolbar action at a time before adding another. A new isolated Bridge is refused if the existing constructor would replace already-authored actions; remove those actions explicitly or use a separate workflow. This preserves the existing canonical ordering and isolated Bridge constraints without widening action semantics. Accepted actions expose their existing full parameter editors. Independently editable Swap/Bridge source amounts support inline entry; linked lending inputs and protected amounts do not. Fiat/output values remain unquoted placeholders. Shared changes are confined to the authoring store/history, the composer projection/card, Advanced Settings and RouterForm amount binding, proposal review, authoring-stage gates and action count. Copilot/Guided Chat, canonical IR, backend APIs, provider adapters, runtime, wallet/session, execution/recovery/reconciliation/evidence and privacy integration are unchanged. Other proposals keep their existing review presentation. The generated, pre-existing `next-env.d.ts` change remains excluded.

Targeted validation:

- **67 focused unit/component tests passed** across `canvas-action-setup.test.ts` (12), `canvas-authoring.test.ts`, `editor-history.test.ts`, `build-correction.test.tsx` and `simulate-workflow-canvas.test.tsx`. Coverage proves no implicit amount 1, invalid/zero rejection (including direct commands bypassing the UI), positive acceptance with exact units, stale acceptance refusal, preserved canonical quantities during replacement, shared history/layout, isolated Bridge safety, existing editor binding and read-only canonical projection.
- **24 unique focused Chromium cases passed across the targeted runs**: five new incomplete/inline-authoring cases plus the existing composer (eight), Simulate projection (four), Build layout (two), CTA (two) and header (three) cases. They cover disabled/guarded Simulate and Execute, shared card/settings fields and summary, acceptance, Cancel, selection, history, stale review dismissal after field/history changes, token/fiat toggles, network badges, protected amounts, pinned footers and one-row toolbar reachability at widths down to 320px and 125/150/200% CSS page zoom. Native browser chrome zoom is not automated. Existing localhost-only network guards remain in place.
- The initial new-action browser checks assumed IR diagnostics existed before a financial node; the new checks now recognize their existing absence, while unit tests directly inspect IR. Bridge zero initially surfaced the generic command rejection; the authoring preflight now invokes the unchanged existing constructor to surface its amount error as product feedback. Failed cases passed focused reruns without weakening financial assertions or skipping tests.
- An additional desktop/mobile visual capture case passed; unconfigured, fiat-priority and accepted Swap/Bridge cards and the canvas were inspected at 1440px and 390px from untracked `.tmp/` captures.
- App-only `tsc --noEmit`, ESLint on all touched TypeScript/TSX files and `git diff --check` passed. Final touched-file checks were repeated only after subsequent changes.

No full repository CI or backend certification suite was run. UX-003B/C/D/E were not started.


## UX-003B — Product card and settings cleanup

Swap/Bridge cards omit visible authoring badges (including Amount required), warning text/borders, technical validation details, dashed/dotted amount styling and the pencil. They retain editable source amounts, shared Advanced Settings fields and the exact existing acceptance/validation path. Detailed lint findings and amount feedback remain in Advanced Settings. Failed inline review keeps a visually hidden, product-worded alert for assistive technology; it takes no card space. Invalid amounts still cannot reach canonical IR or either later stage.

Value boxes now use the product font with tabular numbers, 26px primary token amounts, stronger weight and spacing, 10px fiat sublines and clean borderless fields with keyboard focus treatment. Fiat-priority toggles, known token/chain badges and symbolic output values are preserved. The neutral note reads Estimate unavailable; no USD conversion, quote or output is fabricated. Provider and authored chain/route summaries remain factual, without separate Testnet/Mainnet environment labels inside cards.

Selecting a card, adding an action, or selecting with Enter/Space no longer expands the editor. The lower Advanced Settings disclosure and the card's real, keyboard-accessible Advanced Settings/gear button are the only opening controls. The gear selects its own card and opens the same editor. Selecting another node while settings are already open updates that editor; manually collapsing it remains respected. Canonical acceptance transfers selection without an intermediate deselection that would close an explicitly opened panel. Deleting/clearing selection collapses settings, and Undo/Redo restoration does not automatically reopen it. No new selection/editor model is introduced.

A compact header selector next to the wallet exposes Testnet and Mainnet through `useExecutionEnvironment`'s existing selection callback and capability checks. It changes neither authored chains/amounts nor wallet networks, sessions or authorization. Existing nonpublic simulation modes initially show neutral Network rather than falsely claiming a public environment. Header spacing, wallet truncation and disconnected-wallet wrapping adapt at narrow widths; the settings menu, wallet controls and approved shell remain intact.

Affected product files: `src/components/composer-card.tsx`, `src/components/workflow-canvas.tsx`, `src/components/app-shell.tsx`, `src/components/top-bar.tsx`, and `src/app/globals.css`. All paths here are under `apps/reference-dapp`. Test/fixture updates: `src/components/build-correction.test.tsx`, `e2e/composer-product-cleanup.spec.ts` (new), `e2e/workflow-composer.spec.ts`, `e2e/canvas-action-setup.spec.ts`, `e2e/simulate-workflow-canvas.spec.ts`, `e2e/build-layout.spec.ts`, `e2e/composer-authoring-fixtures.ts` and `e2e/supply-fixtures.ts`. This plan/report pair is also updated. The pre-existing generated `next-env.d.ts` modification is excluded from this work.

Targeted validation:

- **49 unit/component tests passed** across Build presentation, Simulate projection and the contained authoring-model safeguards, retaining exact validator, order/connection, editor binding, read-only and invalid-zero checks. The existing slippage test now asserts warnings stay out of the Swap card while the original findings remain in Advanced Settings.
- **27 unique focused Chromium cases passed across the targeted runs**: three new product-cleanup cases plus the existing composer (eight), incomplete-authoring (five), Simulate projection (four), layout (two), CTA (two) and header (three) cases. They retain invalid/positive acceptance, stale review, history, selection, protected actions, footer placement, wallet menu behavior, title/graph continuity and one-row toolbar checks down to 320px and at 125/150/200% CSS page zoom.
- New cases verify borderless, pencil-free, badge-free Swap/Bridge cards; stronger product-font amounts with smaller fiat lines; collapsed settings on selection; explicit mouse/keyboard opening; existing validation in the editor; header options and alignment; unchanged canonical IR/revision and wallet display; and zero signing, transaction or network-switch requests when selecting environments.
- Initial regressions expecting automatic expansion were changed to explicit settings interactions while preserving their original financial assertions. Acceptance exposed an intermediate deselection closing manually opened settings; the selection transfer was fixed. The environment case now waits for wallet initialization and scrolls the existing header into view before geometry checks. Failed cases passed focused reruns without skipped tests or weakened validators.
- App-only `tsc --noEmit`, touched-file ESLint and `git diff --check` passed. An additional visual capture case passed; Swap/Bridge source/destination values, fiat-priority display and the wallet-adjacent selector were reviewed at 1440px and 390px from untracked `.tmp/` captures. The neutral selector placeholder was shortened to Network to fit narrow headers cleanly.

No full CI or provider/backend certification suite was run. Canonical IR, authoring validators/history, simulation/runtime semantics, providers, backend APIs, wallet/session, execution, privacy and Copilot/Guided Chat logic are unchanged. Only the requested UX-003B cleanup was implemented; subsequent parts remain out of scope.

### UX-003B refinement — in-card amount review and apply

Build Swap/Bridge cards now place Review amount and Apply amount on one compact row. Apply starts disabled and enables only for a valid existing proposal belonging to that card, matching its current source field and the current workflow revision. Review still uses the existing authoring validators and changes no canonical values; explicit Apply invokes the same acceptance callback and guarded history reducer. Editing the field, reviewing a different card or changing the workflow invalidates the previous acceptance. Configured cards retain Cancel to restore the existing amount, and both amount buttons disappear after acceptance until another edit.

The redundant standalone amount review panel is removed. Advanced Settings retains the same shared amount fields and Enter-to-review validation, with a short direction to review/apply in the card instead of duplicated amount-only buttons. Full parameter reviews, including bridge settings and slippage, and the generic proposed-edit review panel remain available through their existing paths. No selection, disclosure, proposal state, validation, canonical IR, simulation, authorization or runtime behavior changes.

Both in-card buttons have a restrained blue hover glow and 160ms color/shadow transition, with explicit keyboard focus outlines. Reduced motion removes transitions. Disabled Apply has a subdued appearance and no hover glow. No blinking, scaling, animation or layout shift is introduced; the Advanced Settings footer remains at the bottom of the card.

Affected files for this refinement (under `apps/reference-dapp`): `src/components/composer-card.tsx`, `src/components/workflow-canvas.tsx`, `src/components/workflow-edit-review.tsx`, `src/components/artifact-inspector.tsx`, `src/app/globals.css`, `e2e/card-amount-review.spec.ts` (new), `e2e/composer-authoring-fixtures.ts`, `e2e/canvas-action-setup.spec.ts`, `e2e/composer-product-cleanup.spec.ts`, `e2e/workflow-composer.spec.ts`, and `e2e/simulate-workflow-canvas.spec.ts`. This plan/report pair is also updated. Shared integration touches only project existing proposal metadata into the card, suppress its redundant lower review surface, and remove duplicated amount-only buttons from the existing inspector. The earlier cleanup changes and pre-existing generated `next-env.d.ts` modification are preserved.

Targeted validation:

- **49 unit/component tests passed** across Build, Simulate projection and required-field authoring safeguards, including invalid-zero rejection and exact canonical quantity assertions.
- **23 focused Chromium cases passed**: three new amount-interaction cases plus incomplete authoring (five), product cleanup (three), workflow composer (eight) and Simulate projection (four). New cases verify disabled/invalid acceptance, explicit review without mutation, field-change invalidation, action/revision scoping across two cards, a single amount interaction, adjacent buttons at 1440/390/320px, hover/focus without geometry changes, reduced motion, shared Advanced Settings values and the accepted amount in Simulate. Existing composer cases retain toolbar checks through 200% CSS page zoom, protection, history, footer and selection assertions.
- App-only `tsc --noEmit`, touched-file ESLint and `git diff --check` passed. No full CI was run.
- An additional visual capture case passed. Reviewed Swap/Bridge cards at 1440px and 390px confirm the adjacent controls, hover glow, disabled Apply, existing Cancel and bottom-anchored Advanced Settings footer; captures stay in untracked `.tmp/`.

This is only the requested amount review/apply refinement. Runtime, validation, IR, simulation, authorization and execution semantics remain unchanged; no additional UX phase was started.


### UX-003B refinement — inline Supply proposal controls

Supply cards now expose Review Supply change and, when the corresponding proposal exists, Apply proposal beside it using the Bridge interaction row and blue hover/focus treatment. Small spacing adjustments accommodate the longer labels within the existing card width. Editing fields remain in Advanced Settings. The inline Review button submits that same form through native HTML form association, including when the disclosure is collapsed; it creates no second editor or duplicated field state. Apply projects the existing valid proposal and revision, then calls the unchanged acceptance function. The card amount remains the existing workflow amount until Apply.

The lower proposal surface retains its diff, explanation and Dismiss action; Supply acceptance moves into its card without a duplicate Apply control. Both standalone SET_SUPPLY and a Supply-only AUTHOR_LENDING edit use this presentation. Borrow, slippage, multi-parameter lending proposals and Bridge retain their existing controls. The lending editor's unchanged-value guard remains effective with its external submit button.

Contained integration touchpoints: `composer-card.tsx` and `workflow-canvas.tsx` render derived controls; `artifact-inspector.tsx`, `supply-panel.tsx` and `lending-node-editor.tsx` provide optional HTML form association; `composer-presentation.ts` identifies an existing Supply command target solely for display; `workflow-edit-review.tsx` suppresses the duplicate Supply CTA. Existing creation forms retain their original submit buttons. No workflow store, proposal commands, IR schemas, validation engine, Copilot logic, provider, simulation, authorization or execution code changes.

Targeted validation passed: 38 component tests covering Build and Simulate projection; 18 focused Chromium cases across product cleanup, amount review/apply, composer and Build layout, including Supply amount rejection, native keyboard review with collapsed settings, Dismiss, acceptance without premature mutation, 1440/390/320px controls, lending Supply versus Borrow targeting, and unchanged Bridge checks. App-only typecheck, touched-file ESLint and git diff check passed. An additional desktop/mobile Supply visual capture case passed; artifacts remain in ignored `.tmp/`. No full CI or additional UX work was run.

### UX-003B refinement — inline Supply amount and larger token pills

Supply now uses the same integrated, borderless source input as Bridge. Its card and Advanced Settings share the existing amount buffer; editing either updates the other without changing workflow amounts before explicit acceptance. Native HTML form association submits the existing Supply form on Enter, preserving beneficiary handling, validation and Review Supply change / Apply proposal. Supply-only lending edits use the existing AUTHOR_LENDING command and preserve Borrow and its linked Swap input. Editing invalidates the previous proposal; required-field stage gates and stale acceptance safeguards remain in effect. The lower Supply diff and Dismiss action remain available, without duplicate Apply controls.

Shared token pills now have a 30px minimum height, 20px avatar, 11px ticker and increased horizontal padding. The small network badge remains intact. Supply retains one value box; Swap and Bridge retain their two boxes and circular connector. Desktop, 390px and 320px checks confirm pills and proposal controls stay within the cards, including fiat-priority display.

Contained integration touchpoints: `composer-card.tsx`, `workflow-canvas.tsx` and `globals.css` provide the shared input and pill presentation; `supply-panel.tsx` and the Supply branch of `lending-node-editor.tsx` bind existing forms to the same amount buffer. `canvas-action-setup.ts` recognizes the existing Supply commands, while `editor-history.ts` and `workflow-store.tsx` pass the workflow into existing proposal-target matching. `composer-presentation.ts` identifies Supply-only lending proposals, including an explicitly reviewed return to the original value; `workflow-edit-review.tsx` retains their lower details. No second editing system, new commands, IR schema, validators, provider/runtime changes or Copilot architecture changes were introduced. Creation forms and other lending parameter editors retain their original state and controls.

Targeted validation passed: **53 unit/component tests** covering amount acceptance, invalid/zero rejection, stale reviews, history, lending linkage, Build presentation and read-only Simulate projection; **18 unique focused Chromium cases** across product cleanup, in-card amount review/apply, workflow composer and Build layout. New assertions cover direct Supply editing, shared settings values, Enter-to-review, explicit acceptance, proposal dismissal/invalidation, unchanged Bridge behavior, and larger-pill geometry at 1440/390/320px. Three additional visual capture cases passed; desktop/mobile Supply, Bridge and fiat-priority Swap captures were inspected. App-only typecheck, touched-file ESLint and git diff check passed. Captures remain in ignored `.tmp/`; the pre-existing generated `next-env.d.ts` modification is excluded. No full CI or further UX work was run.

### UX-003B refinement — consistent numeric entry

`TokenAmountInput` now provides one entry behavior for editable card amounts and their shared Advanced Settings fields. Zero is replaced when typing or pasting begins, including with the caret before it. Integer leading zeros are removed losslessly (`005050` → `5050`, `0007` → `7`), while fractional zeros/digits, trailing decimal entry and large integers remain intact. Empty input is allowed while focused and returns to zero on blur. Invalid syntax is left for the original validators; no Number conversion, rounding, decimal-limit changes or financial parsing changes occur. Fiat-priority display uses the same source input; unavailable output values remain read-only placeholders.

New standalone Supply cards now use the existing unconfigured-card path, starting at zero rather than silently authoring one USDC. The known connected-wallet beneficiary is retained in that same authoring setup. Review Supply change invokes the unchanged ADD_SUPPLY constructor/validator; explicit Apply proposal creates the positive canonical action. Full existing Supply settings remain available after acceptance. Existing authored Supply amounts and lending compositions keep their actual values. Zero/empty input cannot create an executable node or enable later stages; all existing stage gates, proposal invalidation and acceptance guards are reused. The lower Supply diff/Dismiss surface and card CTA pattern remain intact.

Integration touches are confined to the shared input/card and its bound inspector, Supply, lending and Router forms; the existing canvas authoring defaults/setup/history/store extend their supported setup action to Supply and carry its known beneficiary. The existing React Flow node projection updates in a layout effect to prevent outdated controlled input values during rapid typing, without local duplicate amount state or a second editor. Canonical commands/schemas, validators, provider bounds, token decimals, raw-unit conversion, runtime, simulation/execution semantics, wallet behavior and Copilot logic are unchanged. Existing workflow fixtures now explicitly provide/apply Supply amounts rather than relying on the removed one-USDC creation default.

Targeted validation: **104 unit/component tests** covering input formatting, precision preservation, invalid syntax, Supply/Swap/Bridge zero rejection and positive acceptance, exact raw units, beneficiary/history, Build presentation and read-only Simulate projection; **28 unique focused Chromium cases** across numeric entry, existing composer/amount/setup/layout/product interactions and the affected settings/navigation fixtures. The new cases cover rapid typing, zero replacement, decimal entry, temporary empty values and blur, shared settings, fiat-priority mode, incomplete Simulate/Execute gates and explicit acceptance/projection. Bridge acceptance fixtures respect its unchanged minimum/maximum; rejected amounts remain rejected. App-only typecheck, touched-file lint and git diff check passed. No full CI or additional UX phase was run.

### UX-003B refinement — token pill sizing and compact value stacks

The shared card token pill increases from 30px to 34px minimum height, with a 22px avatar (previously 20px), 18px token icon, 12px ticker (previously 11px) and slightly more horizontal padding. Rounded shape, colors and the small network badge are preserved. The number/USD stack gap decreases from 4px to 2px without changing amount or USD typography. Supply and both Swap/Bridge boxes use the same CSS; editing, Review/Apply, Advanced Settings, canvas positioning and all financial/backend logic remain unchanged.

This pass changes only `apps/reference-dapp/src/app/globals.css`, the focused geometry assertions in `e2e/composer-product-cleanup.spec.ts`, and this plan/report pair. Checks confirm the larger pills, tighter stacks and nonoverlapping values/pills inside the existing card bounds at 1440/390/320px, including fiat-priority display. Targeted validation passed: 38 Build/Simulate component tests, three focused Supply/Swap/Bridge browser cases, app typecheck, touched-test ESLint and git diff check. A separate visual capture case covers all three cards at those widths; captures remain in ignored `.tmp/`. No full CI or further UX work was run.

### UX-003B refinement — readable network badges and paired display mode

The shared Supply/Swap/Bridge network overlay increases from 9px to 12px, with 8px lettering instead of 6px. It retains the circular shape, border, network label/tooltip and position over the 22px token avatar. Geometry checks confirm it remains smaller than the main avatar, within the pill and clear of the ticker.

Each Swap/Bridge ComposerCard now owns one display-mode boolean. Both ValueBoxes receive that controlled mode and have no independent display state. Clicking either fiat subline switches both to fiat-primary; either primary fiat line or token return control restores both to token-primary. Source amounts remain editable through the same input and proposal path, destination/fiat values remain truthful unquoted placeholders, and toggling changes no workflow amounts or revision. Supply retains its existing single value block with the shared enlarged badge.

Affected files for this pass: `src/components/composer-card.tsx`, `src/app/globals.css`, `e2e/composer-product-cleanup.spec.ts` and `e2e/canvas-action-setup.spec.ts`, under `apps/reference-dapp`, plus this plan/report pair. No authoring store, IR, backend, provider, quote, simulation or runtime changes were made.

Targeted validation passed: 38 Build/Simulate component tests and 13 focused Chromium cases covering synchronized mouse/keyboard toggles from either box, retained settings/Simulate amounts and workflow revision, larger badge geometry at 1440/390/320px, inline numeric entry, invalid/positive acceptance and incomplete-stage guards. App typecheck, touched-file ESLint and git diff check passed. A separate visual capture case checks all three cards at those widths; captures remain in ignored `.tmp/`. No full CI or additional UX work was run.

### UX-003B refinement — badge and value-stack proportions

Shared network badges increase from 12px to 14px with 9px lettering, remaining secondary to the 18px token glyph/22px avatar. Primary token amounts decrease from 26px to 24px; primary fiat values decrease from 22px to 21px. Primary input height becomes 28px, fiat line height tightens slightly, and the main/subline gap decreases from 2px to 1px. Existing primary weights and supporting text sizes remain readable and unchanged.

Production changes are confined to `apps/reference-dapp/src/app/globals.css`. Focused assertions in `e2e/composer-product-cleanup.spec.ts` verify badge hierarchy, smaller primary typography, tight stack geometry and nonoverlap at 1440/390/320px in both display modes; this plan/report pair records the pass. The shared fiat/token toggle, input behavior, canonical values, quotes, simulation and runtime are unchanged.

Targeted validation passed: 38 Build/Simulate component tests, five focused Supply/Swap/Bridge browser cases, app typecheck, touched-test ESLint and git diff check. A separate visual capture case checks the three card types and both pair display modes at desktop/narrow widths; captures remain in ignored `.tmp/`. No full CI or further UX work was run.


### UX-003B refinement — single lending value blocks and compact fiat sublines

Build Borrow, Repay and Withdraw now reuse Supply's single value/token block, showing only the actual amount/token supplied by their existing summaries. They retain their action titles, protocol/network row, action-specific risk content and Advanced Settings footer. Their existing settings forms remain the editing surface; this visual pass introduces no inline authoring or additional proposal controls. Supply editing and Swap/Bridge dual-box presentation remain intact, as does read-only Simulate projection.

Primary token amounts reduce from 24px to 22px and primary fiat values from 21px to 20px, with a 26px primary input height. Supporting text, the 1px stack gap and existing pill/badge proportions are unchanged. Fiat-priority source inputs now size to their visible character count and align against the token symbol, replacing the fixed 45px blank space. Read-only token sublines use a single label with one separator space (`0 WETH`). The same editable input and shared paired display-mode state remain in use; toggling never changes amounts.

Affected files for this pass: `apps/reference-dapp/src/components/composer-card.tsx`, `src/app/globals.css`, `src/components/build-correction.test.tsx`, `e2e/composer-product-cleanup.spec.ts`, `e2e/canvas-action-setup.spec.ts`, and this plan/report pair. No authoring model, validators, canonical IR, provider, backend, quote, simulation or execution logic changed.

Targeted validation passed: **38 Build/Simulate component tests** and **16 focused Chromium cases** covering all six affected cards, tighter subline geometry, synchronized mouse/keyboard toggles, retained action-specific editor bindings, no value/pill/footer overlap at 1440/390/320px, existing numeric-entry normalization, incomplete-stage gates and guarded amount acceptance. Two additional visual capture cases cover those six card types and both paired display modes at desktop/narrow widths; selected Swap/Borrow/Repay/Withdraw captures were inspected. App typecheck, touched-file ESLint and git diff check passed. Captures remain in ignored `.tmp/`; earlier owner-directed changes and the generated `next-env.d.ts` modification are preserved. No full CI or further UX phase was run.


### UX-003B refinement — editable lending cards and paired liquidity layout

New standalone Borrow, Repay and Withdraw cards now share Supply's zero-based unconfigured authoring path and single editable amount/token block. Adding them creates no financial canonical node or default positive quantity. Borrow/Repay preserve the known wallet beneficiary; Withdraw preserves CONNECTED_OWNER recipient behavior. Zero/empty/invalid amounts cannot be applied, generate artifacts or enter later stages. Existing authored quantities remain visible and editable, with the previous canonical action retained while a replacement is reviewed. No zero amount reaches executable IR.

Card inputs and Advanced Settings now bind the same existing amount buffer and normalized input component. The in-card Review Borrow/Repay/Withdraw change buttons submit the corresponding existing settings form; Apply proposal accepts the same guarded proposal. The lower details/Dismiss surface remains, with acceptance offered once in the relevant card. All existing Add/Set validators, beneficiaries, debt mode and withdrawal policy remain unchanged. Linked Borrow uses the existing AUTHOR_LENDING constructor, retaining Supply, slippage/owner and the typed Borrow-to-Swap edge. Explicit node identity disambiguates unchanged Borrow acceptance, which clears the authoring buffer instead of accidentally matching an unchanged Supply proposal.

Pool / Liquidity uses the shared two-box presentation, token pills/network badges and circular connector. It projects both actual contribution amounts/assets from the existing Uniswap, Orca or liquidity readers; no Swap commands or business logic are used. Both boxes share one display mode and retain unavailable fiat placeholders. Position editing/review stays in its existing settings form, including original range/slippage behavior. No output quantity, fiat valuation or live quote is invented.

Production touchpoints: `composer-card.tsx`, `workflow-canvas.tsx`, `artifact-inspector.tsx`, `lending-node-editor.tsx`, the Borrow/Repay/Withdraw authoring form portions and `workflow-edit-review.tsx` under `apps/reference-dapp/src/components`; `canvas-action-setup.ts`, `canvas-authoring.ts`, `composer-presentation.ts` and `editor-history.ts` under its domain directory. These extend existing UI authoring setup, amount bindings, proposal matching and display projections. No IR schemas/semantics, command types, financial parsing, provider adapters, APIs, runtime, simulation/execution, wallet authorization or Copilot logic changed. Shell/CSS and unrelated cards were preserved.

Targeted validation passed: **117 unit/component tests** across setup/authoring/history, normalized numeric entry and Build/Simulate projections; **18 unique focused Chromium cases** covering zero/empty/precision rejection, explicit positive acceptance, stale review invalidation, shared settings, all six inline card input types, Supply/Swap/Bridge regressions, actual Pool values and paired display mode, toolbar creation, and linked Borrow/order/selection. Card geometry is checked at 1440/390/320px. One additional visual capture case covers Borrow/Repay/Withdraw/Pool and proposal/display variants at those widths; selected captures were inspected. App typecheck, touched-file ESLint and git diff check passed.

Focused test updates are in `canvas-action-setup.test.ts`, `canvas-authoring.test.ts`, `build-correction.test.tsx`, `composer-product-cleanup.spec.ts`, `card-numeric-entry.spec.ts`, `workflow-composer.spec.ts` and the shared composer authoring fixture. Borrow/Repay/Withdraw lifecycle fixtures now explicitly configure their prior positive amounts and locate the relocated card review control; their complete execution suites were not run. Existing unrelated changes and generated `next-env.d.ts` remain preserved. Captures stay in ignored `.tmp/`. Existing limitations remain: one new action is configured at a time, isolated actions obey their existing combination guards, liquidity edits use position settings, and no live fiat valuation is available. No full CI or further UX work was performed.


### UX-003B refinement — Pool Tick/Price selector and strategy tiles

The Build Pool / Liquidity card now has a compact Range selector below its existing asset-pair line, with Tick selected initially. Tick retains the existing compact two-contribution card. Price reveals four selectable tiles with the exact requested ranges and Portuguese descriptions: Estável (± 0.03%), Amplo (–50% — +100%), Unilateral inferior (–50%) and Unilateral superior (+100%). Native radio inputs provide exclusive selection, keyboard arrow navigation and visible focus/selected styling. Selection persists locally while switching between the two views, without creating another workflow model or editing position data.

Only the Price-expanded Pool card widens to 300px to keep the two-column strategy box readable; Tick retains the approved 224px width. After React Flow measures the expansion, its existing fit operation brings the card into view without animation, with bottom space reserved for the existing CTA. Shell, canvas height/control placement, contribution amounts, token pills/badges and Advanced Settings remain intact. Simulate cards do not expose this selector.

Production changes are confined to `apps/reference-dapp/src/components/composer-card.tsx` and `src/app/globals.css`. Focused assertions are updated in `src/components/build-correction.test.tsx` and `e2e/composer-product-cleanup.spec.ts`, plus this plan/report pair. No authoring commands, validation/review/apply behavior, IR, backend, provider, wallet, simulation or execution logic changed. Presets are a product presentation surface only; applying a real price strategy through validated bounds/observed pool prices is intentionally deferred.

Targeted validation passed: **39 Build/Simulate component tests**, **eight focused Chromium cases** covering Pool's selector/tiles and existing contribution editor, plus Swap/Bridge/Supply/Borrow/Repay/Withdraw interactions. Checks cover default Tick, Price-only reveal, exact copy, exclusive mouse/keyboard selection, unchanged amounts/range/slippage/workflow revision, no authoring proposal or wallet handoff, and fit/CTA clearance at 1440/390/320px. One additional visual capture case covers both views at those widths; final desktop/mobile Price captures were inspected. App typecheck, touched-file ESLint and git diff check passed. Captures remain in ignored `.tmp/`; earlier changes are preserved. No full CI or further UX work was run.

### UX-003B refinement — Pool segmented mode control and Amplo default

Pool's Range selector now uses compact rounded Tick / Price buttons with native keyboard interaction, accessible pressed states and visible focus. Tick remains the initial mode. The active segment uses FloFi blue with white text; the inactive segment stays neutral with a subtle hover treatment. Price reveals the existing two-column, four-preset grid with the requested names, ranges and Portuguese descriptions. Strategy names are the strongest labels, followed by ranges and smaller muted explanations. Selected tiles show a blue border/background and a reserved check indicator; neutral tiles gain subtle hover emphasis without layout shift. Reduced-motion preferences disable transitions.

Every transition from Tick to Price selects Amplo (–50% — +100%) as the UI default. Clicking an already-active Price segment preserves the user's chosen preset. Tick hides the grid. Mode and preset selection remain local presentation state, with no mapping into position parameters, authoring commands or executable workflow data. Existing Price-expanded card width, React Flow fit behavior and CTA clearance are preserved. No canonical IR, validation/review/apply, provider, wallet, simulation or runtime changes were made.

Affected files for this pass: `apps/reference-dapp/src/components/composer-card.tsx`, `src/app/globals.css`, `src/components/build-correction.test.tsx`, `e2e/composer-product-cleanup.spec.ts`, and this plan/report pair. Earlier owner-directed changes remain preserved.

Targeted validation passed: **39 Build/Simulate component tests**, **eight focused Chromium cases**, app typecheck, touched-file ESLint and git diff check. Browser checks cover the default and repeated mode transitions, Amplo default, retained selection on active Price clicks, exact preset copy, exclusive mouse/keyboard selection, blue selected checks, hover without layout shift, typography hierarchy, unchanged position values and proposal state, and unrelated Swap/Bridge/Supply/Borrow/Repay/Withdraw interactions. One additional visual capture case covers Tick and Price at 1440/390/320px; desktop/mobile captures were inspected for card bounds and footer/CTA clearance. Captures remain in ignored `.tmp/`. No full CI or further UX work was run.

### UX-003B refinement — Pool provider selector and Custom range preview

The Build Pool / Liquidity card now replaces its static provider/network row with a compact native selector offering Uniswap and Solana. The initial choice reflects the authored protocol: Uniswap positions select Uniswap; Orca/Solana positions select Solana. Any other existing provider remains available as its initial option rather than being relabeled. Actual network badges and liquidity contribution assets remain unchanged. Selector changes are local UI previews, with no protocol migration, provider command or wallet interaction.

The redundant token-pair chip below the two contribution blocks is replaced by a compact Custom percentage input, initially 10%, and a muted Price range: 10% line beneath it. The line reflects this local percentage setting only; editing it does not map to authored liquidity bounds, prices or proposals. Existing validated position editing remains in Advanced Settings. Tick/Price modes, Amplo defaults, presets, card width/fit behavior, contribution values and the footer remain intact. Read-only projection and unrelated cards are unchanged.

Affected files: `apps/reference-dapp/src/components/composer-card.tsx`, `src/app/globals.css`, `src/components/build-correction.test.tsx`, `e2e/composer-product-cleanup.spec.ts`, and this plan/report pair. No authoring semantics, canonical IR, backend, adapter, runtime, simulation/execution or wallet behavior changes were made. Earlier owner-directed changes remain preserved.

Targeted validation passed: **39 Build/Simulate component tests**, **eight focused Chromium cases**, app typecheck, touched-file ESLint and git diff check. Assertions cover Uniswap/Solana defaults and options, removal of the pair chip, Custom/price-line interaction, unchanged contribution values and workflow revision, no generated proposal or wallet handoff, preserved position Review/Apply, existing Tick/Price preset behavior and Swap/Bridge/Supply/Borrow/Repay/Withdraw regressions. Geometry checks cover selector placement, card bounds and footer spacing at 1440/390/320px. One additional visual capture case covers both Tick and Price at those widths; desktop Tick and narrow Price captures were inspected. Captures remain in ignored `.tmp/`. No full CI or further UX refinement was run.

### UX-003B refinement — attached right-side Pool presets

Price now reveals the four existing strategy tiles in a 270px panel attached to the right of the compact Pool card, with a short blue connector and a 180ms horizontal reveal. The presets retain their exact copy, 2x2 layout, native keyboard radio selection, blue selected state and Amplo entry default. The card stays 224px wide and retains the same height in Tick and Price. A Pool-only presentation wrapper lets React Flow measure both surfaces and fit them inside the canvas with bottom CTA clearance; it creates no additional workflow node or edge. Reduced-motion preferences suppress the reveal. Preset selection remains local UI state.

Uniswap/Solana now uses the same rounded blue/neutral segmented buttons as Tick/Price, with accessible pressed states and keyboard focus. Initial selection still reflects the actual provider; switching remains a UI preview and leaves contribution assets/network badges and the authored provider untouched. A thin decorative placeholder sits immediately above the compact Custom percentage box. The Price range text line is removed without replacement. Advanced Settings, position Review/Apply, all unrelated cards and read-only projections are preserved.

Affected files: `apps/reference-dapp/src/components/composer-card.tsx`, `src/app/globals.css`, `src/components/build-correction.test.tsx`, `e2e/composer-product-cleanup.spec.ts`, and this plan/report pair. No canonical IR, provider adapter, runtime, wallet, simulation/execution, validation or proposal semantics changed. Earlier owner-directed changes remain preserved.

Targeted validation passed: **39 Build/Simulate component tests**, **eight focused Chromium cases**, app typecheck, touched-file ESLint and git diff check. Browser assertions cover segmented defaults/keyboard selection, unchanged workflow and position data, placeholder/Custom alignment, absence of price text, constant card dimensions, right-side panel attachment and 2x2 layout, exclusive preset mouse/keyboard selection, Amplo defaults, and canvas/CTA containment at 1440/390/320px. Existing Swap/Bridge/Supply/Borrow/Repay/Withdraw interaction checks pass. One additional visual capture case covers both modes at all three widths; desktop and narrow Price captures were inspected. Captures remain in ignored `.tmp/`. No full CI or further refinement was run.


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

The Build Pool Price range now uses a 3px track, 4px highlighted interval, 14px white boundary handles with 2px blue outlines, and an 8px fixed dark reference marker. The reference legend increases to 11px and boundary labels to 9px. The panel's double-chevron hide control is vertically centered on its left edge, overlapping the connector toward the Pool card. The existing attached 2x2 tiles, blue selected state, provider segments, contribution blocks, inline Review/Apply and Advanced Settings remain intact.

Preset selection and range projection now share the same per-node UI editing buffer: Estável displays −0.03%/+0.03%, Amplo −50%/+100%, Unilateral inferior −50%/0%, and Unilateral superior 0%/+100%. Handles and boundary labels update immediately; the reference marker stays fixed. The stable preset uses a closer visual scale so its small interval remains legible; wide presets retain track headroom. The initial Custom ±10% does not highlight an unrelated preset. Asymmetric selections show their exact range in the compact Custom area rather than a false symmetric percentage; activating that Custom control, editing the percentage or dragging a handle returns to the existing symmetric Custom model. Panel collapse/reopen and Tick/Price changes retain the selected strategy.

The two existing Pool authoring forms consume the same selected range through their existing PRICE editing fields. Exact decimal price boundaries pass through the unchanged native Uniswap/Orca validation/alignment and existing proposal path. Selection and dragging never apply a workflow change. A preset change dismisses the preceding position proposal and requires fresh Review before Apply. No reference price is invented: unavailable reference remains -- and prevents Price Review/Apply; real source labels retain their actual quote-token denomination. No runtime, adapter, schema, API, simulation/execution, wallet or unrelated card behavior changes.

Files affected by this refinement: apps/reference-dapp/src/components/pool-price-range.tsx, pool-price-range.test.tsx, composer-card.tsx, uniswap-liquidity-panel.tsx, solana-liquidity-panel.tsx; apps/reference-dapp/src/app/globals.css; apps/reference-dapp/e2e/composer-product-cleanup.spec.ts; this plan/report pair. Earlier owner-directed uncommitted work is preserved.

Targeted validation passed: **54 component/range tests** (including all four exact preset projections and both native protocol constructors), **nine focused browser cases**, app typecheck, touched-file ESLint and git diff check. Browser assertions cover preset handle positions/labels, exclusive highlighted selection, collapse geometry/persistence, stronger computed styles, existing symmetric pointer/keyboard editing, missing-price safeguards and adjacent Swap/Bridge/Supply/Borrow/Repay/Withdraw regressions. Width checks cover 1440/390/320px and verify panel attachment, canvas containment and clearance from CTA/zoom controls. An additional ignored test-only price-response browser case verifies all four presets can be reviewed and explicitly applied through the existing authoring flow, and selecting a different preset invalidates the preceding review without changing workflow revision or requesting wallet signing. A separate visual capture case covers Tick/Price at those three widths; desktop and narrow Price captures were inspected. No full CI or subsequent UX work was performed. Stopped after this refinement.


### UX-003B session recovery and final targeted verification

Resumed `codex/build-product-ux-001` from committed HEAD `ae2bc45`. Inspected status, the accumulated diff/stat, whitespace checks, recent history and every untracked file. Preserved the accumulated productized cards, inline amount editing, token/network pills, synchronized fiat/token display, Supply/Borrow/Repay/Withdraw model, Swap/Bridge dual boxes, Pool contribution boxes, Uniswap/Solana and Tick/Price segments, attached Price panel, shared Custom range buffer, in-card Review/Apply, Advanced Settings, floating toolbox and header/settings refinements. The new range and amount components/tests, browser tests, generated Next.js agent guidance and generated `next-env.d.ts` are included. No reset, restore, checkout from HEAD, deletion of inherited files or history rewrite was performed.

Finished the interrupted range emphasis: the track grows from 3px to 5px and highlighted interval from 4px to 6px; white handles grow from 14px to 16px with a 3px outline; the fixed center marker grows from 8px to 10px; reference text grows from 11px to 12px and boundary legends from 9px to 10px. Preserved and verified the inherited four-preset mapping and selected highlight: Estável −0.03%/+0.03%, Amplo −50%/+100%, Unilateral inferior −50%/0%, Unilateral superior 0%/+100%. The collapse button is centered on the expanded panel's left edge, with chevrons pointing toward the Pool card. Preset persistence, custom pointer/keyboard editing and native position proposal acceptance remain intact.

Targeted validation completed in this recovered session:

- 136 Vitest tests passed across seven files: `pool-price-range.test.tsx`, `token-amount-input.test.tsx`, `build-correction.test.tsx`, `simulate-workflow-canvas.test.tsx`, `summary-bar.test.tsx`, `canvas-action-setup.test.ts` and `canvas-authoring.test.ts`.
- 32 focused Chromium cases passed across the current product-cleanup, numeric-entry, amount-review and workflow-composer tests, plus the inherited ignored quoted-price fixture. Coverage includes all four strategies, highlighted/persistent selection, collapse placement, computed range styles, symmetric dragging, genuine/missing price handling, proposal invalidation and explicit acceptance, adjacent cards, toolbar, selection and history. One initially stale composer assertion expected Pool's removed network text; it now verifies both accessible network badges, and the corrected case passed on rerun.
- One additional visual capture case passed for all four presets at 1440/390/320px. Desktop and 320px captures were inspected. Temporary configs, guarded development-fixture copies, quoted-price response fixture and screenshots remain ignored in `.tmp/`.
- App TypeScript typecheck passed. ESLint passed for all 42 touched TS/TSX files; final test-only corrections were checked again. `git diff --check` passed.

The remaining insufficient-debt Repay lifecycle fixture now configures its original `0.005` amount before navigating to simulation, matching the inherited zero-based authoring model. Its full financial lifecycle suite was not run. No full repository CI or live financial execution was run. The installed pnpm launcher reported version 12.9.1 against the repository's 11.22.0 pin, so checks used the existing local Vitest, TypeScript, ESLint and Playwright binaries without dependency changes. No further UX phase was started.

Accumulated commit file manifest (48 files):

```text
apps/reference-dapp/AGENTS.md
apps/reference-dapp/CLAUDE.md
apps/reference-dapp/e2e/borrow.spec.ts
apps/reference-dapp/e2e/build-layout.spec.ts
apps/reference-dapp/e2e/canvas-action-setup.spec.ts
apps/reference-dapp/e2e/canvas-cta.spec.ts
apps/reference-dapp/e2e/card-amount-review.spec.ts
apps/reference-dapp/e2e/card-numeric-entry.spec.ts
apps/reference-dapp/e2e/composer-authoring-fixtures.ts
apps/reference-dapp/e2e/composer-product-cleanup.spec.ts
apps/reference-dapp/e2e/header-controls.spec.ts
apps/reference-dapp/e2e/repay.spec.ts
apps/reference-dapp/e2e/simulate-workflow-canvas.spec.ts
apps/reference-dapp/e2e/supply-fixtures.ts
apps/reference-dapp/e2e/withdraw.spec.ts
apps/reference-dapp/e2e/workflow-composer.spec.ts
apps/reference-dapp/next-env.d.ts
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/borrow-panel.tsx
apps/reference-dapp/src/components/build-correction.test.tsx
apps/reference-dapp/src/components/composer-card.tsx
apps/reference-dapp/src/components/header-settings.tsx
apps/reference-dapp/src/components/lending-node-editor.tsx
apps/reference-dapp/src/components/pool-price-range.test.tsx
apps/reference-dapp/src/components/pool-price-range.tsx
apps/reference-dapp/src/components/repay-panel.tsx
apps/reference-dapp/src/components/router-panel.tsx
apps/reference-dapp/src/components/solana-liquidity-panel.tsx
apps/reference-dapp/src/components/summary-bar.test.tsx
apps/reference-dapp/src/components/supply-panel.tsx
apps/reference-dapp/src/components/token-amount-input.test.tsx
apps/reference-dapp/src/components/token-amount-input.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/uniswap-liquidity-panel.tsx
apps/reference-dapp/src/components/withdraw-panel.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/components/workflow-edit-review.tsx
apps/reference-dapp/src/domain/canvas-action-setup.test.ts
apps/reference-dapp/src/domain/canvas-action-setup.ts
apps/reference-dapp/src/domain/canvas-authoring.test.ts
apps/reference-dapp/src/domain/canvas-authoring.ts
apps/reference-dapp/src/domain/composer-presentation.ts
apps/reference-dapp/src/domain/editor-history.ts
apps/reference-dapp/src/state/workflow-store.tsx
docs/builds/BUILD-PRODUCT-UX-001-PLAN.md
docs/builds/BUILD-PRODUCT-UX-001-REPORT.md
```
