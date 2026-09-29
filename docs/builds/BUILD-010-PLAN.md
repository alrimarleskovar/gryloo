# BUILD-010 plan — direct Across bridge

Approved 2026-09-29 under DEC-0049 from main `f455892b58561bbe740a83f1aa0837e8ac82f5e4`. DEC-0048 records the BUILD-009 merge without asserting post-merge CI or certification.

## Objective and boundary

One direct `across.direct` Base (8453) USDC → Arbitrum (42161) USDC bridge uses the shared `asset.bridge` semantic IR. Its provider quote, approval requirements, prepared deposit, status, fill, expiry and refund lifecycle are independent of LI.FI. The financial transport is deterministic MOCKED: no signing, public-chain send, real funds, or testnet/mainnet executed claim. Optional real read-only Across `/swap/approval` and `/deposit/status` reads require server-side credentials; credential absence uses deterministic Across fixtures and is reported as pending live verification. It never falls back to LI.FI for Across data.

## Authorization and provider rule

The reviewed policy and Manifest fix provider `across.direct`, owner and recipient, chain/token/amount, minimum output, quote expiration, approval(s), deposit target/calldata/value, gas/fee limits and origin refund address. No post-authorization automatic provider fallback. A generic conformance test verifies that switching a signed FIXED LI.FI policy to Across is forbidden; an AUTHORIZED_SET can permit a named provider only when every material bound is covered by its signed policy. BUILD-010 execution uses FIXED only.

## Lifecycle and recovery

Normalize the current Across Swap API `GET /swap/approval`: checks, conditional `approvalTxns`, `swapTx`, amounts, fees, expected fill time, and `quoteExpiryTimestamp`. Reject unsupported routes, optional origin/destination swaps, dynamic recipients, unlimited approvals, unknown targets and stale/mismatched responses. Explicitly set owner as depositor/recipient/refund address with refund on origin. Quote expiry gates approval/deposit, separate from the deposit fill deadline. The deterministic financial lifecycle covers prepared approval, confirmed approval, prepared deposit, submitted/unknown/confirmed deposit, fill pending/delayed/filled, independent destination balance reconciliation, expired deposit, refund eligible/pending/confirmed. Persist snapshots with existing validated extending-file journal and attempt patterns. Unknown submission can only read back the existing attempt, never resend automatically. A completed source with pending destination remains partial completion.

## Workspace and keyboard

Remove build IDs, semantic revision and local mock labels from the primary workspace. Retain a quiet Demo mode indicator and place technical evidence in review/execution details. Wallet errors become concise local inline feedback. Canvas click selects; Escape clears; Delete and Backspace use the existing semantic REMOVE command only for deletable nodes. Inputs, textarea, contenteditable and other text-entry controls suppress destructive shortcuts. Required and composition-dependent nodes are protected; clear selection after a successful removal. No undo/redo.

## Acceptance and delivery

Focused Across normalization, provider immutability, authorization, recovery, expiry/refund and duplicate-prevention tests; editor and keyboard tests; browser journey; `pnpm check`; governance. One unmerged PR may be opened. Stop before merge. No heavyweight recording ceremony.

## Exact expected files

Create:
apps/reference-dapp/e2e/across.spec.ts
apps/reference-dapp/e2e/canvas-keyboard.spec.ts
apps/reference-dapp/src/app/across-action.ts
apps/reference-dapp/src/components/across-panel.tsx
apps/reference-dapp/src/domain/across-authoring.ts
apps/reference-dapp/src/domain/across-authoring.test.ts
apps/reference-dapp/src/domain/canvas-keyboard.ts
apps/reference-dapp/src/domain/canvas-keyboard.test.ts
apps/reference-dapp/src/server/across-adapter.ts
apps/reference-dapp/src/server/across-adapter.test.ts
apps/reference-dapp/src/server/across-service.ts
apps/reference-dapp/src/server/across-service.test.ts
apps/reference-dapp/src/state/across-store.tsx
docs/builds/BUILD-010-PLAN.md
docs/builds/BUILD-010-REPORT.md
packages/reference-compiler/src/across.ts
packages/reference-compiler/test/across.test.ts
packages/reference-executor/src/across.ts
packages/reference-executor/test/across.test.ts
Modify:
packages/reference-compiler/src/index.ts
packages/reference-executor/src/index.ts
packages/reference-linter/src/bridge.ts
packages/reference-linter/src/rules.ts
packages/workflow-contracts/src/schemas.ts
.github/workflows/governance.yml
.github/workflows/contracts.yml
apps/reference-dapp/e2e/build009.spec.ts
apps/reference-dapp/e2e/composition-fork.spec.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/mode-b-fork.spec.ts
apps/reference-dapp/e2e/mode-a-fixtures.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/bridge-swap-panel.tsx
apps/reference-dapp/src/components/composition-panel.tsx
apps/reference-dapp/src/components/liquidity-panel.tsx
apps/reference-dapp/src/components/mode-b-panel.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/state/build009-wallet-store.tsx
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/SCOPE_GUARD.md
docs/STATUS.md
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

Delete: none. All other tracked paths, including accepted specs, ADRs and historical build records, remain protected.
