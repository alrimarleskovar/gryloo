# BUILD-011D-1 report — execution capability registry and environment gating

Base: main `33a83ce9de18d8bbbfe4ccfb73811b00c09f290d`. Branch: `codex/build-011d1-execution-capabilities`. Authority: DEC-0054 and the [exact-scope plan](BUILD-011D-1-PLAN.md). Owner merge remains separate.

## Implemented boundary

The Action Registry now has typed execution profiles separate from declarative compatibility. Resolution uses the semantic action, exact adapter/version, chain and selected runtime environment. Authoring, external read, simulation, review, authorization, execution, reconciliation, recovery and evidence maturity remain separate. Missing action, adapter, chain, environment or runtime fails closed with a typed blocker. Workflow execution requires every financial node; a calculated split grants no financial execution authority. Composed evidence is capped by the weakest demonstrated node.

The DApp shows environment, selected-node and workflow capability, evidence ceiling and a specific Execute blocker. The environment selector changes presentation state only; it does not edit Semantic Workflow IR, revision or canvas layout. Existing wallet, exact artifact, simulation, authorization and recovery guards remain in place. The owner’s `.canvas-toolbox` `margin-left:inherit` and floating toolbox `top:40%;transform:translateY(-50%)` are unchanged from the base commit.

Base Uniswap swap and isolated Base liquidity retain `FORK_REPRODUCED` local-fork capability only where the local runtime exists. CoW signed intent, LI.FI and Across financial paths, Arbitrum liquidity and cross-chain composition retain `MOCKED` ceilings. LI.FI live route data remains read-only. Supply, Lending and Borrow are authoring templates. Public Testnet and Mainnet execution are disabled; no public transaction was submitted and no `TESTNET_EXECUTED` or `MAINNET_EXECUTED` evidence is claimed.

## Recovery boundary

New workflow execution capability is resolved from the active workflow and selected environment. Recovery of an existing persisted execution is resolved from that execution's persisted context and does not depend on a reset authoring graph.

The BUILD-009 Mock journal and Mode A local-fork journal retain their original Execution ID, environment, adapter, chain, reviewed Manifest/policy, reconciliation state and remaining authority. Reload recovery opens only the corresponding existing execution panel; an unrelated newly authored graph cannot use that recovery state to initiate new execution. The readiness row and footer label recovered runs as recovery only. The BUILD-009 and Mode A reload browser regressions passed.

## Verification

All 18 changed full-page baselines were reviewed before acceptance: three visual-shell states, seven older standard-profile states, and eight Mode A states. The intentional differences are the environment selector, capability/readiness labels, financial blocker wording and their vertical displacement. Existing execution, recovery, error and toolbox content remained visible. The Base observation visual test now fixes wall time while leaving layout frames active, removing an intermittent pending viewport under Playwright's paused clock. The owner toolbox CSS is byte-identical to the approved base.

- `pnpm check`: passed; 91 unit test files passed, 2 skipped; 498 tests passed, 2 skipped. Typecheck, lint, production build and 11 schema exports passed.
- Standard guarded browser profile: 47 passed, 4 owner-only Mode B cases skipped. This includes BUILD-009, BUILD-011C-1, BUILD-011C-2, the capability cases and every standard visual baseline.
- Mode A guarded browser batch: 13 passed, including exact wallet payload, wrong-chain, divergent payload, reload recovery, delayed mining, revert and revocation cases; all eight Mode A baselines passed without update mode.
- CoW isolated loopback browser batch: 9 passed, including Mock order, cancellation, wrong chain, browser restart and expiry.
- `pnpm test:anvil`: 4 passed, 10 owner-only cases skipped. `pnpm test:fork --testTimeout=30000`: 31 passed, 29 owner-only cases skipped.
- Offline Mode A rehearsal: five fresh-process synthetic passes, each with 50 provider-equivalent requests and 35 local replies; no public transaction.
- Repository contract validation: reference-linter export/digest self-check and Base, liquidity and composition closed-transcript validators passed. Both governance programs passed on the final scope. `git diff --check` passed.

Public Testnet and Mainnet remain non-executable. BUILD-011D-1 claims no `TESTNET_EXECUTED` or `MAINNET_EXECUTED` evidence.

## Next build

BUILD-011D-2 — first real public testnet/devnet execution from the canonical Gryloo DApp — needs a separate plan and owner approval. BUILD-012 and merge are outside BUILD-011D-1.
