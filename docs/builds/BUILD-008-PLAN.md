# BUILD-008 Plan — LI.FI-routed bridge

Approved 2026-09-28 from certified local main bf280d4184a83c9841d9a6b70dbebab1fd03e23e.

## 1. Objective

Deliver one isolated typed asset.bridge action: Base (8453) USDC to Optimism (10) USDC, recipient equal to the connected owner. Chat and canvas edit the same Semantic Workflow IR. Route and quote data remain separate from intent.

## 2. Product path

Resolve both chain-specific USDC addresses from live LI.FI token data, then request a live quote. Accept one cross-chain source transaction with no destination call or intermediate user transaction. The underlying bridge is selected by LI.FI and retained in evidence; no provider is hardcoded. Show expected and minimum output, slippage, fees, gas, route, spender, exact approval and exact source request. Reject expired quotes, changed intent/account/route/payload, mismatched addresses and unsupported shapes. Requote and review when any material bound changes.

Compile quote, simulation limitations, policy, Strategy Manifest and execution plan through existing contracts. The Manifest limits owner, recipient, both chains, token and amount, slippage, fees/gas, provider route, approval spender/amount, source transaction and expiry. Neither Gryloo nor LI.FI holds the user's key.

## 3. Execution and recovery

BUILD-008 sends no public-chain transaction. A deterministic local transport rehearses approval, source submission, bridge progress and destination arrival. Reuse the canonical Execution Journal, durable extending file store, per-step attempt rules and Evidence Bundle. An additive typed bridge projection records NOT_SENT, SOURCE_SUBMITTED, SOURCE_CONFIRMED, BRIDGE_IN_PROGRESS, DESTINATION_CONFIRMED, RECONCILED, FAILED and UNKNOWN, with chain-specific hashes. An uncertain send persists UNKNOWN; recovery checks the existing attempt and never silently sends again. Destination receipt and balance delta are independently reconciled before RECONCILED. Live LI.FI status is informational only in this build.

## 4. Boundary

Only Base to Optimism USDC, same-address recipient, one isolated bridge action and one LI.FI source step. No route picker, other tokens/chains, composition, destination swap/call, Safe delegation, mainnet/testnet submission, real funds, production wallet, public demo execution or direct bridge adapter. BUILD-007E remains separate. Financial-execution evidence ceiling is MOCKED, irrespective of live quote evidence.

## 5. Acceptance

Focused unit tests; LI.FI adapter contract tests; one deterministic end-to-end rehearsal; restart/recovery and uncertain-submission test; destination reconciliation test; browser journey; pnpm check. No heavyweight recording or certification framework. A skipped or unavailable live-network check is reported, not passed.

## 6. Complexity

MEDIUM: one bridge path reuses existing artifacts and journal, with a bounded LI.FI adapter and no public financial transaction.

## 7. Delivery sequence

Implement semantic action and validation, LI.FI quote normalization, pure artifact compilation, durable MOCKED lifecycle, reconciler, then chat/canvas UI and browser acceptance.

## 8. Exact expected files

Create:
docs/builds/BUILD-008-PLAN.md
docs/builds/BUILD-008-REPORT.md
packages/workflow-contracts/src/bridge.ts
packages/workflow-contracts/test/bridge.test.ts
packages/reference-linter/src/bridge.ts
packages/reference-linter/test/bridge.test.ts
packages/reference-compiler/src/bridge.ts
packages/reference-compiler/test/bridge.test.ts
packages/reference-executor/src/bridge.ts
packages/reference-executor/test/bridge.test.ts
packages/reference-reconciler/src/bridge.ts
packages/reference-reconciler/test/bridge.test.ts
apps/reference-dapp/src/domain/bridge-authoring.ts
apps/reference-dapp/src/domain/bridge-authoring.test.ts
apps/reference-dapp/src/server/lifi-adapter.ts
apps/reference-dapp/src/server/lifi-adapter.test.ts
apps/reference-dapp/src/server/bridge-service.ts
apps/reference-dapp/src/server/bridge-service.test.ts
apps/reference-dapp/src/app/bridge-action.ts
apps/reference-dapp/src/state/bridge-store.tsx
apps/reference-dapp/src/components/bridge-panel.tsx
apps/reference-dapp/e2e/bridge.spec.ts

Modify:
.github/workflows/governance.yml
docs/DECISIONS.md
docs/STATUS.md
docs/NEXT_BUILD.md
packages/action-registry/src/reference-registry.ts
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/src/schemas.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts
packages/reference-compiler/src/index.ts
packages/reference-executor/src/index.ts
packages/reference-reconciler/src/index.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/app/globals.css

Delete: none. Frozen v1 schemas and vectors, Master Spec, Master Prompt, accepted ADRs, historical plans/reports and certified evidence remain protected. An extra path requires a plan amendment.

## 9. Owner decision

Under DEC-0044, the owner approved this plan, branch implementation and live read-only LI.FI quote data on 2026-09-28. Only deterministic MOCKED financial execution is authorized. The agent stops before merge and reports functional result, tests, browser journey, changed files and blockers.

## 10. Amendment 1 — cross-chain semantic output

Implementation validation found the shared workflow validator assumes every expected output is on the action source chain. The approved typed bridge requires its USDC output on Optimism. Add `packages/workflow-contracts/src/schemas.ts` to the Modify path set and permit that precise `asset.bridge` Base → Optimism output only. The owner-approved cross-chain semantic action and single path authorize this narrow compatibility change; all other actions retain the same-chain rule.

## 11. Amendment 2 — BUILD-008 governance alignment

On 2026-09-28 the owner added only `.github/workflows/governance.yml` to the Modify path set. Its current BUILD-008 planning-only condition and exact-scope comparison may be advanced to the approved, implemented Base → Optimism USDC bridge from certified main. Historical BUILD-007 and earlier protections remain intact. Governance must continue to enforce live LI.FI as quote-only input, deterministic `MOCKED` financial execution/recovery/reconciliation, no real funds, and no mainnet or testnet execution claim. This amendment authorizes a branch push and one PR for CI review, but no merge or certification.
