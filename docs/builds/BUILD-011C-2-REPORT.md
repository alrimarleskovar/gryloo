# BUILD-011C-2 report — cross-chain liquidity partial recovery

Base: merged main `0ac839738e9aa198007fbf354ea2f14894459c38`. Branch: `codex/build-011c2-cross-chain-recovery`. Authority: DEC-0053 and the [exact-scope plan](BUILD-011C-2-PLAN.md). Full composed failure/recovery evidence remains `MOCKED`; no public financial transaction is claimed. The owner retains merge authority.

## Implementation

The existing cross-chain run records destination swap and mint reverts as partial completion while preserving the reconciled bridge output and any successful swap output. Asset location, balances, source/provider costs and destination gas remain visible. A mint attempt is fsynced as `PREPARED` and `SUBMITTING` through the existing append-only file store before a modeled send; a new store instance reloads the unknown result before reconciliation. The shared nonce/block/txpool classifier checks unknown results; a found LP is reconciled without a second mint, a proven `NOT_FOUND` permits one bounded retry under current Manifest/provider/balance/gas limits, and inconclusive results fail closed. Expiry or stale destination artifacts leave bridged USDC at Arbitrum and prevent silent continuation.

Recovery options state whether retry, fresh review, compensation, stop or manual intervention is available. Compensation is proposed separately, requires a new Manifest, uses its own attempt and gas, and reconciles independently. Manual intervention retains a summary and does not claim revocation. A stale destination artifact produces a fresh canonical artifact set, simulation, policy and Manifest preview which cannot execute without another review and authorization. The partial Evidence Bundle includes intended/authorized hashes, the append-only journal, observed outputs, best-known location, costs, compensation references and `RECONCILED`, `INCONCLUSIVE` or `DIVERGENT` outcome at `MOCKED` maturity. The existing DApp panel renders these outcomes, and presentation-only canvas card statuses show completed/failed steps without changing the semantic workflow graph.

## Verification

- `pnpm check`: passed with 89 test files passed, 2 skipped; 487 tests passed, 2 skipped. Typecheck, lint, build and 11 schema exports passed.
- Focused cross-chain executor/app tests: passed for swap revert, mint revert, durable unknown-result restart, `NOT_FOUND` retry, inconclusive fail-closed, late bridge arrival, stale requote, separate compensation authority, manual stop and BUILD-011C-1 happy path.
- Browser: standard profile passed 57, with 18 opt-in skips. New recovery and prior happy-path browser tests passed. The BUILD-008 live LI.FI route spec is a separate opt-in profile; it reached the live quote step locally but returned `BRIDGE_INTERNAL_ERROR`, so that external read is not recorded as passed. CI does not include this opt-in spec.
- `pnpm test:anvil`: 4 passed, 10 owner-only skipped. `pnpm test:fork --testTimeout=30000`: 31 passed, 29 skipped on repeat; an initial unrelated preflight attempt timed out on this host.
- Both local governance scripts: passed. `git diff --check`: passed. GitHub CI on PR #24 head `8bcdfbdde2558981839176a7e6b9bc3a05aaa554`: governance, contracts/reference app/dependencies/SBOM and Vercel passed for both push and PR-triggered checks.

The composed financial recovery remains MOCKED. Compensation authorization is represented by a separate reviewed Manifest and authorization evidence hash in the deterministic model; it is not a public-chain signature or transaction. No TESTNET_EXECUTED or MAINNET_EXECUTED claim is made.

## Conclusion

The functional requirements originally assigned to Master Prompt BUILD-011 — Cross-chain liquidity composition — are now fulfilled by BUILD-011C-1 plus BUILD-011C-2 on this unmerged PR head. This does not imply public testnet or mainnet execution, production readiness, live composed adapters or BUILD-012 completion. Full composed recovery evidence remains MOCKED. The next planned build after owner merge is BUILD-011D-1 — Execution Capability Registry + environment gating.
