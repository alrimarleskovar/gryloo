# BUILD-009 Plan — bridge to destination swap

Approved 2026-09-28 from certified main `308901495790416c149976aaee747c2fd5ef9f52` under DEC-0047.

## Objective

Compose Base (8453) USDC → LI.FI bridge → Arbitrum (42161) USDC → destination swap → Arbitrum WETH. The bridge and swap are separate workflow nodes joined by an output reference. BUILD-008's certified Base → Optimism path remains intact.

## Provider preflight

Before implementation, the live LI.FI token catalog identified Arbitrum USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (6 decimals) and WETH `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` (18 decimals). A read-only `42161 → 42161` USDC → WETH `/v1/quote` for 1 USDC returned HTTP 200 with a same-chain swap step, approval spender, bounded output, and transaction request. This is provider availability evidence only; no transaction was sent. The bridge Base → Arbitrum route must also be validated in the implementation.

## Product scope

- Author and review exactly one Base → Arbitrum USDC bridge feeding one Arbitrum USDC → WETH swap through the shared Semantic Workflow IR.
- Keep route and quote data separate from intent. Use live read-only LI.FI quotes and validate chain, token, owner, recipient, amounts, spender, payload and expiry.
- Reconcile MOCKED destination USDC arrival before quoting the swap. Quote the actual reconciled amount. Require a fresh, bounded destination review and authorization; expiration or a changed account, chain, workflow or quote retires it. A late arrival cannot revive authority.
- Persist a deterministic MOCKED journal. Model unknown submission without silent retry, partial completion after a completed bridge, and explicit readback/recovery. Never call partial completion a rollback.
- Add a top-bar injected EIP-1193 wallet flow. No automatic account request; connect only on click. Show shortened account, current and required chain, explicit Base/Arbitrum switch request with post-response verification, account/chain/disconnect events, deterministic disconnected state on refresh, and an app-only Disconnect/Reset. Browser connection must work on Vercel staging without localhost.

## Boundary

Live injected wallet connection and read-only LI.FI provider data are real. Financial bridge and swap execution, recovery and reconciliation remain deterministic MOCKED. Never request a signature, `eth_sendTransaction`, seed phrase or private key for BUILD-009. No `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, real funds or public-chain financial execution. No WalletConnect, smart account, embedded wallet, custody, direct Across, alternate chain/token pair, liquidity, or general route picker. No BUILD-009 merge or certification without separate owner approval.

## Acceptance

Connect Wallet appears when disconnected. Connection occurs only after an explicit click; shows shortened account and actual chain. Source requires Base; destination requires Arbitrum. Switch is explicit and verified. Account, chain and provider-disconnect events invalidate affected reviews. Refresh requires reconnection; Reset clears only app state. The wallet works in a deployed browser without localhost.

The two-node workflow is reviewable. A live Base → Arbitrum quote can be inspected. After MOCKED bridge destination reconciliation, the live destination swap quote uses the reconciled Arbitrum USDC amount. A fresh bounded review gates MOCKED swap progression. Expiry, late arrival, changed quote, unknown submission, partial completion and recovery are visible and gated. Focused tests, one browser journey, `pnpm check` and governance pass. Existing screenshot baselines change only where the approved top bar and authoring control change the visible shell; no heavyweight evidence ceremony is required.

## Exact expected files

DEC-0047 limits this implementation to these paths relative to certified main. Created and modified files are regular non-executable files; there are no deletions. Browser snapshots change only where the new top bar and BUILD-009 authoring control alter existing views.

Create:
apps/reference-dapp/e2e/build009.spec.ts
apps/reference-dapp/src/app/build009-action.ts
apps/reference-dapp/src/components/bridge-swap-panel.tsx
apps/reference-dapp/src/domain/bridge-swap-authoring.test.ts
apps/reference-dapp/src/domain/bridge-swap-authoring.ts
apps/reference-dapp/src/domain/build009-run.test.ts
apps/reference-dapp/src/domain/build009-run.ts
apps/reference-dapp/src/server/build009-lifi.test.ts
apps/reference-dapp/src/server/build009-lifi.ts
apps/reference-dapp/src/state/bridge-swap-store.tsx
apps/reference-dapp/src/state/build009-wallet-store.tsx
docs/builds/BUILD-009-PLAN.md
docs/builds/BUILD-009-REPORT.md
packages/reference-linter/src/bridge-swap.ts
Modify:
.github/workflows/contracts.yml
.github/workflows/governance.yml
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts-snapshots/execute-divergent-wallet-payload-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/execute-reconciled-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/manifest-review-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-recovered-after-restart-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-result-unknown-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-revocation-confirmed-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-swap-reverted-residual-allowance-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/proposal.ts
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/SCOPE_GUARD.md
docs/STATUS.md
packages/action-registry/src/reference-registry.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts

## Delivery

Complexity: HEAVY. Implement a separate BUILD-009 route profile while preserving BUILD-008. Use existing IR, Manifest, attempt, journal and reconciliation patterns. Run local gates, commit and push one `codex/build-009-bridge-swap` branch, open one PR, and stop before merge.
