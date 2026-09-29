# BUILD-011D-2 plan — first public Base Sepolia swap

Approved by the owner on 2026-09-29 from clean main `205055605d96f36e024a0bbc770453113e4f7b40` (DEC-0055). This is one Uniswap v3 exact-input swap on Base Sepolia (84532), submitted from the canonical DApp through an injected EIP-1193 wallet. The owner's explicit approval includes this plan, implementation, bounded public testnet infrastructure if needed, recording, evidence, tests, governance, and one unmerged PR.

## Boundary

Remove the global environment selector and permanent capability/readiness/evidence labels from normal Build. Keep the existing canvas, toolbox position, editor, Copilot, and navigation. Wallet connection is reusable application state; authoring and wallet-free quoting remain available before connection. The runtime resolves the exact `asset.swap.exact-input` + `uniswap.v3` + `eip155:84532` + `PUBLIC_TESTNET` profile. The profile gains implementation support with a `null` demonstrated evidence ceiling until one real DApp-initiated transaction has a successful receipt, independent token-balance reconciliation, gas accounting, Evidence Bundle, and explorer link. Other public profiles and all Mainnet paths remain unavailable.

Use the official Base Sepolia RPC and current official Uniswap v3 Base Sepolia deployment map. Verify chain, bytecode, QuoterV2 linkage, token metadata, Factory pool and liquidity at runtime. Use Circle test USDC and Base Sepolia WETH. Prepare quote and transaction bytes from these verified contracts, with a fresh quote/review gate, account and network checks, finite ERC-20 approval if needed, persisted attempt before each wallet send, immediate tx-hash persistence, public receipt checks, independent balance reads, and fail-closed unknown-result recovery. No server signing or unattended financial submission. Normal CI uses deterministic transports and needs no funded wallet. The public recording is explicitly opt-in and stops for the owner's wallet authorization.

## Evidence and delivery

Record observed deployment addresses and block, pool, quote, tests and any transaction evidence in the report. Infrastructure setup transactions are separate from the certifying swap. Only successful public evidence may promote this one exact profile to `TESTNET_EXECUTED`; implementation alone does not. Historical evidence stays frozen. Run `pnpm check`, guarded browser, Mock and fork regressions, governance, contract checks and `git diff --check`. Commit, push, open one PR and check CI after the wallet gate and evidence completion. Do not merge or start BUILD-012.

## Exact expected files

Create:
apps/reference-dapp/src/app/public-testnet-action.ts
apps/reference-dapp/src/components/public-testnet-panel.tsx
apps/reference-dapp/src/domain/public-testnet-swap.ts
apps/reference-dapp/src/server/public-testnet-service.ts
apps/reference-dapp/src/server/public-testnet-service.test.ts
apps/reference-dapp/src/state/public-testnet-store.tsx
apps/reference-dapp/e2e/public-testnet.spec.ts
docs/builds/BUILD-011D-2-PLAN.md
docs/builds/BUILD-011D-2-REPORT.md
Modify:
.gitignore
.github/workflows/contracts.yml
.github/workflows/governance.yml
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/swap-authoring.ts
apps/reference-dapp/src/state/build009-wallet-store.tsx
apps/reference-dapp/src/state/capability-store.tsx
apps/reference-dapp/src/state/workflow-store.tsx
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/build009.spec.ts
apps/reference-dapp/e2e/canvas-ux.spec.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts-snapshots/execute-divergent-wallet-payload-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fixtures.ts
apps/reference-dapp/e2e/mode-a-fork.spec.ts
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/execute-reconciled-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/manifest-review-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-recovered-after-restart-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-result-unknown-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-revocation-confirmed-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-swap-reverted-residual-allowance-chromium-linux.png
apps/reference-dapp/e2e/execution-capabilities.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/STATUS.md
packages/action-registry/src/execution-capabilities.ts
packages/action-registry/test/execution-capabilities.test.ts
packages/reference-linter/src/context.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts
Delete:
apps/reference-dapp/src/components/capability-summary.tsx
