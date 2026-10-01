# BUILD-012A — Aave V3 Supply

## 1. Authority and baseline

APPROVED under DEC-0056 on 2026-10-01 by the human owner: the single allowance in /tmp/BUILD-012A-PREFLIGHT.md, strictly baseline main 64a0a46f45532d667e226193f29529d8938acf15, BUILD-012A only, the exact 59 protected and 5 UX paths and purposes below. Branch codex/build-012a-aave-v3-supply; one PR; no merge. Any additional path requires stopping and reporting it. The owner explicitly authorizes implementation, tests, governance, browser/fork validation and PR preparation. Approval supersedes the prior prohibition on this exact Aave public-testnet Supply only.

## 2. Public acceptance

AUTHOR → SIMULATE → REVIEW → EXECUTE → RECOVER → RECONCILE → EVIDENCE. Only an owner-triggered, injected-wallet Supply through Gryloo, on the verified official public deployment, independently reconciled with index-aware aToken readback and downloaded evidence can reach TESTNET_EXECUTED. All deterministic harness evidence is MOCKED. No owner signature, public transaction, funding or CI result is asserted by this plan.

## 3. Verified deployment

Base Sepolia, eip155:84532. Official sources: https://aave.com/docs/resources/addresses and https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3BaseSepolia.sol; current Aave interface marketsConfig.tsx and networksConfig.ts. Pool 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27; Provider 0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00; USDC 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f, 6 decimals; aToken 0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC. Explorer https://sepolia.basescan.org. Read RPC https://base-sepolia.gateway.tenderly.co. Aave test faucet 0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc. Read-only verified at block 47520269, hash 0x10d0cc500814f4aaed58424da8983dcaa9f4da5d5c86d296d5535d76b5496b5b: chain, code, Provider Pool, reserve active/unfrozen/unpaused, decimals, aToken underlying and supply. USDC is the Aave mock reserve, not Circle test USDC. Liquidity index is non-unit; reconciliation accounts for interest/rounding.

## 4. Implementation

Extend the existing SemanticWorkflow with actionType supply, protocol aave-v3, typed amount/asset and beneficiary. Chat/canvas use the same Command/editor reducer. Add minimal shared linter/compiler/executor/reconciler modules. Exact finite allowance approval and exact Pool.supply are separately persisted/reconciled. Simulation is read-only and fails closed if exact chained simulation is unavailable. Review binds semantic revision, identity, deployment, allowance requirement and transactions. Reuse the existing wallet session; no keys or automatic signatures.

## 5. Recovery and evidence

Persist account/chain/nonce/block/calldata before requesting the wallet. After uncertainty, observe only the existing transaction; a missing hash never permits blind resubmission. Verify transaction semantics, successful canonical receipt, exact Supply event and index-aware scaled position delta. Receipt status alone cannot reconcile. Public classification requires the exact public runtime and validated observations. No other capability/profile is promoted.

## 6. Validation and delivery

Run dependency verification, typecheck, lint, build, schema check, unit/focused Aave tests, guarded browser journey/recovery, applicable fork tests, governance self-tests and both phases, pnpm audit and git diff --check before PR. Preserve snapshots and historical frozen bytes. Deterministic tests are development evidence only. Record READY_FOR_OWNER_EXECUTION only after implementation/validation/CI is ready; then request one unavoidable owner action at a time. Owner must Execute and sign in the DApp. Do not merge.

## 7. Boundaries

Supply only. No Borrow, Repay, Withdraw, composition, unrelated refactor/UX change, new wallet system, dependency change, broad directory allowance, disabled checks or governance weakening. Detailed engineering information stays collapsed. Evidence file is created only after successful real public acceptance, never as a placeholder.

## 8. Exact approved paths

## Complete exact Create paths

| Exact path | Current policy | Why required |
| --- | --- | --- |
| `packages/workflow-contracts/src/supply.ts` | Protected | Canonical supply action, semantic field readers/builders using the existing WorkflowNode shape; no environment-specific action. |
| `packages/workflow-contracts/test/supply.test.ts` | Protected | Canonical IR, required fields, native-unit amount and beneficiary validation. |
| `packages/action-registry/src/aave-v3-testnet.ts` | Protected | One exact verified runtime deployment profile, reserve, aToken, chain and read endpoint. |
| `packages/action-registry/test/supply.test.ts` | Protected | Exact Supply capability profile and honest evidence maturity; reject other profiles. |
| `packages/reference-linter/src/supply.ts` | Protected | Supply-specific constraints within the existing shared workflow validator; reject composition and unsupported deployments. |
| `packages/reference-linter/test/supply.test.ts` | Protected | Invalid chain, asset, protocol, amount, beneficiary, ports and unsupported connections. |
| `packages/reference-compiler/src/supply.ts` | Protected | Exact Pool.supply/approval calldata, read-only simulation and deterministic review/Manifest commitments. |
| `packages/reference-compiler/test/supply.test.ts` | Protected | Review binding, exact calldata/beneficiary, real-allowance decisions, exact approval and semantic/state invalidation. |
| `packages/reference-executor/src/supply.ts` | Protected | Approval and Supply steps, durable attempt identity before wallet submission, bounded observation and restart recovery. |
| `packages/reference-executor/test/supply.test.ts` | Protected | Persistence ordering, uncertain results, rejection/revert, restart, stale authorization and no duplicate economic steps. |
| `packages/reference-reconciler/src/supply.ts` | Protected | Independent chain/transaction/log/allowance/position verification and canonical Evidence Bundle with attached public observations. |
| `packages/reference-reconciler/test/supply.test.ts` | Protected | Wrong Pool/account/calldata, successful and inconsistent position deltas, index mechanics and maturity classification. |
| `apps/reference-dapp/src/domain/supply-authoring.ts` | Protected | Canvas/chat amount parsing and Supply authoring through the shared semantic helpers. |
| `apps/reference-dapp/src/domain/supply-authoring.test.ts` | Protected | Chat/canvas equivalence, parsing, reducer edits, revision invalidation and undo/redo regression. |
| `apps/reference-dapp/src/server/supply-service.ts` | Protected | Thin orchestration of the shared compiler, executor and reconciler; runtime profile validation and durable storage. |
| `apps/reference-dapp/src/server/supply-service.test.ts` | Protected | End-to-end deterministic service lifecycle and failure/restart coverage with no public submissions. |
| `apps/reference-dapp/src/app/supply-action.ts` | Protected | Validated server-action ingress and bounded, allowlisted read-only RPC transport. |
| `apps/reference-dapp/src/state/supply-store.tsx` | Protected | Supply execution state and recovery pointers; reuse the existing application injected-wallet session. |
| `apps/reference-dapp/src/components/supply-panel.tsx` | Protected | Financial Simulate, Review, Execute, approval/Supply progress, recovery and downloadable evidence; collapsed technical details. |
| `apps/reference-dapp/e2e/supply.spec.ts` | Protected | Canonical Build → Supply → Simulate → Review → Execute journey and injected-wallet failures. |
| `apps/reference-dapp/e2e/supply-recovery.spec.ts` | Protected | Browser/app restart, uncertain approval/Supply and observation without duplicate submission. |
| `apps/reference-dapp/e2e/supply-fixtures.ts` | Protected | Deterministic injected-wallet and transport fixtures; explicit MOCKED provenance. |
| `apps/reference-dapp/e2e/supply-harness.mjs` | Protected | Offline loopback RPC/state harness for the real DApp code path; never classified as public execution. |
| `scripts/governance_build012a_scope.py` | Protected | Exact baseline/branch/path/profile allowance and source constraints for BUILD-012A only. |
| `scripts/test_governance_build012a_scope.py` | Protected | Reject wrong baselines/branches, extra paths, unrelated profiles/operations, server signing and false evidence promotion. |
| `docs/contracts/AAVE_V3_SUPPLY_V1.md` | Protected | Additive Supply contract, review/attempt/reconciliation/evidence requirements; frozen v1 contracts remain byte-identical. |
| `docs/builds/BUILD-012A-PLAN.md` | Protected | One owner-approved implementation plan with this complete exact scope and the public acceptance gate. |
| `docs/builds/BUILD-012A-REPORT.md` | Protected | Authoritative deployment observations, checks, limitations, owner DApp execution and delivery report. |
| `docs/builds/BUILD-012A-EVIDENCE.json` | Protected | Public acceptance artifact containing the canonical Evidence Bundle and independently verifiable observations; create only after successful real public acceptance. |

## Complete exact Modify paths

| Exact path | Current policy | Why required |
| --- | --- | --- |
| `packages/workflow-contracts/src/index.ts` | Protected | Export the additive canonical Supply helpers. |
| `packages/action-registry/src/index.ts` | Protected | Export the exact runtime deployment profile. |
| `packages/action-registry/src/execution-capabilities.ts` | Protected | Add supply + aave-v3 + eip155:84532 support only; demonstrated maturity stays unset until real evidence exists. |
| `packages/reference-linter/src/index.ts` | Protected | Export Supply validation for existing consumers. |
| `packages/reference-linter/src/validation.ts` | Protected | Validate Supply in the existing canonical workflow ingress and forbid out-of-scope composition. |
| `packages/reference-linter/src/rules.ts` | Protected | Supply authoring findings that require current simulation/review before financial execution. |
| `packages/reference-compiler/src/index.ts` | Protected | Export the additive Supply compiler and review functions. |
| `packages/reference-executor/src/index.ts` | Protected | Export the additive Supply economic lifecycle and recovery functions. |
| `packages/reference-reconciler/src/index.ts` | Protected | Export independent Supply reconciliation and evidence functions. |
| `apps/reference-dapp/src/app/page.tsx` | Protected | Mount the Supply lifecycle provider under the existing workflow and application wallet providers. |
| `apps/reference-dapp/src/components/workflow-canvas.tsx` | UX category; bounded Supply integration | Wire the existing Supply toolbar action to canonical authoring and financial card labels; preserve layout/toolbox. |
| `apps/reference-dapp/src/components/action-library.tsx` | UX category; bounded Supply integration | Supply creation settings for network, asset, amount and explicit beneficiary. |
| `apps/reference-dapp/src/components/artifact-inspector.tsx` | Protected | Edit Supply semantic fields through existing proposal/revision handling. |
| `apps/reference-dapp/src/components/copilot-panel.tsx` | Protected | Pass existing session account as an optional authoring default without requesting connection; contextual Supply guidance. |
| `apps/reference-dapp/src/components/app-shell.tsx` | Protected | Route Supply and persisted Supply recovery to the canonical financial panels. |
| `apps/reference-dapp/src/components/summary-bar.tsx` | UX category; bounded Supply integration | Connect Supply simulation, Review and Execute navigation to current artifacts. |
| `apps/reference-dapp/src/domain/commands.ts` | Protected | Parse canonical Supply chat commands and canvas commands with the same fields. |
| `apps/reference-dapp/src/domain/editor.ts` | Protected | Apply Supply additions/edits in the existing reducer with revision checks and composition rejection. |
| `apps/reference-dapp/src/domain/proposal.ts` | Protected | Describe exact Supply semantic changes in existing proposal review. |
| `apps/reference-dapp/src/domain/mock-actions.ts` | Protected | Remove Supply from current mock-template creation; retain unrelated template behavior. |
| `apps/reference-dapp/src/domain/canvas-actions.test.ts` | UX category; bounded Supply integration | Replace the obsolete Supply-template expectation with canonical Supply coverage; keep editor safety checks. |
| `apps/reference-dapp/src/state/capability-store.tsx` | Protected | Resolve Supply runtime readiness from the exact Supply workflow, artifacts and shared wallet session. |
| `apps/reference-dapp/playwright.config.ts` | Protected | Opt-in offline Supply harness and isolated journals; preserve network guard and all existing suites. |
| `apps/reference-dapp/e2e/canvas-ux.spec.ts` | UX category; bounded Supply integration | Migrate only obsolete Supply-template assertions; preserve generic layout, selection, deletion and editor coverage. |
| `apps/reference-dapp/e2e/build-ux-001.spec.ts` | Protected | Use an unchanged template for generic editor tests where Supply becomes financial; retain all editor assertions. |
| `.github/workflows/contracts.yml` | Protected | Run the new Supply browser/recovery and governance self-tests alongside every existing dependency/audit/fork/browser gate. |
| `.github/workflows/governance.yml` | Protected | Dispatch the single BUILD-012A allowance, add exact source permissions and current-build record checks in both phases; preserve historical checks. |
| `docs/AUTHORITY_MATRIX.md` | Protected | Record BUILD-012A scope and owner-only public wallet authority. |
| `docs/DECISIONS.md` | Protected | Append one approval decision for this single narrow amendment/plan; preserve every historical row. |
| `docs/NEXT_BUILD.md` | Protected | Point current work to Supply only; keep 012B/012C/012D unstarted. |
| `docs/REQUIREMENTS.md` | Protected | Record Supply requirements and truthful validation/acceptance evidence. |
| `docs/SCOPE_GUARD.md` | Protected | Document the exact BUILD-012A exception without widening ordinary UX policy. |
| `docs/STATUS.md` | Protected | Track only the requested maturity states with owner public acceptance still mandatory. |
| `docs/SECURITY_MODEL.md` | Protected | Record exact review, wallet, approval, persistence, ambiguity and reconciliation boundaries for Supply. |
| `docs/EVIDENCE_LEVELS.md` | Protected | Add exact Supply public classification prerequisites while preserving all historical ceilings. |

## Explicitly outside the allowance

No deletes. No dependency, lockfile, package-version, toolchain, bootstrap-integrity, legal-text, frozen-v1 schema/vector, historical plan/report/transcript, snapshot, wallet-provider, prior protocol-adapter, Master Spec or Master Prompt modifications. No new wallet system or future lending actions. No swap + Supply composition. No mainnet permission. No automatic owner signature, CLI acceptance transaction, external token mint on behalf of the owner, merge or 012B start.

The acceptance Evidence JSON is the one conditional created path: it is absent until public acceptance succeeds. Governance must permit that specific staged absence without treating it as evidence or allowing additional paths.

## Preflight observations

The original governance phases and 22 UX governance self-tests passed on the unchanged baseline. These are preflight checks only. Implementation checks and the real owner execution are reported separately in BUILD-012A-REPORT. DEC-0056 records the owner approval; no further scope approval is pending.
