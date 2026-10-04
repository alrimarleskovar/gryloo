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
