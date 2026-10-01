# BUILD-012C — Aave V3 Repay

Baseline: clean main `f2b8afa53d9d0d46346fbb0515b167f1045d3f1e`, including merged BUILD-012B and BUILD-DEMO-001. Branch: `codex/build-012c-aave-repay`. Governance-Lite: implementation, normal tests, one PR, CI, human owner merge. Never merge or submit owner transactions as an agent.

Scope is the canonical environment-independent `repay` primitive, implemented for the existing verified Aave V3 USDC profile on Base Sepolia (84532), variable mode 2, onBehalfOf = connected owner. Acceptance is exactly 5000 raw (0.005 USDC), with exactly 5000 raw Pool approval if needed. No Withdraw, permit, aToken repayment, advanced lending, Solana implementation changes or unrelated UX.

Fresh independent prestate is preserved in BUILD-012C-PRESTATE.json, including the 30 read-only RPC responses and official-source digest. At block 47560156, wallet USDC = 10000, variable debt = 10001, allowance = 0, collateral aToken balance = 1000001, health factor = 85991485650860948343. BUILD-012B Borrow receipt is canonical. All configured addresses match live deployment reads and the current official address book. Acceptance is feasible at this observation; recheck before execution. A failed prerequisite requires stopping, with no financial workaround.

Implementation:

1. Add canonical Repay fields/node reader and capability, shared Chat/Canvas authoring, and minimal network/asset/amount/variable-mode form.
2. Extend existing Aave compiler, linter, service and journal with exact approval + repay calls. Read real wallet, allowance, debt/index, collateral/risk and gas state. Simulation uses ephemeral allowance overrides only, never public submission.
3. Bind Review to complete workflow, owner/onBehalfOf, profile, amount/mode, approval spender/amount, freshness and debt state. Semantic edits invalidate authority. Read again at Review, Execute and wallet handoff.
4. Preserve durable preparation before handoff, uncertainty as observation-only, and economic leases across refresh/restart and re-authored metadata. Only known pre-submission refusal can prepare a new explicit review.
5. Independently reconcile canonical signed transaction/receipt, exact calldata and Repay event, exact wallet debit, allowance transition, decreasing debt and scaled debt/index rounding, unchanged scaled collateral/configuration, health factor and costs. Reject unexpected owner asset movement. Historical nominal debt is never assumed to equal simple subtraction.
6. Add focused compiler, authoring, service/recovery/reconciliation and closed-loop browser cases. Run pnpm check, Governance-Lite/self-tests, dependency/audit/SBOM, existing Anvil/fork gates, and browser regressions for Supply, Borrow, BUILD-014 and BUILD-DEMO-001.

Expected files: new workflow-contracts/src/repay.ts, reference-compiler/src/repay.ts, reference-reconciler/src/repay.ts and exports; action-registry/src/execution-capabilities.ts; reference-linter/src/supply.ts and validation.ts; existing compiler/executor/reconciler src/supply.ts; DApp server/supply-service.ts, app/supply-action.ts, state/supply-store.tsx and capability-store.tsx; domain/supply-authoring.ts, commands.ts, editor.ts, proposal.ts; components/repay-panel.tsx, workflow-canvas.tsx, artifact-inspector.tsx, action-library.tsx, app-shell.tsx and summary-bar.tsx; focused unit/e2e tests and supply-harness.mjs; .github/workflows/contracts.yml; package.json verifier lint coverage; three toolbar-affected screenshot baselines; BUILD-012C plan/prestate/report and verification tooling.

Maximum delivery status before owner execution is READY_FOR_OWNER_EXECUTION. Only real owner execution through Gryloo followed by independent reconciliation permits TESTNET_EXECUTED and final BUILD-012C-EVIDENCE.json / BUILD-012C-VERIFICATION.json. Mock/fork tests cannot satisfy public acceptance.
