# BUILD-011C-2 plan — partial cross-chain recovery

Approved by the owner on 2026-09-29 from merged main `0ac839738e9aa198007fbf354ea2f14894459c38` under DEC-0053. BUILD-011C-1 remains frozen at that base.

## Boundary

Extend the existing MOCKED Base → Arbitrum → Uniswap composition, canonical journal, Manifest, reconciliation and Evidence Bundle. A confirmed bridge or swap remains an irreversible recorded effect after a destination failure. Recovery starts from the last independently reconciled balance and transaction state. Retry is bounded by exact attempt identity, fresh artifacts, valid authority and unspent budget. Compensation is a separate proposal, review, authorization, attempt, cost and reconciliation; no return bridge is introduced. Manual intervention is a valid terminal local choice, and pausing execution does not revoke onchain authority. The composed evidence ceiling remains MOCKED. Do not implement BUILD-011D, BUILD-012, a new provider or public financial execution.

## Exact expected files

Create:
apps/reference-dapp/e2e/cross-chain-liquidity-recovery.spec.ts
docs/builds/BUILD-011C-2-PLAN.md
docs/builds/BUILD-011C-2-REPORT.md
packages/reference-executor/test/cross-chain-liquidity-recovery.test.ts
packages/reference-executor/src/cross-chain-liquidity-store.ts
Modify:
.github/workflows/contracts.yml
apps/reference-dapp/src/app/cross-chain-liquidity-action.test.ts
.github/workflows/governance.yml
apps/reference-dapp/src/app/cross-chain-liquidity-action.ts
apps/reference-dapp/src/components/cross-chain-liquidity-panel.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/STATUS.md
packages/reference-executor/src/cross-chain-liquidity.ts
packages/reference-executor/src/index.ts
packages/reference-reconciler/src/cross-chain-liquidity.ts
Delete:
none
