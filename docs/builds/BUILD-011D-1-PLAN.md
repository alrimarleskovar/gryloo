# BUILD-011D-1 plan — execution capability registry and honest gating

Approved by the owner on 2026-09-29 from main `33a83ce9de18d8bbbfe4ccfb73811b00c09f290d` under DEC-0054. The owner’s canvas toolbox CSS adjustment at that commit is preserved. BUILD-011C-1 and BUILD-011C-2 remain frozen historical builds.

## Boundary and capability matrix

Extend the existing declarative Action Registry with a separate typed execution capability registry. A declaration alone grants no execution authority. Resolve the selected semantic action, exact adapter/version, source chain, execution kind, authorization mode and runtime environment. Keep authoring, external read, simulation, review, authorization, execution, reconciliation and recovery independent. A missing profile, prerequisite or required node fails closed with a typed reason. Workflow execution uses the weakest financial node; composed evidence cannot exceed its separately demonstrated MOCKED result.

Current profiles: Base Uniswap direct swap and isolated Base Uniswap v3 liquidity have certified `FORK_REPRODUCED` local-fork paths. The Arbitrum v3 liquidity configuration and cross-chain composition are `MOCKED` only. CoW signed intent, LI.FI bridge and destination swap, and direct Across bridge have deterministic `MOCKED` financial lifecycles. LI.FI live quote data is read-only and does not raise financial evidence. Supply, Lending and Borrow are authoring templates with no financial execution. Public Testnet and Mainnet execution remain disabled. Local-fork availability requires the actual local runtime; a hosted browser cannot infer it from a registry row. Existing Mock and fork adapters, wallet guards, Manifest/artifact checks and recovery semantics remain in force.

The DApp receives a presentation-only environment selection and node/workflow capability summaries. The Execute stage uses the resolver before rendering an execution panel and explains any blocking node. Environment inspection does not mutate Semantic Workflow IR, revision or canvas layout. No public financial transaction, new provider, Aave or BUILD-011D-2 implementation is authorized. Merge remains the owner’s decision.

The standard and Mode A browser profiles also capture fifteen historical full-page states. The Base observation visual test keeps wall time fixed while allowing graph measurement frames to run, preventing intermittent pending viewport captures. Their baselines are in this build's Modify scope only because the intentional readiness row, environment selector and capability status appear in those captures. Review each changed image against its base before acceptance; no historical source or financial behavior is expanded.

## Exact expected files

Create:
apps/reference-dapp/e2e/execution-capabilities.spec.ts
apps/reference-dapp/src/components/capability-summary.tsx
apps/reference-dapp/src/domain/capability-view.ts
apps/reference-dapp/src/domain/capability-view.test.ts
apps/reference-dapp/src/state/capability-store.tsx
docs/builds/BUILD-011D-1-PLAN.md
docs/builds/BUILD-011D-1-REPORT.md
packages/action-registry/src/execution-capabilities.ts
packages/action-registry/test/execution-capabilities.test.ts
Modify:
.github/workflows/contracts.yml
.github/workflows/governance.yml
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts-snapshots/execute-divergent-wallet-payload-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/manifest-review-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/execute-reconciled-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-result-unknown-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-recovered-after-restart-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-swap-reverted-residual-allowance-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-revocation-confirmed-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/STATUS.md
packages/action-registry/src/index.ts
Delete:
none
