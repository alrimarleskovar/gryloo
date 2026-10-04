# BUILD-PRODUCT-UX-001 — Product UX report

Date: 2026-10-04. Branch: `codex/build-product-ux-001`. Base: `1cf923f`.
Plan: [BUILD-PRODUCT-UX-001-PLAN.md](BUILD-PRODUCT-UX-001-PLAN.md).

## Status

**Part A implemented; targeted validation passed. Parts B–E have not started. Full integration and certification are pending Part E.**

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

### Parts B–D

Not started; no tests claimed.

### Part E — Final certification

Pending. Run the full repository gates specified in the plan after integrating all five parts. No gate has been weakened and no public-execution evidence class is claimed by this build.

## Known limitations and remaining work

- This phase changes the shell only. Canvas composition, richer simulation/review, detailed execution/recovery/evidence and complete lifecycle integration remain Parts B–E.
- The current initial workflow is still the existing mock example. The context row explicitly identifies the editable draft; a reopened run's reviewed workflow and authoritative state remain in its existing panel.
- Responsive styles and shell markup have targeted validation, but visual rendering, browser interactions and screenshot baselines await Part E. Existing screenshot comparisons will need reviewed updates for the intended shell changes.
- Guided Chat is outside this branch. Future authoring surfaces must continue to feed the same canonical IR and existing proposal/command boundary.
- BUILD-JOURNEY-001's deployment/public permissionless execution limitations are unchanged. This phase does not establish deployed Journey completion or upgrade evidence maturity.
