# BUILD-011C-1 plan — cross-chain liquidity happy path

Approved by the owner under DEC-0052 on 2026-09-29 from main `89415eb3574ddd28ab8b1cb0d39e221791c5521f`. This is the successful-composition half of functional Master Prompt Build 011. BUILD-011 and BUILD-011B remain frozen.

## Boundary

Reuse the existing Base → Arbitrum LI.FI bridge, optional fixed direct Across provider, destination swap, shared semantic IR, Uniswap v3 liquidity action, artifacts, Manifest, journal, reconciliation and Evidence Bundle. The sole chain extension is Arbitrum configuration and validation for that existing liquidity adapter. Base behavior remains intact. No new bridge route, provider, liquidity protocol, public financial execution, Aave, Solana or failure/compensation path is authorized. Financial bridge, swap and composed execution evidence remains `MOCKED` unless a separately approved fork profile proves more. Provider choice remains fixed by review.

The reviewed graph binds bridge output to destination preparation, a calculated swap when needed, and liquidity. Bridge and swap estimates are never trusted as actual settlement. Reconcile each output before preparing the next bounded action. The wallet must hold independent Arbitrum ETH for destination gas; no automatic gas acquisition is authorized. The completed business outcome requires a reconciled LP position and explicit residual balances.

## Acceptance

Use the pool's observed state and approved ticks for deterministic Uniswap v3 ratio math, including one-sided ranges. Shared spend and gas budgets must avoid double counting. Surface source, in-flight, destination, post-swap and LP/residual asset locations. Simulation, review, policy/Manifest, canonical journal and evidence must retain step provenance, non-atomic boundaries and `MOCKED` labels. Chat and canvas authoring must yield the same three-action graph. Focused unit/browser tests, historical regressions, `pnpm check`, governance, contracts/reference app and `git diff --check` are required. Open one unmerged PR and verify CI.

BUILD-011C-1 implements the successful cross-chain liquidity composition path. BUILD-011C-2 is still required for destination failure, compensation authority, recovery and manual-intervention proof before Master Prompt Build 011 is considered complete.

## Exact expected files

Create:
apps/reference-dapp/e2e/cross-chain-liquidity.spec.ts
apps/reference-dapp/src/app/cross-chain-liquidity-action.test.ts
apps/reference-dapp/src/app/cross-chain-liquidity-action.ts
apps/reference-dapp/src/components/cross-chain-liquidity-panel.tsx
apps/reference-dapp/src/domain/cross-chain-liquidity.test.ts
apps/reference-dapp/src/domain/cross-chain-liquidity.ts
docs/builds/BUILD-011C-1-PLAN.md
docs/builds/BUILD-011C-1-REPORT.md
packages/reference-compiler/src/cross-chain-liquidity-artifacts.ts
packages/reference-compiler/src/cross-chain-liquidity.ts
packages/reference-compiler/test/cross-chain-liquidity-artifacts.test.ts
packages/reference-compiler/test/cross-chain-liquidity.test.ts
packages/reference-executor/src/cross-chain-liquidity.ts
packages/reference-executor/test/cross-chain-liquidity.test.ts
packages/reference-linter/src/cross-chain-liquidity.ts
packages/reference-linter/test/cross-chain-liquidity.test.ts
packages/reference-reconciler/src/cross-chain-liquidity.ts
packages/reference-reconciler/test/cross-chain-liquidity.test.ts
Modify:
.github/workflows/governance.yml
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/server/liquidity-service.test.ts
apps/reference-dapp/src/server/liquidity-service.ts
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/STATUS.md
packages/reference-compiler/src/index.ts
packages/reference-compiler/src/liquidity.ts
packages/reference-executor/src/index.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/validation.ts
packages/reference-reconciler/src/index.ts
packages/workflow-contracts/src/schemas.ts
Delete:
none
