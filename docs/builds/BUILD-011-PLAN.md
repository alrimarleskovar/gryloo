# BUILD-011 plan — canvas and product UX

Approved for implementation from main `5d169748e6a44e3fb63e371a18ace2e0814d5f04` on 2026-09-29 under DEC-0050. This build changes the Build workspace and canvas interaction. It does not expand financial execution authority.

## Acceptance

- Dragged positions are stored by workflow ID and node ID as layout metadata, without changing semantic workflow revisions or invalidating artifacts. New nodes receive nonoverlapping default positions. Semantic replacement prunes stale layout.
- Canvas selection covers nodes and resource edges. Delete and Backspace issue semantic REMOVE/DISCONNECT commands only when allowed; Escape clears selection. Text entry and IME suppress destructive shortcuts. Dependency and required-node rejection gives a readable reason.
- A compact six-action toolbox creates Swap, Bridge, Pool, Supply, Lending, and Borrow nodes via the semantic editor. Unsupported families remain clearly marked templates. Existing advanced authoring paths stay available in a secondary disclosure below the canvas.
- A contextual inspector edits the selected action through existing commands and review proposals. Build workspace loses its left authoring column and prominent engineering labels. Wallet and all Simulate/Execute paths remain intact.
- Focused unit/browser tests, repository checks, pnpm check, and one unmerged PR establish local acceptance. Owner decides merge.

## Exact expected files

Create:
apps/reference-dapp/e2e/canvas-ux.spec.ts
apps/reference-dapp/src/domain/canvas-actions.test.ts
apps/reference-dapp/src/domain/canvas-layout.test.ts
apps/reference-dapp/src/domain/canvas-layout.ts
docs/builds/BUILD-011-PLAN.md
docs/builds/BUILD-011-REPORT.md
Modify:
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
apps/reference-dapp/e2e/across.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/bridge.spec.ts
apps/reference-dapp/e2e/build-roundtrip.spec.ts
apps/reference-dapp/e2e/build009.spec.ts
apps/reference-dapp/e2e/cow-fixtures.ts
apps/reference-dapp/e2e/cow-intent.spec.ts
apps/reference-dapp/e2e/cow-recovery.spec.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/liquidity-fixtures.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
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
apps/reference-dapp/e2e/mode-b-adversarial.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/domain/canvas-keyboard.test.ts
apps/reference-dapp/src/domain/canvas-keyboard.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/mock-actions.ts
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/SCOPE_GUARD.md
docs/STATUS.md
package.json
