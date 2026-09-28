# BUILD-007 — First finite Mode B swap-to-liquidity composition

**Status:** APPROVED by the human owner from clean synchronized `main` at `f4868b94e10981b820653dd21d1ef94a72edb067`. **Branch:** `codex/build-007-mode-b-composition`. Approval covers implementation, local acceptance, report, commit, push and one unmerged PR. The owner retains merge and certification.

## 1. Single objective

Let a user author and review one Base USDC → WETH Uniswap swap → Uniswap v3 WETH/USDC 0.05% position in the shared chat/canvas IR, install finite Safe/Roles authority, and let a deterministic worker complete and independently reconcile the two-step plan on local chain 31337 after browser closure or worker restart.

## 2. Relationship to v3.2

- Master Spec §§5, 7–8, 10–13, 16–17, 19, 21 Phase 4, 22 and 28 Gates 2, 4–6; Master Prompt §§1–5 Build 007, 8–9 and 11.
- BUILD-003 swap, BUILD-004 isolated finite Safe/Roles swap, and BUILD-006 isolated Mode A liquidity are separately certified `FORK_REPRODUCED` on local chain 31337. BUILD-005 CoW is separately certified `MOCKED`. No earlier claim is relabeled.
- BUILD-003F and BUILD-006 transcripts pin different Base blocks; they cannot jointly prove one composition. BUILD-007 needs its own complete recording and closed replay. BUILD-003E remains reserved for public-testnet evidence. Gryloo remains global, non-custodial and multichain, including Solana priority.
- Add B007-IR-001, B007-SIM-001, B007-AUTH-001, B007-EXEC-001, B007-RECOVERY-001, B007-EVIDENCE-001 and B007-ROADMAP-001 to the requirements registry with actual results.

## 3. Authorized scope

One Base USDC/WETH 0.05% Uniswap exact-input swap produces WETH in a disposable Safe. One dependent mint uses the reconciled actual WETH output, approved range and current pool state, bounded by reviewed WETH and USDC caps. The NFT recipient and owner is the Safe. The flow is sequential and may partially complete. Chat and canvas must construct the same two-node revisioned IR with a typed WETH output reference. Quotes, pool state, balances, receipts, token ID and runtime state remain outside the IR. CoW and other graph connections remain unsupported.

A new opt-in, loopback-only service builds separate Quote/State Artifacts, a chained Simulation Bundle, Policy, Manifest, composition permission, Execution Plan, four-level journal and Evidence Bundle. A fixed worker loads a disposable executor key outside Git, persists/reserves before each attempt, reconciles before continuation, and has no arbitrary transaction endpoint. A new strict composition permission/hash profile binds the Manifest without changing frozen v1 schemas, domains or vectors; add a new compatibility vector and additive contracts package version `0.3.0`.

Safe 1.4.1 and Zodiac Roles 2.1.0 remain pinned to the accepted BUILD-004 inputs. The owner wallet signs setup, exact finite router/Position Manager approvals, two role installations and revocation. Roles must constrain swap target, selector, token pair, Safe recipient, exact input and one non-refilling call; Uniswap enforces minimum output and deadline. A separate one-use mint role must constrain Position Manager target and selector, token pair, fee, ticks, Safe NFT recipient, upper bounds on both desired amounts, fixed minimums and deadline. Finite USDC router and Position Manager allowances together may not exceed the reviewed total USDC budget; WETH Position Manager allowance has its own cap. Direct calls outside the UI/API and same-block contention must prove the effective bounds. Gas and step ordering are labeled application controls, not Roles-enforced limits. The Safe owner retains broader authority. If direct fork tests show Roles cannot enforce the mint bounds, stop the composed Mode B claim and request a new owner decision; no weaker substitute is authorized.

The new read-only Base recording is owner-operated only after a complete synthetic dry run, exact pinned-tool and method-allowlist preflight, current Free-plan report and fresh owner-controlled mode-0600 credential outside Git. One attempt: at most 1,500 provider requests, 39,000 reserved listed CU, 30 minutes, at least 400 ms single-flight send spacing, permanent stop on first provider, policy, validation or accounting error. The credential is removed; its value never enters Git, transcript, browser, Anvil, logs or agent context. New disposable local accounts and Safe funding are declared `LOCAL_SETUP_NOT_BASE_OBSERVED`. No prior transcript, recording budget or credential is reused.

## 4. Out of scope

Public-chain writes, public testnet, mainnet, real funds, production wallet or executor key, CoW-to-liquidity, another pool or chain, Mode B increase/remove/collect, automatic rebalancing, Mode C, bridge, lending, Solana implementation, package publication and PR merge. No isolated certified evidence is altered or promoted.

## 5. Acceptance criteria

1. Chat/canvas round-trip one two-node IR and valid WETH output reference. Invalid edges, adapters, assets, recipient, revision and material edits fail closed and invalidate descendants.
2. At one source block, verify Router02, Quoter, factory, pool, Position Manager and token identities/code. Simulate expected/minimum swap outputs, range-derived deposits, cumulative token budgets, gas reserves and partial-failure residues without double spending.
3. The owner reviews and signs each installation. Direct onchain readback matches the exact permission; the permission hash/Manifest are not represented as onchain enforcement by themselves.
4. With browser closed and after a fresh worker start, reconcile the swap before choosing the bounded mint amount. One NFT is owned by the Safe.
5. Independent direct fork calls reject altered recipient, token, chain, target, function, ticks, one-unit excess spend, replay, expiry and revoked authority; concurrent attempts cannot consume either one-time call twice.
6. Independent raw-RPC verification checks signed bytes/signer, receipts, actual output, Safe balance deltas, owner/token ID/ticks/liquidity, deposits, fees, allowances, role state and residual assets. Principal is never reported as earned fees.
7. Unknown submission, inconsistent RPC, changed pool state, insufficient output, failed mint, restart and revocation during pending work cannot duplicate effects or falsely complete.
8. Existing BUILD-003 through BUILD-006 paths, evidence, protected transcripts, frozen contracts/vectors, legal text and visual baselines remain intact.

## 6. Required tests and gates

- Local: strict ingress, compatibility/hash/invalidation, integer range and budget tests; compiler/decode and Roles-condition tests; executor concurrency/idempotency/restart; direct bypass on fork; complete synthetic rehearsal; recording preflight; credential-free transcript validation; byte-identical closed replay; independent verifier; guarded browser journey, recovery, accessibility and visual review; `pnpm check`, `git diff --check`, governance, secret and license scans.
- CI: pinned frozen install and toolchain, typecheck, lint, build, unit/compatibility/fork/browser, exact protected-byte scope, dependency integrity/license/age, low-threshold audit and ephemeral CycloneDX validation. No credential or external route for fork/browser tests. Report local, owner-operated, PR-head and post-merge gates separately; skips and unrun gates do not count as passes.

## 7. Authority and artifacts

Authorization is `MODE_B_FINITE_DELEGATION` only on chain 31337. The wallet controls Safe setup and revocation; the worker controls only a disposable bounded executor identity. Acyclic hash order: semanticWorkflowHash → artifactSetHash → simulationHash → policyHash → manifestHash → compositionPermissionHash, followed by exact executable payload hashes, executionAttemptId and evidenceBundleHash. A material change invalidates downstream artifacts and requires new wallet authority. The enforcement matrix names `SMART_ACCOUNT_MODULE_OR_GUARD`, `PROTOCOL_VERIFIER`, `APPLICATION_GATEWAY` or `NOT_ENFORCED` for each limit. Local pause is not revocation. A confirmed effect is not rolled back by deleting a journal.

## 8. Security impact

Protect owner wallet authority, disposable executor key, finite allowances, Safe assets/NFT, private provider credential and evidence integrity. Threats include forged pool/token, malformed range/math, overbroad mint role, same-block overspend, stale quote, changed state, duplicate send, unknown result, partial completion and misleading Safe ownership/fee claims. Use exact allowlists and code pins, separately reviewed installation, direct bypass tests, durable attempts and reservations, strict closed replay, independent reconciliation and honest interface labels.

## 9. Evidence target

Maximum `FORK_REPRODUCED` on local chain 31337, conditional on a complete new recording, `REPLAY_BYTE_IDENTICAL`, independent reconciliation and direct boundary proof. Synthetic work is `MOCKED`; Base reads are `NOT_EVIDENCE` for transaction outcomes. A receipt alone is `CONFIRMED_NOT_RECONCILED`; incomplete or contradictory reads are `INCONCLUSIVE` or `DIVERGENT`. PR-head checks, owner merge, post-merge checks and a separate owner certification decision are required for certification.

## 10. License impact

New contracts profile and vectors are Apache-2.0; reference compiler, linter, executor, reconciler and DApp are AGPL-3.0-only. No new external dependency or vendored contract source is approved. Existing official licenses, notices and dependency pins remain unchanged.

## 11. Exact expected files

**Create:**

```text
docs/builds/BUILD-007-PLAN.md
docs/builds/BUILD-007-REPORT.md
docs/adr/ADR-0005-mode-b-composition-authority.md
docs/contracts/MODE_B_COMPOSITION_LOCAL_V1.md
tests/compatibility/v2/mode-b-composition-vectors.json
packages/workflow-contracts/src/mode-b-composition-permission.ts
packages/workflow-contracts/test/mode-b-composition-permission.test.ts
packages/reference-linter/src/composition.ts
packages/reference-linter/test/composition.test.ts
packages/reference-compiler/src/composition.ts
packages/reference-compiler/test/composition.test.ts
packages/reference-compiler/test/composition.fork.test.ts
packages/reference-executor/src/composition.ts
packages/reference-executor/test/composition.test.ts
packages/reference-executor/test/composition.fork.test.ts
packages/reference-reconciler/src/composition.ts
packages/reference-reconciler/test/composition.test.ts
packages/reference-reconciler/test/composition.fork.test.ts
apps/reference-dapp/src/domain/composition-authoring.ts
apps/reference-dapp/src/domain/composition-authoring.test.ts
apps/reference-dapp/src/server/composition-service.ts
apps/reference-dapp/src/server/composition-service.test.ts
apps/reference-dapp/src/app/composition-action.ts
apps/reference-dapp/src/state/composition-store.tsx
apps/reference-dapp/src/components/composition-panel.tsx
apps/reference-dapp/e2e/fork/composition-recording.mjs
apps/reference-dapp/e2e/fork/composition-replay-upstream.mjs
apps/reference-dapp/e2e/fork/composition-harness.mjs
apps/reference-dapp/e2e/fork/composition-transcript.json
apps/reference-dapp/e2e/fork/composition-verify-manual-wallet.mjs
apps/reference-dapp/e2e/composition-fixtures.ts
apps/reference-dapp/e2e/composition-fork.spec.ts
apps/reference-dapp/e2e/composition-recovery.spec.ts
apps/reference-dapp/e2e/composition-adversarial.spec.ts
apps/reference-dapp/e2e/composition-fork.spec.ts-snapshots/composition-review-chromium-linux.png
apps/reference-dapp/e2e/composition-fork.spec.ts-snapshots/composition-reconciled-chromium-linux.png
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
packages/workflow-contracts/package.json
packages/workflow-contracts/src/canonical.ts
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/test/canonical.test.ts
packages/workflow-contracts/test/contracts.test.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/test/validation.test.ts
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
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/app/globals.css
pnpm-lock.yaml
```

**Owner-approved scope amendment (2026-09-28):** The owner explicitly added six consumer manifests to permit the approved `workflow-contracts` 0.3.0 bump with frozen workspace installation: `apps/reference-dapp/package.json`, `packages/action-registry/package.json`, `packages/reference-linter/package.json`, `packages/reference-compiler/package.json`, `packages/reference-executor/package.json`, and `packages/reference-reconciler/package.json`. Only their `workspace:0.2.1` dependency pins may change to `workspace:0.3.0`.

**Owner-approved verifier amendment (2026-09-28):** The owner explicitly added `scripts/bootstrap-ci.py` to the modify scope solely to update the current exact `workflow-contracts` 0.3.0 version and six consumer `workspace:0.3.0` manifest/lock expectations. The 247 registry identity integrity, license and release-age checks, historical baselines and all other rules remain unchanged.

**Owner-approved recording remediation amendment (2026-09-28, DEC-0039):** The spent attempt stopped because `composition-recording.mjs` placed the harness runtime under the recording root, outside the `/tmp/` path required for disposable keys; synthetic rehearsal did not exercise that layout. Within the existing `composition-recording.mjs` path only, the owner approved a fresh `/tmp/` runtime in every mode (session journal and request log unmoved), a 120,000 ms fork RPC call timeout in live recording sessions only (closed replay keeps the default), and a distinct new attempt root `/home/asus/.gryloo/build-007-attempt-2`. The spent first-attempt evidence under `/home/asus/.gryloo/build-007` remains unmodified. The 1,500-request, 39,000-CU, 30-minute, 400 ms spacing and first-error stop limits and the Anvil timeout are unchanged. No new recording attempt, credential, provider request, merge or certification is authorized.

**Owner-authorized attempt 2 (2026-09-28, DEC-0040):** One attempt-2 read-only Base recording is authorized from `/home/asus/.gryloo/build-007-attempt-2` against manifest SHA-256 `6a171dc81fcda36ead2f0f561e19220464c6e2c431cdfd40e16b1a6796ca292f`. The §3 limits are unchanged: 1,500 requests, 39,000 reserved listed CU, 30 minutes, at least 400 ms single-flight spacing and a permanent stop on the first error. It runs only after the owner reports the fresh credential ready. A stop spends attempt 2. The first-attempt evidence stays untouched.

**Delete:** none. Every other tracked baseline path is byte- and mode-protected, including the Master Spec, Master Prompt, accepted ADRs, frozen v1 schemas/vectors, BUILD-003 through BUILD-006 certified records and transcripts, legal texts and prior visual baselines. A necessary path outside the lists requires a plan amendment and owner decision before editing.

## 12. Risks and rollback

If Roles cannot enforce the mint bounds, stop and report; do not substitute application-only bounds. If recording stops, preserve its credential-free stop journal and counters; the one attempt is spent. If the swap succeeds but mint fails, mark `PARTIALLY_COMPLETED`, show WETH and USDC in the Safe and require safe reconciliation or new owner authority. Never automatically swap back or repeat a confirmed step. Unknown submissions stay frozen until nonce, signed bytes, receipt, role consumption and balances agree. A failed gate leaves the composition disabled and earlier certified paths intact. The PR remains unmerged for owner review.

## 13. Human decision

The owner approved this plan in full from synchronized main `f4868b94e10981b820653dd21d1ef94a72edb067`, including the exact path scope, one conditional bounded owner-operated read-only recording and unmerged PR delivery. The owner retains merge and certification. No public-chain, testnet, mainnet, real-funds, production-wallet or later-build authority is implied.
