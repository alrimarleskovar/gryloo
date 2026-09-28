# BUILD-008 local implementation report

Date: 2026-09-28. Branch: `codex/build-008-lifi-bridge`. Base: certified local `main` bf280d4184a83c9841d9a6b70dbebab1fd03e23e. Decision: DEC-0044. Status: local implementation complete, unmerged, NOT CERTIFIED. Financial evidence ceiling: `MOCKED`.

## Functional result

One isolated `asset.bridge` action now represents Base (8453) USDC → Optimism (10) USDC, with the connected owner as recipient. Chat and canvas proposals produce equal Semantic Workflow IR. A server-side read-only LI.FI adapter checks both canonical USDC tokens and requests a live route. It accepts only the approved one-source-transaction shape, retains the dynamically selected bridge provider, underlying steps and raw quote hash, and rejects mismatched recipient, token, chain, native value, extra cross step or unsupported fees. Quote data stays outside semantic intent.

The review shows expected/minimum output, slippage, provider steps, fees, gas, exact amount-limited USDC approval, source target/calldata, freshness and artifact hashes. The existing artifact chain compiles the quote, simulation limitations, authorization policy, Strategy Manifest and execution plan. Its policy binds owner, recipient, both chains, tokens, provider, target/functions, spend, fee/gas, slippage and expiry; plan hashes bind exact approval and source payloads. Expired or changed review state requires a new quote before mocked submission.

Execution uses the existing canonical workflow/segment/step/attempt journal plus an additive bridge-state projection. Append-only local snapshots survive process restart. The eight bridge states are `NOT_SENT`, `SOURCE_SUBMITTED`, `SOURCE_CONFIRMED`, `BRIDGE_IN_PROGRESS`, `DESTINATION_CONFIRMED`, `RECONCILED`, `FAILED` and `UNKNOWN`. An uncertain source result is rechecked against its original attempt; no second source attempt is submitted. A separate reconciler requires matching source and destination receipts, chain, recipient, token and destination USDC balance delta before emitting a `MOCKED` Evidence Bundle.

The browser UI is enabled only with `GRYLOO_BRIDGE=mocked` and an absolute journal path. It never calls a wallet signing or transaction method; the injected provider supplies Base chain ID and the user's address for review. Source submission, bridge progress, receipts and destination balance are deterministic local observations. No public transaction or real funds were used.

## Gates

| Gate | Result |
|---|---|
| `pnpm check` with pinned Node 24.21.0 and pnpm 11.22.0 | PASS: typecheck, lint, production build, 11 schema exports; 421 unit tests passed, 2 existing skips |
| Focused adapter, compiler, journal, restart and reconciliation tests | PASS; included in full unit suite |
| Live quote + browser journey on pinned Chromium 153 / Playwright 1.63 | PASS: 1/1, chat/canvas IR parity, live LI.FI route, exact review, uncertain source, restart, recheck and destination reconciliation |
| Browser journey live route | LI.FI selected `across` with fee collection and one cross step; nine durable snapshots, one source attempt, final `RECONCILED`, Evidence Bundle `MOCKED` |

An initial full-gate test run timed out in the new file-backed lifecycle test under concurrent suite load. The test had already passed alone; its timeout was set explicitly to 20 seconds and the final full gate passed. An earlier Turbopack internal panic during concurrent editing did not recur in the final production builds.

## Changed files

- Contracts and registry: `packages/workflow-contracts/src/{bridge,index,schemas}.ts`, `packages/workflow-contracts/test/bridge.test.ts`, `packages/action-registry/src/reference-registry.ts`.
- Linter/compiler/executor/reconciler: `packages/reference-linter/src/{bridge,index,rules,validation}.ts`, `packages/reference-linter/test/bridge.test.ts`, `packages/reference-compiler/src/{bridge,index}.ts`, `packages/reference-compiler/test/bridge.test.ts`, `packages/reference-executor/src/{bridge,index}.ts`, `packages/reference-executor/test/bridge.test.ts`, `packages/reference-reconciler/src/{bridge,index}.ts`, `packages/reference-reconciler/test/bridge.test.ts`.
- App authoring/server/UI: `apps/reference-dapp/src/domain/{bridge-authoring,commands,editor,proposal}.ts`, `apps/reference-dapp/src/domain/bridge-authoring.test.ts`, `apps/reference-dapp/src/server/{lifi-adapter,bridge-service}.ts` and their tests, `apps/reference-dapp/src/app/{bridge-action.ts,page.tsx,globals.css}`, `apps/reference-dapp/src/state/bridge-store.tsx`, `apps/reference-dapp/src/components/{action-library,app-shell,bridge-panel,copilot-panel,workflow-canvas}.tsx`, `apps/reference-dapp/e2e/bridge.spec.ts`.
- Records: `docs/DECISIONS.md`, `docs/STATUS.md`, `docs/NEXT_BUILD.md`, `docs/builds/BUILD-008-PLAN.md`, this report.

## Limits and next decision

The live LI.FI quote is read-only input and does not upgrade execution evidence. LI.FI route availability and provider selection can change; unsupported route shapes fail closed. The deterministic destination observation cannot establish public-chain settlement. The run was on local browser/server infrastructure; BUILD-007E public EVM demo readiness remains separate. Local acceptance has no open functional blocker. The existing remote Governance workflow still hardcodes BUILD-008 as planning-only and its older exact-path sets; it will need an owner-approved update before a PR-head governance check can pass. No remote CI was run. Stop before merge; owner review of this branch is next. No `TESTNET_EXECUTED` or `MAINNET_EXECUTED` claim is made.
