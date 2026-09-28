# BUILD-006 — Uniswap v3 liquidity lifecycle

**Status:** approved by the owner on 2026-09-27 under DEC-0036. **Baseline:** clean synchronized `main` and `origin/main` at `4a402dd6be956fee0e3df001b8ad0f356f625937`. **Branch:** `codex/build-006-uniswap-liquidity`. The owner approved implementation, local acceptance, report, commit, push and one unmerged PR; merge remains with the owner.

## 1. Single objective

Let a user author one isolated Base USDC/WETH Uniswap v3 position through the shared chat/canvas Semantic Workflow IR, review range-derived amounts and exact Mode A wallet payloads, then add, inspect, increase, decrease, collect and fully remove the position on a controlled chain-31337 Base fork with independently reconciled ownership, liquidity, token flows, fees, allowances and residual assets.

## 2. Relationship to v3.2

- Master Spec §§5, 7–8, 10–13, 15–17, 19, 21 Phase 4 and Gates 2, 3 and 6; Master Prompt §§1–5 Build 006, 8–9 and 11.
- Preserve one shared IR, separated artifacts, non-custodial wallet authority, global multichain scope and Solana priority. BUILD-007 remains the first swap-to-liquidity Mode B composition.
- Dependencies: BUILD-003 and BUILD-004 are separately `FORK_REPRODUCED` on local chain 31337; BUILD-005 is separately `MOCKED`. ADR-0002, ADR-0003 and ADR-0004 govern contracts, exact Mode A payloads and controlled fork boundaries. BUILD-003E public-testnet evidence remains reserved.
- Candidate requirement IDs: B006-IR-001, B006-POOL-001, B006-MATH-001, B006-AUTH-001, B006-LIFECYCLE-001, B006-RECOVERY-001, B006-EVIDENCE-001 and B006-ROADMAP-001; add their acceptance rows to `docs/REQUIREMENTS.md` during implementation.

## 3. Authorized scope

One isolated Uniswap **v3** Base USDC/WETH position through one verified existing fee-tier pool, reproduced on local execution chain 31337. Use factory-derived pool identity, verified deployed code and relations, token order, `slot0`, current tick and tick spacing. The candidate official Base NonfungiblePositionManager is `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1`; verify it at the selected source block before use. Reject a missing or inconsistent pool or deployment.

Add typed liquidity actions and capability declarations in the existing registry. Chat and canvas edit the same revisioned IR. Stable inputs include tokens, pool/fee constraint, tick bounds, native-unit maximum inputs, minimum outputs, owner/recipient and failure policy. Mutable pool state, balances, quote, token ID, receipts and runtime status remain in separate artifacts. Existing swap nodes and hashes remain byte-identical.

Calculate token composition with integer range math using current price and approved ticks, including below-, inside- and above-range cases and rounding. Simulate approvals, gas, fees, residuals, price/range risk and failures. Review a Manifest and exact separately signed EIP-1559 payloads for finite token approvals, mint, increase, decrease, collect and, when eligible, burn of an empty position NFT. Inspect is read-only; changing range means separately authorized removal and a new position, not `increaseLiquidity`.

Persist an `executionAttemptId` before every submission. On ambiguity or restart, reconcile sender/nonce, transaction, receipt and position state before any replacement. Reconcile owner/token ID, ticks, liquidity, token amounts, fees, allowance, gas and residual assets independently. Full removal means zero liquidity and collected owed amounts; show a remaining empty NFT honestly if burn is unavailable.

### Controlled Base read-only recording

The BUILD-003F certified transcript is protected and has no pinned Position Manager evidence. A new credential-free closed replay is a prerequisite for the BUILD-006 `FORK_REPRODUCED` target. The owner explicitly authorized one owner-operated, read-only Base recording after offline dry-run and pinned-tool preflight, current Free-plan confirmation, a fresh private credential under the prior file boundary, and review of the exact allowlist. The cap is one attempt, 1,500 provider requests, 39,000 reserved listed CU, 30 minutes, at least 400 ms between single-flight sends, and permanent stop on the first provider, policy, validation or accounting error. No previous recording budget or transcript may be reused or rewritten. No agent-held credential or public transaction is authorized. All financial transactions use only disposable accounts on the local fork; local funding and fee-generating setup are labeled `LOCAL_SETUP_NOT_BASE_OBSERVED`.

## 4. Out of scope

Public-chain writes, public testnet, mainnet, real funds, production wallets, Uniswap v4, a second pool or chain, automated range management, yield claims, swap/CoW-to-liquidity or other composition, Mode B liquidity permission, Solana implementation, package publication, managed infrastructure and BUILD-006 PR merge. No existing certified evidence is relabeled.

## 5. Acceptance criteria

1. Chat/canvas round trip preserves one IR revision; conflicts and material edits fail closed and invalidate dependent hashes.
2. Capability discovery refuses unsupported chain, token, pool, fee tier, range, wallet or environment; pool and Position Manager identities, code, token order and tick spacing match the pinned source state.
3. Integer range calculations match independent vectors below, within and above range, at boundaries and rounding edges. Simulation discloses native-unit composition, approvals, gas, fees, residuals, risks and freshness.
4. On the controlled fork, a user completes mint, inspect, increase, partial decrease, collect, full decrease/collect and optional eligible NFT burn, with each wallet operation separately reviewed and signed.
5. Exact calldata review rejects changed chain, target, selector, token, tick, tier, recipient, token ID, amount limit, minimum, deadline, nonce, gas or wallet payload. Changed pool state blocks stale submission.
6. Unknown submission, restart, duplicate request, revert, transferred NFT, changed allowance, inconsistent RPC and interrupted removal do not duplicate effects or falsely reconcile.
7. Every step links IR, artifact set, simulation, policy, Manifest, exact payload, signed transaction, journal and independent evidence. Estimates and observed fees are separate. Remaining permissions and assets are visible.
8. Existing Mode A swap, finite Mode B swap, CoW local intent, historical vectors and labels remain intact. BUILD-006 makes no composed Mode B claim.

## 6. Required tests and local/CI gates

- Offline unit and compatibility: strict ingress, registry/linter, IR revision and hash invalidation, integer range math, payload encode/decode, journal idempotency and reconciliation, malformed responses and provider outage.
- Controlled fork: pinned tools and contract code, complete new credential-free transcript, byte-identical closed replay, lifecycle, separate approvals, injected failures, restart and independent readback. CI uses no credential or external route.
- Browser: chat/canvas, Build → Simulate → review → Execute, each signature, inspect/partial/full removal, ambiguity, keyboard/focus, responsive layout and loopback network guard.
- Repository: `pnpm check`, schema drift, applicable fork/browser suites, frozen install, locked dependency integrity/licensing/age, low-threshold audit, secret and protected-byte checks, `git diff --check`, exact-scope governance and ephemeral CycloneDX SBOM validation.
- Report local, owner-operated and remote gates separately; PR-head checks, owner merge and post-merge checks are distinct certification gates. A skipped or unrun check is never passed.

## 7. Authority and artifacts

- Authorization mode: Mode A exact reviewed transactions only. The user wallet signs; Gryloo, model and server hold no user key and do not broadcast for the user.
- Reuse canonical IR, Quote/State, Artifact Set, Simulation Bundle, Authorization Policy, Manifest, Execution Plan, Journal and Evidence Bundle contracts, with an additive liquidity profile/vector. Existing v1 schemas, domains, fixtures and historical hashes stay frozen.
- The enforcement matrix states each limit's real location. Exact signed payload and protocol checks differ from application freshness checks and monitoring. Finite USDC and WETH approvals; no unlimited allowance or arbitrary target.
- Every material IR/pool-state change invalidates dependent artifacts and authorization. Local pause is not onchain revocation; allowance reset and any NFT burn are separately authorized actions.

## 8. Security impact

Protected assets are user wallet authority, disposable local test accounts, a new private provider credential, token approvals, position NFT ownership and evidence integrity. Threats include fake pool/token, tick/decimal/rounding errors, stale state, excessive approval, NFT transfer, ambiguous wallet submission and principal mistaken for earned fees. Typed validation, allowlists, exact decoded payloads, independent readback, fail-closed recovery and honest labels are mandatory. No production signer or public write path is introduced.

## 9. Evidence target

Maximum `FORK_REPRODUCED` on local chain 31337, conditional on complete closed replay and independent lifecycle reconciliation. Pure fixtures are `MOCKED`; Base reads are `NOT_EVIDENCE` for transaction outcomes. Confirmation alone is `CONFIRMED_NOT_RECONCILED`; independent agreement permits `RECONCILED`; missing or contradictory observations are `INCONCLUSIVE` or `DIVERGENT`. A failed recording or incomplete lifecycle leaves BUILD-006 uncertified at its demonstrated level. No testnet, mainnet, production wallet, real-funds or public financial outcome is claimed.

## 10. License impact

New registry and contract-profile material is Apache-2.0; reference compiler, executor, reconciler, linter and DApp implementation is AGPL-3.0-only. No new registry dependency or vendored upstream code is planned. Any needed dependency or upstream material requires exact version, license, integrity, security and notice review before addition. No legal grant or official license text changes.

## 11. Exact expected files

**Create:**

```text
docs/builds/BUILD-006-PLAN.md
docs/builds/BUILD-006-REPORT.md
docs/contracts/UNISWAP_V3_LIQUIDITY_LOCAL_V1.md
tests/compatibility/v1/uniswap-v3-liquidity-vectors.json
packages/reference-linter/src/liquidity.ts
packages/reference-linter/test/liquidity.test.ts
packages/reference-compiler/src/liquidity.ts
packages/reference-compiler/test/liquidity.test.ts
packages/reference-compiler/test/liquidity.fork.test.ts
packages/reference-executor/src/liquidity.ts
packages/reference-executor/test/liquidity.test.ts
packages/reference-executor/test/liquidity.fork.test.ts
packages/reference-reconciler/src/liquidity.ts
packages/reference-reconciler/test/liquidity.test.ts
packages/reference-reconciler/test/liquidity.fork.test.ts
apps/reference-dapp/src/domain/liquidity-authoring.ts
apps/reference-dapp/src/domain/liquidity-authoring.test.ts
apps/reference-dapp/src/server/liquidity-service.ts
apps/reference-dapp/src/server/liquidity-service.test.ts
apps/reference-dapp/src/app/liquidity-action.ts
apps/reference-dapp/src/state/liquidity-store.tsx
apps/reference-dapp/src/components/liquidity-panel.tsx
apps/reference-dapp/src/wallet/liquidity-eip1193.ts
apps/reference-dapp/src/wallet/liquidity-eip1193.test.ts
apps/reference-dapp/e2e/fork/liquidity-recording.mjs
apps/reference-dapp/e2e/fork/liquidity-replay-upstream.mjs
apps/reference-dapp/e2e/fork/liquidity-harness.mjs
apps/reference-dapp/e2e/fork/liquidity-transcript.json
apps/reference-dapp/e2e/liquidity-fixtures.ts
apps/reference-dapp/e2e/liquidity-fork.spec.ts
apps/reference-dapp/e2e/liquidity-recovery.spec.ts
```

**Modify:**

```text
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/EVIDENCE_LEVELS.md
docs/LICENSE_MAP.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
packages/action-registry/src/reference-registry.ts
packages/action-registry/test/registry.test.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/test/validation.test.ts
packages/reference-compiler/src/index.ts
packages/reference-executor/src/index.ts
packages/reference-reconciler/src/index.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/state/workflow-store.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/simulate-panel.tsx
apps/reference-dapp/src/components/execution-panel.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/app/globals.css
```

**Delete:** none. Every other tracked path at baseline `4a402dd6be956fee0e3df001b8ad0f356f625937` is protected byte- and mode-identically, including the Master Spec, Master Prompt, accepted ADRs, frozen v1 schemas/vectors, BUILD-000–005 records, certified BUILD-003F transcript, BUILD-004 fork evidence, BUILD-005 mocked evidence, legal texts, dependency pins and existing visual baselines. A necessary path outside these lists needs a plan amendment before editing.

## 12. Risks and rollback

An incomplete transcript, imprecise range math, stale pool state, excessive approval, NFT ownership change, unknown submission or confused fee accounting stops the affected flow. If recording stops, preserve counts and credential-free stop evidence; retry needs a new owner decision. If an acceptance gate fails, leave liquidity disabled, preserve prior certified paths and report the incomplete state. Reconcile confirmed local effects or require explicit intervention; rollback never means reversing a confirmed transaction. The final PR remains unmerged for owner review.

## 13. Owner decisions

DEC-0036 records full approval of this single plan, including the bounded owner-operated read-only recording under §3 conditions. No public-chain transaction, mainnet, real funds, production wallet, BUILD-007 composition, Mode B liquidity authority or PR merge is authorized. A new path, provider, budget, credential condition, evidence ceiling or authority mechanism requires a new owner decision.
