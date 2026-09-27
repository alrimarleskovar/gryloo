# BUILD-005 — CoW signed-intent adapter

**Status:** approved by the owner on 2026-09-27 under DEC-0034; implementation and local acceptance in progress. **Baseline:** synchronized local `main`, `origin/main`, and GitHub `main` at `9c5484db1a78602cb6603744b03fb1b4096266da` on 2026-09-27. **Branch:** `codex/build-005-cow-signed-intent`. Implementation authority comes solely from the owner's explicit BUILD-005 approval recorded in DEC-0034.

## 1. Product outcome and source

The user can take the existing chat/canvas `asset.swap.exact-input` workflow through a distinct CoW signed-order journey: inspect the quote and exact EIP-712 fields, authorize the order in an injected wallet, see posting and lifecycle states, recover after an uncertain response or restart, request supported cancellation, and inspect settlement evidence. The same semantic swap action remains the source of intent; provider and execution kind are explicit in the reviewed policy and Manifest. A switch between CoW and Uniswap after authorization requires fresh artifacts, simulation, Manifest, and signature.

This is Build 005 in the approved Master Prompt §4 and the next milestone in `docs/NEXT_BUILD.md`. It advances the Master Spec §§5, 7–8, 11–13, 15–16 and 21 after the separately certified Mode A and finite Mode B local-fork slices. Gryloo remains a global, non-custodial, multichain engine. The Master Spec priorities remain primary EVM engine maturity, Solana non-EVM portability, Robinhood Chain when eligible, and Ethereum configuration/expansion; the Jupiter, Orca/Raydium, bridge, lending, Mode C and embedded milestones are unchanged. This build implements one EVM intent adapter, not a product-wide chain restriction.

## 2. Boundary and owner decision

**D-1, recommended:** approve the complete BUILD-005 local-first signed-intent journey below. The CoW Order Book transport implements the documented quote, order, lookup, trade, and supported cancellation contracts against an injected transport; acceptance uses a deterministic, loopback-only scripted orderbook and disposable local wallet. A real CoW endpoint, public RPC, public chain, production wallet, provider credential, paid service, or financial transaction is **not** used. EIP-712 signatures and order IDs are checked cryptographically in tests, but scripted posting/trades/settlement are labelled `MOCKED`; no live CoW fill, public-chain settlement or production certification is claimed. Existing BUILD-003/004 fork evidence remains exactly as recorded. Owner approval of D-1 authorizes implementation, local tests, governance, ordinary in-scope fixes, commits, push and one reviewable PR; merge remains the owner's decision. If a later acceptance step genuinely requires a public provider, wallet action or transaction, obtain a separate narrow authorization before that action.

The alternative is to require live CoW/public-chain evidence in BUILD-005; that changes cost, wallet and evidence boundaries and needs a revised plan before implementation. Deferral leaves the CoW path unavailable. No owner choice is needed for file organization, deterministic fixtures, UI copy faithful to evidence, polling intervals, tests or CI fixes within this scope.

## 3. Exact implementation scope

1. Extend the reference Action Registry capability for the **existing** semantic swap action to include `SIGNED_INTENT` without altering the frozen v1 schemas or compatibility corpus. Discover availability by explicit chain, token pair, amount and environment. The BUILD-005 demonstrated profile is a Base USDC/WETH exact-input intent in a local scripted environment; the adapter is chain-parameterized and does not assert CoW coverage everywhere.
2. Compile a CoW-specific quote/artifact, simulation limits, fixed-provider Mode A policy, Manifest binding, exact EIP-712 order and deterministic order UID. Pin chain ID, settlement domain, owner, receiver, tokens, sell/buy amounts, fee, validity, order kind, partial-fill flag, signing scheme and allowance/spender implications. Verify all signed limits against the Manifest immediately before posting. Refuse stale quote, changed owner/receiver/token/amount/fee/domain, invalid signature, unsupported chain or unapproved provider switch.
3. Implement a typed CoW Order Book transport with closed response validation and explicit error classification. Persist a signed order and posting attempt before transmission. On timeout, 5xx, connection loss or restart, query the deterministic UID first; never submit a second order while existence is uncertain. Keep journal entries append-only and recovery idempotent.
4. Track `SIGNED`, `POSTING`, `POST_RESULT_UNKNOWN`, `POSTED`, `OPEN`, `PARTIALLY_FILLED` where applicable, `FULFILLED`, `EXPIRED`, `CANCEL_REQUESTED`, `CANCELLED`, `RECONCILIATION_REQUIRED`, `RECONCILED`, `INCONCLUSIVE` and `DIVERGENT` at the adapter level, mapping into the existing workflow/segment/step/attempt journal contract without silently widening frozen v1 runtime enums. Supported cancellation is a separate reviewed wallet signature, and a request is never presented as completed cancellation. Reconcile orderbook state and trades against separately supplied settlement receipt, token balance deltas, allowance and fee observations in the scripted environment; absent or inconsistent settlement evidence remains `RECONCILIATION_REQUIRED` or `INCONCLUSIVE`.
5. Add a CoW review and tracking surface to the current Build → Simulate → Execute DApp. Display exact amounts, token identities, receiver, fee, expiry, provider, signing domain, order UID, state, cancellation status, and evidence provenance. Disable signing or posting on stale review, changed workflow or wrong wallet/chain. Restore an unfinished local order after browser/server restart. The current Mode A and Mode B journeys remain available and labelled with their original evidence boundaries.

## 4. Acceptance criteria

- The same edited Semantic Workflow IR revision reaches either adapter; a semantic edit invalidates a prepared CoW review. One user-visible local journey completes review → disposable wallet EIP-712 signature → locally scripted post → open/partial/fulfilled or cancel/expiry → evidence, with accurate `MOCKED` labels.
- Quote and exact signed order pass canonical field and Manifest checks; adversarial mutations of owner, receiver, tokens, chain/domain, sell amount, minimum buy amount, fee, validity, order kind, signature and provider fail before posting. Unsupported chain/token or stale quote is unavailable, not silently rerouted.
- A persisted posting attempt survives process restart. Ambiguous response and replay tests prove one UID produces at most one accepted order; no speculative repost occurs. Query failure stays unknown.
- Cancellation has its own signature and observed result. Late fill, partial fill, expired order, cancellation race and contradictory trade, receipt, balance, allowance or fee data preserve correct nonterminal or inconclusive states. A scripted fill is never labelled public-chain settlement.
- Browser tests cover user review, keyboard/focus, wrong-wallet refusal, restart recovery, ambiguity and cancellation. No public network call is made by tests or the default app. The existing direct and finite delegated flows and their evidence labels remain intact.
- Full applicable unit, integration, browser, governance, dependency/license/integrity, CycloneDX SBOM, exact-scope, secret, build, typecheck, lint, schema and compatibility gates pass locally and on PR CI. The report distinguishes synthetic evidence from BUILD-003/004 fork certification and records any unrun gate honestly.

## 5. Exact path scope and protected baseline

**Create (20):**

```text
docs/builds/BUILD-005-PLAN.md
docs/builds/BUILD-005-REPORT.md
docs/contracts/COW_SIGNED_INTENT_V1.md
tests/compatibility/v1/cow-signed-intent-vectors.json
packages/reference-compiler/src/cow.ts
packages/reference-compiler/test/cow.test.ts
packages/reference-executor/src/cow.ts
packages/reference-executor/test/cow.test.ts
packages/reference-reconciler/src/cow.ts
packages/reference-reconciler/test/cow.test.ts
apps/reference-dapp/src/server/cow-service.ts
apps/reference-dapp/src/server/cow-service.test.ts
apps/reference-dapp/src/app/cow-action.ts
apps/reference-dapp/src/state/cow-store.tsx
apps/reference-dapp/src/components/cow-panel.tsx
apps/reference-dapp/src/wallet/cow-eip712.ts
apps/reference-dapp/src/wallet/cow-eip712.test.ts
apps/reference-dapp/e2e/cow-intent.spec.ts
apps/reference-dapp/e2e/cow-recovery.spec.ts
apps/reference-dapp/e2e/cow-fixtures.ts
```

**Modify (27):**

```text
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
packages/action-registry/src/reference-registry.ts
packages/action-registry/test/registry.test.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/test/validation.test.ts
apps/reference-dapp/src/domain/swap-authoring.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/components/action-library.tsx
packages/reference-compiler/src/index.ts
packages/reference-executor/src/index.ts
packages/reference-reconciler/src/index.ts
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/e2e/network-isolation.spec.ts
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/EVIDENCE_LEVELS.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
```

**Delete:** none. **Protected:** every other tracked path in baseline `9c5484db1a78602cb6603744b03fb1b4096266da` (374 of 401 paths) remains byte- and mode-identical. In particular protect the Master Spec, Master Prompt, accepted ADRs, BUILD-000 through BUILD-004 historical records, BUILD-003F transcript, BUILD-004 local-fork evidence, all existing v1 schemas/compatibility vectors, legal files, lockfile and dependency pins, and unrelated source and screenshots. A needed path outside this list is a plan discrepancy to resolve with the narrowest in-scope change before editing; material scope, authority or licensing changes return to the owner.

## 6. Delivery and evidence

After D-1 approval, implement the journey and gates on this one branch, record an accurate BUILD-005 report and current governance state, commit reviewable conceptual units, push, open one PR, and fix in-scope CI failures. Do not merge. Report the PR URL, exact CI results, unrun checks and evidence ceiling for owner review. No source-of-truth spec or prompt edit is authorized.

Technical reference checked during planning: [CoW Order Book API and EIP-712 integration](https://docs.cow.fi/cow-protocol/integrate/api). The API describes quote, order posting, lookup, trades and cancellation endpoints; implementation tests must prove the actual selected response and signing profile rather than infer production readiness from documentation.

The three authoring/validation paths above were added after implementation inspection: the existing swap node had a Uniswap-only protocol constraint. A CoW signature against that node would contradict user intent. The explicit CoW choice in the existing swap form allows both approved providers before authorization, while default and legacy Uniswap-only nodes retain their exact historical bytes and hashes; no provider may change after authorization. This is the minimum in-scope correction required by §3.1 and does not widen an external-action boundary.

The four authoring-command and form paths above were added after protected screenshot acceptance exposed a semantic-hash change from making CoW available by default. CoW now requires an explicit preauthorization choice in the existing swap form. This preserves every existing default swap hash, recorded-observation screenshot and direct/fork workflow while letting the selected swap use the same reviewed IR for either adapter. No external-action or evidence boundary changed.
