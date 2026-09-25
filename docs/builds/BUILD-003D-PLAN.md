# BUILD-003D — Uniswap Mode A vertical slice on a controlled Base fork

Status: `APPROVED_FOR_IMPLEMENTATION`. On 2026-09-24 the owner approved implementation of this plan, with Amendments 1 and 2, followed by the narrow D-5 Amendment 3, the exact-path Amendment 4, and the recommended D-1 to D-20 choices (the approved plan text had SHA-256 `dd0e95abfdf1b5cf3e184ade7b8322a0c03f18f2e681c5c727b651869e90b7b4` before this status record). Work follows gates G0 to G8. The Alchemy session is authorized only within the D-5 caps, after the offline preflight and the owner's no-paid-billing confirmation. The owner runs the recording command. Base Mainnet execution, BUILD-004 and merging are not authorized. Branch: `codex/build-003d-mode-a-fork-vertical-slice`. Baseline: `main` at `8a5fbaed26e005e5719528c399f7ca1adb334eb6`.

**What this plan proposes.** BUILD-003D completes the remaining Master Prompt Build 003 slice in **one build**, in a controlled local fork of Base mainnet. It covers exact-payload review, wallet authorization, controlled submission, attempt journaling, recovery, independent reconciliation and an Evidence Bundle. The evidence environment is `FORK_REPRODUCED`. Mainnet execution, testnet execution, Mode B and every later build stay outside it. BUILD-003E is proposed **only** as an optional public-testnet increment, in case the owner requires `TESTNET_EXECUTED` evidence before BUILD-004 (§1.4, D-2).

**What this plan does not authorize** before approval:

- dependency installation, live RPC requests, implementation;
- commits, pushes and PRs.

**Amendment 1 (requested by the owner on 2026-09-24; proposed).** Three explicit gates are added:

1. **Offline anvil compatibility gate (G1, §3.2.6).** It runs against the exact pinned anvil v1.8.3 binary before any credentialed request. A failed required method stops the build and returns for a D-14 (or D-5, D-3) decision. Nothing is substituted silently.
2. **Manual injected-wallet acceptance (G7, §3.9.1).** It uses a real injected EIP-1193 wallet with a recorded dev account on chain 31337 only. The automated test-wallet evidence stays separately labelled. Any outcome other than a pass is recorded as `LIMITED`. The PR may still be delivered, but BUILD-003 stays `IN_PROGRESS` (Amendment 2).
3. **Conditional certification (§1.5).** P1–P14 are conditional acceptance criteria. BUILD-003 is marked complete, and eligible for BUILD-004 planning, only after the results actually pass and the owner records a certification decision. Before the owner-run session, the owner verifies that the Alchemy account has no paid billing (§3.3.2).

**Sections changed by Amendment 1:**

- the status line and the owner request table;
- §1.4, §1.5 and §2.1;
- §3.2.3 and the new §3.2.6;
- §3.3.2, §3.3.3 and §3.3.6;
- the new §3.9.1;
- §3.18, §3.19 and §3.20;
- §4, §5, §6, §9, §11, §12 and §13.

**Choices changed:** D-1, D-2, D-3, D-5, D-9, D-10, D-14 and D-20.

**Amendment 2 (owner correction, 2026-09-24; proposed).** G7 does not block delivery of the BUILD-003D PR. It is **required** for certifying BUILD-003 as complete and eligible for BUILD-004 planning.

If the manually operated injected wallet cannot complete both transactions with exact payload fidelity and `RECONCILED` evidence:

- the result is recorded as `LIMITED`;
- the PR is delivered with that limitation, provided every other gate passes;
- BUILD-003 stays `IN_PROGRESS`.

`LIMITED` never satisfies Master Spec Gate 3 for completion.

**Sections changed by Amendment 2:** the status line, Amendment 1 item 2, §1.5, §2.1, §3.9.1, §3.19, §3.20, §5, §9, §12 and §13.

**Choices changed by Amendment 2:** D-2, D-9, D-19 and D-20.

**Amendment 3 (owner-approved D-5 correction, 2026-09-24; DEC-0023).** Offline G1 against pinned Anvil v1.8.3 found five extra method names, including startup probes and missing-object lookups. The owner approved only the following local responses by the recording/replay proxy, for the exact observed parameter forms:

- `eth_gasPrice []` and `eth_getAccountInfo [address, H]`: JSON-RPC method-not-found. Anvil falls back to the approved state reads.
- `eth_getBlockByHash [hash, true]`: `null` for a missing non-source block; a request for H returns already verified pinned block-N data or fails closed.
- `eth_getTransactionByHash [txHash]` and `eth_getTransactionReceipt [txHash]`: local `null` after Anvil has missed local data. A null alone cannot establish `NOT_FOUND` or permit retry; the nonce, txpool, waiting and reconciliation checks in §3.11 remain mandatory, including the broadcast-before-unknown-result test.

No extra method is forwarded to Alchemy. The provider allowlist, 3-attempt/1,800-request total and 900-request per-attempt caps, pacing, stop rules, exact Anvil command, `eth_simulateV1` method and all other approved boundaries are unchanged. The proxy accepts only the observed forms; other hashes, parameter forms, methods and batches stop the session. Approved state reads must name exactly source hash H on the Anvil side and are forwarded only after rewriting the block parameter to `{ "blockHash": H, "requireCanonical": true }`. C4 now proves both sides of that boundary and negative cases entirely offline. Any additional method or form stops for a new decision. This amendment authorizes no live request or owner-only recording run.

**Amendment 4 (owner-approved exact-path correction, 2026-09-24; DEC-0023).** Add only `packages/workflow-contracts/test/contracts.test.ts` to the §11 Modify list and remove it from Do not touch. Its sole authorized change is the existing package-version assertion from `0.1.0` to the approved `0.2.0`. The exact counts become 113 created, 51 modified, 164 total and 201 protected. No other test-file change, dependency, license, schema, fixture, vector, RPC, wallet or recording authority is added.

**Planning record (2026-09-24).**

- **Git state.** Checked on the WSL2 checkout and GitHub (§2.3). Before this branch was created, the tree was clean.
- **Files changed during planning.** Only this untracked plan file. Branch creation was the only Git operation.
- **Diagnosis of the intermittent screenshot.**
  - The approved local toolchain ran the existing unmodified E2E tests: pinned Node 24.21.0, the cached headless shell revision 1243 and the replay mode.
  - An ad-hoc scratch copy of the expiry test ran outside the repository with CPU throttling and pixel "fingerprints" (§3.16).
  - These runs used an existing turbo-cached build, wrote only ignored outputs (`.next`, `test-results`), and left `next-env.d.ts` byte-identical.
- **Documentation retrieved.** No RPC request was made. Every item is listed in §2.2:
  - the Uniswap Base deployments page;
  - the SwapRouter02 sources;
  - Foundry release metadata and anvil source files;
  - npm registry metadata for `@noble/hashes` and `@noble/curves`.
- **Not done.** No dependency or binary was installed. No credential was read. No RPC request of any kind was made.

No Claude conversation or private memory is an authority source.

### Owner request → section

| Request | Section |
|---|---|
| Verified Git state, PR #9 merge and CI (including the rerun) | 2.3 |
| Assessment of a read-only simulation of the exact direct swap path using a fresh verified quote | 1.3 |
| Fewest coherent increments; what completes BUILD-003; when BUILD-003E is necessary | 1.4, 1.5 |
| One measurable objective | 1 |
| Exact created, modified and protected paths | 11 |
| Artifact and hash relationships | 3.7, 7 |
| Source and block freshness | 3.3, 3.4, 3.13 |
| Failure behavior | 3.14 |
| UI changes | 3.15 |
| Unit, integration, browser and visual acceptance | 5, 6 |
| Governance and dependency impact | 3.17–3.19, 10 |
| Recording BUILD-003C delivery in the living documents | 3.19 |
| Deterministic fix for the intermittent simulate-expired screenshot | 3.16 |
| Live-read budget and credential boundary | 3.3, D-5 |
| Every decision requiring approval | 13 |
| Amendment 1, gate 1: offline anvil compatibility before any credentialed request | 3.2.6, 3.20 |
| Amendment 1, gate 2: manual injected-wallet acceptance; separate wallet labels | 3.9.1, 9 |
| Amendment 1, gate 3: conditional P1–P14 certification; no-paid-billing verification | 1.5, 3.3.2 |
| Amendment 2: G7 required for certification; `LIMITED` keeps BUILD-003 `IN_PROGRESS`; PR delivery unaffected | 1.5, 3.9.1, 3.20 |

## 1. Single objective

On a controlled local fork of Base mainnet, served as EIP-155 chain 31337 and labeled `FORK_REPRODUCED`, a user can take each authored USDC↔WETH swap end to end:

- read a fresh, on-fork-verified quote;
- simulate the exact approve-and-swap transactions;
- review a Manifest, enforcement matrix and payloads whose decoded view is re-derived in the browser from the exact bytes;
- authorize each payload in an EIP-1193 wallet, which also submits it after the attempt has been journaled;
- recover from injected failures and a server restart;
- export an Evidence Bundle that is `RECONCILED` only when every reconciliation invariant holds.

This is **measured by** passing browser E2E tests for both directions and for every injected failure in §5. The same build also:

- records the BUILD-003C delivery in the living documents;
- makes the simulate-expired screenshot deterministic.

### 1.1 User-visible result

1. **Fork environment region on Simulate.** It appears below the unchanged mocked chain and the unchanged Base read-only observation. It shows:
   - the fork source: Base `eip155:8453`, block number and hash, the recorded state-source transcript digest;
   - the local chain ID 31337;
   - the label `FORK_REPRODUCED · NOT MAINNET · NOT CURRENT MARKET`.
2. **Connect wallet (fork chain only).** The app requests accounts from the page's EIP-1193 provider and accepts only chain 31337. Gryloo never holds a key.
3. **Read fork quote.** For each swap, the four fee tiers are read on the fork in fixed order, with the same full-input proof as BUILD-003C, plus the owner's balances and router allowance. The user **selects** one `QUOTED` tier. Nothing is ranked, recommended or called "best".
4. **Simulate exact path.** The exact approve and swap transactions are simulated on the fork. This yields gas, expected output, the slippage-derived minimum output, balance and allowance deltas, and failure paths. A mismatch between simulated and quoted output blocks.
5. **Open Manifest review.** This is now the enabled primary action after simulation. It shows:
   - both payloads, decoded from their bytes: wallet, chain, nonce, target, function, spender, recipient, amounts, minimum output, deadline, value, gas limit and fee caps, and fees;
   - the per-limit enforcement matrix;
   - every hash;
   - the disclosures.

   Warnings require explicit acknowledgement.
6. **Accept Manifest.** Acceptance assigns an Execution ID and starts the journal. Each payload is then signed and submitted from the wallet after its attempt is persisted. The Execute tab shows:
   - workflow, segment, step and attempt states;
   - the `executionAttemptId`;
   - transaction hashes;
   - pending versus confirmed;
   - fund location;
   - residual authority;
   - reconciliation;
   - the Evidence Bundle.
7. **Recovery.**
   - "Reconcile now" is always available.
   - "Retry step" is available only after reconciliation proves `NOT_FOUND`.
   - "Revoke residual allowance" is a separate Mode A revocation execution, available when an allowance remains.
   - The warning "Stopping does not revert confirmed steps" is shown.
8. **Unchanged outside fork mode:**
   - authorization `NONE`, enforcement `NOT_ENFORCED`, workflow `DRAFT`;
   - the mocked chain and the BUILD-003C observation, which never feed Mode A;
   - Execute, which explains that it requires the local fork environment.

   Mainnet execution is impossible in every mode (§3.2.4).

### 1.2 Exactly what "fork" means here

The fork reproduces Base mainnet state at one **finalized** block, recorded once through a bounded, hash-pinned, owner-run read session (§3.3). CI, E2E and local development then replay that recorded state offline through a local upstream that serves only recorded responses. The fork runs real Base contract bytecode (USDC, WETH, Uniswap v3 factory, pools, QuoterV2, SwapRouter02) at that state. This is `FORK_REPRODUCED` evidence (Master Prompt §2.6). It is:

- not mainnet evidence;
- not a current market quote;
- not proof of general security.

### 1.3 Assessment of the original candidate (read-only exact-path simulation on live Base)

**Conclusion:** a truthful read-only simulation of the *exact* direct swap path on live Base mainnet is **not possible without the inputs the owner forbade inventing**.

**What an exact SwapRouter02 path simulation requires:**

- **A real `from` owner.** `exactInputSingle` pulls `tokenIn` from `msg.sender`. The simulation must know whose balance and allowance are used.
- **The owner's real balance and a sufficient allowance to the router.** Without them the exact call reverts. Supplying them through `eth_call` state overrides invents a balance or allowance. A sequential approve-then-swap simulation (`eth_simulateV1`) avoids inventing an allowance, but still needs a real owner with a real balance.
- **A recipient.** It is part of the calldata. The only non-invented default is the owner, so it again needs a real owner address.
- **A router choice.** It has to be approved, allowlisted and pinned. No router has been approved (BUILD-003C §13.2 A-2).
- **A gas estimate.** It is only meaningful for the exact `from`, nonce and state.

**What a narrower read-only prerequisite would unlock:** address-only wallet connection, owner balance and allowance reads, an approved router pin, and a new live-read budget. That would unlock one read-only preview against mainnet state. It would:

- reveal the user's address and intent to the provider;
- still produce no authorization, submission, journal, reconciliation or evidence;
- leave Build 003 incomplete.

**Why the fork path is better.** Under the owner's correction, the controlled fork makes the owner, balances and allowance **real state on the fork**:

- dev-account ETH is set by anvil locally, the only state override, which is disclosed;
- WETH comes from `deposit()`;
- USDC comes from a labeled setup swap.

It also allows the exact payloads to be signed, submitted, recovered and reconciled with no mainnet exposure. It therefore delivers the original candidate's value and the remaining Build 003 gates in the same increment.

### 1.4 Increment structure: one build; BUILD-003E only for public-environment evidence

- **One build.** No technical dependency forces a split inside the fork slice:
  - The contract amendment (D-6), the toolchain (D-3, D-12) and the recording budget (D-5) are all decided by approving this plan.
  - Their sequencing is handled by internal stop gates (§3.20).
  - Splitting into "review-only" and "execution" builds would add a governance cycle.
  - It would also need a **second live recording**: the fork state touched by signing, execution, recovery and adversarial cases would not be in a review-only recording. The owner asked to minimize live reads.
- **No automatic BUILD-003E (owner direction, 2026-09-24).** The only real dependency that could justify BUILD-003E is that public-environment execution must follow fork certification (P11 before P12). BUILD-003E would be planned only if the owner later explicitly requests `TESTNET_EXECUTED` evidence. It would:
  - use Base Sepolia (84532), with SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` per the page in §2.2;
  - need an owner-controlled funded test wallet, faucet assets, a public RPC budget and a new registry entry for 84532;
  - produce evidence whose liquidity is not representative of mainnet.

  This plan neither proposes nor schedules it.

### 1.5 What completes BUILD-003 and makes BUILD-004 planning eligible (conditional acceptance criteria; Amendment 1)

The table below lists **conditional acceptance criteria, not results**. Nothing in it is achieved by approving this plan.

The BUILD-003D report may mark a row `PASS` only when the named evidence was actually produced and is cited: test names, run IDs and digests. Otherwise the row is:

- `FAIL`, `BLOCKED` or `NOT_RUN`, with the reason; or
- `LIMITED`, for the P9, P11 and Gate 3 rows only, when G7 did not pass (§3.9.1). `LIMITED` records a result; it never satisfies the row.

The approved environment is `FORK_REPRODUCED` (D-2).

| Gate | Criterion that must actually pass | Evidence required | Status now |
|---|---|---|---|
| P1 Schema | v1 schemas, fixtures and vectors byte-identical; `enforcement-matrix` schema, projection and vectors validated | `schemas:check`, contract tests, governance frozen-tree check | `NOT_STARTED` |
| P2 Chat, P3 Canvas, P4 Round trip, P5 Lint | BUILD-003A results still hold in the BUILD-003D tree | Existing unit and E2E suites passing, with only the §3.15 assertion changes | Historical pass; regression `NOT_STARTED` |
| P6 Quote/Data | Fork quote checks, provenance and freshness pass for both directions on the replayed fork | Fork-quote unit and integration tests; E2E | `NOT_STARTED` |
| P7 Simulation | Exact-path simulation equals the quote; failure paths include the residual allowance; gas stable after rebuild | Simulation unit and integration tests; G1 check C7 | `NOT_STARTED` |
| P8 Policy and Manifest | Canonical, deterministic policy, Manifest, plan, payloads and matrix; material-change and invalidation tables hold | Compile tests; frozen-contract validation | `NOT_STARTED` |
| P9 Preview | The browser re-derives every displayed field and hash from the exact bytes; tampering blocks before the wallet | E2E decode comparison; unit tamper tests; **G7 `PASS`** for a real wallet UI | `NOT_STARTED` |
| P10 Mock | BUILD-003B mocked chain still passes | Existing suites | Historical pass; regression `NOT_STARTED` |
| P11 Fork | Both directions signed, submitted and `RECONCILED` on the replayed fork; reproducibility byte-identical | E2E; G5 reproducibility record; **G7 `PASS`** | `NOT_STARTED` |
| P12 Public environment | Not performed | Owner direction of 2026-09-24: not required for the approved environment; recorded as `NOT_PERFORMED` | `NOT_PERFORMED` |
| P13 Recovery and reconciliation | Unknown result plus server restart without a duplicate transaction; pending; `NOT_FOUND` retry; revert with residual allowance; revocation confirmed; `DIVERGENT` and `INCONCLUSIVE` on injected cases | Recovery and adversarial E2E; integration tests | `NOT_STARTED` |
| P14 Evidence | Evidence Bundles validate with the frozen contracts and link every hash; supersession works | Evidence tests; E2E JSON checks | `NOT_STARTED` |
| Master Spec Gate 3 | Reviewed payload equals the signed payload, with signer and hash verified from chain data, for the automated test wallet **and** one manually operated injected wallet, both with `RECONCILED` evidence | P9, P11, the reconciler fidelity checks and a **G7 `PASS`** record | `NOT_STARTED` |

**Completion rule.** BUILD-003 may be marked complete, and eligible for BUILD-004 **planning** (not implementation), only when **all** of these hold:

1. Every row above is `PASS`, with the cited evidence. The rows are marked in the BUILD-003D report or, for a later G7 run only, in the records change described below. The only exception is P12 (`NOT_PERFORMED` as stated). A `LIMITED` row does not satisfy this rule.
2. Every §5 acceptance criterion is checked, and gates G0–G8 (§3.20) passed, **including G7 `PASS`**.
3. Pull-request CI and the post-merge push checks on `main` passed.
4. The owner accepts the report and records an explicit **certification decision**. It states the certified environment (`FORK_REPRODUCED`) and the wallet surfaces that passed Gate 3: the automated test wallet and the named, manually operated injected wallet.

**If G7 is `LIMITED` at delivery (Amendment 2).**

- The BUILD-003D PR may be delivered with that limitation if every other gate passes (§3.20). The limitation is stated in the report, `STATUS.md` and the PR description.
- BUILD-003 stays `IN_PROGRESS`, with certification `PENDING_OWNER_DECISION`.
- `LIMITED` never satisfies Master Spec Gate 3 for completion.
- BUILD-003 can advance only through a later G7 run that passes. That run is owner-run on the merged code, in replay mode with no live request, and is recorded in the same records change that registers the certification decision.
- If passing G7 requires a code or scope change, that change needs its own approved plan or amendment.

**Recording the decision.** The certification decision is registered with the next sequential decision number in the first records change after acceptance. Until then:

- every living record says BUILD-003 is `IN_PROGRESS`, with certification `PENDING_OWNER_DECISION`;
- no record, UI text or report claims BUILD-003 is complete or certified (governance-checked, §3.19).

**If a criterion fails:**

- BUILD-003 stays incomplete;
- the report proposes the smallest corrective step;
- no BUILD-004 planning starts.

**BUILD-004.** It begins with the human-approved ADR-0001 mechanism selection (Master Prompt Build 004). It would reuse the BUILD-003D journal, reconciler, evidence and fork harness. Mainnet stays disabled until Gate 10 in every case.

## 2. Relationship to v3.2

- **Master Spec:**
  - §7.1–§7.9 (artifact separation, Quote/State, simulation, journal and evidence, hashes);
  - §8 (Manifest, enforcement matrix, Mode A binding, pause, revocation, refund);
  - §10 (chained simulation and scenarios 1, 2, 4, 6 and 9);
  - §11.1–§11.4 (sequential same-chain execution, disclosed additional signature);
  - §12 (hierarchical state, failure policies, recovery);
  - §13 (components, trust boundaries, adapter interface);
  - §16.1 and §16.4 (Mode A and authorization rules);
  - §17 (threats and controls);
  - §21 Phase 2;
  - §22;
  - Gates 2, 3 and 6.
- **Master Prompt:**
  - §1.6 forbidden claims;
  - §2.1–§2.6;
  - §3.2 EVM swap routing and bounded-authority policy;
  - §4.1 P6–P14;
  - Build 003;
  - §5;
  - §6.3–§6.4;
  - §8.3, §8.5–§8.7;
  - §9.3–§9.7;
  - §11 quality and merge gates (canonical artifacts, executor, adapters, Uniswap evidence).
- **Governance:**
  - ADR-0002 compatibility rules (additive kind, v1 bytes frozen);
  - ADR-0001 stays `PROPOSED`;
  - DEC-0015 (Mode A may proceed while ADR-0001 is `PROPOSED`);
  - DEC-0020–DEC-0022 (BUILD-003C observations are never authorization inputs; no further Alchemy request under those decisions);
  - the BUILD-003C plan §13.2 later decisions: L-5 fork environment needs an ADR, which here is ADR-0004; A-2 router approval, which here is D-7.
- **Preserved differentiators:**
  - one IR, whose swap node is unchanged;
  - separated artifacts;
  - a Manifest with an honest enforcement matrix;
  - explicit Mode A semantics;
  - simulation before execution;
  - workflow, segment, step and attempt states;
  - independent reconciliation and evidence;
  - the user controls the wallet;
  - no custody;
  - the DApp as the canonical monitoring and recovery surface.
- **Dependencies:**
  - BUILD-001 through BUILD-003C are merged (§2.3).
  - The BUILD-003C live observation stays read-only and is never an input.
  - The BUILD-003B mocked chain stays mocked and is never an input.

### 2.1 Proposed requirement IDs (registered only at implementation)

| Proposed ID | Requirement and source |
|---|---|
| B003D-FORK-001 | Controlled fork, exactly specified by: the pinned anvil; recorded finalized, hash-pinned Base state; offline replay; local chain 31337; the mainnet refusal guard. Master Spec §21 Phase 2; Master Prompt P11 |
| B003D-RECORDING-001 | One bounded, owner-run, credential-isolated state recording with persistent caps and stop rules; the transcript is committed without credentials. It is preceded by the offline compatibility gate and by the owner's recorded no-paid-billing confirmation. Master Prompt §10.4 |
| B003D-QUOTE-001 | A fresh fork quote, with on-fork code, metadata and deployment checks, recorded as Quote/State artifacts that are authorization inputs only on the fork. Master Spec §7.5 |
| B003D-SIMULATION-001 | Exact-path Simulation Bundle, consistent with the quote; failure paths and residual effects. Master Spec §7.6, §10 |
| B003D-AUTHORIZATION-001 | Canonical policy, Manifest and Execution Plan with payload hashes; material changes alter the correct hashes. Master Prompt §2.2, P8 |
| B003D-MATRIX-001 | Additive enforcement-matrix artifact and EVM payload profile; v1 bytes and fixtures unchanged. Master Spec §8.4; ADR-0002 |
| B003D-PREVIEW-001 | Decoded preview re-derived in the browser from the exact bytes sent to the wallet. Master Prompt P9, §8.3 |
| B003D-WALLET-001 | EIP-1193 authorization with chain and account guards; Gryloo holds no key and never broadcasts. Master Spec §16.4; Master Prompt §8.5 |
| B003D-WALLET-002 | Owner-run manual acceptance with a real injected EIP-1193 wallet and a recorded dev account on chain 31337 only. Automated and manual wallet evidence are labelled separately. Any other outcome is recorded as `LIMITED`: the claim is limited, the PR may be delivered and BUILD-003 stays `IN_PROGRESS`. A G7 `PASS` is required for certification. Master Prompt §8.5; Master Spec Gate 3 |
| B003D-TOOLCHAIN-001 | Offline compatibility gate for the exact pinned anvil binary, before any credentialed request; no silent substitution. Master Prompt §10.2, §10.4 |
| B003D-CERTIFICATION-001 | P1–P14 are conditional criteria. No completion or certification claim before cited passing evidence and the owner's certification decision. Master Prompt §5.5, §14 |
| B003D-JOURNAL-001 | Attempt persisted and fsynced before the wallet request; append-only, hash-chained v1 journal; idempotent attempts. Master Prompt §2.3, §6.4 |
| B003D-RECOVERY-001 | Unknown result, server restart, pending, revert and residual-allowance revocation; reconciliation precedes any retry. Master Spec §12.3 |
| B003D-RECONCILIATION-001 | Independent invariants on receipt, signed payload, signer, balances, allowance, fees and recipient. Master Prompt §2.6, §11 Uniswap evidence |
| B003D-EVIDENCE-001 | Evidence Bundle linking every hash; `FORK_REPRODUCED`; outcome labels honest. Master Spec §7.7 |
| B003D-ADVERSARIAL-001 | Build 003 injections and applicable §8.7 cases, with results recorded. Master Prompt Build 003, §8.7 |
| B003D-VISUAL-001 | Reviewed visual changes, then zero-pixel regression. Master Prompt §9.7 |
| B003D-DETERMINISM-001 | Measurement-independent Simulate canvas viewport and screenshot-diff forensics. Master Prompt §9.7 |
| B003D-SUPPLY-001 | Exact new npm pins and a pinned anvil binary, verified in CI. Master Prompt §8.6 |
| B003D-COMPATIBILITY-001 | v1 schemas, fixtures and hash vectors are byte-identical; additions are versioned. ADR-0002 |
| B003D-GOVERNANCE-001 | BUILD-003C pinned historically; exact BUILD-003D scope and boundaries enforced. Master Prompt §5 |
| B003C-DELIVERY-001 | Retrospective: BUILD-003C merged through PR #9, with its pull-request CI and post-merge CI (after one rerun) passing. Master Prompt §5.5 |

### 2.2 Sources retrieved for this plan (2026-09-24)

| Source | Location | SHA-256 of retrieved bytes | Facts used |
|---|---|---|---|
| Uniswap v3 Base deployments | developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments | `101727a34cc7fb319e249d6834874eaaf133f78f7bd1c2d3fd6ea221306066d7` | Base SwapRouter02 `0x2626664c2603336E57B271c5C0b26F421741e481`. The factory and QuoterV2 match BUILD-003C. Base Sepolia SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |
| `IV3SwapRouter.sol`, Uniswap/swap-router-contracts at `70bc2e40dfca294c1cea9bf67a4036732ee54303` | contracts/interfaces/IV3SwapRouter.sol | `6923e377f3300769dcecba1cd57dbda6642c932feeb5455771ef3fbdf61fc171` | `ExactInputSingleParams(tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)`, with no deadline field |
| `V3SwapRouter.sol`, same commit | contracts/V3SwapRouter.sol | `aae643f487dde006e03d64acee391315822a245276586c5cbbf7bf3e759913a2` | `require(amountOut >= params.amountOutMinimum, 'Too little received')`. `amountIn == 0` means contract balance. Recipients `address(1)` and `address(2)` are sentinels |
| `Constants.sol`, same commit | contracts/libraries/Constants.sol | `ad6c525483d98318531f48d1652efdcc6d57e8fc466f584f3d61c02b592a5ba1` | `CONTRACT_BALANCE = 0`, `MSG_SENDER = address(1)`, `ADDRESS_THIS = address(2)` |
| `MulticallExtended.sol`, same commit | contracts/base/MulticallExtended.sol | `0524197bbf4a7ae21f06241b9382c1a30835e102bd7024cf2732406aaa505f15` | `multicall(uint256 deadline, bytes[] data)` with `checkDeadline(deadline)` |
| Foundry release `v1.8.3` | GitHub releases API, foundry-rs/foundry | Asset `foundry_v1.8.3_linux_amd64.tar.gz`: 113,058,051 bytes; GitHub-reported digest `sha256:7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568` | Latest stable, published 2026-09-15T12:49:47Z. Publisher `.sha256` and sigstore attestation assets exist |
| anvil RPC surface at tag `v1.8.3` | crates/anvil/core/src/eth/mod.rs | `cfaf78ce79098cc180448c470d82790d22a20ac10292cfc2beefc3a6144b13ba` | `eth_simulateV1`, `eth_signTransaction`, `eth_getRawTransactionByHash`, `anvil_metadata`, `anvil_setBlockTimestampInterval`, `evm_snapshot`, `evm_revert`, `txpool_content`, `anvil_setAutomine` exist |
| anvil CLI at tag `v1.8.3` | crates/anvil/src/cmd.rs | `e9c9ce69f9c137a022806f76e71733938732dad39fedfeefcf02aafe65239daa` | `--chain-id`, `--fork-chain-id`, `--fork-block-number`, `--no-storage-caching`, `--no-fork-node-info`, `--retries`, `--timeout`. Fork state is read **by block hash by default**; `--fork-state-by-number` is the opt-out, which is prohibited here |
| npm registry | `@noble/hashes`, `@noble/curves` | Metadata only | Both `2.4.0`, MIT, published 2026-08-27. Curves depends only on hashes `2.4.0` |

Selectors and topics were re-derived with the self-checked Keccak-256 embedded in `packages/reference-linter/test/base-observation.test.ts`. Implementation tests re-derive them again:

| Signature | Selector or topic |
|---|---|
| `approve(address,uint256)` | `0x095ea7b3` |
| `allowance(address,address)` | `0xdd62ed3e` |
| `balanceOf(address)` | `0x70a08231` |
| `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `0x04e45aaf` |
| `multicall(uint256,bytes[])` | `0x5ae401dc` |
| `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| `Approval(address,address,uint256)` | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |

`factory()` (`0xc45a0155`) and `WETH9()` (`0x4aa4a4fc`) are shared with BUILD-003C.

### 2.3 Verified baseline and BUILD-003C delivery (2026-09-24)

**Git state.**

- Local `main`, `origin/main` and GitHub `main` resolve to `8a5fbaed26e005e5719528c399f7ca1adb334eb6`. The working tree was clean.
- No BUILD-003D PR exists. The branch was created locally only to hold this plan.
- The agent shell still cannot push over SSH (unchanged).

**PR #9 merge.**

- The owner account merged it at 2026-09-24T15:31:30Z.
- The merge commit's parents are `0faec71207628dfe27fb23c81680d2c27827f5ea` and `d9cba3aaaaffbaa31e29eeaa3d61d375ec8956f4`.
- The merge tree equals the head tree: `58a76b582221a75128f8cbece2f5acc6a62e4184`.

**Branch push checks on `d9cba3a`.** Governance 36020071744 and contracts/app 36020071537 passed.

**Pull-request checks.** Governance 36020349600 and contracts/app 36020349556 passed.

**Post-merge push checks on `8a5fbae`.**

- Governance 36020831537 passed on attempt 1 (job 107704983440).
- Contracts/app run 36020831381:
  - **Attempt 1 failed.** Job 107704982646, step "Bootstrap exact approved headless shell and run guarded browser suite". 27 of 28 tests passed. `mock-artifact-chain.spec.ts:155` failed at `toHaveScreenshot('simulate-expired.png')` with "5365 pixels (ratio 0.01 of all image pixels) are different", after Playwright had "captured a stable screenshot". The expiry text and mocked-value assertions before it had passed.
  - **Attempt 2 passed.** Job 107706138125, 15:34:20Z–15:37:12Z.
  - No diff image was retained, because the workflow uploads no artifacts and `uses:` Actions are banned.

**Historical BUILD-003C records.** They were written before delivery and stay byte-identical:

- plan SHA-256 `fa543e75169f85121063cc4f64ec6b6f54e4187a539ae5add416779420d13109`;
- report SHA-256 `4cef5a0cb63e97d5bbebb9022980ff98b237eded820855c5c0ddab0c004a5ab9`.

The facts above go into the living records instead (§3.19).

## 3. Authorized scope

Nothing in this section is authorized until the owner approves the plan (§13).

### 3.1 Architecture and boundaries

| Component (Master Prompt §6.3) | Location | Trust role |
|---|---|---|
| Quote and State Artifact Layer (fork quote) | `packages/reference-compiler/src/fork-quote.ts` | Pure; injected transport; untrusted responses validated |
| Simulation Orchestrator | `packages/reference-compiler/src/simulation.ts` | Pure; injected transport |
| Policy Compiler, Manifest Service, Execution Planner | `policy.ts`, `manifest.ts`, `execution-plan.ts`, `enforcement.ts`, `payload.ts`, `abi.ts`, `rlp.ts` in `reference-compiler` | Deterministic; no I/O |
| Review Engine (Mode A) | `packages/reference-compiler/src/review.ts` | Deterministic blocking, warning and information findings |
| Execution Orchestrator and Journal | `packages/reference-executor/src/*` | State machine and append-only journal. The only file I/O is in `file-store.ts` (Node) |
| Independent Reconciler and Evidence | `packages/reference-reconciler/src/*` | Pure; never imports the executor; verifies from chain data |
| Authority Adapter (Mode A wallet) | `apps/reference-dapp/src/wallet/eip1193.ts` | The only place `window.ethereum` and `eth_sendTransaction` may appear |
| Server integration | `apps/reference-dapp/src/server/fork-rpc.ts`, `mode-a-service.ts`, `src/app/mode-a-action.ts` | Loopback-only fork transport; Server Actions; no key; never broadcasts |
| Execution Explorer (minimal) | `components/execution-panel.tsx` | Canonical state loaded from the journal |

The three new packages are private, AGPL-3.0-only, version `0.1.0`, and use the reserved boundaries `packages/reference-compiler/**`, `packages/reference-executor/**` and `packages/reference-reconciler/**` (D-11).

**Import rules** (enforced by governance):

- The reconciler must not import the executor.
- Neither may import the BUILD-003C observation or the BUILD-003B mocked modules, and those may not import them.
- Browser code imports only `reference-compiler`'s browser-safe modules: `abi`, `rlp`, `payload`, `payload-digest` and `profile`.

### 3.2 Controlled fork environment (D-3, D-4, D-10; ADR-0004)

#### 3.2.1 Binary and command

- **Binary.** Foundry `anvil` from release `v1.8.3`. The `scripts/bootstrap-anvil.py` script follows the bootstrap-playwright pattern:
  - exact URL `https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.tar.gz`;
  - a redirect allowlist limited to GitHub release-asset hosts;
  - proxies ignored;
  - a streamed size cap of 113,058,051 bytes;
  - SHA-256 verified before the archive is opened;
  - tar entries validated (no traversal, links or special files);
  - extraction of `anvil` only;
  - an exact `anvil --version` string, recorded at implementation;
  - an atomic move to a destination whose basename is `foundry-v1.8.3`.

  The pin is accepted only if the publisher digest, the `.sha256` asset and a local observation agree, and the owner approves. The classification is `PUBLISHER_DIGEST_MATCHED_LOCALLY_OBSERVED_HUMAN_APPROVED`. CI uses runner Python only, with no `uses:` Action.
- **Command.** Built only by `e2e/fork/harness.mjs`:
  `anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --fork-url http://127.0.0.1:8546 --fork-block-number N --fork-chain-id 8453 --no-storage-caching --no-fork-node-info --retries 0 --timeout 20000 --accounts 10 --balance 100`
  - Port 8546 is the offline replay upstream (§3.3.5).
  - The recording mode differs only in `--timeout 600000` and points at the recording proxy.
  - Fork state is read by block hash, anvil's default. `--fork-state-by-number` is prohibited.

#### 3.2.2 Chain identity (D-4 = A recommended)

- **Local chain ID.** The fork serves EIP-155 chain ID **31337** (`0x7a69`), so a signature produced on the fork is not valid on Base mainnet (8453).
- **Wallet identity.** A wallet cannot confuse the fork with Base.
- **Artifact identity.**
  - Execution-layer artifacts use `eip155:31337`: fork quotes, simulation, policy, Manifest, plan, matrix and evidence.
  - The Semantic Workflow IR keeps its authored intent, `eip155:8453`. It is not changed.
  - The enforcement matrix `environment` binds `sourceChainId: eip155:8453`, `sourceBlock {N, H}` and the recorded state-source digest.
  - Registry assets are mapped from `eip155:8453` to the fork only after on-fork code-pin, metadata and deployment-link checks.
- **Contract behavior.**
  - Approve and swap do not depend on `block.chainid`.
  - Permit, Permit2 and typed-data signing are not used.
- **Rejected alternative.** Serving the fork as 8453 would make fork signatures replayable on Base and confuse wallets.

#### 3.2.3 Accounts and funding (D-10)

- **Accounts.** Anvil's built-in default dev accounts. No key, mnemonic or seed is written by Gryloo or committed.
- **Owner and setup accounts.** The recording harness selects the owner as the lowest dev index whose code at block N is empty and whose state is recorded. The setup account is the next such index. Both indices are pinned in `profile.ts`. If fewer than two clean indices exist, the recording stops for an owner decision.
- **Funding**, done by `e2e/fork/fork-setup.mjs` before any reviewed workflow:
  - Dev-account ETH comes from anvil's local `--balance`. This is the **only** state override, and every evidence limitation list discloses it.
  - WETH comes from `WETH9.deposit()` sent by the setup account and `transfer` to the owner.
  - USDC comes from a labeled **setup swap** by the setup account through the same SwapRouter02, then `transfer` to the owner.
  - Setup transactions are fixture preparation, not part of any Manifest. They are listed with their transaction hashes in the fork descriptor.
  - The harness then mines 20 empty local blocks, a count pinned in `profile.ts`, so recent-block and fee-history queries from a manual wallet stay on local blocks (§3.9.1).
- **Recorded accounts only.** Manual use with a real browser wallet is possible only by importing a recorded dev account on chain 31337. Arbitrary addresses would need unrecorded state and fail closed (`FORK_STATE_UNRECORDED`). The owner-run manual acceptance (§3.9.1) uses exactly this path.

#### 3.2.4 Mainnet refusal and fork-mode activation

- **Activation.** Fork mode activates only when the server sees `GRYLOO_EXECUTION_ENVIRONMENT=fork` **and** all of these hold:
  - the fixed loopback URL literal `http://127.0.0.1:8545` answers `eth_chainId` = `0x7a69`;
  - `anvil_metadata` reports a forked network with chain ID 8453, fork block number N and fork block hash H, all equal to the pins in `profile.ts`.

  Otherwise it returns `FORK_MODE_OFF` or a specific code. Any other value of the variable returns `CONFIGURATION_INVALID`.
- **Refusal of other chains.** The compiler, wallet bridge and reconciler hard-refuse any chain ID other than 31337 (`MAINNET_CHAIN_REFUSED` for 8453). This does not depend on configuration.
- **No mainnet path.** No mainnet RPC URL exists in any execution path.
- **Broadcasting.** The server never broadcasts: `eth_sendRawTransaction` and `eth_sendTransaction` are forbidden in all server and package source.
- **Anvil cheat methods** (`anvil_*` other than `anvil_metadata`, `evm_*`, `hardhat_*`) are forbidden in app and package source. They exist only in `e2e/fork/*`.

#### 3.2.5 Deterministic time and state

- **Block timestamps.** The harness calls `anvil_setBlockTimestampInterval(2)`. Every new fork block's timestamp is the previous one plus 2 seconds, independent of wall clock.
- **Clean state per test.** The harness takes an `evm_snapshot` after setup. Each E2E test starts from `evm_revert` plus a new snapshot, with the runtime journal directory wiped.
- **Reproducible hashes.** Nonces, payloads, anvil's deterministic ECDSA signatures and transaction hashes are identical across runs, so E2E snapshots and evidence hashes are reproducible.

#### 3.2.6 Offline anvil compatibility gate (G1; Amendment 1)

**When.** Immediately after `scripts/bootstrap-anvil.py` has verified the pinned v1.8.3 binary, before code that depends on anvil behavior is written, and **before any credentialed request**. The gate is also a permanent CI step.

**How.** `packages/reference-compiler/test/anvil-compatibility.fork.test.ts`, run by `pnpm test:anvil`:

- makes no network access and uses no credential;
- starts an in-test synthetic proxy and provider on 127.0.0.1 that serve a generated source chain (chain ID 8453, one synthetic block N with hash H, empty accounts) and log both Anvil-side and provider-bound requests;
- starts anvil with the exact §3.2.1 flags pointed at that upstream.

The synthetic state is test-only. It is never a fixture, an evidence input or a substitute for the recording.

| # | Check | Required result |
|---|---|---|
| C1 | Binary identity | The archive and extracted `anvil` SHA-256 equal the approved pins; `anvil --version` equals the recorded string |
| C2 | Fork start and local identity | anvil starts with the exact flags; `eth_chainId` is `0x7a69`; no `anvil_nodeInfo` or `anvil_metadata` request reaches the upstream |
| C3 | Fork metadata | `anvil_metadata` reports the forked network's chain ID 8453, block number N and block hash H, under the exact field names the activation guard (§3.2.4) reads |
| C4 | Upstream method set and proxy boundary | Every provider-bound request uses only a method in the unchanged D-5 allowlist. Every provider-bound state read carries exactly `{ "blockHash": H, "requireCanonical": true }`, never a bare hash, number or tag. The observed extra Anvil requests receive only the Amendment 3 local replies, including verified pinned data or fail-closed behavior for H. Wrong hashes, forms, methods and batches stop without provider forwarding |
| C5 | No retry; misses surface | With `--retries 0`, an injected upstream error is requested exactly once and reaches the client as a JSON-RPC error. An unanswerable request does the same (the `FORK_STATE_UNRECORDED` path) |
| C6 | Hash-pinned local reads | `eth_call` and `eth_getCode` with `{ "blockHash": <latest local>, "requireCanonical": true }` succeed; an unknown hash fails |
| C7 | `eth_simulateV1`, `validation: true` | Two dependent calls in one simulated block succeed, returning per-call `status`, `gasUsed`, `logs` and `returnData` (a hand-assembled log-emitting contract deployed locally). Separately, a wrong nonce, an insufficient balance and a fee cap below the base fee are each rejected. Block number, balances and nonces are unchanged afterwards |
| C8 | Signing and raw retrieval | `eth_signTransaction` for a dev account returns an EIP-1559 raw transaction. `eth_sendRawTransaction` returns its hash. `eth_getRawTransactionByHash` returns byte-identical bytes, and `keccak256(raw)` (`@noble/hashes`) equals the hash. `eth_getTransactionByHash` and `eth_getTransactionReceipt` expose `status`, `gasUsed`, `effectiveGasPrice` and `logs`; whether an L1-fee field is present is recorded |
| C9 | Wrong-chain refusal | A raw transaction signed for chain ID 8453 is rejected by the fork |
| C10 | Determinism and pending controls | `anvil_setBlockTimestampInterval(2)` gives consecutive block timestamps 2 seconds apart. `evm_snapshot` and `evm_revert` restore block number, balances and nonces. With `anvil_setAutomine(false)`, a submitted transaction appears in `txpool_content`, and `evm_mine` includes it |

**Output.** A credential-free JSON result: anvil version and digest, each check, and the upstream request inventory (method and block-parameter form). Its SHA-256 goes in the report.

**Stop rule.** Any failure stops the build. No method, flag or behavior is substituted silently: no `--fork-state-by-number`, no snapshot-and-impersonation simulation, and no wider upstream allowlist without an approved decision. The failed check decides which decision the owner must make:

| Failed check | Returns for |
|---|---|
| C7 | A new D-14 decision |
| C4 (a required upstream method outside the allowlist) | A D-5 amendment |
| Any other check | A D-3 decision |

### 3.3 Fork state source, recording session and budget (D-5; ADR-0004)

#### 3.3.1 Why a live read is needed

- A fork of real Base state is impossible without reading Base.
- The BUILD-003C Alchemy authority is exhausted (3/3 attempts, 43/63 requests), and no further request is authorized under DEC-0020–DEC-0022.
- The historical BUILD-003C replay cannot supply fork state: it is not an input.

This build therefore proposes **one new, separately counted session**.

#### 3.3.2 Proposed budget and credential boundary

- **Provider and credential.**
  - Provider: the existing Alchemy Free app, Base Mainnet only, at the fixed destination `https://base-mainnet.g.alchemy.com/v2`.
  - The key stays only in the owner-controlled WSL process environment of an **uncommitted scratchpad recording proxy**, sent only as `Authorization: Bearer`.
  - The key never goes into anvil's arguments, a URL, file, transcript, log, browser, commit or chat.
  - No payment method, paid plan or charge. If the account requires one, stop.
- **Caps and pacing.**
  - Persistent caps, counted before each request is sent: **3 attempts and 1,800 requests** in total, and at most **900 requests per attempt**. Counters are never reset, and these caps are separate from all earlier sessions.
  - One request in flight, at least 400 ms apart start to start.
  - Anvil `--retries 0`; no automatic retry.
- **Allowed provider-bound upstream methods (unchanged by Amendment 3):**
  - `eth_chainId`;
  - `eth_getBlockByNumber`: only `"finalized"` once at the start, then only N;
  - `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode` and `eth_getStorageAt`: only with block parameter `{ "blockHash": H, "requireCanonical": true }`. The proxy adds `requireCanonical: true` to anvil's hash form and records both.
  - Anything else stops the session: another method, block form or block, or a batch.
- **Amendment 3 local proxy replies.** Only the five observed extra method names and exact forms at the top of this plan are handled locally; none reaches the provider. They are recorded as local exchanges, not counted as provider requests. All other requests stop. The proxy proves the H-to-canonical-object rewrite before forwarding any approved state read.
- **Stop rules.** The session stops on the first of:
  - HTTP 429 or any other non-200 status;
  - a JSON-RPC error, including an unsupported block-hash form;
  - an inconsistency: the block-N hash differs from H, or H is not finalized at the start;
  - a response larger than 1,048,576 bytes;
  - a timeout or no-response failure;
  - a cap breach;
  - an interrupted journal.

  There is **no fallback** to number-pinned reads, another URL or another provider.
- **Estimated cost.** At most 1,800 requests at 26 or fewer listed CUs each is at most 46,800 listed CUs, conditional on Alchemy's current method table. This is well inside the published Free allowance.
- **Upstream method set confirmed offline.** The allowlist above is final only after G1 check C4 (§3.2.6) confirms that the pinned anvil uses no other upstream method. If it does, the build stops and returns for a D-5 amendment. The allowlist is never widened silently.
- **No paid billing (Amendment 1).** Before the preflight produces the owner's command, the owner checks the Alchemy dashboard and reports in chat, without sharing any credential, that:
  - the account plan is Free;
  - no payment method is on file;
  - no paid add-on, pay-as-you-go, overage or automatic upgrade is enabled;
  - the existing app has Base Mainnet only;
  - this month's used compute units plus the session maximum (46,800 listed CUs) stay inside the Free monthly allowance.

  The agent records these owner-reported values and their date in the preflight journal (`billingConfirmation`) and in the report. The preflight refuses to emit the command without them. The agent cannot verify billing independently: it holds no credential and makes no provider request. Any sign of paid billing, a required payment method or a charge stops the session before any request. During the session, HTTP 402 stops it like any other non-200 response.

#### 3.3.3 Session procedure

1. **Offline preparation (G4).** Three conditions must all hold first: G1 has passed; the owner's billing confirmation is recorded; and a preflight with the key unset and a scripted upstream has proved the caps, stop rules and journal refusal behavior with zero live requests (as in BUILD-003C Amendment 3).
2. **One command, run by the owner.** The agent makes no live request.
3. **The command:**
   - reads `finalized` → N, H;
   - starts anvil against the proxy;
   - runs the complete, deterministic scenario driver: setup, both directions, fork quotes, simulations, executions, recovery paths, adversarial cases and the revocation execution;
   - shuts down;
   - writes the credential-free transcript and request log.
4. **Later attempts.** Attempts 2 and 3 exist only to re-record the **whole** scenario set when implementation later touches unrecorded state or a stop occurs, after an owner acknowledgement per attempt. Exceeding the caps needs a new decision.

#### 3.3.4 Transcript

`apps/reference-dapp/e2e/fork/base-fork-transcript.json`:

- format `gryloo.base-fork-state-transcript.v1`, RFC 8785 canonical;
- source chain 8453, N, H and the finalized-at-start proof;
- anvil version;
- for each exchange: the canonical anvil-side request, either the rewritten provider-bound request and exact upstream response bytes or an explicit Amendment 3 local-response classification and bytes;
- the request log digest;
- no timing, credential or header values.

Its SHA-256 and raw-response digest are recorded in the report and pinned by governance.

#### 3.3.5 Offline replay upstream

`e2e/fork/replay-upstream.mjs` listens on 127.0.0.1:8546. It answers **only** requests whose canonical form (method and params, ignoring `id`) is in the transcript, returning the recorded response bytes or the exact recorded Amendment 3 local reply. Everything else returns a JSON-RPC error that anvil surfaces, and the product maps it to `FORK_STATE_UNRECORDED`. It never contacts the network.

#### 3.3.6 Reproducibility gate (G5)

Immediately after recording, the same scenario driver runs fully offline against the replay upstream. Every artifact hash, payload hash, transaction hash, receipt and balance must be **byte-identical** to the recorded run. Any difference stops the build.

### 3.4 Fresh verified fork quote (P6)

**Read plan.** A fixed order on the fork via `fork-rpc.ts`:

1. `eth_chainId` = `0x7a69`, and `anvil_metadata` = the profile pins.
2. `eth_getBlockByNumber("latest", false)` → B, hash `Hb` and time `Tb`.
3. At `{blockHash: Hb, requireCanonical: true}`:
   - `eth_getCode` for USDC, WETH, the factory, QuoterV2 and SwapRouter02.
     - The SHA-256 of each code must equal its pin. The four BUILD-003C pins must hold unchanged.
     - The SwapRouter02 pin is trust on first use from the reviewed recording.
   - `decimals()` and `symbol()` for both assets.
   - QuoterV2 `factory()` and `WETH9()`, and SwapRouter02 `factory()` and `WETH9()`, all equal to the pinned factory and WETH.
   - `getPool` for the four fee tiers.
   - `quoteExactInputSingle` for each existing pool, with the BUILD-003C full-input proof rule and statuses unchanged.
   - Owner `balanceOf` for both tokens, `allowance(owner, SwapRouter02)` for `tokenIn`, `eth_getBalance(owner)` and `eth_getTransactionCount(owner)`.
   - `eth_getCode(owner)`, which must be `0x` (`OWNER_HAS_CODE` otherwise).
4. A final `eth_getBlockByNumber(B)` must return the same hash and time.

**Artifacts.** Two Quote/State artifacts per swap node, both with `chainId: eip155:31337` and `retrievedAt = Tb` in fork time (§3.13).

- **`FORK.base-quote.<node>.r<rev>.b<B>`:**
  - `sourceId` `fork.anvil-json-rpc`;
  - adapter `uniswap-v3.swap-router-02@1.0.0`;
  - `providerReference` `NONE`;
  - `proposedContracts`: tokenIn and SwapRouter02; `proposedSpenders`: SwapRouter02; `proposedRecipients`: owner;
  - `outputBounds`: one row per `QUOTED` tier, with the minimum derived from the authored slippage;
  - `normalizedValues`: fork source chain, N, H, `Hb`, state-source digest, code pins and tier facts;
  - `uncertainty`: `FORK_REPRODUCED`, `NOT_CURRENT_MARKET`, `SINGLE_PROVIDER_STATE_SOURCE`, `CODE_PINS_TRUST_ON_FIRST_USE`, `IMPLEMENTATION_NOT_PINNED`, `SOURCE_EQUIVALENCE_NOT_VERIFIED`, `PRICE_MOVES_BEFORE_INCLUSION`, `FORK_SETUP_BALANCE_OVERRIDE`.
- **`FORK.account-state.<node>.r<rev>.b<B>`:** owner balances, allowance, ETH, nonce and empty code.

**Other rules.**

- `rawResponseHash` is the raw-response digest of the fork read transcript.
- **Freshness:** `observedAt = Tb`, `expiresAt = Tb + 60`, `maximumAgeSeconds 60`.
- **Tier selection (D-8 = A):** the user selects one `QUOTED` tier. The selection is recorded in the policy and matrix, never in the IR.
- **Separation from BUILD-003C:** these artifacts use the `FORK.` prefix and their own module. They never reuse or read BUILD-003C observation code or data, whose consumer allowlist is unchanged.

### 3.5 Exact-path simulation (P7; D-14)

**The simulation call.** `eth_simulateV1` on the fork at `Hb`, with `validation: true`, simulates two calls in one block. Each call carries the exact `from`, nonce, gas limit and fee caps, `to`, `data` and `value`:

1. `approve(SwapRouter02, amountIn)` on tokenIn;
2. `multicall(deadline, [exactInputSingle(tokenIn, tokenOut, fee, owner, amountIn, minOut, 0)])` on SwapRouter02.

There are no state overrides.

**Required results.**

- Both calls succeed.
- The decoded `amountOut` from the multicall result and the owner's Transfer log equals the selected tier's quoted output exactly. Otherwise the code is `SIMULATION_QUOTE_MISMATCH`.
- tokenIn is debited by exactly `amountIn`.
- The allowance after the swap is `0`.

**Gas.** `gasLimit` for each call is `ceil(gasUsed × 5 / 4)`, with the payloads rebuilt and re-simulated once with the final gas values. Results must equal the first simulation's. Otherwise `SIMULATION_UNSTABLE`.

**Simulation Bundle** `FORK.simulation.r<rev>.b<B>`:

- **outputs:** expected = simulated `amountOut`; minimum = adverse = `minOut`;
- **failurePaths:**
  - approve fails: no effect;
  - swap fails after approve: the input is retained, and a **residual allowance of `amountIn` to SwapRouter02** remains;
- **uncertainty:** as §3.4, plus `L1_DATA_FEE_NOT_REPRODUCED`, `GAS_ESTIMATE_FORK_ONLY` and `SIMULATION_NOT_A_GUARANTEE`;
- **freshness:** the quote's.

The raw `eth_simulateV1` response digest is carried in the enforcement matrix `environment.simulationRawHash` and in the evidence.

### 3.6 Payloads, router and approval (D-7; `MODE_A_EVM_PAYLOAD_V1`)

**Router and call shape.** SwapRouter02 `multicall(uint256 deadline, bytes[] data)` wrapping exactly one `exactInputSingle`, with an **exact** ERC-20 `approve(SwapRouter02, amountIn)` beforehand. This means two Mode A payloads and two wallet authorizations, disclosed as "2 signatures".

**Rejected alternatives.**

- UniversalRouter with Permit2: broader standing authority, typed-data signing and more decoding surface.
- Unlimited or pre-existing approvals.

**Payload bytes** (documented in `docs/contracts/MODE_A_EVM_PAYLOAD_V1.md`).

- Payload bytes are the unsigned EIP-1559 signing preimage: `0x02 || RLP([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList=[]])`.
- `payloadHash` is the frozen `hashRawBytes('payload', bytes)`.
- The wallet's signing hash is `keccak256(bytes)`, so the signature covers exactly the reviewed bytes.

**Field values.**

- `chainId` 31337.
- Nonces n (approve) and n + 1 (swap), read from the fork.
- `maxPriorityFeePerGas` = 1,000,000 wei.
- `maxFeePerGas` = 2 × the next base fee + priority.
- `value` 0.
- `accessList` empty.

**Decode rejections** (blocking, in both compiler and browser):

- an unknown target, spender or function;
- extra multicall entries;
- a recipient that is not the owner, including sentinels `address(1)` and `address(2)`;
- `amountIn` 0 or different from the authored amount;
- a non-zero `sqrtPriceLimitX96`;
- a non-zero `value`;
- a non-empty access list;
- a chain other than 31337;
- an approve amount different from `amountIn` (`EXCESSIVE_APPROVAL`);
- non-canonical RLP or ABI.

### 3.7 Policy, Manifest, Execution Plan and enforcement matrix (P8; D-6; ADR-0003)

**Contract amendment (D-6 = A recommended).**

- `@defi-workflow-engine/workflow-contracts` goes to **0.2.0**. It adds one artifact kind, `enforcement-matrix` (schema v1, domain `defi-workflow-engine/enforcement-matrix`, `enforcementMatrixHash`), with closed schema, validation, canonical projection, fixtures and vectors.
- Every v1 schema, fixture, vector and hash is **byte-identical**.
- The v1 `enforcement: "NOT_ENFORCED"` literal on policy, Manifest and plan keeps its v1 meaning: *that document itself is not an enforcement mechanism*. The per-limit locations live only in the bound matrix.
- A v2 redesign of policy, Manifest, plan, journal and evidence is deferred and recorded as debt (C-9 to C-12 in §12).

**Enforcement matrix fields:**

- `enforcementMatrixId`;
- the six upstream hashes: IR, artifact set, simulation, policy, Manifest, plan;
- `authorizationMode` `MODE_A`;
- `environment`: `evidenceEnvironment`, `executionChainId`, `sourceChainId`, `sourceBlock {height, hash}`, `stateSourceHash`, `simulationRawHash`;
- `payloads[]`: `stepId`, `payloadHash`, `payloadProfile` `EVM_EIP1559_UNSIGNED_V1`, and decoded `chainId`, `from`, `nonce`, `to`, `value`, `functionId`, `gasLimit`, `maxFeePerGas`, `maxPriorityFeePerGas`, `arguments`;
- `limits[]`: `limitId`, `description`, `value`, `locations[]` from the seven Master Spec §8.4 values, `payloadBindings[] {stepId, field}`;
- `limitations[]`.

**Policy (v1) mapping:**

- `requiredAuthorizationClass` `MODE_A`.
- **Allowlists:**
  - owners, accounts and recipients: the owner;
  - chains: `eip155:31337`;
  - adapters: `uniswap-v3.swap-router-02@1.0.0`;
  - protocols: `uniswap`;
  - contracts: tokenIn and SwapRouter02;
  - functions: `0x095ea7b3` on tokenIn and `0x5ae401dc` on SwapRouter02.
- **Limits:**
  - `spendLimits`: tokenIn = `amountIn` for maximum, per-step and cumulative;
  - `maximumSlippageBps`: authored;
  - `gasBudgets`: native ETH on 31337 = Σ gasLimit × maxFeePerGas;
  - `feeBudgets`: the pool fee on tokenIn = `ceil(amountIn × fee / 1,000,000)`, disclosed as part of the price.
- `checkpointRules`: `swap-minimum-output`, before the swap node, with `minOut`.
- `providers`: `FIXED` `uniswap-v3.swap-router-02`.
- `nonce` = owner account nonce n; `deadline` = swap deadline; `revocationEpoch` 0.
- `recovery`: `ABORT`, residual recipient the owner, `maximumAttemptsPerStep` 2, `requiresHumanReview` true.
- Oracle and account-risk rules are empty.

**Manifest (v1) mapping:**

- `authorizationMode` `MODE_A`;
- `owner`; `executor` `null`;
- `expiresAt` = deadline;
- `nonce` n; `revocationEpoch` 0;
- the same limits, providers and recovery as the policy.

**Execution Plan (v1) mapping:**

- one segment `seg-fork-31337`;
- `step-approve` and `step-swap` (the swap depends on the approve), both `DIRECT_TRANSACTION` with their `payloadHash`;
- `checkpointIds` `["swap-minimum-output"]`.

**Hash DAG** (every link is recomputed by the compiler, the browser verifier and the reconciler):

```text
semanticWorkflowHash (IR, unchanged)
 ├─ fork quote + account-state artifacts ── rawResponseHash (fork read transcript)
 │    └─ artifactSetHash
 │         └─ simulationHash ── (simulationRawHash in matrix/evidence)
 │              └─ policyHash
 │                   └─ manifestHash ── Execution ID = exec-<first 24 hex of manifestHash>
 │                        └─ executionPlanHash ── payloadHash(step-approve), payloadHash(step-swap)
 │                             └─ enforcementMatrixHash (binds all above + environment + stateSourceHash)
 └─ journal entry hashes (bind executionPlanHash + manifestHash) ── journalHeadHash
      └─ evidenceBundleHash (binds IR, set, simulation, policy, Manifest, plan, journal head;
                             receipts by transaction hash; evidence[] = matrix hash, signed raw
                             transaction digests, reconciliation transcript digest, fork transcript digest)
```

**Enforcement matrix rows:**

| Limit | Location(s) | Binding |
|---|---|---|
| Chain 31337, nonce, `to`, function, arguments, `value`, gas limit and fee caps | `EXACT_SIGNED_PAYLOAD` | Payload fields |
| Approve spender = SwapRouter02; approve amount = `amountIn` (finite allowance) | `EXACT_SIGNED_PAYLOAD` | `step-approve` arguments |
| tokenIn, tokenOut, fee tier, recipient = owner, `amountIn` | `EXACT_SIGNED_PAYLOAD` | `step-swap` arguments |
| Minimum output | `EXACT_SIGNED_PAYLOAD`, checked on-chain by SwapRouter02 | `amountOutMinimum` |
| Deadline | `EXACT_SIGNED_PAYLOAD`, checked on-chain by `checkDeadline` | multicall `deadline` |
| Maximum slippage in bps | `APPLICATION_GATEWAY` (compile); its effect is bound via minimum output | Policy |
| Quote freshness, simulation success, zero pre-existing allowance, sufficient balances, step order, attempts per step, signature window | `APPLICATION_GATEWAY` | Review and executor |
| Residual allowance after failure; fund location; reconciliation | `MONITOR_ONLY` | Reconciler; revocation is a new Mode A action |
| Cumulative budget reservation; revocation epoch | `NOT_ENFORCED` | Mode A single execution; no delegated authority |

`INTENT_PROTOCOL`, `SMART_ACCOUNT_MODULE_OR_GUARD` and `PROTOCOL_VERIFIER` are not claimed.

**Invalidation.**

- The frozen v1 matrix is applied unchanged.
- The app mirror adds: `enforcement-matrix` is retired whenever `execution-plan` is.
- A semantic edit **after** acceptance retires authorization for every unsigned step (`AUTHORIZATION_RETIRED_BY_EDIT`). Only reconcile and revoke then remain.
- Account nonce changes, fork-block changes and a fee-tier selection change are material. They produce a new quote, simulation, policy, Manifest and plan.

### 3.8 Review and preview (P9)

**Server review.** The Mode A review (`review.ts`) consumes the unchanged BUILD-003A lint.

- Every `BLOCK` finding blocks, except `UNQUOTED_EXECUTION_UNAVAILABLE`. That one is discharged **only** by a current, verified fork quote for the same node and revision, and the discharge is recorded as an information finding with the quote hash.
- Lint warnings (0 bps, or 101–300 bps) need explicit acknowledgement in Manifest review.
- Blocking findings also cover:
  - every code in §3.14 before signature;
  - `INSUFFICIENT_BALANCE`, `INSUFFICIENT_GAS_BALANCE`, `PRE_EXISTING_ALLOWANCE`, `OWNER_HAS_CODE`;
  - `QUOTE_EXPIRED`, `DEADLINE_TOO_CLOSE`;
  - `ARTIFACT_LINK_MISMATCH`.

**Browser verification.** Before rendering Manifest review, and again immediately before each wallet request, the browser:

1. runs the digest self-check;
2. re-decodes each payload from its **exact bytes** with `reference-compiler` browser modules;
3. recomputes `payloadHash` with WebCrypto;
4. checks the plan and matrix payload hashes;
5. re-derives the decoded fields shown on screen from those bytes only.

Any mismatch returns `PAYLOAD_DECODE_MISMATCH` or `PAYLOAD_HASH_MISMATCH`, and no wallet request is made. The object passed to `eth_sendTransaction` is constructed from the same decoded bytes.

**Displayed.**

- Mode A, "2 wallet authorizations".
- Wallet, and chain "31337 · local fork of Base 8453 at block N · not valid on Base".
- Nonce, target with name and pin status, and function.
- Spender, allowance before and after, recipient.
- `amountIn`, expected and minimum output in native units and human units.
- Deadline in fork time.
- `value`, gas limit, fee caps and maximum gas cost.
- Pool fee tier and the fact that no interface fee applies on this path.
- `USD values: not modeled`.
- Payload hash and raw hex (collapsed).
- The matrix, and all hashes.

### 3.9 Wallet authorization and controlled submission (D-9)

**Wallet bridge.** `src/wallet/eip1193.ts` uses only `eth_requestAccounts`, `eth_accounts`, `eth_chainId` and `eth_sendTransaction` on `window.ethereum`. There is no wallet library, no chain switching and no typed-data or message signing.

**Guards before each request:**

- `WALLET_NOT_CONNECTED`;
- `WALLET_CHAIN_MISMATCH` (not 31337);
- `WALLET_ACCOUNT_MISMATCH` (not the Manifest owner);
- an expired signature window or deadline.

**Controlled submission, per step:**

1. **Prepare.** The browser calls `prepareAttempt(executionId, stepId, idempotencyKey)`. The server appends `PREPARED` and then `SUBMITTING` for a new `executionAttemptId`, and fsyncs the file and directory. Only then does it return.
2. **Wallet request.** The browser calls `eth_sendTransaction` with all fields set explicitly.
3. **Report.** The browser reports the transaction hash (`PENDING`) or error (`SUBMISSION_RESULT_UNKNOWN`) with `reportAttemptResult`.
4. **Wallet errors.** A wallet rejection is **not** treated as proof of no broadcast. The attempt goes to `SUBMISSION_RESULT_UNKNOWN`, and reconciliation classifies it.
5. **Ordering.** The swap step can be prepared only after the approve step's attempt is reconciled `CONFIRMED`, with its allowance equal to `amountIn`.

**Automated tests.** Browser tests use a Playwright test wallet (`e2e/mode-a-fixtures.ts`):

- `exposeBinding` delegates `eth_sendTransaction` to anvil `eth_signTransaction` and `eth_sendRawTransaction` from the Node test process.
- The browser never reaches anvil, and the CSP stays `connect-src 'self'`.
- Faults can be injected:
  - `REJECT` (4001);
  - `THROW_BEFORE_BROADCAST`;
  - `BROADCAST_THEN_THROW`;
  - `BROADCAST_THEN_HANG`;
  - `MUTATE_DATA`, `MUTATE_RECIPIENT`, `MUTATE_GAS`;
  - `WRONG_CHAIN`, `WRONG_ACCOUNT`.

The report records that no production wallet UI is exercised by automated evidence. Production-wallet coverage comes only from G7 (§3.9.1).

#### 3.9.1 Manual injected-wallet acceptance (G7; Amendment 1)

**Purpose.** Show that a real, manually operated injected EIP-1193 wallet signs and submits exactly the reviewed payloads. The automated evidence (§3.9) proves the protocol with a test wallet whose signing is done by the fork node. This check covers what automated evidence does not.

**Who and when.** The owner runs it on the local branch after G6 and before the commits. It may be rerun later on the merged code, in replay mode with no live request, if the first result is `LIMITED` (§1.5). The agent prepares the runbook and the verifier. The agent cannot operate a wallet extension, and it makes no RPC request of its own.

**Environment.**

- The fork harness in replay mode: no network, no credential.
- The app under `next start` on `127.0.0.1:3000`.
- A new, dedicated browser profile containing exactly one wallet extension, chosen by the owner. Its name and version are recorded.

**Wallet setup.**

- Add a custom network: RPC `http://127.0.0.1:8545`, chain ID 31337, native currency ETH.
- Import only the recorded owner dev account (its index is pinned in `profile.ts`), using the key that anvil prints in the local terminal.
- The key is never written to a file, chat, log or commit.
- The account has value only on the local fork. The profile is used for nothing else and is removed afterwards.

**Wallet queries.** After setup, the harness has mined 20 empty local blocks (§3.2.3), so recent-block and fee-history queries stay local. A wallet request that needs unrecorded state fails closed (`FORK_STATE_UNRECORDED`). That is recorded as a wallet-compatibility finding. The recording is never widened for it.

**Procedure.**

- Required: 1 WETH → USDC. Optional: 2,500 USDC → WETH.
- Connect, read the fork quote, select a tier, simulate, open Manifest review, accept, then approve and swap in the wallet UI. The wallet submits both transactions.

**Comparison.** `node apps/reference-dapp/e2e/fork/verify-manual-wallet.mjs <executionId>`:

- reads the reviewed payload bytes from the runtime execution directory;
- reads each signed raw transaction from the fork (`eth_getRawTransactionByHash`);
- prints, per step, a field-by-field table: chain, nonce, `to`, `value`, `data`, gas limit, both fee caps and the access list;
- compares the reviewed `payloadHash` with the hash recomputed from the signed transaction, the recovered signer with the owner, and `keccak256(raw)` with the transaction hash.

The owner also notes what the wallet displayed (target, spender or recipient, amount, network fee). That note is a transcription, not payload evidence.

**Record.** The report records the following under a separate heading, "Manual injected wallet (owner-run)":

- wallet name and version;
- browser version;
- date;
- Execution ID;
- transaction hashes;
- Evidence Bundle hash;
- verifier output digest;
- outcome.

**Status rule (Amendment 2).** G7 is `PASS` only when all of these hold:

- the required direction's two transactions are completed through the manually operated injected wallet;
- both have `EXACT` payload fidelity;
- the signer is the owner;
- the Evidence Bundle is `RECONCILED`.

Every other outcome is `LIMITED`.

**Outcomes, claims and effect on BUILD-003.**

| Outcome | G7 | Claim | BUILD-003 |
|---|---|---|---|
| Both transactions completed; both `EXACT`; signer is the owner; evidence `RECONCILED` | `PASS` | "Mode A payload fidelity demonstrated in `FORK_REPRODUCED` with the automated test wallet and with one manually operated injected wallet (name and version)." No other wallet is claimed | May be certified under §1.5 |
| Completed but not exact (for example the wallet re-priced gas, changed the nonce or altered data) | `LIMITED`, recorded as `DIVERGENT` with the differing fields | Automated test wallet only. The report says the tested wallet did not sign the reviewed payload exactly | Stays `IN_PROGRESS` |
| Both `EXACT` but the evidence is not `RECONCILED` (`INCONCLUSIVE`, or `DIVERGENT` effects) | `LIMITED` | Automated test wallet only | Stays `IN_PROGRESS` |
| Not completed: the wallet cannot use chain 31337 or import the account; a wallet query needs unrecorded state; only one transaction completes; or the owner is unavailable | `LIMITED` | "Demonstrated with an automated EIP-1193 test wallet whose signing is performed by the local fork node; not demonstrated with a production wallet UI." | Stays `IN_PROGRESS` |

In every `LIMITED` case, the PR may still be delivered if every other gate passes (§3.20). The report, `STATUS.md` and the PR description state the limitation. P9, P11 and Gate 3 are recorded as `LIMITED` in §1.5. `LIMITED` never satisfies Master Spec Gate 3 for completion. The wallet-surface labels are defined in §9.

### 3.10 Journal, attempts, persistence and restart (D-13)

**Journal.** The v1 Execution Journal is kept per execution under the git-ignored `apps/reference-dapp/.gryloo-runtime/mode-a/<executionId>/`.

- Entries are appended by writing a complete new file, fsyncing it, renaming it atomically and fsyncing the directory.
- The new bytes must extend the previous entries byte-for-byte, with the hash chain validated by the frozen `hashJournalBytes`.
- The directory also holds `attempts.json` (hash-chained attempt facts: transaction hash, signed raw transaction digest, wallet result, `preparedAtBlock`) and the frozen artifacts.

**Execution ID and attempt IDs.**

- The Execution ID is assigned at Manifest acceptance, before any wallet request.
- Re-accepting the same Manifest is idempotent.
- `executionAttemptId` = `<executionId>.<stepId>.a<k>`.
- A second prepare for a step with a non-terminal attempt returns `ATTEMPT_IN_PROGRESS`.

**States.**

- Workflow entries at acceptance: `DRAFT → REVIEWED → SIMULATED → AUTHORIZED`, recorded at acceptance and labeled as such.
- Then `EXECUTING`, `RECONCILING`, `COMPLETED`, or `PARTIALLY_COMPLETED`, `RECOVERY_REQUIRED` or `FAILED`.
- Attempts follow the frozen transitions. `RECONCILIATION_REQUIRED` is terminal.

**Persistence failures.**

- A write failure → `JOURNAL_WRITE_FAILED`, and no wallet request.
- A corrupt or non-extending file → `JOURNAL_CORRUPT`, the execution is frozen and only read-only display is available.

**Restart.**

- Server restart counts as worker restart: all state is reloaded from files.
- Any attempt in `SUBMITTING` without a result is treated as unknown and reconciled before any action.
- A browser refresh reloads by Execution ID. The page URL fragment is `#execution=<id>`; no browser storage is used.

**Rejected alternative.** A database and worker process are deferred (D-13 B).

### 3.11 Recovery (P13; D-15)

**Decision table** (`recovery.ts`, Master Prompt §2.3):

| Attempt outcome | Action |
|---|---|
| `CONFIRMED` | Record the receipt; never resubmit |
| `PENDING` | Wait; never create a competing transaction |
| `REVERTED` | Apply `ABORT`; inspect residual effects |
| `NOT_FOUND` (nonce unconsumed, deadline not near) | A retry is allowed only as a new attempt with the **same payload** and a new wallet authorization, up to 2 attempts |
| Divergence | `RECONCILIATION_REQUIRED`; fail closed |

**Unknown-result reconciliation:**

1. Read the owner's latest nonce.
2. If it passed the payload nonce, scan blocks from `preparedAtBlock` (at most 256 blocks) for `from = owner` and that nonce, then verify the payload (§3.12).
3. If the nonce is unconsumed, check `txpool_content` and wait through the applicable observation window. Only the combined nonce, block scan, txpool and waiting evidence may establish `NOT_FOUND`; a local `null` transaction or receipt lookup is never sufficient. The broadcast-before-unknown-result case must reconcile to the transaction without a duplicate.

**Residual allowance** after a failed or abandoned swap is shown as remaining authority. "Revoke residual allowance" compiles a **separate Mode A revocation execution** (`revocation.ts`):

- the same IR revision;
- a new account-state artifact;
- a simulated `approve(SwapRouter02, 0)`;
- policy spend 0;
- its own Manifest, plan, matrix, journal and evidence;
- linked by `supersedes` in evidence version 2.

It goes through `REVOCATION_REQUESTED`, `REVOCATION_SUBMITTED` and `REVOCATION_CONFIRMED`, where the last requires allowance 0 reconciled on the fork. A local stop never claims revocation.

### 3.12 Independent reconciliation and Evidence Bundle (P13, P14)

**Signed-payload checks.** The reconciler uses only fork chain data, fetched fresh, never the wallet's word or executor memory:

- `eth_getRawTransactionByHash` → decode the signed EIP-1559 transaction;
- `keccak256(raw)` must equal the hash (`TX_HASH_MISMATCH`);
- the recovered signer must equal the owner (`SIGNER_MISMATCH`, using `@noble/curves` secp256k1);
- the re-serialized unsigned preimage must equal the reviewed payload bytes (`PAYLOAD_FIDELITY_FAILED`).

**Effect checks:**

- the receipt status and block;
- decoded Transfer and Approval logs;
- owner tokenIn delta = −`amountIn`;
- owner tokenOut delta ≥ `minOut`, and equal to the Transfer log amount to the owner (the recipient);
- allowance after = 0 (after the swap);
- ETH delta = −(Σ gasUsed × effectiveGasPrice + any reported L1 fee), otherwise `FEE_MISMATCH`;
- no tokenIn or tokenOut residue at SwapRouter02 attributable to the execution;
- nonce consumption consistent.

Reads are pinned to the receipt block hash plus the latest block hash, with a final consistency re-read (`RPC_INCONSISTENT` → `INCONCLUSIVE`).

**Outcomes.**

| Outcome | When |
|---|---|
| `RECONCILED` | Every invariant holds |
| `CONFIRMED_NOT_RECONCILED` | The receipt exists but reconciliation has not run or finished |
| `DIVERGENT` | A fidelity or effect mismatch, including a wallet-altered payload or recipient |
| `INCONCLUSIVE` | Inconsistent or unavailable reads |

Green is shown only for `RECONCILED`.

**Evidence Bundle** (v1):

- `environment` `FORK_REPRODUCED`; `outcome` as above;
- `receipts`: `{receiptId: txHash, contentHash: raw-response digest of the receipt}`;
- `differences` for every expected-versus-observed mismatch;
- `reconciliation`: balances, allowances, fees and residual assets, plus `ownership` = owner and `limitations`, which include the fork disclosures, setup override and v1 quantity limits;
- `evidence[]`: `EXTERNAL_REFERENCE` for the matrix hash, signed raw transaction digests, reconciliation transcript digest and fork transcript digest;
- versioning through `version` and `supersedes`, append-only.

**Export.** The Execute tab offers "Copy Evidence Bundle JSON" and "Copy journal JSON".

### 3.13 Freshness, clocks and deadlines (D-16)

- **Authoritative clock.** In `FORK_REPRODUCED`, fork chain time (the latest block timestamp) is the authoritative clock for `retrievedAt`, freshness, deadlines, journal `recordedAt` and evidence `observedAt`. It is deterministic (§3.2.5). Wall clock is never recorded in these artifacts.
- **Quote validity.** 60 fork-seconds from `Tb`. It is re-checked at simulation, Manifest compile, acceptance and before each wallet request, against a fresh `latest` read.
- **Deadline.** The swap deadline is `Tb + 180`. A wallet request is refused unless the next block time is at least 12 seconds before the deadline (`DEADLINE_TOO_CLOSE`).
- **Signature window.** A server-monotonic guard refuses wallet requests more than 300 seconds after acceptance (`SIGNATURE_WINDOW_EXPIRED`). This is not recorded.
- **Browser clock.** Display only.
- **Source disclosure.** Fork state is Base at finalized block N, recorded on the recording date. It is shown as `NOT_CURRENT_MARKET`, and never presented as a current quote.
- **BUILD-003C replay.** Never used.

### 3.14 Failure behavior

Every failure is closed: nothing partial is shown as current, and a code and plain message are shown.

| Area | Codes | Effect |
|---|---|---|
| Environment | `FORK_MODE_OFF`, `CONFIGURATION_INVALID`, `FORK_UNAVAILABLE`, `FORK_CHAIN_MISMATCH`, `FORK_SOURCE_MISMATCH`, `FORK_STATE_UNRECORDED`, `MAINNET_CHAIN_REFUSED` | No fork actions |
| Quote | BUILD-003C chain, block, code, metadata, deployment and envelope codes; `NO_QUOTED_TIER`, `TIER_NOT_SELECTED`, `QUOTE_EXPIRED`, `OWNER_HAS_CODE` | No artifacts |
| Account | `INSUFFICIENT_BALANCE`, `INSUFFICIENT_GAS_BALANCE`, `PRE_EXISTING_ALLOWANCE` | Review blocked |
| Simulation | `SIMULATION_REVERTED` (with decoded reason), `SIMULATION_QUOTE_MISMATCH`, `SIMULATION_UNSTABLE`, `SIMULATION_UNSUPPORTED`, `GAS_BUDGET_EXCEEDED` | No policy |
| Compile and review | `LINT_BLOCKED`, `WARNING_NOT_ACKNOWLEDGED`, `ARTIFACT_LINK_MISMATCH`, `UNKNOWN_TARGET`, `UNKNOWN_SPENDER`, `UNKNOWN_FUNCTION`, `RECIPIENT_NOT_OWNER`, `SENTINEL_RECIPIENT`, `EXCESSIVE_APPROVAL`, `AMOUNT_MISMATCH`, `NONZERO_VALUE`, `ACCESS_LIST_NOT_EMPTY`, `NONCANONICAL_ENCODING`, `PAYLOAD_DECODE_MISMATCH`, `PAYLOAD_HASH_MISMATCH` | No Manifest acceptance or wallet request |
| Executor | `JOURNAL_WRITE_FAILED`, `JOURNAL_CORRUPT`, `ATTEMPT_IN_PROGRESS`, `ATTEMPT_LIMIT_REACHED`, `STEP_ORDER_VIOLATION`, `DEADLINE_TOO_CLOSE`, `SIGNATURE_WINDOW_EXPIRED`, `AUTHORIZATION_RETIRED_BY_EDIT` | No wallet request |
| Wallet | `WALLET_NOT_CONNECTED`, `WALLET_CHAIN_MISMATCH`, `WALLET_ACCOUNT_MISMATCH`, and any wallet error → `SUBMISSION_RESULT_UNKNOWN` | Reconcile first |
| Reconciliation | `TX_HASH_MISMATCH`, `SIGNER_MISMATCH`, `PAYLOAD_FIDELITY_FAILED`, `NONCE_CONSUMED_BY_OTHER_TRANSACTION`, `BALANCE_DELTA_MISMATCH`, `RECIPIENT_MISMATCH`, `ALLOWANCE_RESIDUAL`, `FEE_MISMATCH` → `DIVERGENT`; `RPC_INCONSISTENT`, `FORK_UNAVAILABLE` → `INCONCLUSIVE` | No retry; recovery options only |

### 3.15 UI changes

**Label and title.** The build label becomes `BUILD-003D` (D-17), together with the page title. Everything else below is new or changed only in fork mode, unless stated.

| Screen | Change | Snapshot |
|---|---|---|
| Top bar | Build label. A new environment badge: `FORK_REPRODUCED · chain 31337` or `FORK: OFF`. Wallet: `Not connected`, the short address, or `Unavailable` outside fork mode | All ten existing |
| Simulate | New region **"Mode A on a local Base fork"** below the observation panel: environment, wallet, per-swap tier table and selection, account state, "Simulate exact path", results, findings, hashes, disclosures. The mocked-chain "Next step" line becomes build-neutral: "Mocked artifacts cannot authorize execution; Manifest review uses only fork artifacts" | `simulate`, `simulate-current`, `simulate-invalidated`, `simulate-expired`, `observation-recorded`, `observation-expired`, and new `fork-simulated` |
| Summary bar | "Open Manifest review" is enabled only with a current fork simulation; otherwise it is disabled with its reason. Statuses show the fork execution's mode, enforcement and environment when one exists | As above |
| Execute | Replaces "Execute is not implemented" with: Manifest review (when opened), the execution timeline, attempts, hashes, fund location, residual authority, reconciliation, evidence and recovery controls. Without fork mode it reads "Execute requires the local fork environment (FORK_REPRODUCED). Mainnet execution is disabled." | `execute`, and new `manifest-review`, `execute-reconciled`, `execute-result-unknown`, `execute-recovered-after-restart`, `execute-swap-reverted-residual-allowance`, `execute-revocation-confirmed`, `execute-divergent-wallet-payload` |
| Build | Label only | `build`, `proposal`, `review-blocked` |

**Colors.**

- Green only for `RECONCILED`.
- Amber for pending and unconfirmed states and warnings.
- Red only for blocks, `DIVERGENT` and failures.
- The fork region uses its own neutral badge tone.

**Accessibility.** Every new control is keyboard reachable with visible focus, and meaning is never carried by an icon alone. Layout is checked at 375, 768 and 1280 widths.

**Allowed controls.** The E2E authority scan is replaced by an exact allowlist of enabled authority-shaped controls in fork mode: Connect wallet, Accept Manifest, Sign … in wallet, Retry step, Revoke residual allowance. Outside fork mode, none are enabled.

**Visual evidence process** (as in BUILD-003B and BUILD-003C):

1. Reproduce the 10 existing snapshots at `8a5fbae` with strict RGB equality.
2. Retain `*-before.png`.
3. Capture the after images under the same fixed settings.
4. Inspect every difference against this table and retain `*-diff.png`, with counts and hashes in the report.
5. Only then write the baselines.

The 8 new snapshots are inspected and recorded. All comparisons keep `maxDiffPixels: 0`, with no masks and no retries.

### 3.16 Deterministic fix for the intermittent simulate-expired screenshot (D-18)

#### Evidence

**CI facts.** See §2.3.

**Local reproduction attempts** (pinned Node 24.21.0, approved headless shell 1243, replay mode, unmodified tests). **152 runs, 0 failures:**

- 80 isolated repeats of the expiry test;
- 12 repeats of the whole mock-chain spec pinned to one CPU core;
- 60 runs of a scratch copy under 6× CDP CPU throttling.

**Fingerprinting**, measured against the committed baseline with the same comparator:

| State | Differing pixels |
|---|---|
| Unchanged | 0 |
| Focus-visible on the Generate button | 0 |
| Pointer moved away | 0 |
| React Flow viewport shifted by ±0.5 px (nodes only, background dots unchanged) | 239 to 3,795 |
| React Flow viewport shifted by +1 px horizontally (nodes only) | 4,239 |
| Scale 1.19 instead of 1.2 | 6,727 |
| Viewport reset to unfitted (approximate) | 9,328 or more |

The observed 5,365 pixels therefore matches **a fitted viewport computed from inputs about one pixel different**, not a missing fit, a focus change or a hover change. The committed fitted transform is `translate(27.4px, 15.3px) scale(1.2)` on an 818×405 pane.

#### Mechanism in code

- **Remount.** The Simulate canvas is remounted whenever the mocked overlay changes: `workflow-canvas.tsx:60` `key={`${workflow.nodes.length}-${overlay.size}`}`. That happens on generation, invalidation and expiry.
- **One-shot fit.** The canvas uses one-shot `fitView`. In `@xyflow/react@12.11.6`, the queued fit is resolved by the first `updateNodeInternals` after node measurement, using the pane size in the store at that moment. It is then cleared and never recomputed when pane or node sizes change later (`dist/esm/index.mjs` lines 3483–3492 and 3393–3396). The pane `ResizeObserver` (lines 1283–1284) only updates width and height.
- **Browser timing.** The viewport after each remount therefore depends on the browser-scheduled moment of measurement, which Playwright's clock does not control. The expiry remount is also the only one triggered by a synthetic `visibilitychange` event dispatched from test code, rather than by a click or a resolved action.

This timing-dependent measurement is consistent with the fingerprint evidence, but it is **not proven by reproduction**. The report must say so.

#### Fix (targeted; no tolerance change; expiry assertions unchanged)

1. **Viewport.** In `SimulationCanvas`:
   - drop `overlay.size` from the key and remove the `fitView` prop;
   - add a child that, in a layout effect, applies `setViewport(getViewportForBounds(getNodesBounds(measured nodes), paneWidth, paneHeight, 0.35, 1.2, 0.1), { duration: 0 })` **whenever** the pane size, node set or any measured node size changes.

   These are the same function and parameters as v12's default `fitView`, so a settled state renders the same pixels as today for the same layout. The final viewport becomes a pure function of the final layout, whatever the order of measurement and effects. No timer or `requestAnimationFrame` is used, so Playwright's paused clock cannot stall it.
2. **Settled signal.** The canvas region exposes `data-viewport="fitted"` only when the inputs last applied equal the current inputs, and `pending` otherwise.
3. **Tests.** Before every Simulate screenshot that contains the canvas, add `await expect(canvas).toHaveAttribute('data-viewport', 'fitted')`. This covers `simulate-current`, `simulate-invalidated`, `simulate-expired`, `observation-recorded`, `observation-expired` and `fork-simulated`.
   - This only strengthens the tests.
   - The `EXPIRED` chip, the expiry text, the zero mocked values, the tab-resume, access and focus retirement checks, `maxDiffPixels: 0`, no masking and `retries: 0` are unchanged.
   - The Build canvas stays unchanged. Its snapshots are click-driven and have never failed.
4. **Forensics.** A failure step in `contracts.yml` runs `python3 scripts/summarize-screenshot-diffs.py apps/reference-dapp/test-results` (stdlib only, no upload, no `uses:`). For every `*-diff.png` it prints:
   - image size;
   - count of Playwright diff-colored pixels;
   - up to eight bounding boxes;
   - SHA-256 of the expected, actual and diff images.

   Any recurrence is then diagnosable from the log alone.

#### Acceptance

- A unit test of the viewport-convergence helper.
- 300 consecutive local runs of the expiry test (200 normal, 100 at 6× CPU throttling) and five full browser-suite runs, with zero failures.
- The forensics script is tested on synthetic diff images.
- CI passes on push, PR and post-merge **without a rerun**.
- If a mismatch recurs after the fix, work stops. The forensics output is reported, and the tolerance is never relaxed.

### 3.17 Network, secret and boundary rules (governance)

| # | Rule | After BUILD-003D |
|---|---|---|
| 1 | Remote URL literals in scanned source | Unchanged Alchemy exemption in `base-rpc.ts`, plus exactly one `http://127.0.0.1:8545` in `src/server/fork-rpc.ts`. No other literal |
| 2 | `fetch(` | Exactly one in `base-rpc.ts` and exactly one in `fork-rpc.ts` |
| 3 | Wallet tokens | `window.ethereum` and `eth_sendTransaction` only in `src/wallet/eip1193.ts`, count-limited. `eth_sign*`, `personal_sign`, `signTypedData`, `eth_sendRawTransaction`, wagmi, viem, ethers and web3 stay banned everywhere scanned |
| 4 | Scanned sources | Extended to `packages/reference-{compiler,executor,reconciler}/src` |
| 5 | Policy, Manifest, plan, journal and evidence type names | Allowed only in the three new packages, `mode-a-service.ts`, `mode-a-action.ts`, `domain/mode-a.ts`, `state/mode-a-store.tsx`, the three new components and their tests. Still banned in the mocked-chain and observation modules |
| 6 | JSON-RPC methods (non-test) | `base-observation.ts` and `base-rpc.ts` unchanged. Only `fork-rpc.ts`, `fork-quote.ts`, `simulation.ts` and `reconcile.ts` may use: `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`, `eth_call`, `eth_getBalance`, `eth_getTransactionCount`, `eth_simulateV1`, `eth_getTransactionByHash`, `eth_getRawTransactionByHash`, `eth_getTransactionReceipt`, `anvil_metadata`, `txpool_content`. No other `anvil_`, `evm_` or `hardhat_` method in scanned source |
| 7 | Selectors (non-test) | The six BUILD-003C selectors plus `0x095ea7b3`, `0xdd62ed3e`, `0x70a08231`, `0x04e45aaf`, `0x5ae401dc` |
| 8 | Node modules | `node:fs` only in `reference-executor/src/file-store.ts` and `src/server/*`. Network modules and `child_process` stay banned in scanned source (the harness and E2E are not scanned sources) |
| 9 | Separation | No imports between the Mode A packages or modules and the BUILD-003B mocked or BUILD-003C observation modules, in either direction. The reconciler never imports the executor. Browser files never import server files |
| 10 | CSP and guard | `connect-src 'self'` unchanged. The E2E network guard and `fixtures.ts` are byte-identical |
| 11 | CI | No step sets `GRYLOO_BASE_OBSERVATION` or `GRYLOO_EXECUTION_ENVIRONMENT`; Playwright config pins them. No secret, no `uses:`. The anvil bootstrap uses runner Python |
| 12 | Secrets | The transcript, request logs and runtime files contain no credential, header or key. `.gryloo-runtime` is added to `.gitignore` and to the generated-output ban |

### 3.18 Dependencies, toolchain and CI (D-3, D-12)

- **npm.**
  - Add exact pins `@noble/hashes@2.4.0` (to `reference-compiler` and `reference-reconciler`) and `@noble/curves@2.4.0` (to `reference-reconciler`), both MIT with no further transitive packages.
  - Lockfile identities go from 245 to **247**. There is no new license exception.
  - `bootstrap-ci.py`: new lock-section digest, counts 247, a `BUILD003D_DIRECT_VERSIONS` table, exact manifests and importers for the three packages, and the unchanged release-age rule, which both packages satisfy.
  - `contracts.yml`: SBOM counts 247, 8 workspace manifests and importers, export checks for the new packages, and `pnpm audit` clean.
- **Contracts package.** `workflow-contracts` 0.2.0. Its dependents' `workspace:` pins are updated in `action-registry`, `reference-linter` and the app package.
- **Binary.** anvil v1.8.3 via `scripts/bootstrap-anvil.py` (§3.2.1). Foundry is MIT or Apache-2.0. It is a test and development tool only: downloaded, never vendored or distributed.
- **CI order.**
  1. Bootstrap Node and pnpm.
  2. Install.
  3. Verify dependencies.
  4. Typecheck, lint, build, schema check, unit tests.
  5. Bootstrap anvil.
  6. `pnpm test:anvil`: the offline compatibility gate (§3.2.6).
  7. `pnpm test:fork` (the Vitest fork integration suite against anvil plus replay upstream).
  8. Bootstrap the headless shell.
  9. Guarded E2E through the fork harness.
  10. Forensics on failure.
  11. Audit.
  12. SBOM.
- **Scripts.** The root `package.json` adds `test:anvil` (the compatibility gate only) and `test:fork`. `test` excludes `*.fork.test.ts`.
- **Unchanged:** Node 24.21.0, pnpm 11.22.0, Playwright 1.63.0, the headless shell, `next`, `react` and `@xyflow/react`.

### 3.19 Governance transition and living records (including BUILD-003C delivery)

- **Decisions.** At implementation, register:
  - **DEC-0023**: plan approval with the D-1 to D-20 choices, Amendment 1 and the BUILD-003C delivery facts;
  - **DEC-0024**: acceptance of ADR-0003, the Mode A binding and contract amendment;
  - **DEC-0025**: acceptance of ADR-0004, the fork environment and the bounded recording budget.

  Each gets a marker check.
- **Requirements.** Register §2.1, including `B003C-DELIVERY-001`. Historical rows stay unchanged.
- **BUILD-003C delivery**, recorded truthfully in `STATUS.md`, `NEXT_BUILD.md`, `README.md`, `REQUIREMENTS.md`, `AUTHORITY_MATRIX.md` and `SCOPE_GUARD.md`:
  - PR #9;
  - merge `8a5fbae…` at 15:31:30Z;
  - every run ID;
  - the post-merge contracts/app attempt-1 failure on `simulate-expired` and the successful rerun.

  The BUILD-003C plan and report stay byte-identical and are added to the protected digests.
- **Historical scope.**
  - BUILD-003C becomes a fixed tree comparison `0faec71 → 8a5fbae` with its 30/36 sets, fixture lock and mode rules. CI fetches `8a5fbae`.
  - BUILD-003C images, the replay fixture and the observation snapshot checks move to `git show 8a5fbae:` objects.
- **Current scope.** `8a5fbae →` the reviewed tree must equal the §11 lists exactly: 113 created, 51 modified, no deletions, regular files, no executable modes.
- **Frozen trees.**
  - `schemas/v1`: the 9 v1 files stay byte-identical, plus the new `enforcement-matrix.schema.json`.
  - `tests/compatibility/v1`: 20 files byte-identical, plus 2 new.
  - `third_party/licenses` is unchanged.
- **Packages.**
  - The allowed package set adds the three reference packages.
  - Their LICENSE files must equal the official AGPL text.
  - `LICENSE_MAP` moves the three paths from reserved to AGPL implementation.
  - The remaining reserved boundaries (`reference-simulation`, `reference-evidence`, `public-ui`) stay reserved.
- **Build documents.**
  - Templates: the BUILD-003D plan (13 headings) and report (14).
  - The allowed BUILD-003 document set becomes the 003A to 003D plans and reports.
  - ADR checks cover ADR-0003 and ADR-0004 (`ACCEPTED` after approval), with ADR-0001 unchanged.
- **Authority matrix.**
  - Add a `BUILD-003D` `APPROVED` row.
  - Mode A exact payload binding becomes `IMPLEMENTED_FORK_ONLY` with its real locations.
  - The not-approved row is renamed "Mainnet execution, public testnet execution, Mode B or later builds" `NOT_APPROVED`, with the regular expression updated.
- **Markers.**
  - `STATUS.md` must contain `BUILD-003D` and `8a5fbaed26e005e5719528c399f7ca1adb334eb6`.
  - `NEXT_BUILD.md` ends `NONE_APPROVED`.
  - These records contain no percent sign.
  - `STATUS.md` and the BUILD-003D report must contain `BUILD-003 certification: PENDING_OWNER_DECISION`.
  - `STATUS.md` and the BUILD-003D report must contain exactly one of `G7 manual wallet acceptance: PASS` or `G7 manual wallet acceptance: LIMITED`. With `LIMITED`, `STATUS.md` must also contain `BUILD-003: IN_PROGRESS`.
  - `STATUS.md`, `NEXT_BUILD.md`, `README.md`, `EVIDENCE_LEVELS.md`, `AUTHORITY_MATRIX.md` and the report must not match `\bBUILD-003\b(?![A-Z])\s+(?:is\s+)?(?:complete|certified)`. Only the later records change that registers the certification decision may replace this check.
- **Delivery constraint.** Current governance rejects any tree containing this plan, for three reasons: unexpected path, unexpected BUILD-003 document set and unregistered IDs. The plan therefore ships only with the implementation, as earlier builds did.

### 3.20 Implementation phases and stop gates

| Phase | Work | Gate before continuing |
|---|---|---|
| P0 | Flake fix and forensics (§3.16) | G0: §3.16 acceptance locally |
| P1 | `scripts/bootstrap-anvil.py`; the `reference-compiler` package skeleton with its exact `@noble/hashes` pin and the lockfile, `bootstrap-ci.py` and manifest updates this needs; the **offline anvil compatibility gate** (§3.2.6) | **G1: C1–C10 all pass against the exact pinned binary. Any failure stops the build and returns for D-14, D-5 or D-3. Nothing is substituted. No credentialed request may exist before G1** |
| P2 | ADR-0003, enforcement-matrix kind, payload profile, fixtures, schema export | G2: v1 bytes, fixtures and vectors identical; new vectors frozen; `schemas:check` |
| P3 | Pure compiler, executor and reconciler with scripted transports | G3: unit suites, including adversarial decode and the state machine |
| P4 | ADR-0004, harness, replay upstream, setup, scenario driver, scratch recording proxy and zero-request preflight | **G4: the preflight proves the caps and stops; G1 passed; the owner's no-paid-billing confirmation is recorded (§3.3.2)** |
| P5 | **Owner-run recording** (§3.3) | G5: transcript valid, pins reviewed, reproducibility byte-identical. **Any stop pauses the build for the owner** |
| P6 | App integration, UI, automated E2E, visual evidence | G6: all automated browser and visual acceptance |
| P7 | **Owner-run manual injected-wallet acceptance** (§3.9.1) | **G7: `PASS` requires both transactions `EXACT` with `RECONCILED` evidence through the manual wallet. Any other outcome is recorded as `LIMITED`. G7 does not block delivery of the BUILD-003D PR. A `PASS` is required before BUILD-003 can be certified (§1.5)** |
| P8 | Governance, dependencies, SBOM, audit, records, report | G8: every check in §5; then the commits under D-19. A `LIMITED` G7 is stated in the report, `STATUS.md` and the PR description |
| After merge | Owner review of the report and CI; a later owner-run G7 rerun only if G7 was `LIMITED` | The certification decision (§1.5), which requires G7 `PASS`. Only then is BUILD-004 planning eligible. With G7 `LIMITED`, BUILD-003 stays `IN_PROGRESS` |

Routine fixes inside this scope need no new approval. Work stops for an amendment if a fix would change:

- the scope or file lists;
- a dependency or pin;
- a protected file;
- the recording budget;
- the upstream allowlist;
- the simulation method;
- the strength of a check.

## 4. Out of scope

- Mainnet execution or any mainnet-signable payload. Public testnet execution and any automatic BUILD-003E (owner direction, 2026-09-24).
- Mode B and Mode C, ADR-0001 selection, delegated or background execution, and any executor key.
- UniversalRouter, Permit2, EIP-2612 permits, typed-data or message signing, native ETH input and multi-hop routes.
- Wallet libraries, chain switching and wallet-connection protocols other than injected EIP-1193.
- Recipients other than the owner, and any IR schema or authoring change.
- Automatic tier ranking and "best" claims. CoW, LI.FI and any other adapter.
- Databases, a separate worker service, hosting and multi-user or tenant support.
- Using any BUILD-003C observation or BUILD-003B mocked value as input. New live reads beyond §3.3.
- A v2 policy, Manifest, plan, journal or evidence schema, and any change to v1 bytes.
- Package publication and binary redistribution.
- USD values.

## 5. Acceptance criteria

- [ ] **Offline anvil compatibility (G1).** C1–C10 pass against the exact pinned binary before any credentialed request. The result JSON digest is reported. No method, flag or behavior was substituted.
- [ ] **Recording.** Within the D-5 caps and stop rules, credential-free. The transcript and request log digests are reported. Reproducibility is byte-identical (G5). The owner's no-paid-billing confirmation preceded the session and is recorded.
- [ ] **Environment guards.** Fork mode activates only with the exact loopback, chain 31337 and pinned `anvil_metadata`. 8453 and every other chain are refused in the compiler, wallet bridge and reconciler. There is no broadcast path in the server.
- [ ] **Fork quote.** All checks pass on the fork. The four BUILD-003C code pins hold and the SwapRouter02 pin is reviewed. Perturbations fail closed. Nothing is ranked.
- [ ] **Simulation.** Exact-path simulation equals the selected tier's quote. Failure paths include the residual allowance. Gas values are stable after rebuild.
- [ ] **Artifacts.**
  - Policy, Manifest, plan, payloads and matrix are canonical and deterministic.
  - Each material change alters exactly the expected hashes.
  - A quote refresh invalidates only dependents.
  - The IR is byte-identical before and after every fork operation.
  - v1 fixtures, vectors and schemas are byte-identical.
- [ ] **Preview.** The browser re-derives every displayed payload field and hash from the exact bytes. Tampered bytes block before the wallet.
- [ ] **Wallet.** Chain and account guards hold. Rejection and errors lead to reconciliation, never to an assumed non-broadcast.
- [ ] **Manual injected wallet (G7).** The G7 result is recorded under its own label as `PASS` or `LIMITED` (§3.9.1). `PASS` requires both transactions `EXACT`, signed by the owner dev account, with `RECONCILED` evidence. For PR delivery, `LIMITED` is acceptable only if it is stated in the report, `STATUS.md` and the PR description. For BUILD-003 completion, only `PASS` counts (§1.5). Automated and manual wallet evidence are never merged.
- [ ] **Journal.** The attempt is persisted and fsynced before every wallet request. The hash chain is valid. Prepare is idempotent. A write failure blocks the wallet.
- [ ] **Recovery.**
  - An unknown result followed by a server restart reconciles to `CONFIRMED` with no duplicate transaction.
  - `PENDING` is shown as pending, then confirmed.
  - `NOT_FOUND` allows exactly one retry of the same payload.
  - A swap revert shows the residual allowance.
  - The revocation execution reaches `REVOCATION_CONFIRMED`.
- [ ] **Reconciliation and evidence.**
  - `RECONCILED` only when every invariant holds.
  - A wallet-mutated payload, recipient or gas is `DIVERGENT`.
  - An inconsistent RPC is `INCONCLUSIVE`.
  - The Evidence Bundle links every hash, is `FORK_REPRODUCED` and is versioned.
- [ ] **Adversarial.** The Build 003 injections and the applicable §8.7 cases in §6 pass, with results tabulated in the report.
- [ ] **UI honesty.**
  - No green before `RECONCILED`.
  - Estimates labeled as estimates.
  - The two signatures disclosed.
  - The fork, not-mainnet and not-current-market labels present.
  - "Stopping does not revert confirmed steps" present.
  - Outside fork mode: `DRAFT`, `NONE`, `NOT_ENFORCED`.
- [ ] **Flake fix.** §3.16 acceptance, and CI passes without rerun.
- [ ] **Visual evidence.** Visual evidence for the 10 changed snapshots and inspection of the 8 new ones. Zero-pixel regression on all 18. Keyboard reach and the 375, 768 and 1280 layouts pass.
- [ ] **Supply chain.** 247 identities, audit clean, SBOM validated, and the anvil pin verified in CI.
- [ ] **Governance and records.** Historical and current governance pass, with isolated negative mutations rejected. The BUILD-003C delivery is recorded truthfully. The historical records are byte-identical. The report separates local results, the recording, remote CI and missing evidence.
- [ ] **Conditional certification.** The report marks each §1.5 row only with cited evidence. `STATUS.md` and the report carry `BUILD-003 certification: PENDING_OWNER_DECISION`. No record claims BUILD-003 complete or certified.

## 6. Required tests

**Unit** (Vitest, no network):

- **`reference-compiler`:**
  - RLP and ABI strict encode and decode against vectors, including non-canonical rejections;
  - selectors and topics re-derived with an in-test Keccak and with `@noble/hashes`;
  - payload preimage, `payloadHash` equal in Node and browser, and signing hash;
  - fork-quote read plan, checks and pins, including perturbations;
  - simulation interpretation, mismatch and instability;
  - policy, Manifest, plan and matrix determinism and material-change tables;
  - invalidation;
  - review findings, including every code in §3.14 before signature, sentinel recipients, excessive approval, unknown spender, target or function, nonzero value, access list, wrong chain, `amountIn` + 1 native unit, and lint discharge only by a current fork quote.
- **`reference-executor`:**
  - every workflow, segment, step and attempt transition, and the rejection of every forbidden one;
  - persist-before-request ordering;
  - idempotent prepare and concurrent prepare;
  - attempt limit;
  - file-store atomicity, fsync ordering and corrupt or non-extending file rejection;
  - the recovery decision table.
- **`reference-reconciler`:**
  - signed-transaction decode, hash, signer recovery and payload fidelity;
  - every invariant and its failure code;
  - outcome classification;
  - Evidence Bundle build and validation with the frozen contracts, and supersession.
- **`workflow-contracts`:** `enforcement-matrix` schema, projection, vectors and compatibility. The v1 domain-coverage test is scoped to the frozen v1 vectors.
- **App:**
  - `fork-rpc.ts`: exact destination, method allowlist, size and time limits, environment parsing, activation guards;
  - `mode-a-service.ts`: scripted fork transport;
  - `eip1193.ts`: guards and error mapping;
  - `domain/mode-a.ts`: browser re-verification, and the IR hash and revision unchanged;
  - viewport-convergence helper;
  - product labels.

**Offline compatibility gate** (`pnpm test:anvil`, the exact pinned anvil, in-test synthetic upstream, no network): checks C1–C10 in §3.2.6. Negative self-tests confirm that each of these fails the gate: a wrong binary digest, a changed version string, and an upstream method outside the allowlist.

**Manual acceptance** (owner-run, not CI): the §3.9.1 procedure. `verify-manual-wallet.mjs` compares through the reconciler's `raw-transaction` fidelity functions. Those functions are unit-tested for exact, fee-changed, nonce-changed, recipient-changed and wrong-signer transactions.

**Integration** (`pnpm test:fork`, real anvil v1.8.3 plus the replay upstream, no network):

- compile, simulate, sign through anvil `eth_signTransaction`, submit, reconcile and evidence for both directions;
- unknown result and a restart of the store process (`restart.fork.test.ts` kills and relaunches a child process on the same runtime directory);
- pending with automine off;
- revert under a price-moving adversary swap, followed by the revocation execution;
- the application gateway bypassed by broadcasting after the deadline, giving an on-chain revert `Transaction too old` → `REVERTED`;
- a lying transport for inconsistent chain ID, block hash, receipt, logs or raw transaction → `INCONCLUSIVE` or `DIVERGENT`.

**E2E** (guarded Playwright, fork harness, fixed browser clock):

- **`mode-a-fork.spec.ts`**, for 1 WETH → USDC and 2,500 USDC → WETH: connect, quote, select a tier, simulate, Manifest review with a decoded-field check against bytes independently decoded in the test, acceptance, both signatures, `RECONCILED`, evidence JSON parsed and hashed with the frozen `parseArtifactBytes` and `hashArtifactBytes`, and the IR hash unchanged. Plus keyboard and responsive checks, and the `fork-simulated`, `manifest-review` and `execute-reconciled` snapshots.
- **`mode-a-recovery.spec.ts`:**
  - `BROADCAST_THEN_HANG` plus a harness web-server restart plus reload leads to recovery with no duplicate: exactly one transaction at nonce n;
  - `THROW_BEFORE_BROADCAST` leads to `NOT_FOUND`, then one retry;
  - pending, then mined;
  - swap revert leads to a residual allowance, then revocation confirmed.

  Plus four snapshots.
- **`mode-a-adversarial.spec.ts`:**
  - `MUTATE_RECIPIENT` and `MUTATE_DATA` → `DIVERGENT` with the recipient shown (snapshot);
  - `MUTATE_GAS` → `DIVERGENT`;
  - wrong chain and wrong account are blocked before signature;
  - insufficient balance, pre-existing allowance and expired quote (fork time advanced by the harness) are blocked;
  - lint slippage above 300 bps is blocked;
  - a prompt such as "send to 0x…" creates no recipient field.
- **Regression:** all 28 existing tests pass with only the §3.15 assertion updates and the §3.16 settled-viewport waits. The network guard stays clean.

**Visual:** 18 snapshots at zero pixels, and the §3.15 evidence process.

**Governance** (isolated negative copies must fail):

- a third `fetch(`, or a second loopback literal;
- `window.ethereum` outside the bridge;
- `eth_sendRawTransaction` or an `anvil_setBalance` in scanned source;
- a disallowed method or selector;
- a Mode A type in a mocked or observation module;
- a reconciler importing the executor;
- a changed v1 schema byte;
- a changed BUILD-003C plan or report byte;
- an altered historical 003C tree;
- an unregistered B003D ID;
- a missing report heading;
- an incomplete DEC marker;
- an unlisted path;
- the transcript containing `Bearer`;
- `.gryloo-runtime` content tracked;
- a completion or certification phrase for BUILD-003, or a missing `PENDING_OWNER_DECISION` marker, in `STATUS.md` or the report;
- a percent sign in `STATUS.md`.

## 7. Authority and artifacts

- **Authorization mode.** `MODE_A` for fork executions only. `NONE` everywhere else.
- **Enforcement.** Per the matrix in §3.7:
  - `EXACT_SIGNED_PAYLOAD` for the payload fields, with minimum output and deadline checked on-chain by SwapRouter02;
  - `APPLICATION_GATEWAY` for freshness, simulation, balance, allowance, ordering and attempt limits;
  - `MONITOR_ONLY` for residual allowance and fund location;
  - `NOT_ENFORCED` for cumulative reservation and revocation epoch.

  No policy-level enforcement is claimed for Mode A.
- **ADRs.**
  - ADR-0003 (Mode A exact payload binding and additive contract kind) and ADR-0004 (controlled Base fork environment and recording) are created and proposed for acceptance with this plan.
  - ADR-0001 remains `PROPOSED` and byte-identical.
- **Artifacts created per fork execution:**
  - two Quote/State artifacts per node;
  - Artifact Set;
  - Simulation Bundle;
  - Authorization Policy;
  - Strategy Manifest;
  - two payloads;
  - Execution Plan;
  - enforcement matrix;
  - Execution Journal;
  - attempt facts;
  - Evidence Bundle version 1, plus version 2 after revocation.
- **Hashes:** `semanticWorkflowHash` (unchanged), `artifactSetHash`, `simulationHash`, `policyHash`, `manifestHash`, `payloadHash` ×2, `executionPlanHash`, `enforcementMatrixHash`, journal entry hashes and `journalHeadHash`, `evidenceBundleHash`, the raw-response digests, and the fork `stateSourceHash`. The DAG is in §3.7.
- **Material-change invalidation.** Per the frozen v1 matrix plus the §3.7 additions. A retired authorization is never reused.
- **Revocation and cancellation.**
  - Residual allowance is revoked only through a new Mode A revocation execution.
  - A local stop or pause never claims revocation.
  - Nothing can be cancelled after broadcast on this path.
  - Refund is not applicable.

## 8. Security impact

- **Protected assets.** On the fork, test assets only, with no real value. Also protected:
  - integrity of the review-to-signature binding;
  - journal integrity;
  - evidence honesty;
  - the Alchemy credential during the recording;
  - repository supply chain.
- **Trust boundaries.**
  - browser ↔ server (same-origin Server Actions);
  - browser ↔ wallet (EIP-1193; the wallet is the authorization boundary);
  - server ↔ loopback fork;
  - fork ↔ recorded upstream;
  - recording proxy ↔ Alchemy (owner-run only);
  - reconciler ↔ chain data;
  - test harness ↔ app (test only).
- **Threats:**
  - a lying or inconsistent RPC;
  - a malicious or buggy wallet altering the payload;
  - a tampered server response;
  - a stale quote;
  - price movement or front-running;
  - excessive or leftover approvals;
  - duplicate submission after an unknown result;
  - journal loss or corruption;
  - replay on another chain;
  - confusing the fork with mainnet;
  - a credential leak during recording;
  - a compromised pinned binary or npm package;
  - dishonest labels;
  - prompt injection supplying a recipient.
- **Controls:**
  - pinned code and deployment checks;
  - hash-pinned, finalized recording;
  - chain 31337 plus the source-metadata guard;
  - exact payload profile and strict decoding;
  - the browser decode derived from bytes;
  - persist before request;
  - idempotent attempts;
  - reconcile before retry;
  - nonce scan;
  - signer and payload-fidelity verification;
  - exact approvals plus residual-allowance display and revocation;
  - on-chain minimum output and deadline;
  - no key and no broadcast in Gryloo;
  - the governance scans in §3.17;
  - CSP and the network guard;
  - pinned supply chain with SBOM and audit;
  - forensics.
- **Limitations** (in the report and UI):
  - `FORK_REPRODUCED` is not mainnet.
  - Anvil may differ from Base in OP-stack L1 fee accounting and in future forks.
  - The dev-account balance override is disclosed.
  - The state source is a single provider, and code pins are trust on first use.
  - Proxy implementations and source equivalence are not verified.
  - A malicious wallet can sign something else. Gryloo detects this after the fact (`DIVERGENT`) but cannot prevent it; the wallet is the Mode A boundary.
  - Application-gateway checks are not transaction-level enforcement.

## 9. Evidence target

- **Required environment.** `FORK_REPRODUCED` for the execution evidence. Integration proofs use the replayed fork. Pure logic is covered by unit tests.
- **Required outcome.** `RECONCILED` on the two happy paths and the recovery paths. `DIVERGENT` and `INCONCLUSIVE` are demonstrated on injected cases.
- **Reconciliation invariants.** Those in §3.12:
  - signed payload equals the reviewed payload;
  - signer equals the owner;
  - transaction hash equals keccak of the raw transaction;
  - input debited exactly;
  - output at or above the minimum and received by the owner;
  - allowance 0;
  - fees consistent;
  - no residue;
  - nonce consistent.
- **Wallet-surface labels, kept separate (Amendment 1).**
  - `FORK_REPRODUCED · AUTOMATED TEST WALLET`: the Playwright binding delegates signing to the fork node. No production wallet UI is involved.
  - `FORK_REPRODUCED · MANUAL INJECTED WALLET (<name> <version>)`: the owner-run G7 check.

  Each Evidence Bundle records its surface as an `EXTERNAL_REFERENCE` entry (`wallet-surface:automated-test-wallet` or `wallet-surface:manual-injected-wallet`) and in its limitations. The two surfaces are reported in separate tables. A Gate 3 claim names exactly the surfaces that passed. Completion requires the manual surface to have passed (§1.5).
- **Not claimed.** `TESTNET_EXECUTED` and `MAINNET_EXECUTED`. The BUILD-003C observation stays `NOT_EVIDENCE`. BUILD-003B stays `MOCKED`.
- **Retained evidence:**
  - the transcript and request-log digests;
  - the recording harness digest (uncommitted);
  - pins;
  - reproducibility results;
  - test and run logs;
  - visual before, after and diff images;
  - example Evidence Bundle and journal hashes from E2E;
  - remote CI run IDs, reported separately.

## 10. License impact

- **AGPL-3.0-only.** `packages/reference-{compiler,executor,reconciler}/**`, each with a LICENSE that is an official copy, and `apps/reference-dapp/**`, including the harness, transcript and snapshots.
- **Apache-2.0.** `workflow-contracts` changes and schemas, the new compatibility fixtures, ADRs, contract docs, both new scripts, governance files and records.
- **Transcript.** Contains on-chain data and public contract bytecode as returned by the provider. It is test data. No license is asserted over third-party bytecode.
- **New dependencies.** `@noble/hashes` and `@noble/curves` 2.4.0 (MIT). Foundry anvil v1.8.3 (MIT or Apache-2.0), a downloaded test tool that is not vendored or distributed.
- **Unchanged.** No license exception or official text changes. `THIRD_PARTY_NOTICES.md` is unchanged. `LICENSE_MAP` records the new AGPL paths and the anvil tool note.
- **Out of scope.** Publication and redistribution remain unapproved.

## 11. Expected files

The lists are closed: **113 created and 51 modified, 164 in total.** No other creation, deletion, rename or mode change is authorized. File names avoid tokens the governance path check rejects.

**Not committed:**

- the recording proxy, preflight and journals, which stay in the agent scratchpad and whose digests go in the report;
- the owner's manual-wallet session data; only its record and digests go in the report;
- the runtime journal directory, which is git-ignored.

### Create (113 paths)

```text
docs/builds/BUILD-003D-PLAN.md
docs/builds/BUILD-003D-REPORT.md
docs/adr/ADR-0003-mode-a-exact-payload-binding.md
docs/adr/ADR-0004-controlled-base-fork-environment.md
docs/contracts/ENFORCEMENT_MATRIX_V1.md
docs/contracts/MODE_A_EVM_PAYLOAD_V1.md
scripts/bootstrap-anvil.py
scripts/summarize-screenshot-diffs.py
packages/workflow-contracts/src/enforcement-matrix.ts
packages/workflow-contracts/schemas/v1/enforcement-matrix.schema.json
packages/workflow-contracts/test/enforcement-matrix.test.ts
tests/compatibility/v1/enforcement-matrix.json
tests/compatibility/v1/mode-a-payload-vectors.json
packages/reference-compiler/LICENSE
packages/reference-compiler/package.json
packages/reference-compiler/tsconfig.json
packages/reference-compiler/src/index.ts
packages/reference-compiler/src/profile.ts
packages/reference-compiler/src/abi.ts
packages/reference-compiler/src/rlp.ts
packages/reference-compiler/src/payload.ts
packages/reference-compiler/src/payload-digest.ts
packages/reference-compiler/src/fork-quote.ts
packages/reference-compiler/src/simulation.ts
packages/reference-compiler/src/policy.ts
packages/reference-compiler/src/manifest.ts
packages/reference-compiler/src/execution-plan.ts
packages/reference-compiler/src/enforcement.ts
packages/reference-compiler/src/review.ts
packages/reference-compiler/src/revocation.ts
packages/reference-compiler/test/abi.test.ts
packages/reference-compiler/test/rlp.test.ts
packages/reference-compiler/test/payload.test.ts
packages/reference-compiler/test/fork-quote.test.ts
packages/reference-compiler/test/simulation.test.ts
packages/reference-compiler/test/compile.test.ts
packages/reference-compiler/test/review.test.ts
packages/reference-compiler/test/compile.fork.test.ts
packages/reference-compiler/test/anvil-compatibility.fork.test.ts
packages/reference-executor/LICENSE
packages/reference-executor/package.json
packages/reference-executor/tsconfig.json
packages/reference-executor/src/index.ts
packages/reference-executor/src/journal.ts
packages/reference-executor/src/attempts.ts
packages/reference-executor/src/recovery.ts
packages/reference-executor/src/file-store.ts
packages/reference-executor/test/journal.test.ts
packages/reference-executor/test/attempts.test.ts
packages/reference-executor/test/recovery.test.ts
packages/reference-executor/test/file-store.test.ts
packages/reference-executor/test/restart.fork.test.ts
packages/reference-reconciler/LICENSE
packages/reference-reconciler/package.json
packages/reference-reconciler/tsconfig.json
packages/reference-reconciler/src/index.ts
packages/reference-reconciler/src/raw-transaction.ts
packages/reference-reconciler/src/reconcile.ts
packages/reference-reconciler/src/evidence.ts
packages/reference-reconciler/test/raw-transaction.test.ts
packages/reference-reconciler/test/reconcile.test.ts
packages/reference-reconciler/test/evidence.test.ts
packages/reference-reconciler/test/reconcile.fork.test.ts
apps/reference-dapp/src/server/fork-rpc.ts
apps/reference-dapp/src/server/fork-rpc.test.ts
apps/reference-dapp/src/server/mode-a-service.ts
apps/reference-dapp/src/server/mode-a-service.test.ts
apps/reference-dapp/src/app/mode-a-action.ts
apps/reference-dapp/src/wallet/eip1193.ts
apps/reference-dapp/src/wallet/eip1193.test.ts
apps/reference-dapp/src/domain/mode-a.ts
apps/reference-dapp/src/domain/mode-a.test.ts
apps/reference-dapp/src/state/mode-a-store.tsx
apps/reference-dapp/src/components/fork-simulation-panel.tsx
apps/reference-dapp/src/components/manifest-review.tsx
apps/reference-dapp/src/components/execution-panel.tsx
apps/reference-dapp/e2e/mode-a-fixtures.ts
apps/reference-dapp/e2e/mode-a-fork.spec.ts
apps/reference-dapp/e2e/mode-a-recovery.spec.ts
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts
apps/reference-dapp/e2e/fork/harness.mjs
apps/reference-dapp/e2e/fork/replay-upstream.mjs
apps/reference-dapp/e2e/fork/fork-setup.mjs
apps/reference-dapp/e2e/fork/base-fork-transcript.json
apps/reference-dapp/e2e/fork/verify-manual-wallet.mjs
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/manifest-review-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/execute-reconciled-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-result-unknown-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-recovered-after-restart-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-swap-reverted-residual-allowance-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-revocation-confirmed-chromium-linux.png
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts-snapshots/execute-divergent-wallet-payload-chromium-linux.png
apps/reference-dapp/e2e/visual-evidence/build-003d/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/review-blocked-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-current-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-current-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-invalidated-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-invalidated-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-expired-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-expired-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-recorded-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-recorded-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-expired-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-expired-diff.png
```

### Modify (51 paths)

```text
.github/workflows/contracts.yml
.github/workflows/governance.yml
.gitignore
README.md
package.json
pnpm-lock.yaml
scripts/bootstrap-ci.py
scripts/export-schemas.mjs
packages/workflow-contracts/package.json
packages/workflow-contracts/src/canonical.ts
packages/workflow-contracts/src/schemas.ts
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/test/canonical.test.ts
packages/workflow-contracts/test/contracts.test.ts
packages/action-registry/package.json
packages/reference-linter/package.json
apps/reference-dapp/package.json
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/simulate-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/domain/contracts.integration.test.ts
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/EVIDENCE_LEVELS.md
docs/LICENSE_MAP.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
```

**Constraints on the modified test files:**

- `mock-artifact-chain.spec.ts` and `base-observation.spec.ts` change only by the settled-viewport waits and any build-label assertion.
- `interface-honesty.spec.ts` changes only in the Execute and label assertions.
- `fixtures.ts`, `network-isolation.spec.ts`, `visual-shell.spec.ts`, `swap-authoring.spec.ts` and `build-roundtrip.spec.ts` are unchanged.

### Do not touch (201 paths)

Every path tracked at `8a5fbaed26e005e5719528c399f7ca1adb334eb6` that is not in Modify is protected byte-for-byte and mode-for-mode. The list includes:

- the Master Spec and Master Prompt;
- ADR-0001 and ADR-0002;
- every BUILD-000 through BUILD-003C plan and report;
- the three v1 contract documents;
- all v1 schemas and compatibility fixtures;
- the BUILD-003B mocked modules and the BUILD-003C observation modules and replay fixture;
- `fixtures.ts`;
- the lockfile's existing resolutions, which may only be extended;
- the headless-shell bootstrap;
- `next-env.d.ts`.

```text
.node-version
.npmrc
LICENSE
LICENSES/AGPL-3.0-only.txt
LICENSES/Apache-2.0.txt
NOTICE
THIRD_PARTY_NOTICES.md
TRADEMARKS.md
apps/reference-dapp/LICENSE
apps/reference-dapp/e2e/build-roundtrip.spec.ts
apps/reference-dapp/e2e/fixtures.ts
apps/reference-dapp/e2e/network-isolation.spec.ts
apps/reference-dapp/e2e/observations/base-recorded-observations.json
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/visual-evidence/build-003a/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/review-blocked-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/review-blocked-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-current-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-current-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-expired-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-expired-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-invalidated-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-invalidated-diff.png
apps/reference-dapp/e2e/visual-shell.spec.ts
apps/reference-dapp/next-env.d.ts
apps/reference-dapp/next.config.ts
apps/reference-dapp/src/app/observation-action.ts
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/observation-panel.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/status-badge.tsx
apps/reference-dapp/src/domain/artifact-chain.test.ts
apps/reference-dapp/src/domain/artifact-chain.ts
apps/reference-dapp/src/domain/base-observation.test.ts
apps/reference-dapp/src/domain/base-observation.ts
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/initial-workflow.ts
apps/reference-dapp/src/domain/mock-actions.ts
apps/reference-dapp/src/domain/mock-artifacts.test.ts
apps/reference-dapp/src/domain/mock-artifacts.ts
apps/reference-dapp/src/domain/proposal.test.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/domain/swap-authoring.test.ts
apps/reference-dapp/src/domain/swap-authoring.ts
apps/reference-dapp/src/server/base-rpc.test.ts
apps/reference-dapp/src/server/base-rpc.ts
apps/reference-dapp/src/state/workflow-store.tsx
apps/reference-dapp/tsconfig.json
docs/adr/ADR-0001-mode-b-authority.md
docs/adr/ADR-0002-canonical-contracts.md
docs/assets/1.jpeg
docs/assets/2.jpeg
docs/assets/3.jpeg
docs/builds/BUILD-000-LICENSING-AMENDMENT.md
docs/builds/BUILD-000-PLAN.md
docs/builds/BUILD-000-REPORT.md
docs/builds/BUILD-001-PLAN.md
docs/builds/BUILD-001-REPORT.md
docs/builds/BUILD-002-GOVERNANCE-AMENDMENT.md
docs/builds/BUILD-002-PLAN.md
docs/builds/BUILD-002-REPORT.md
docs/builds/BUILD-003A-PLAN.md
docs/builds/BUILD-003A-REPORT.md
docs/builds/BUILD-003B-PLAN.md
docs/builds/BUILD-003B-REPORT.md
docs/builds/BUILD-003C-PLAN.md
docs/builds/BUILD-003C-REPORT.md
docs/contracts/CANONICALIZATION_V1.md
docs/contracts/COMPATIBILITY_V1.md
docs/contracts/INVALIDATION_V1.md
docs/specs/MASTER_SPEC_V3.2.md
eslint.config.mjs
packages/action-registry/LICENSE
packages/action-registry/schemas/v1/action-registry.schema.json
packages/action-registry/src/actions.ts
packages/action-registry/src/base-assets.ts
packages/action-registry/src/capabilities.ts
packages/action-registry/src/index.ts
packages/action-registry/src/reference-registry.ts
packages/action-registry/src/schemas.ts
packages/action-registry/test/reference-registry.test.ts
packages/action-registry/test/registry.test.ts
packages/action-registry/tsconfig.json
packages/reference-linter/LICENSE
packages/reference-linter/src/artifact-digest.ts
packages/reference-linter/src/base-observation.ts
packages/reference-linter/src/context.ts
packages/reference-linter/src/index.ts
packages/reference-linter/src/mocked-chain.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/test/artifact-digest.test.ts
packages/reference-linter/test/base-observation.test.ts
packages/reference-linter/test/linter.test.ts
packages/reference-linter/test/mocked-chain.test.ts
packages/reference-linter/test/validation.test.ts
packages/reference-linter/tsconfig.json
packages/workflow-contracts/LICENSE
packages/workflow-contracts/schemas/v1/artifact-set.schema.json
packages/workflow-contracts/schemas/v1/authorization-policy.schema.json
packages/workflow-contracts/schemas/v1/evidence-bundle.schema.json
packages/workflow-contracts/schemas/v1/execution-journal.schema.json
packages/workflow-contracts/schemas/v1/execution-plan.schema.json
packages/workflow-contracts/schemas/v1/quote-state-artifact.schema.json
packages/workflow-contracts/schemas/v1/semantic-workflow.schema.json
packages/workflow-contracts/schemas/v1/simulation-bundle.schema.json
packages/workflow-contracts/schemas/v1/strategy-manifest.schema.json
packages/workflow-contracts/src/artifact-set.ts
packages/workflow-contracts/src/authorization-policy.ts
packages/workflow-contracts/src/common.ts
packages/workflow-contracts/src/evidence-bundle.ts
packages/workflow-contracts/src/execution-journal.ts
packages/workflow-contracts/src/execution-plan.ts
packages/workflow-contracts/src/invalidation.ts
packages/workflow-contracts/src/quote-state.ts
packages/workflow-contracts/src/raw-json.ts
packages/workflow-contracts/src/revision.ts
packages/workflow-contracts/src/semantic-workflow.ts
packages/workflow-contracts/src/simulation.ts
packages/workflow-contracts/src/state-transitions.ts
packages/workflow-contracts/src/strategy-manifest.ts
packages/workflow-contracts/test/invalidation.test.ts
packages/workflow-contracts/test/raw-json.test.ts
packages/workflow-contracts/test/revision-state.test.ts
packages/workflow-contracts/tsconfig.json
patches/@streamparser__json@0.0.26.patch
patches/@xyflow__system@0.0.82.patch
pnpm-workspace.yaml
prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md
scripts/bootstrap-playwright.py
tests/compatibility/v1/action-registry.json
tests/compatibility/v1/artifact-set.json
tests/compatibility/v1/authorization-policy.json
tests/compatibility/v1/evidence-bundle.json
tests/compatibility/v1/execution-journal.json
tests/compatibility/v1/execution-plan.json
tests/compatibility/v1/hash-vectors.json
tests/compatibility/v1/invalidation-cases.json
tests/compatibility/v1/raw-json/invalid-duplicate-nested.json.txt
tests/compatibility/v1/raw-json/invalid-duplicate-root.json.txt
tests/compatibility/v1/raw-json/invalid-escaped-equivalent-key.json.txt
tests/compatibility/v1/raw-json/invalid-trailing-document.json.txt
tests/compatibility/v1/raw-json/invalid-utf8.hex
tests/compatibility/v1/raw-json/valid-distinct-nested-keys.json
tests/compatibility/v1/raw-json/valid-escaped-string-value.json
tests/compatibility/v1/revision-conflicts.json
tests/compatibility/v1/semantic-workflow.json
tests/compatibility/v1/simulation-bundle.json
tests/compatibility/v1/state-transitions.json
tests/compatibility/v1/strategy-manifest.json
third_party/licenses/caniuse-lite-1.0.30001810-LICENSE
third_party/licenses/img-sharp-libvips-darwin-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-darwin-x64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-arm-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-ppc64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-riscv64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-s390x-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-x64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linuxmusl-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linuxmusl-x64-1.3.3-README.md
third_party/licenses/img-sharp-wasm32-0.35.4-LICENSE
third_party/licenses/img-sharp-wasm32-0.35.4-README.md
third_party/licenses/img-sharp-win32-0.35.4-LICENSE
third_party/licenses/img-sharp-win32-arm64-0.35.4-README.md
third_party/licenses/img-sharp-win32-ia32-0.35.4-README.md
third_party/licenses/img-sharp-win32-x64-0.35.4-README.md
third_party/licenses/streamparser-json-MIT.txt
third_party/licenses/tslib-2.8.1-CopyrightNotice.txt
third_party/licenses/tslib-2.8.1-LICENSE.txt
third_party/licenses/xyflow-system-MIT.txt
tsconfig.base.json
turbo.json
```

## 12. Risks and rollback

- **Anvil compatibility gap.** G1 fails on a required method or behavior. The build stops before any credentialed request, and the owner decides D-14, D-5 or D-3. There is no silent substitute.
- **Real wallet cannot complete the manual check,** or it re-prices or re-nonces the transaction. The outcome is recorded as `LIMITED`: the claim is limited to the automated test wallet, the PR may still be delivered, and BUILD-003 stays `IN_PROGRESS` until a G7 run passes (§1.5, §3.9.1). The recording is not widened for wallet queries.
- **Premature completion claims.** P1–P14 are conditional criteria. The certification decision follows owner acceptance, and governance rejects completion wording before then.
- **Billing.** The agent cannot see the Alchemy billing state. The session requires the owner's recorded no-paid-billing confirmation, and HTTP 402 or any sign of a charge stops it.
- **Recording stops or is insufficient.** The build pauses at G5 for the owner. Attempts 2 and 3 exist only for a complete re-record. The caps are never reset.
- **Later code touches unrecorded state.** `FORK_STATE_UNRECORDED` fails closed. Mitigation: the scenario driver is complete before P4, and it is re-recorded within the caps.
- **Anvil differs from Base.** Examples are OP-stack L1 fees and deposit types. This is disclosed. Reconciliation compares observed ETH deltas exactly and reports `FEE_MISMATCH` rather than assuming.
- **EIP-7702 or other code on dev accounts.** Clean-index selection is used. If none is clean, stop for a decision.
- **Scope size.** Six gated phases, stop rules, and D-19 commits by conceptual unit.
- **Real wallets that re-price gas.** They yield `DIVERGENT` by design (strict Mode A). Automated evidence uses the test wallet. D-9 records this.
- **Supply chain.** Exact pins, release age, SRI, audit, SBOM, a publisher-and-local digest for anvil, and no postinstall scripts.
- **Flake hypothesis wrong.** Forensics output and no tolerance change. Stop and report.
- **Contract debt created (C-9 to C-12).**
  - C-9: v1 Manifest and policy lack payload and recipient fields, which are bound only through the matrix and plan.
  - C-10: v1 journal entries carry no transaction facts, which sit in hash-chained attempt facts.
  - C-11: v1 evidence quantities lack account and before/after fields.
  - C-12: no environment field on Quote/State or simulation, so C-1 persists.

  A v2 contract plan is recommended before Mode B.
- **Rollback.** A reviewed revert of the PR restores code, contracts, records and images together. Fork state is local and disposable. No real funds exist. The recording transcript is test data.

## 13. Questions requiring human decision

Recommended choices are marked **(R)**. Approving the plan "as recommended" selects every **(R)** option.

| ID | Decision | Options |
|---|---|---|
| D-1 | Increment structure | **A — direction approved by the owner on 2026-09-24:** one BUILD-003D completes the fork slice with internal gates, now including G1 and G7 (Amendment 1). Implementation approval is still pending. B: split into two builds (not chosen) |
| D-2 | Build 003 certification environment | **A — direction approved on 2026-09-24:** `FORK_REPRODUCED`, with no automatic BUILD-003E. P12 is `NOT_PERFORMED`. **Amended:** P1–P14 are conditional acceptance criteria. Completion and BUILD-004 planning eligibility follow only the §1.5 completion rule and the owner's certification decision. **Amendment 2:** completion requires G7 `PASS`. A `LIMITED` G7 keeps BUILD-003 `IN_PROGRESS` and never satisfies Master Spec Gate 3. B: a separately requested BUILD-003E (not planned) |
| D-3 | Fork toolchain | **A (R), amended:** Foundry anvil v1.8.3 pinned binary (§3.2.1), **conditional on G1** checks C1–C6 and C8–C10. A failure returns for a new D-3 decision. B (Hardhat EDR) and C (a JS EVM) are not fallbacks without that decision |
| D-4 | Fork chain identity | **A (R):** local chain ID 31337, forked from `eip155:8453`; execution artifacts on `eip155:31337` with a bound source descriptor. B: keep 8453 (replayable signatures, wallet confusion) |
| D-5 | New live-read budget and credential boundary | **A (R), amended by Amendment 3:** one owner-run Alchemy Free session, Base Mainnet only, with the Bearer credential held only by the scratchpad proxy. Finalized block; hash-pinned `requireCanonical` reads; **3 attempts and 1,800 requests (at most 900 per attempt)**; 400 ms spacing; stop rules; no fallback; no charge. **Added:** the provider upstream allowlist stays unchanged; Amendment 3 permits only the exact local proxy replies and canonical H rewrite described above, with C4 proving both sides offline. The session requires G1 and the owner's recorded no-paid-billing confirmation (§3.3.2). HTTP 402 stops the session. B: another provider (needs its own terms). C: no live read, which blocks the build |
| D-6 | Contract strategy | **A (R):** `workflow-contracts` 0.2.0 with the additive `enforcement-matrix` kind and the EVM payload profile; v1 byte-identical. B: v2 policy, Manifest, plan, journal and evidence now (larger; redesign risk) |
| D-7 | Router and approval | **A (R):** SwapRouter02 `multicall(deadline, [exactInputSingle])` plus exact `approve`, two authorizations. B: UniversalRouter plus Permit2 |
| D-8 | Fee-tier selection | **A (R):** the user selects a `QUOTED` tier; no ranking. B: a disclosed deterministic rule (highest proven output) |
| D-9 | Wallet surface and fidelity rule | **A (R), amended:** injected EIP-1193 only, no library. Strict fidelity: any wallet change to any payload field, including gas, is `DIVERGENT`. Automated evidence uses the Playwright test wallet and is labelled separately. **Added:** an owner-run manual acceptance with a real injected wallet and a recorded dev account on 31337 only (G7, §3.9.1). **Amendment 2:** any outcome short of both transactions `EXACT` with `RECONCILED` evidence is `LIMITED`. The claim is then limited to the automated test wallet, the PR may still be delivered, and BUILD-003 stays `IN_PROGRESS`. `LIMITED` never satisfies Gate 3 for completion. B: tolerate wallet gas re-pricing within budget (not recommended) |
| D-10 | Accounts and funding | **A (R), amended:** anvil built-in dev accounts, clean indices; ETH only from the local `--balance`; WETH by `deposit`; USDC by a labeled setup swap. **Added:** 20 empty local blocks mined after setup (count pinned) for manual-wallet queries. B: storage overrides for token balances |
| D-11 | Code placement | **A (R):** three AGPL packages `reference-compiler`, `reference-executor`, `reference-reconciler`. B: one package. C: inside the app and linter (weaker boundaries) |
| D-12 | Crypto dependencies | **A (R):** `@noble/hashes` and `@noble/curves` 2.4.0 with hand-written RLP and ABI. B: `viem` |
| D-13 | Persistence and restart | **A (R):** local append-only files with fsync; server restart equals worker restart; the E2E harness restarts the server. B: PostgreSQL and a worker app now |
| D-14 | Simulation method | **A (R), amended; conditional on G1 check C7:** `eth_simulateV1` with `validation: true` and no overrides. **If C7 fails, the build stops and returns for a new D-14 decision.** Snapshot with impersonation and revert (formerly option B) is no longer a pre-approved alternative. It may be chosen only by that new decision |
| D-15 | Recovery scope | **A (R):** include the residual-allowance revocation execution. B: display the residual allowance with manual instructions only |
| D-16 | Time source and windows | **A (R):** fork chain time for artifacts; quote validity 60 s; deadline `Tb + 180` s; 12 s margin; 300 s signature window; gas limit ×5/4; priority fee 1,000,000 wei; 2 attempts per step |
| D-17 | Build label | **A (R):** `BUILD-003D` on all snapshots with before/after evidence. B: make the label build-neutral once to end the churn |
| D-18 | Flake fix | **A (R):** §3.16 convergent viewport, settled assertion and CI forensics |
| D-19 | Commits and delivery | **A (R), amended:** after G0–G6 and G8 pass, and G7 is either `PASS` or recorded as `LIMITED`: four commits in one PR, one per conceptual unit: (1) "Make Simulate canvas viewport deterministic and add diff forensics"; (2) "Add Mode A enforcement matrix contract and EVM payload profile"; (3) "Implement Build 003D Mode A fork execution, recovery and evidence"; (4) "Record Build 003C delivery and Build 003D governance". The owner pushes (the agent shell cannot use SSH) unless the owner authorizes agent push; the agent opens the PR with `gh`; merge stays with the owner. The report and the PR description state any `LIMITED` G7 result. B: one commit |
| D-20 | Records | **A (R), amended:** DEC-0023 to DEC-0025 and the §2.1 IDs, now including B003D-TOOLCHAIN-001, B003D-WALLET-002 and B003D-CERTIFICATION-001. The certification decision is registered later, with the next sequential number, in the first records change after acceptance. This build does not register it. That decision also cites the G7 `PASS` evidence, including a later G7 run where one was needed |

### Amendment 1 record

- **Owner direction approval, 2026-09-24:** a single BUILD-003D targeting `FORK_REPRODUCED`, with no automatic BUILD-003E.
- **Requested gates:**
  - offline anvil compatibility before any credentialed request (§3.2.6, G1);
  - manual injected-wallet acceptance, with separate labels and a limited claim if the check is incomplete (§3.9.1, G7);
  - P1–P14 as conditional acceptance criteria, and a no-paid-billing verification before the owner-run session (§1.5, §3.3.2).
- **Choices changed:** D-1, D-2, D-3, D-5, D-9, D-10, D-14 and D-20. All others are unchanged.
- **Still not approved:** implementation, the new Alchemy recording budget and any RPC request.

### Approval record

- **Owner approval, 2026-09-24:** implementation of this plan with Amendments 1 and 2 and the recommended D-1 to D-20 choices.
- **Conditions:**
  - Follow G0 to G8.
  - Run the pinned anvil compatibility gate before any credentialed request.
  - Authorize the Alchemy session only within the D-5 caps, after the offline preflight and the owner's no-paid-billing confirmation. The owner runs the recording command.
  - A G7 `LIMITED` result may allow PR delivery with the limitation clearly recorded, but BUILD-003 remains `IN_PROGRESS`.
  - Certifying BUILD-003 and planning BUILD-004 require G7 `PASS`, every other completion criterion, passing CI and the owner's separate acceptance of the final report.
- **Not authorized:** execution on Base Mainnet, starting BUILD-004 and merging the PR.
- **Stop rule:** stop at any gate that requires a new decision and present the evidence.

### Amendment 2 record

- **Owner correction, 2026-09-24:** G7 does not block delivery of the BUILD-003D PR. It is required for certifying BUILD-003 as complete and eligible for BUILD-004 planning.
- **LIMITED outcome:** if the manually operated injected wallet cannot complete both transactions with exact payload fidelity and `RECONCILED` evidence, the result is recorded as `LIMITED`. The PR is delivered with that limitation if the other gates pass, and BUILD-003 stays `IN_PROGRESS`.
- **Gate 3:** `LIMITED` never satisfies Master Spec Gate 3 for completion.
- **Choices changed:** D-2, D-9, D-19 and D-20.

**Not requested and not approved by this plan:**

- mainnet execution;
- BUILD-003E;
- Mode B, Mode C or BUILD-004 work;
- publication;
- any live request before G1 and G4 pass and the owner runs the command;
- any other build.

### Amendment 3 record

- **Owner approval, 2026-09-24 (DEC-0023):** only the exact local D-5 proxy responses and H-to-canonical-object rewrite stated above. Provider methods, caps, pacing, stop rules, Anvil command and simulation method remain unchanged.
- **Recovery condition:** local `null` alone cannot establish `NOT_FOUND` or authorize retry; broadcast-before-unknown-result must reconcile without duplication.
- **Offline gate:** G1 C4 covers both proxy sides and negative forms. An additional method or form stops for a new decision. No live RPC or owner-only recording was requested or run for this amendment.

### Amendment 4 record

- **Owner approval, 2026-09-24 (DEC-0023):** add `packages/workflow-contracts/test/contracts.test.ts` to Modify solely for its existing `0.1.0` to `0.2.0` package-version assertion. Scope is 113 created, 51 modified, 164 total, 201 protected. No other change to that test is authorized.

### G2 local verification record (2026-09-24)

G2 `PASS` for the additive contract gate only. The nine existing `schemas/v1` files, twenty existing `tests/compatibility/v1` files and twenty-one `third_party/licenses` files were byte-identical to `HEAD`; all current changed paths were within the amended §11 lists. The new schema and two synthetic files have the SHA-256 digests pinned in `ENFORCEMENT_MATRIX_V1.md` and the 79-test contract suite. `pnpm schemas:check` verified 11 exports. The independent offline vector check decoded both EIP-1559 preimages, recomputed payload and signing hashes, and checked canonical ABI contents and links. Pinned `pnpm typecheck` and `pnpm lint` passed. The exact dependency verifier reviewed 247 registry identities, matching integrity and release age, with the unchanged 16 license exceptions; its evidence SHA-256 was `cf3c4a591d084028a53b34c76b70a3f7fee8565ac338a7e511d2e802c799bb75`. The three new package LICENSE files matched `LICENSES/AGPL-3.0-only.txt` byte-for-byte. DEC-0024 records ADR-0003 acceptance. G2 does not assert P1–P14 certification, G7, recording, or any later gate.

### G3 local verification record (2026-09-24)

G3 `PASS` for the P3 **pure-package gate** only. The compiler uses injected, scripted transports for fixed-order, hash-bound fork quote reads and two-pass exact simulation; it tests deterministic policy, Manifest, plan and matrix links, material-change invalidation, strict RLP/ABI decoding, independent Keccak selector/topic derivation, review blockers and separate zero-allowance revocation. The executor tests every allowed and forbidden frozen workflow, segment, step and attempt transition, concurrent idempotent prepare, persisted `SUBMITTING` before any scripted request, unknown-result recovery and the file/then-directory fsync order. The reconciler tests signed-byte fidelity, nonce and fee invariants, independent scripted chain reads, divergent and inconclusive perturbations, and Evidence Bundle supersession and green-outcome guards. No live RPC, wallet operation, operational signing, broadcast, recording or credential was used for this gate.

Pinned Node 24.21.0 and pnpm 11.22.0: targeted pure-package tests 60/60 in 14 files (log SHA-256 `d047208619424130df63cd1a46e732bdb9d0f1f93737590afb46696b3ec6dd75`); complete offline unit suite 313/313 in 38 files (`5be0c0d2d4229227e02f6f78c9c67159f6690661c33da9510ba7f70f60595b73`); typecheck 11/11 tasks (`0361531b6a306080475ae1a54698726925147986d5fedf94b5d7c74e63eb63df`); build 7/7 tasks (`9322a2263acb939d5ce85ffc7771abfb528ad8507ba6baaf4c3880c300e44f18`); lint pass (`d8201492c3fd8d96c54af312cb5435bb0930520ecec23474e61c8f5486220f12`); contracts 79/79 in 6 files (`04078564adfd9c6789f2527af267883414737082471904e7055c5906a147dd2b`); and 11 schema exports (`ff3647d12a3766c6a8712faeadc2a5f02b12b6ef96a55daff235e609eaf41563`). `git diff --check` passed. Logs are credential-free under `/tmp/gryloo-build-003d-g3-checks/` and are not committed.

Both currently tracked governance programs were run read-only and remain **pending implementation update at G8**: they still enforce BUILD-003C as the current scope, the pre-addition v1 directory counts and the old package/document set. Their failures are expected for this approved partial BUILD-003D tree; they are not counted as a G3 pass. The final pre-G4 exact-path check passed with 61 created and 22 modified paths, no deletion or out-of-list path. All nine pre-existing v1 schemas, twenty compatibility files and twenty-one third-party license files remained byte-identical to HEAD, and the resolved lock-section digest remained `9e0aaf059085b4d0ac9c367c049eb4ff7d460bf83fd0c09c8530153e6661f749`.

G3 does not establish a real fork quote, execution, Evidence Bundle, browser behavior, production-wallet behavior, recording, or P1–P14 certification. The next phase is G4 and is outside this G3 continuation. The owner must provide the §3.3.2 no-paid-billing confirmation before its preflight can emit an owner-run recording command.

### G4 offline preparation record (2026-09-24; historical partial state)

The owner explicitly authorized G4 offline preparation only and reported the Alchemy dashboard values on 2026-09-24: Free plan; no payment method, paid add-on, Pay As You Go, overage, auto-scale or automatic upgrade; Gryloo app on Base Mainnet over HTTP; All Apps usage **968 / 30,000,000 CUs**, peak throughput **16.3 / 300 CU/s**, gas sponsorship **$0**. The planned maximum is **46,800 CUs**; projected usage is **47,768 CUs**, leaving **29,952,232 CUs**. These are owner-reported facts, not independently verified by the agent. No credential was shared.

The uncommitted `/tmp/gryloo-build-003d-g4/` scratchpad contains the credential-isolated proxy and a key-unset scripted preflight. The final preflight reported **21 checks passed**, zero live provider requests and no credential. Its journal at `session-final-verified/journal.json` records the billing confirmation and remains `READY` with zero attempts and zero requests. SHA-256: preflight script `24fa18e519772e49fda44693b8ed7ded2534743528bd707c34eb230a43a56929`; proxy `1eee3c984ec9df1bcefa73c0484b7c924ceae47ff86d2ef30124a69fa4f46404`; journal `4b579e36834bd6aacb0a6cd577ea1e76ca8e36f158dfda617d0966c7d4959baf`; preflight result `4b33768f4629ff1f4b40e6adf7fa875bc9f8360eb75a8af6fca5c63bc30dccb4`. The preserved G1 C1–C10 digest still matches, and a fresh synthetic-only `pnpm test:anvil` passed **13/13** with all C1–C10 true; result SHA-256 `cefb5da97e13a2c0c19699dc127fd488861b6a70340e4e6fe4bba08fe5fa2527`.

The approved-path ADR-0004, exact Anvil harness, closed replay upstream and fixture/scenario driver are present. A separate synthetic replay check passed **9/9** with zero live requests. The full driver has not been proven on recorded Base state. Automatic approval review rejected preparation of an owner-recording entrypoint as G5 work beyond this turn's G4-only authorization; no entrypoint was created or run. Therefore **G4 remains PARTIAL**, no owner command is emitted, and G5–G8 remain `NOT_RUN`. The old persistent governance programs still require the approved G8 update; their failure on this partial tree is not counted as a G4 pass.

Final offline verification after the G4 edits: the complete unit suite passed 313/313 in 38 files; typecheck 11/11 tasks, build 7/7 tasks, lint, contracts 79/79 in six files, and 11 schema exports passed. The exact current tree contains 65 created and 22 modified approved paths, zero deletions, renames, mode changes or out-of-list paths. The nine existing v1 schemas, twenty existing compatibility files and twenty-one third-party license files remain byte-identical to HEAD; `git diff --check` passed. Both existing persistent governance programs were run read-only and still reject the partial tree under BUILD-003C rules, pending G8.

### G4 completion and limited G5 preparation record (2026-09-24)

After the historical G4-only record above, the owner explicitly authorized limited G5 preparation. This resolved the earlier automatic approval rejection of entrypoint preparation, without authorizing an agent live RPC request, wallet operation, recording, G6 work, commit, push or PR. G4 is now `PASS` offline: G1 C1–C10 remains passed; the owner-reported Alchemy Free billing confirmation is recorded; and the credential-unset synthetic preflight proves the budget and stop rules. The reported All Apps baseline is **968 / 30,000,000 CUs**. The bounded additional maximum is **46,800 CUs**, projected cumulative **47,768 CUs**, leaving **29,952,232 CUs**. The owner reported no payment method, paid add-on, Pay As You Go, overage, auto-scale or automatic upgrade; the Gryloo app has only Base Mainnet over HTTP. Peak throughput was 16.3 / 300 CU/s and gas sponsorship usage $0. The agent did not independently access the dashboard or a credential.

The owner-only, uncommitted scratchpad `/tmp/gryloo-build-003d-g5-prep/` contains the single-use command, mode-0600 proxy, fixed 49-file manifest, read-only/claim gate, nine-scenario harness, transcript finalizer, synthetic preflight and a credential-free private continuation journal. The journal remains `READY` with **zero attempts, zero provider requests and zero reserved CUs**. The proxy fsyncs the attempt and every 26-CU request reservation before send, permits only the fixed Base Mainnet host and exact approved methods/forms, serializes requests with 400 ms pacing, and stops at 3 attempts, 900 requests per attempt, 1,800 total requests, 46,800 additional CUs or 47,768 cumulative CUs at the recorded baseline. The prepared command is single-use and refuses every rerun after success, failure, interruption or budget exhaustion. Attempts 2 and 3 in the plan require a separate owner decision and fresh preparation.

The G5 preparation preflight passed **37/37** with 27 synthetic provider calls and zero live calls; saved replay passed **3/3**; local Anvil hash-parameter acceptance passed; and an isolated gate claim test accepted once and rejected a rerun. The actual gate passed read-only, without claiming the prepared session. Pinned Node 24.21.0 and pnpm 11.22.0 validation passed: complete unit suite **313/313** in 38 files, typecheck **11/11** tasks, build **7/7** tasks, lint, contracts **79/79** in six files, schema exports **11**, and pinned Anvil compatibility **13/13** with all C1–C10 true. The preserved G2 247-identity dependency evidence SHA-256 is `cf3c4a591d084028a53b34c76b70a3f7fee8565ac338a7e511d2e802c799bb75`; the networked verifier was not rerun.

SHA-256: private journal `4dc736c777463935b980c989a9781db4470bd983965f33e5f1b343dc129b4b28`; preflight result `a0277a57f04e9aa6087c8e83ac6faad14af1572511c3cacc8be3fdf442354794`; owner entrypoint manifest `9013ae9df611c639a931f5f416ad658fc5ef6cd45912f98433c378e94041c6ef`. Exact-scope and frozen-file checks pass for the current partial tree; the tracked persistent governance programs still enforce BUILD-003C and await the approved G8 update. **G5 recording and G6–G8 are `NOT_RUN`**. A true recorded Base-state run and byte-identical replay are still required for G5 completion. The agent did not execute the owner command.

Credential-free final validation log SHA-256 values under `/tmp/gryloo-build-003d-g5-prep/`: complete unit suite `0363119bc9c5d7ae7f72c26f0fea03fab04d61d393d4998fc908bbc7d989c56c`; typecheck `dc7ffb611c95ff2003b7da695b3daa77ed53dbee17ecacdca99efb7176575193`; build `202b50afac390d1d938a77941b8487f7b4b6b95d294ea089bcfc22c72662b606`; lint `d8201492c3fd8d96c54af312cb5435bb0930520ecec23474e61c8f5486220f12`; contracts `ccc882d279036c8c59183c3d28ff17c9e5a8d7600b7032d24132f5ed58028c0e`; schemas `ff3647d12a3766c6a8712faeadc2a5f02b12b6ef96a55daff235e609eaf41563`; Anvil `0f4cd28ec8d47e3e78b9fe7337df47b19bbc1d988c8db96cfc8d5b3d76d9431d`. The two read-only persistent governance logs have SHA-256 `33c9939a2b20e857c3d2de5ccdd49d0eb6464d834bbc2cce801ebcb5f7ef63af` and `1114eaab0aa3aedb310af628033350846e2b11de0b22a2d9bcbc38bc202f493d`; both exit 1 because they still enforce BUILD-003C. The separate amended §11 exact-scope check passes **65/113 created, 22/51 modified**, zero deletions or out-of-list paths; all 9 prior v1 schemas, 20 compatibility files and 21 third-party license files remain byte-identical; `git diff --check` passes.

### G5 owner-run incident and offline repair record (2026-09-24)

**Owner run.** The owner ran `bash /tmp/gryloo-build-003d-g5-prep/owner-run.sh 9013ae9df611c639a931f5f416ad658fc5ef6cd45912f98433c378e94041c6ef` exactly once. It printed `G5 owner run claimed once` and then failed with `ANVIL_EXITED: Error: failed to create genesis … failed to get account for 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 … tcp connect error: Connection refused (os error 111)` at `harness.mjs:42` (`startFork`, `withFork`, `owner-harness.mjs:24`). The owner did not rerun it.

An obsolete BUILD-003C command had been entered first, as the owner reported. Its read-only Python preflight failed at its first digest assertion (`continuation/session.json digest changed`), so the `&&`-chained Node process never started. The evidence agrees:

- no file under the BUILD-003C recording directory changed after 15:51:41 WEST;
- its continuation session and request log still match the final digests in the BUILD-003C report (`dcf97126…`, `82fbbc20…`).

**Preserved evidence.** Every file under `/tmp/gryloo-build-003d-g5-prep/` was hashed before investigation (digest list SHA-256 `fdedadb5aea78bfd194aabfd9c4241ecde486d55c21e4529cc8689073d24f4a5` is recorded in the report). All of them were unchanged afterwards. All 49 manifest-pinned files matched the manifest at investigation start. Credential-shaped scans (Bearer markers, authorization text, key-length tokens, keyed Alchemy paths) found nothing in any evidence file.

- The claim marker `session-validated/started` was written at 2026-09-24T20:29:31.975Z.
- The journal `session-validated/journal.json` changed from the `READY` digest `4dc736c7…` to SHA-256 `ee7a3adaa8b10ec2996dad93ea520f49ebc2bb9e4eb79d06e69e37a05d74e220`. It records attempt 1 `STOPPED`, 2 provider requests, 52 reserved listed CU and stop reason `UNAPPROVED_UPSTREAM`. Its final write was at 20:29:33.899Z.
- The request log `session-validated/requests.jsonl` (SHA-256 `221da8290b4cefc271ac31383e6b0418991bd787a02e0bae9dadcaaa0d832ecc`) has two provider exchanges:
  - the harness `eth_getBlockByNumber ["finalized", false]`;
  - Anvil's `eth_getBlockByNumber ["0x3159231", false]`.

  Both returned Base block 51,745,329, hash `0x364b9e8c55ac3f79224b33083206ab986edbe4c2cf9e9bb99cfc17c3d49a2a20`, time 2026-09-24T20:00:05Z, with 483 transactions (response SHA-256 `63698fe9…` and `d8cea670…`).
- There is no scenario result and no transcript. The finalizer never ran.

**Provider requests.** Exactly two requests reached Alchemy, and both returned HTTP 200 with a matching JSON-RPC result. The evidence for this:

- The proxy writes a log line only after HTTP 200 and a valid result. It fsyncs each counter increment before sending.
- The journal counter (2) equals the number of log lines (2).
- The only provider transport is TLS to the fixed Alchemy host.

The third request was rejected before any reservation. The reserved total is 52 of 46,800 listed CU. The cumulative bound against the recorded 968 baseline is therefore 1,020. The actual dashboard figure can be observed only by the owner.

**Exact root cause.** The sequence was:

1. Pinned Anvil v1.8.3 omits the JSON-RPC `params` member for zero-argument calls. Its second upstream request, and the proxy's third, was `{"method":"eth_gasPrice","id":1,"jsonrpc":"2.0"}`.
2. `routeForkUpstreamRequest` required a `params` array and returned `stop`.
3. The proxy fsynced `STOPPED`/`UNAPPROVED_UPSTREAM`, answered HTTP 503 and called `server.close()`, which removed its own 8546 listener.
4. Anvil treats the remote gas price as optional and went on to genesis. Its first dev-account read found nothing listening, and startup failed with "connection refused".

The upstream was ready when Anvil started: it served Anvil's block-N read. It was not listening afterwards only because the fail-closed stop closed it.

G1 did not see the problem: its synthetic upstream normalized `params ?? []` before routing and logging, so the gate recorded `eth_gasPrice []`. The 37/37 preparation preflight did not see it either. It called the session handler directly, one call at a time, always with `params`, and never used Anvil or the HTTP layer. The Anvil-to-proxy wire seam was never exercised before the owner run.

**Byte-identical reproduction.** The following ran inside a loopback-only network namespace:

- the preserved, unmodified proxy class and repository harness;
- a synthetic provider replaying the two saved responses;
- the pinned Anvil.

It reproduced the run exactly:

- journal and request log byte-identical (`ee7a3ada…`, `221da829…`);
- the same Anvil error text and stack;
- 2 provider calls;
- the proxy exiting by itself, with 8546 refusing connections afterwards.

A wire trace of Anvil against the saved block recorded 42 upstream requests before readiness:

- the block-N read;
- `eth_gasPrice` without `params`;
- 40 concurrent genesis reads: `eth_getAccountInfo`, balance, nonce and code for each of ten dev accounts, up to 40 in flight.

**Latent defects found offline.** Each would have stopped, or wasted, a later attempt.

1. The proxy stops on any concurrent arrival (`CONCURRENT_REQUEST`), but Anvil's genesis is concurrent.
2. The proxy's local-reply logger throws on an omitted `params`. With only the router fixed, the run still stops at `eth_gasPrice`, as `PROVIDER_OR_RUNTIME_FAILURE`.
3. A request waiting for pacing is still reserved and sent after a stop. One such send was observed while the journal said `STOPPED`.
4. Pacing is stamped before the journal fsync. The provider-side gap fell to 333 ms.
5. The harness waited a fixed 100 × 100 ms. A paced recording genesis needs 32 provider requests, about 12.4 s. The next attempt would have ended in `ANVIL_START_TIMEOUT` after about 26–28 provider requests. The 20 s client timeout also applied in recording mode.
6. After a stop, the closed listener turned a clean stop into an opaque connection error. The wrapper discarded proxy output, so the rejected request was recorded nowhere.
7. The harness had several further gaps:
   - no check that 8545 was free or that 8546 was listening before spawning Anvil;
   - Anvil inherited the caller's environment;
   - error tails included stdout, which carries dev-account private keys and the mnemonic;
   - `withFork` did not await child exit;
   - there was no cleanup on interruption;
   - output accumulated without bound.
8. Setup pinned indices 0 and 1, and aborted if either had code, instead of the §3.2.3 lowest-clean selection. Two scenarios used `eth_accounts[1]` instead of the setup account.
9. Anvil v1.8.3 contains a payment-capable "MPP" HTTP transport, which answers HTTP 402 challenges; a `FOUNDRY_MPP_NO_AUTO_FUND` switch exists. It is only the transport label in the error. It is unreachable by design: Anvil talks only to the loopback proxy, and the proxy never relays HTTP 402.

**Repository repair.** Everything is inside the §11 paths. No dependency, pin, provider method, cap, Anvil argument, simulation method or scope count changed.

- **`profile.ts`.** `forkUpstreamCall` is the single wire normalization.
  - An omitted `params` is read as `[]` only for `eth_gasPrice` (`FORK_UPSTREAM_PARAMS_OMITTED`), which stays a local method-not-found reply.
  - Every other omission, and every `null` or non-array `params`, still stops.
- **`replay-upstream.mjs`.**
  - Uses the same normalization for its keys.
  - Prints `REPLAY_UPSTREAM_READY 127.0.0.1:8546` only after binding.
  - On a bind failure, exits with `REPLAY_UPSTREAM_BIND_FAILED:<code>`.
- **`harness.mjs`.**
  - Refuses `FORK_PORT_OCCUPIED:8545` and `UPSTREAM_NOT_READY` before spawning Anvil. The probes connect over TCP only and send no bytes.
  - Treats Anvil's own `Listening on 127.0.0.1:8545` line, Anvil's exit, or a deadline as the readiness outcome. The deadline is 20 s for replay and 600 s for recording, which is the approved `--timeout`.
  - Uses a 600 s recording-mode client RPC timeout.
  - Gives Anvil a minimal child environment (`HOME`, `PATH`).
  - Keeps bounded, stderr-only error tails, together with the upstream state.
  - Awaits child exit and verifies that the port is released.
  - Kills every live child on SIGINT, SIGTERM, SIGHUP and process exit.
  - Provides `startReplayUpstream`, which waits for the replay readiness line.
  - Passes the selected setup account to the scenarios.
- **`fork-setup.mjs`.** Selects the lowest clean indices (no extra upstream read) and returns `DEV_ACCOUNTS_NOT_CLEAN` if fewer than two are clean. A replay requires the pinned indices (`DEV_ACCOUNT_PINS_DIFFER`).
- **G1.** Routes the raw wire request exactly as the proxy receives it, and reports `paramsOmittedMethods`. C4 fails any omission outside the approved local form.
- **`compile.fork.test.ts`.** This approved Create path is created now, with 13 offline readiness and lifecycle tests. The transcript-backed integration will join it at G6.

**Offline validation.** All runs used pinned Node 24.21.0, pnpm 11.22.0 and Anvil v1.8.3, inside a loopback-only namespace, with no credential.

| Check | Result |
|---|---|
| Build | 7/7 tasks |
| Typecheck | 11/11 tasks |
| Lint | pass |
| Schema exports | 11 |
| Unit suite | 313/313 in 38 files |
| Contract tests | 79/79 in 6 files |
| G1 | 14/14; C1–C10 true; `paramsOmittedMethods` `["eth_gasPrice"]` |
| Fork suites | 27/27 |
| `git diff --check` | clean |
| Exact scope | 66/113 created, 23/51 modified (after the record updates, which include `SECURITY_MODEL.md`); nothing outside the lists; no deletion, rename, mode change or executable |
| Frozen files | 9 v1 schemas, 20 compatibility files and 21 third-party licenses byte-identical to `HEAD` |
| Persistent governance programs | still exit 1 under BUILD-003C rules; the only new line is the approved `compile.fork.test.ts` path |

The 13 lifecycle tests cover:

- successful readiness;
- upstream not ready;
- a port collision;
- the G5 child-exit shape;
- a hung-startup timeout;
- a paced recording genesis beyond 10 s (31 forwards at least 400 ms apart);
- SIGTERM (143) and SIGINT (130) interruption;
- scenario-failure cleanup;
- replay readiness, collision, exit, and bind-then-ready ordering.

**Saved-replay validation of the proxy corrections.** The candidate proxy lives in the scratchpad and is validation-only. It has an injected provider, no transport and no credential path, so it is not an owner entrypoint. It carries corrections C-1 to C-8 (Amendment 5). The results:

- **Consumed code.** With only the router fixed, it stops at `eth_gasPrice`. With concurrent reads, it stops with `CONCURRENT_REQUEST` and still sends one request after the stop.
- **Original harness plus corrected proxy.** `ANVIL_START_TIMEOUT` after 9.5 s, with 26 calls and none after the kill.
- **Repaired harness plus corrected proxy on the saved block.** Readiness at about 14 s after exactly 32 attempt-2 provider requests. Fork metadata equals 8453 / 51,745,329 / `0x364b…`. Minimum provider send gap 423 ms. Every reservation fsynced before its send.
- **HTTP 429.** A durable stop with `stopDetail`, no send afterwards, and the listener kept.
- **Unapproved forms.** An unapproved form, and `eth_chainId` without `params`, stop with `stopDetail`.
- **Refusals.** The consumed journal, reuse, an existing log, a tampered parent and out-of-range billing are all refused.
- **Routing tally over the 42 traced requests.** 1 stop under the consumed rule, 0 after the repair.

The result SHA-256 is `532e956d2a6d129bca2f5b03d66d0fe5b0610b18f09a95c55f4382aa55597aa6`.

**Status.**

- G5 attempt 1 is `FAIL` (`STOPPED`, `UNAPPROVED_UPSTREAM`).
- The single-use entrypoint and its journal are consumed and preserved. The repository files the entrypoint pinned have since changed, so its gate can never pass again.
- No transcript and no reproducibility result exist.
- G6–G8 are `NOT_RUN`.
- Any further recording requires the owner's approval of Proposed Amendment 5.

### Proposed Amendment 5 — G5 continuation, attempt 2 only (PROPOSED; NOT APPROVED)

**Scope if approved.** The agent may prepare one new, separately digested owner entrypoint, offline and with the key unset. The owner may then run its single command once, for BUILD-003D attempt 2. The D-5 provider allowlist, caps, pacing and stop rules, the exact Anvil argv and the simulation method all stay unchanged. Nothing is authorized before approval.

**Owner decisions required.** All six are approved together, or none is.

- **A5-1 Wire form.** `eth_gasPrice` with the JSON-RPC `params` member omitted is the same zero-argument form that Amendment 3 recorded as `eth_gasPrice []`. It stays a local method-not-found reply and is never sent to the provider. No other method may omit `params`.
- **A5-2 Proxy corrections C-1 to C-8.**
  - C-1: the shared normalization is applied before routing, logging and keys.
  - C-2: concurrent Anvil requests are queued first in, first out (FIFO), with one provider request in flight. This replaces the preparation's stricter stop-on-concurrency. The plan rule itself is unchanged.
  - C-3: session status is re-checked after the pacing wait.
  - C-4: after a stop, the listener stays open and answers JSON-RPC errors; nothing is forwarded.
  - C-5: the journal gets a durable `stopDetail`, limited to the method name and parameter shape, with no values or credential.
  - C-6: a continuation journal carries the attempt-1 counters forward.
  - C-7: a queued request whose client has disconnected is never reserved or sent.
  - C-8: the pacing timestamp is taken after the fsync, so provider sends are at least 400 ms apart.
- **A5-3 Harness corrections.** The repository repair above applies, including the 600 s recording-mode startup and client RPC bounds and the minimal Anvil environment.
- **A5-4 Journal and limits.** The new journal and the remaining limits below.
- **A5-5 Wrapper output.** The wrapper prints a credential-free journal summary on every exit path: status, attempt, counters, stop reason and stop detail.
- **A5-6 Billing.** The owner makes a fresh no-paid-billing report.

**New journal.**

- It lives in a new private scratchpad directory.
- Its format is `gryloo.build-003d-recording-continuation.v1`, and it is created `READY`.
- It pins the consumed parent journal by SHA-256 `ee7a3ada…` and carries forward `attempts 1`, `totalRequests 2`, `reservedCu 52`, `STOPPED` and `UNAPPROVED_UPSTREAM`.
- The parent journal, and everything under `/tmp/gryloo-build-003d-g5-prep/`, stays read-only evidence and is never reset, reclaimed or reused.

**Remaining limits.** Counters are never reset.

| Limit | D-5 cap | Used by attempt 1 | Available to attempt 2 |
|---|---|---|---|
| Attempts | 3 | 1 | 1 (attempt 2 only; attempt 3 is not pre-authorized) |
| Provider requests, total | 1,800 | 2 | 1,798 |
| Provider requests, per attempt | 900 | 2 | 900 |
| Reserved listed CU | 46,800 | 52 | 46,748 remaining; at most 23,400 for this attempt (900 × 26) |
| Cumulative listed CU against the 968 baseline | 47,768 | 1,020 | Reported current usage must be 1,020 or less, and reported usage plus the new reservation must stay at or below 47,768 |

Anvil's genesis alone reserves 32 requests (832 CU) before any scenario read: the finalized read, block N, and balance, nonce and code for ten dev accounts.

**Stop conditions.** Every D-5 stop rule stays in force:

- a non-200 status, including 402 and 429;
- a JSON-RPC error;
- a changed or non-finalized source;
- a response over 1 MiB;
- a timeout or no response;
- a cap;
- an interrupted journal;
- an unapproved method, form or batch.

The following also stop attempt 2:

- any harness startup failure (`FORK_PORT_OCCUPIED`, `UPSTREAM_NOT_READY`, `ANVIL_EXITED`, `ANVIL_START_TIMEOUT`, `FORK_CHAIN_MISMATCH`, `FORK_METADATA_MISMATCH`);
- `DEV_ACCOUNTS_NOT_CLEAN`;
- any scenario or completion failure;
- an owner interruption.

Any stop ends attempt 2 and consumes its entrypoint. There is no retry, fallback method, provider or block form.

**Evidence required before the owner receives the command.** The agent produces it offline, with the key unset, in a loopback-only namespace.

1. The repair checks above, re-run on the exact tree to be pinned.
2. A new preflight that drives the new proxy through its HTTP layer from the pinned Anvil. It must reproduce every saved-replay result above:
   - readiness at the saved block after exactly 32 attempt-2 requests;
   - sends at least 400 ms apart;
   - reservations fsynced before each send;
   - every stop class, with its durable detail;
   - no send after a stop or after a client disconnect;
   - the listener kept after a stop;
   - every refusal.
3. A manifest pinning every file the command executes or imports, including the repository harness, replay upstream, fork setup, profile source and `dist`, other imported `dist` files, the lockfile and the Anvil binary. It is accompanied by a read-only gate check and a claim test that refuses reuse.
4. The owner's fresh dashboard report:
   - Free plan;
   - no payment method, paid add-on, Pay As You Go, overage, auto-scale or automatic upgrade;
   - Base Mainnet only;
   - current usage of 1,020 CU or less.

**Evidence required from the run.**

- The credential-free journal, request log, scenario results and transcript, with their digests.
- The G5 byte-identical offline reproducibility run.
- Review of the selected owner and setup indices. If they differ from 0 and 1, the profile pins change before replay.

**Not authorized even if approved:**

- attempt 3;
- any agent live request;
- wallet operation;
- G6 or later gates;
- the G8 governance update;
- commit, push or pull request;
- mainnet or public-testnet execution;
- BUILD-004.

### Amendment 5 record (owner approval, 2026-09-24)

- **Owner approval.** The owner explicitly approved Proposed Amendment 5 as one package, exactly as documented, including A5-1 to A5-6:
  - `eth_gasPrice` with an omitted `params` is the local equivalent of `eth_gasPrice []`. It is answered locally and never forwarded.
  - Proxy corrections C-1 to C-8.
  - The harness readiness, lifecycle, timeout, cleanup and safe-error-output corrections.
  - A separate continuation journal that carries the attempt-1 counters forward.
  - Preparation for attempt 2 only, capped at 900 new provider requests. The overall remaining ceilings are 1,798 requests and 46,748 CU. Attempt 3 is not pre-authorized.
  - A credential-free journal summary whenever the owner wrapper exits.
  - Every attempt-1 file, digest, counter and timestamp stays unchanged.
- **Billing report (owner-reported, 2026-09-24).**
  - Plan: Free.
  - No payment method, and no paid feature or add-on.
  - Pay As You Go, overage, auto-scale and automatic upgrades disabled.
  - The Gryloo app remains Base Mainnet only.
  - Current usage: "at or below the Amendment 5 limit of 1,020 CUs". The exact figure in the report was an unfilled placeholder (`[CURRENT_USAGE]`). The journal therefore records `currentUsageCuUpperBound: 1020` and `currentUsageCuExact: null`, and every cap uses 1,020. The agent cannot verify the dashboard.
- **Authorized.** Offline preparation and validation of the new owner-only entrypoint.
- **Not authorized.** Any agent live request or credential use, running the recording, wallet operation, G6, commit, push or pull request.

### G5 attempt-2 entrypoint preparation record (2026-09-24)

**Location.** `/tmp/gryloo-build-003d-g5-attempt2/`, mode 0700, uncommitted. The attempt-1 directory `/tmp/gryloo-build-003d-g5-prep/` was not modified. Its 30-file digest list still verifies.

| File | Role | SHA-256 |
|---|---|---|
| `recording-proxy.mjs` | Corrected proxy (C-1 to C-8), with the unchanged attempt-1 HTTPS transport | `32408933839b2f0ddf05f79059299082ea4ece40d8dccbd6c77a026497fbc45f` |
| `owner-run.sh` | Owner-only single-use wrapper; prints the credential-free summary on every exit path | `d78afb60ac8bebb6906c76efd0427d935c9b6e016fe4be723f47855e250faf39` |
| `gate.mjs` | Read-only gate; `--claim` writes the atomic single-use marker | `e4daeeaf7ff1e5b3e3ca9c7d028ed75e45de8499621a23c5891243323634c472` |
| `owner-harness.mjs` | Credential-free scenario driver (repaired harness, recording mode) | `6ca8c03fb3a0a68e607bd654027c1959c6e6cb76b4d780eb7112d747a0cb8e01` |
| `finalize-transcript.mjs` | Transcript finalizer (only after a `COMPLETE` journal) | `7ad1526253ddbaced310938082956092ba03d113d4c926c35f77fdb7173f0745` |
| `journal-summary.mjs` | Credential-free journal summary (A5-5) | `f1d491527ebc78ff4c278890668f131e90001479b5eb36c1f30e269731c168a9` |
| `preflight.mjs` | Offline preflight | `8cf659b60503d7ab2016e71eb23d6e080f52d9883adb1f7e350e9f1c2dafe2aa` |
| `test-proxy-launcher.mjs` | Preflight-only launcher (synthetic provider; refuses non-synthetic tokens) | `72bdb8c570beab40e4026c0cddc78d790394b90e2db4c7ff5cc00b7eb3efedf3` |
| `session/journal.json` | Continuation journal, `READY`, counters 2 / 52 carried | `01f2cd5009d6713572e32fa18578e2e52284f03044d6e570f0cb1e48933a4857` |
| `session/preflight.json` | Preparation record bound to the journal digest | `ae5bfbafc0b291443017d389d39ee95fb27886d1ec699645c29e493f05ab92d2` |
| `preflight-result.json` | Preflight result | `9c6a9555aa2db323d435314e271f5ad91166c2d04fbddc19f976b094259c87e7` |
| `g1-result.json` | G1 result of the final battery | `19d29093a7d954d7b29b707fb3ad29e73ad5ec5fb183b0e558a279daf9cd362a` |
| `attempt1-evidence-sha256.txt` | Digest list of the 30 attempt-1 evidence files | `fdedadb5aea78bfd194aabfd9c4241ecde486d55c21e4529cc8689073d24f4a5` |
| `pinned-external-files.txt` | The 848 pinned repository, dependency, Anvil and Node files | `daa3736456b1ac94ec55cb286112379c2fe04ab69fdc041e3b38182f6f023f45` |
| `manifest.json` | Manifest pinning 865 files; its SHA-256 is the command argument | `03960444a495de85067a782cd8bbd732f5a9a5997b882f8cedea177b7bd02277` |

**Corrections as implemented.**

- **C-1 to C-7.** Implemented as validated in the incident record.
- **C-8 (pacing clock).** The preflight found a further pacing defect: the WSL2 wall clock stepped by −1,352 ms and −1,803 ms against the monotonic clock. The attempt-1 proxy paced with `Date.now()`, so a forward step could shorten a real gap. Under C-8, the proxy now paces with the monotonic clock, stamped after the reservation fsync.
- **Activation order.** The proxy validates the journal, binds 127.0.0.1:8546, and only then activates attempt 2. A bind failure leaves the journal `READY` with no request, and the claim marker still refuses any rerun.
- **Wrapper signals.** A harness failure is recorded as `HARNESS_FAILED`; the wrapper signals it to the proxy with `SIGUSR2`. A refused completion is recorded as `COMPLETION_REFUSED`, and an owner interruption as `INTERRUPTED_SHUTDOWN`.
- **Gate.** Before claiming, the gate verifies all of the following:
  - every one of the 865 manifest files, which covers every executed file and a superset of the static import closure (329 files; every file under each resolved package);
  - the 30 attempt-1 evidence files;
  - the pinned HEAD and branch;
  - Node v24.21.0;
  - the preflight record and the `READY` journal;
  - the absence of any claim, log, scenario result, harness log or transcript;
  - private directory modes;
  - free fork ports.
- **Repository change.** The one repository change in this step: `compile.fork.test.ts` now paces and measures with the monotonic clock.

**Offline preflight.** All 111/111 checks passed, in a loopback-only namespace, with no credential and 0 live provider requests. Result SHA-256 `9c6a9555aa2db323d435314e271f5ad91166c2d04fbddc19f976b094259c87e7`. The checks cover:

- static source rules;
- 22 journal, billing and single-use checks;
- 38 HTTP-level checks:
  - host, method and path;
  - finalized-first;
  - the canonical hash rewrite;
  - the A5-1 local form;
  - Amendment 3 local replies;
  - every unapproved form;
  - HTTP 402, 429 and 500, RPC errors, invalid JSON, id mismatch, oversize, timeout, reflected credential, transport failure, changed source block and wrong chain;
  - the 900-request, 1,800-request, 46,800-CU and 47,768-CU caps;
  - queueing, one request in flight, stop during pacing, and client disconnect;
- 15 pinned-Anvil checks on the saved block;
- 7 process-level signal and collision checks;
- 15 checks on an isolated wrapper copy that differs only on the three marked lines.

Measurements:

- **Anvil readiness.** After exactly 32 attempt-2 provider requests, at about 13.5 s.
- **Pacing.** Minimum send gap 418.9 ms at the provider, monotonic.
- **Queueing.** Up to 40 Anvil requests queued at once.
- **Reservations.** Every reservation fsynced before its send.
- **Record-to-replay closure.** The recorded startup was finalized into a transcript. The closed replay upstream reproduced the fork at 51,745,329 / `0x364b…` with no miss.
- **Wrapper interruption.** Ctrl-C to the process group gave exit 130 and `INTERRUPTED_SHUTDOWN`, with no send afterwards.
- **Wrapper refusals.** A rerun, a wrong digest, a missing credential, an occupied port and any changed pinned file all refuse before the claim or at it. The exit summary printed on every path.

**Repository battery on the final tree.** The G1 result digest varies between runs only by the arrival order of Anvil's concurrent genesis reads; the checks and request multiset are identical.

| Check | Result |
|---|---|
| Build | 7/7 |
| Typecheck | 11/11 |
| Lint | pass |
| Schema exports | 11 |
| Unit | 313/313 |
| Contracts | 79/79 |
| G1 | 14/14 (C1–C10) |
| Fork suites | 27/27 |
| `git diff --check` | clean |
| Exact scope | 66/113 created, 23/51 modified |
| Frozen files | identical |

**Gate and command.**

- The real gate `--check` passed read-only. The directory is not claimed, and the journal summary reads `READY`, 2 requests, 52 CU.
- The single-use owner command, run once in the owner's WSL terminal with the credential exported only in that terminal, is:

  ```text
  bash /tmp/gryloo-build-003d-g5-attempt2/owner-run.sh 03960444a495de85067a782cd8bbd732f5a9a5997b882f8cedea177b7bd02277
  ```

- G5 remains `NOT_PASSED` until that run completes and the byte-identical offline replay passes. G6–G8 are `NOT_RUN`.

### G5 attempt-2 stop record and go/no-go (2026-09-24)

**Owner run.** The attempt-2 command ran exactly once and printed `G5 attempt 2 claimed once`, followed by `Error: DEV_ACCOUNTS_NOT_CLEAN`. It was not rerun. Attempt 2 is consumed, and attempt 3 is not authorized.

**Dashboard (owner-reported, after the run).** 1,008 / 30,000,000 CU; Free plan; app Gryloo; Base Mainnet. This is within the reserved upper bound of 968 + 884 = 1,852.

**Preserved evidence.** All 23 attempt-2 files were hashed before inspection (digest list `a81b45874764fb50423f1f091cd74e92ab5dfa700208078731066385546bbf5e`) and were unchanged afterwards. The owner-reported digests match:

| File | SHA-256 |
|---|---|
| `session/journal.json` | `7fb21b2cf723e76cb0f6de0a45e636e44dff0956af9954bc3831ad611c028669` |
| `session/requests.jsonl` | `0dd180bfeeebcaa0005ec565b35b17f5635378b0050dcd22d334faad9b3a8487` |
| `session/harness.log` | `8190d0933a4896cbb25f9a36fea1493fe5a3d2bc1630fbed13545ae60df7c237` |
| `session/started` | `907430250974c81e9ce94bee31077e1b57aff2515f0ee8c78bf1d5ccf36fdc89` |

- **Credential scan.** No credential-shaped content was found.
- **Journal.** Attempt 2 is `STOPPED` with reason `HARNESS_FAILED`. Attempt 2 made 32 requests. Totals are 34 requests and 884 reserved CU, of which attempt 2 reserved 832.

**Provider exchanges.** There are exactly 32, all HTTP 200 with valid results:

- the finalized read;
- the block-N read of Base block 51,748,192 (`0x4de73646…1d986`);
- balance, nonce and code for each of the ten dev accounts.

There are also 11 local exchanges: `eth_gasPrice` and ten `eth_getAccountInfo`.

**What happened after readiness.** The fixture made only `eth_chainId`, `eth_accounts` and ten local `eth_getCode` reads, all answered from Anvil's genesis cache. It then threw at `fork-setup.mjs:42`.

**What did not happen.** No timestamp change, local transaction, scenario, signature, wallet operation, scenario result or transcript occurred.

**Candidates.** Anvil's ten default dev accounts, indices 0 to 9, were each examined for code at block N. Every one was rejected for the same reason: its code is the EIP-7702 delegation designator `0xef01008a67b5020ee254ef48e3b6a04927f39baf7e408a`, a delegation to `0x8a67b5020ee254ef48e3b6a04927f39baf7e408a`. Each has a Base balance of 0. Their Base nonces:

| Index | Nonce |
|---|---|
| 0 | 3,440,245 |
| 1 | 31,270 |
| 2 | 18,998 |
| 3 | 18,833 |
| 4 | 30,510 |
| 5 | 171,597 |
| 6 | 10,720 |
| 7 | 12,372 |
| 8 | 8,835 |
| 9 | 11,044 |

**What the check observed.** The check reads `eth_getCode(account, 'latest')` on the fork. Anvil's genesis keeps forked code and nonce, and changes only the balance (to 100 ETH). The check therefore observed real forked Base bytecode. It did not observe the Anvil prefunding, the nonce, or any other property.

**§3.2.3 conformance.** The implementation conforms exactly: the lowest indices with empty code at block N, and a stop for an owner decision when fewer than two qualify. The plan's §12 risk "EIP-7702 or other code on dev accounts … If none is clean, stop for a decision" is the outcome that occurred. The defect is in the plan's assumption that Anvil's publicly known default accounts could be clean on Base, not in the implementation.

**Offline reproduction.** The setup:

- a loopback-only network and mount namespace;
- a scratch copy bind-mounted at the attempt-2 path, so every path is identical and the originals stay untouched;
- the unmodified attempt-2 proxy classes, owner harness, gate, repository harness and pinned Anvil;
- the 32 saved provider responses;
- the `READY` journal recreated byte-identically (`01f2cd50…`);
- a wrapper differing only on its marked proxy line.

It reproduced:

- the journal, harness log and claim marker, **byte-identically**;
- the credential-free summary, field for field;
- the request log, **exchange-identically** (all 43 exchanges). Only arrival order and Anvil's self-assigned JSON-RPC ids differ, because Anvil issues its genesis reads concurrently.

Reproduction digests: request log `cf31dfb42ef97df41829fc89cd0125fcd1f30ee792289e7486acf432e9987b49`, replay launcher `f8fd48eb0738cd50b06bd5554dc24980ff426dad1b802b2b44819329a66d8f1b`.

**Files and counters.** No repository or entrypoint code changed. All pinned attempt-2 files other than the consumed session files, and all 30 attempt-1 files, remain unchanged. D-5 usage now stands at 2/3 attempts, 34/1,800 requests and 884/46,800 reserved CU.

**Bounded go/no-go (owner decision; neither option is prepared).**

- **A. Implementation defect.** Not supported by the evidence. No implementation defect exists: the code observed real state and applied the approved §3.2.3 rule. Every route to an attempt 3 is a design change, not a defect repair:
  - another account source, which changes the approved exact Anvil command;
  - a state override that clears code, which is prohibited: the local balance is the only override;
  - accepting delegated accounts, which reverses the owner-code rule.
- **B. Scope split.** BUILD-003D closes without another recording.
  - **Delivered by BUILD-003D:** G0–G4 as recorded, the G5 incident repairs and their tests, and the governance update for exactly the delivered paths.
  - **Moved out:** the Base-state recording, the transcript, fork app integration (G6), manual-wallet acceptance (G7) and the dependent certification rows. They go to a separately governed build, whose first decision is a reviewed account strategy for recorded Base state and whose recording budget is its own.
  - **D-5 recording authority:** ends at 2/3 attempts and 34/1,800 requests.
  - **BUILD-003:** stays `IN_PROGRESS`, with certification `PENDING_OWNER_DECISION`.
  - **Name of the new build:** BUILD-003E is reserved in §1.4 for public-testnet evidence, so the owner names it.
  - **After approval:** choosing B requires a narrow amendment that reduces §11 to the delivered paths and sets the G8 scope. The agent drafts it only after the owner chooses B.

### Proposed Amendment 6 — final recording continuation with project-specific local accounts (PROPOSED; NOT APPROVED)

**Status.** This is a draft only. Nothing executable has been prepared. It would be the final recording continuation for BUILD-003D.

- **If attempt 3 succeeds,** work continues through G5 replay, G6, G7 and G8 as the plan describes.
- **If attempt 3 stops for any reason,** no Amendment 7 and no further recording is permitted. The Option B scope split becomes the required closure path.

**Technical validity (established offline, no network, 2026-09-24).**

- **Flags.** The pinned Anvil v1.8.3 supports `--mnemonic`, `--derivation-path` and `--mnemonic-seed-unsafe`.
- **Derivation.**
  - Historical design: the phrase came from a public label. DEC-0026 withdraws the reconstruction input from Git.
  - The historical derivation produced accounts that sit on the derivation path `m/44'/60'/31337'/0/`.
  - This gives ten addresses, none of them an Anvil default.
  - An independent BIP-39/BIP-32 derivation using only the approved `@noble/hashes` 2.4.0 and `@noble/curves` 2.4.0 reproduces all ten exactly.
  - The same code reproduces Anvil's public defaults from the public default phrase, as a control. Script SHA-256 `d20cd0f2ad39caf10df026a97d0f834f9c6d70ac3a8169080911647620329b30`.
- **Fork genesis.** With the pinned phrase on the exact fork command, against the saved attempt-2 block 51,748,192, the genesis sends 42 upstream requests with the attempt-2 shape: 31 bound for the provider, 11 answered locally. It reads only the ten derived addresses and none of the defaults. `anvil_metadata` reports 8453 / 51,748,192 / `0x4de73646…1d986`, and stderr carries no phrase or key. Trace SHA-256 `aef07f3404259a385d05e82a88aeadb36cbc7d8ab184606ca5613530e7bd4885`.
- **Governance.**
  - CI secret patterns do not match a pinned test phrase.
  - §3.2.3 currently says "No key, mnemonic or seed is written by Gryloo or committed", and §3.2.1 fixes the exact Anvil command. Both change only through this amendment (A6-1, A6-2).
  - No new path, dependency, pin, provider method, simulation method or scope count is needed.

**A6-1 Account source (replaces the §3.2.3 "Accounts" bullet and D-10's account choice).** Anvil's public default mnemonic and its ten default addresses are no longer used. The dev accounts are Gryloo test-only accounts derived as follows:

| Item | Pinned value |
|---|---|
| Public label | `[withdrawn under DEC-0026]` |
| Seed | First 8 bytes (big-endian) of SHA-256(label) = `[withdrawn under DEC-0026]` = [withdrawn under DEC-0026] |
| Phrase generation | Pinned Anvil v1.8.3 `--mnemonic-seed-unsafe [withdrawn under DEC-0026]` (a 12-word BIP-39 phrase) |
| Phrase pin | SHA-256 of the exact phrase string `[withdrawn under DEC-0026]`. The phrase itself is written only at implementation (A6-3) |
| Derivation path (`--derivation-path`) | `m/44'/60'/31337'/0/` + index 0–9. The hardened account index 31337 is distinctive: no standard wallet path |
| Accounts | 10 (`--accounts 10`), local `--balance 100` unchanged |

Expected addresses (pinned):

| Index | Address |
|---|---|
| 0 | `0x6b86363f41c70feae8fdd5476957cdadc9621704` |
| 1 | `0x490850405076beb741fdc81cbd5bfd6d51573168` |
| 2 | `0xd76788875502edb648e0032b4eb120e0610c1c68` |
| 3 | `0x511a4267baac7ddad4da7032a82476b81fb32d36` |
| 4 | `0x4f4506387734a9da0828070bc95aa43672c12083` |
| 5 | `0x62b8ddc1663c7517ec645ab777c48f5748232a01` |
| 6 | `0x3b6f9a972e4edc101afce6b50c36245d6eaf7ff2` |
| 7 | `0xd6990854a6fde3766e5255e12aa3c7541c7a5e35` |
| 8 | `0x81f25f79889ad7315b448bae04ecc5728c079784` |
| 9 | `0x62d225656b8c4e21dd4c9d1801b2df2cf8b64066` |

**Handling rules.** These are public, test-only accounts: public by construction, like Anvil's defaults, but never used anywhere else.

- The phrase and keys exist only for the local chain-31337 Anvil fork.
- They are never funded, never used on Base or any public network, and never used for a transaction outside the local fork.
- The recording happens before any commit or push, so the phrase is unpublished while Base state is recorded. The later publication cannot change the recorded block-N state.

**A6-2 Exact Anvil command (replaces §3.2.1 "Command").** Built only by `e2e/fork/harness.mjs`:

```text
anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --fork-url http://127.0.0.1:8546 --fork-block-number N --fork-chain-id 8453 --no-storage-caching --no-fork-node-info --retries 0 --timeout 20000 --accounts 10 --balance 100 --mnemonic <pinned phrase> --derivation-path m/44'/60'/31337'/0/
```

- The recording variant differs only in `--timeout 600000`.
- `--mnemonic-seed-unsafe` is used only to reproduce the phrase offline, never in the run.
- `--fork-state-by-number` remains prohibited.

**A6-3 Key hygiene (replaces "No key, mnemonic or seed is written by Gryloo or committed").**

- **Where the phrase lives.** Historical implementation superseded by DEC-0026: the delivered harness reads an owner-controlled untracked mode-0600 file, with no fallback.
- **Where it never goes:**
  - `profile.ts` (browser-safe) or any app, server, wallet or package `src` file;
  - the transcript, journals, logs, error text or evidence.
- **What is public.** The ten addresses are pinned in `profile.ts` as public identifiers.
- **Error output.** Anvil's stdout banner, which lists keys and the phrase, is never captured into errors or logs; the existing stderr-only tails apply.
- **Wallet guards.** No private key is ever held by the app, server or wallet bridge. The §3.9 wallet guards are unchanged.
- **G7.** The manual-wallet check still imports only the selected owner key from the local Anvil terminal.

**A6-4 Selection and verification before any scenario transaction.** `fork-setup.mjs`, before any local transaction:

1. `eth_accounts` must equal the ten pinned addresses exactly, in order. Otherwise it stops with `DEV_ACCOUNTS_DERIVATION_MISMATCH`.
2. No account may equal an Anvil default address.
3. The unchanged §3.2.3 rule then applies. Owner and setup are the two lowest indices whose recorded Base code at block N is empty (`0x`). An EIP-7702 designator or any other code disqualifies an account. Nothing is wiped, overridden or accepted.
4. With fewer than two clean accounts, it stops with `DEV_ACCOUNTS_NOT_CLEAN` before any scenario.

The owner-has-empty-code rule (`OWNER_HAS_CODE`) is unchanged. The selected indices are reported. If they differ from 0 and 1, the `profile.ts` pins change before the G5 replay.

**A6-5 Attempt-3 journal and entrypoint.**

- **Location.** A new private directory `/tmp/gryloo-build-003d-g5-attempt3/`.
- **Journal.** Format `gryloo.build-003d-recording-continuation.v2`, created `READY`. It pins:
  - the attempt-2 journal, SHA-256 `7fb21b2cf723e76cb0f6de0a45e636e44dff0956af9954bc3831ad611c028669` (`STOPPED`, `HARNESS_FAILED`);
  - through it, the attempt-1 journal `ee7a3ada…`.

  It carries `attempts 2`, `totalRequests 34` and `reservedCu 884`, and it permits attempt 3 only.
- **Evidence preservation.** Every attempt-1 and attempt-2 file (their 30- and 23-file digest lists) is verified byte-identical by the gate and never modified.
- **Entrypoint code.** It reuses the validated attempt-2 proxy, wrapper, gate, harness driver, finalizer and summary. The only changes are the parent pins, attempt number, per-attempt cap and billing record in A6-6.
- **Billing.** The journal records the owner's exact 1,008 CU dashboard value (at most 968 + 884 = 1,852, the reserved bound after attempt 2). Before the command, the owner re-confirms the no-paid-billing flags: Free plan; no payment method, paid feature or add-on; Pay As You Go, overage, auto-scale and automatic upgrades disabled; Base Mainnet only.

**A6-6 Limits (mechanically recomputed from the preserved journals and the 1,008 CU dashboard).**

| Limit | D-5 ceiling | Used (attempts 1+2) | Remaining | Attempt 3 |
|---|---|---|---|---|
| Attempts | 3 | 2 | 1 | Attempt 3 only (final) |
| Provider requests | 1,800 | 34 | 1,766 | At most **600** (its own cap, below the former 900) |
| Reserved listed CU | 46,800 | 884 | 45,916 | At most 15,600 |
| Cumulative listed CU (ceiling 47,768) | — | Dashboard 1,008 | 46,760 headroom | Projected at most 16,608 |

After attempt 3, totals are at most 634 requests and 16,484 reserved CU.

The 600 cap covers:

- the 32 genesis reads;
- the fixture and nine scenarios, whose real read count cannot be measured offline (engineering estimate: a few hundred).

Reaching the cap is a stop.

**A6-7 Stop conditions.** Attempt 3 stops on any of the following:

- every D-5 stop rule and every Amendment 5 stop;
- `DEV_ACCOUNTS_DERIVATION_MISMATCH`;
- `DEV_ACCOUNTS_NOT_CLEAN`;
- the 600-request cap;
- any scenario, completion or finalizer failure;
- an owner interruption.

Any stop ends attempt 3 and consumes its entrypoint. There is no retry, fallback, Amendment 7 or further recording. BUILD-003D then closes through Option B.

**A6-8 Offline validation required before the owner command.** The agent performs it with no network and no credential:

1. The independent derivation test reproduces the ten pinned addresses. The phrase digest equals the pin, and nothing overlaps the Anvil defaults.
2. G1 C1–C10 pass with the changed exact command.
3. Fork genesis with the pinned accounts shows 32 provider requests for attempt 3, and only the pinned addresses are read.
4. Selection tests:
   - all clean;
   - the lowest indices dirty via an EIP-7702 designator;
   - fewer than two clean;
   - a derivation mismatch;
   - pins that differ in replay.
5. The full attempt-2 preflight suite re-run against the attempt-3 constants: HTTP proxy, caps including 600, pacing, concurrency, stop behavior, interruption, cleanup, the wrapper-copy flow and single-use refusal.
6. Record-to-replay closure.
7. The repository battery.
8. Exact scope.
9. Both earlier attempts' evidence unchanged.

**A6-9 Files (all already in §11; counts unchanged at 113 created, 51 modified, 201 protected):**

- `packages/reference-compiler/src/profile.ts`: pinned public addresses; `forkAnvilArgs` takes the account derivation from its caller.
- `apps/reference-dapp/e2e/fork/harness.mjs`: the pinned phrase and path.
- `apps/reference-dapp/e2e/fork/fork-setup.mjs`: the A6-4 checks.
- `packages/reference-compiler/test/anvil-compatibility.fork.test.ts`.
- `packages/reference-compiler/test/compile.fork.test.ts`: the synthetic transcript uses the pinned addresses.
- `packages/reference-reconciler/test/raw-transaction.test.ts`: the independent derivation test, using the reconciler's approved `@noble/curves` and `@noble/hashes`.
- The plan, report, ADR-0004 and living records.

**A6-10 Not authorized even if approved:**

- any agent live request or credential use;
- running attempt 3;
- funding or using the accounts outside the local fork;
- G6 before a successful G5;
- commit, push or pull request;
- mainnet or public-testnet execution.

**Owner decision.** Approve Amendment 6 exactly as drafted, which authorizes only the A6-9 code changes and the offline preparation and validation of the attempt-3 entrypoint. Or reject it, which makes Option B the closure path.

### Amendment 6 record (owner approval) and attempt-3 preparation record (2026-09-24)

**Approval.** On 2026-09-24 the owner explicitly approved Amendment 6 exactly as drafted, A6-1 to A6-10. The approval covers:

- project-specific deterministic Gryloo test accounts, replacing Anvil's public defaults;
- the amended exact Anvil command, §3.2.3 and D-10;
- the empty-code rule preserved: EIP-7702 or any other code disqualifies an account, with no code wiping, override or delegated-account acceptance;
- the pinned derivation, digest, ten addresses and complete arguments;
- the phrase and keys confined to the test harness and the local Anvil process;
- no public-network use, funding or submission;
- verification of the ten pinned addresses and of at least two empty-code accounts before any scenario transaction;
- a separate attempt-3 journal carrying attempts 1 and 2 forward;
- unchanged overall ceilings;
- attempt 3 capped at 600 requests and 15,600 reserved CU.

Any attempt-3 stop ends BUILD-003D recording authority, and Option B becomes mandatory. No Amendment 7 is permitted.

**Repository changes (the six A6-9 paths).**

| Path | SHA-256 after the change |
|---|---|
| `packages/reference-compiler/src/profile.ts` | `0038db259fa3820c55ddbf2b382042695ff1342f1905b92ccb7cb26068c3c746` |
| `apps/reference-dapp/e2e/fork/harness.mjs` | `6d846894b46de0532bcb28593a4743ac80d5d57a49b45ad577bd4af1e9d7c532` |
| `apps/reference-dapp/e2e/fork/fork-setup.mjs` | `0caa84b237c9b24e71ecd12d06c3901876d8212eb830043f9873ee19aaeb8133` |
| `packages/reference-compiler/test/anvil-compatibility.fork.test.ts` | `53f8cbcf6f4a0319cfa96454d354a62fe2f617b721b5e893b46dfa765a6fcd8a` |
| `packages/reference-compiler/test/compile.fork.test.ts` | `2846590ac45a4ce1b8e5cc3cd5d832a55d1a0da21d1d2f9ae931269867b33992` |
| `packages/reference-reconciler/test/raw-transaction.test.ts` | `cab92a6d91f93e2208574165ee401f0e8f0aac48e54a0e5ff94d49a526c606c3` |

What changed:

- **Arguments.** `forkAnvilArgs` now appends `--mnemonic <phrase> --derivation-path m/44'/60'/31337'/0/`. The browser-safe `profile.ts` holds only public addresses and the path; DEC-0026 removed the phrase digest.
- **Phrase check.** The harness holds the phrase and checks it against the pinned digest when it loads.
- **Account selection.** `selectForkAccounts` enforces, in order:
  1. exactly the ten pinned addresses (otherwise `DEV_ACCOUNTS_DERIVATION_MISMATCH`);
  2. no Anvil default address;
  3. the unchanged empty-code rule;
  4. `DEV_ACCOUNTS_NOT_CLEAN` if fewer than two accounts qualify.

  All of this runs before any transaction.
- **Where the phrase appears.** Only in `apps/reference-dapp/e2e/fork/harness.mjs`. It is absent from docs, app, package and browser source, and from every log.
- **Correction during implementation.** A slicing error in `fork-setup.mjs` truncated `send()`. It was restored. A reconstruction of the pre-change file, reversing only the intended edits, matched the attempt-2 pin `62712c08…`.

**Offline validation (A6-8).** Pinned Node, pnpm and Anvil, a loopback-only namespace, no credential.

| Check | Result |
|---|---|
| Build | 7/7 |
| Typecheck | 11/11 |
| Lint | clean |
| Schema exports | 11 |
| Unit | 316/316, including 3 independent derivation tests (the phrase digest, the ten pinned addresses, and the public-defaults control) |
| Contracts | 79/79 |
| G1 | 14/14 with the changed exact command; C1–C10 true; C2 asserts exactly the pinned accounts and no default |
| Fork suites | 31/31, including 4 selection tests: all clean; EIP-7702 designators on indices 0–1 (recording selects 2 and 3, replay refuses the changed pins, code kept); other non-empty code; fewer than two clean; derivation mismatch |
| `git diff --check` | clean |
| Exact scope | 66/113 created, 23/51 modified |
| Frozen files | identical |

**Attempt-3 preflight.** 114/114 passed; result SHA-256 `b710845c4d992dad8758f9038a135d33c88e55be0b150a35fb3e65b531215042`. Measured on the saved attempt-2 block 51,748,192:

- Anvil was ready after exactly 32 attempt-3 provider requests.
- The genesis read only the ten pinned accounts and no default.
- The minimum send gap was 417.7 ms (monotonic clock), with up to 40 requests queued and one in flight.
- The 601st request was refused before sending, at 600 requests and 15,600 CU.
- Through the real proxy, recorded EIP-7702 code was kept and disqualified indices 0 and 1. Selection moved to 2 and 3, and replay pins refused them.
- Every stop class, the caps, pacing, interruption (exit 130, `INTERRUPTED_SHUTDOWN`), cleanup, record-to-replay closure and single-use refusal passed.
- The phrase appears in no attempt-3 file, log or preflight artifact.
- The attempt-1 (30) and attempt-2 (23) evidence files are byte-identical.

**Entrypoint** (`/tmp/gryloo-build-003d-g5-attempt3/`, mode 0700, uncommitted; the manifest pins 868 files).

| File | SHA-256 |
|---|---|
| `recording-proxy.mjs` | `b3a6d25eac35b64021718d0fc3eedb4efe8c6929f0e44060837b18d84ce8a9ec` |
| `owner-run.sh` | `4f96fcebc31c0d6c92f7c3f2f3b9293ee58fb461400314f7b40cb1cbce52a721` |
| `gate.mjs` | `732531ea8935929919babfb14d34f9625d8929e5ca041f09f21f185e7a43b2a5` |
| `owner-harness.mjs` | `4b01117ed13633487e66f3249ce6c92a227244af268303c9e6b2e7e387d405d3` |
| `finalize-transcript.mjs` | `db634f3067b59e4bbfd79fef126b40d72feb080ec13ab50acf160e782f9a1019` |
| `journal-summary.mjs` | `1dc72ddd364966062216f6618b25ee681454d0bb4e056860cc3fa60388f68076` |
| `session/journal.json` | `9441a7fb4f6c8c791d6d0c5eaa01c55e50f76e14c545f3f50ce90bc77c5cc53d` |
| `session/preflight.json` | `9a84c2e51d74b2928e1d03ae8ea7db6d3f5d29af4c4bcbbb8da829d576fdbbc5` |
| `preflight-result.json` | `b710845c4d992dad8758f9038a135d33c88e55be0b150a35fb3e65b531215042` |
| `manifest.json` | `5e55b73bccef36cd60c4bca8172a295c356f947a96aa7de8355be81e4c97bad5` |

**Journal.** `READY`, attempt 3 only. It carries 34 requests and 884 CU, pins attempt 2 (`7fb21b2c…`) and attempt 1 (`ee7a3ada…`), and records the owner's exact 1,008 CU dashboard value. The real gate `--check` passed read-only, and the directory is not claimed.

**Owner command (final, single use, run only after the owner's fresh no-paid-billing confirmation).**

```text
bash /tmp/gryloo-build-003d-g5-attempt3/owner-run.sh 5e55b73bccef36cd60c4bca8172a295c356f947a96aa7de8355be81e4c97bad5
```

### G5 attempt-3 stop record (2026-09-24)

**Owner run.** The final attempt-3 command ran exactly once and was not rerun. It printed `G5 attempt 3 (final) claimed once`, followed by `Error: SETUP_TRANSACTION_FAILED`.

**Preserved evidence.** Every attempt-3 file was hashed before inspection (digest list `bf761eb989efbb526652bd33c6c768691353d234e2db23c0304debea85b46ace`) and was unchanged afterwards. The owner-reported digests match:

| File | SHA-256 |
|---|---|
| Journal | `9c9725f4dacfa34c475084dc0b5eeb472fe5333ac5f1fd3a9118f4d6bc612d1c` |
| Request log | `1b699ed439b09f770b0c96cd06dedde4b3cc55ba0530e38f3b0fd73263c8e607` |
| Harness log | `7316602f3d9e800b671c49828aadf043691bf5cf6faa53813c7710294d424b48` |
| Claim marker | `1ddcb09beb589a334ac746bedd177673030c9767f7e773cfd250b64123a008be` |

- No credential, key or test phrase appears in them.
- The attempt-1 (30 files) and attempt-2 (23 files) evidence is byte-identical.

**Counters.**

- **Attempt 3:** `STOPPED` with reason `HARNESS_FAILED`, having reserved 34 provider requests (884 CU). The log holds 33 provider exchanges, all HTTP 200, and 12 local exchanges.
- **D-5 totals:** 3/3 attempts, 68/1,800 requests and 1,768/46,800 reserved listed CU. Recording authority is exhausted.

**Source block and accounts.**

- **Block:** finalized Base block 51,749,339, hash `0xc16a60a63a33d8e91f2d1245e005d297da781a398bf72b1563f7bae2b4c4489f`.
- **Accounts:** the ten pinned Amendment 6 accounts were the only accounts read. All had empty code, nonce 0 and balance 0 on Base, so selection chose indices 0 and 1 as pinned. Amendment 6 worked.

**Failure.**

1. The first fixture transaction, the setup account's WETH `deposit`, went through `eth_sendTransaction`.
2. `fork-setup.mjs` `send()` read the receipt immediately. Anvil had not mined the transaction yet, so it fell back to the fork (the local `null` reply of Amendment 3).
3. The harness threw at `fork-setup.mjs:24`.

No WETH or system-contract state was read before the stop. The 34th reservation was Anvil's first mining read, sent just before the stop; its response was not logged.

**Offline cause (for the record only).** Both checks ran in a loopback-only namespace.

- **Reproduction.** A byte-faithful reproduction ran the unmodified attempt-3 code over the 33 saved responses, with unrecorded reads left pending, as a slow provider leaves them. It reproduced:
  - the harness log, byte-identically;
  - the request log, exchange-identically (all 45 exchanges);
  - the same `HARNESS_FAILED`.

  The journal differs only by that timing-dependent 34th reservation.
- **Delayed-upstream diagnostic.** With a 400 ms upstream, `eth_sendTransaction` returned the hash and the immediate receipt was `null`. The transaction was mined about 4 s later with status `0x1`. Mining needed about 25 upstream reads first: the OP-stack L1Block contract `0x4200…0015`, WETH, the coinbase and the fee vaults.

**Root cause.** `send()` in `fork-setup.mjs`, and likewise `submit()` in `harness.mjs`, read the receipt without waiting for Anvil's asynchronous automine. Under paced recording, the read deterministically loses the race.

**Agent verification failure.** The earlier V4 validation, and the attempt-2 and attempt-3 preflights, all recorded this same `SETUP_TRANSACTION_FAILED` on synthetic state. The agent attributed it to the synthetic zero state without verifying it. That misattribution let a known failure reach the final attempt.

As the owner instructed, no repair or recording attempt was prepared. The finding is carried to BUILD-003F.

### Option B closure record (owner-approved 2026-09-24, DEC-0025)

**Decision.** The owner selected and approved Option B.

- BUILD-003D closes with only the implementation and acceptance evidence that passed offline.
- The successful Base recording and transcript, the fork application integration previously assigned to G6, the manual-wallet acceptance previously assigned to G7, and every dependent certification row move to **BUILD-003F**, which is not approved.
- BUILD-003E stays reserved for public-testnet evidence.
- No Amendment 7 and no further BUILD-003D recording attempt is permitted.
- DEC-0025 records the closure. ADR-0004 remains `PROPOSED`: its acceptance, earlier reserved for DEC-0025 in §3.19, moves to BUILD-003F.

**Reduced §11 for BUILD-003D delivery.** This replaces the 113-created and 51-modified lists. Every other path tracked at `8a5fbaed26e005e5719528c399f7ca1adb334eb6` stays byte-identical, and the G8 governance update enforces exactly these lists.

Delivered, created (66):

```text
apps/reference-dapp/e2e/fork/fork-setup.mjs
apps/reference-dapp/e2e/fork/harness.mjs
apps/reference-dapp/e2e/fork/replay-upstream.mjs
apps/reference-dapp/src/domain/mode-a.test.ts
apps/reference-dapp/src/domain/mode-a.ts
docs/adr/ADR-0003-mode-a-exact-payload-binding.md
docs/adr/ADR-0004-controlled-base-fork-environment.md
docs/builds/BUILD-003D-PLAN.md
docs/builds/BUILD-003D-REPORT.md
docs/contracts/ENFORCEMENT_MATRIX_V1.md
docs/contracts/MODE_A_EVM_PAYLOAD_V1.md
packages/reference-compiler/LICENSE
packages/reference-compiler/package.json
packages/reference-compiler/src/abi.ts
packages/reference-compiler/src/enforcement.ts
packages/reference-compiler/src/execution-plan.ts
packages/reference-compiler/src/fork-quote.ts
packages/reference-compiler/src/index.ts
packages/reference-compiler/src/manifest.ts
packages/reference-compiler/src/payload-digest.ts
packages/reference-compiler/src/payload.ts
packages/reference-compiler/src/policy.ts
packages/reference-compiler/src/profile.ts
packages/reference-compiler/src/review.ts
packages/reference-compiler/src/revocation.ts
packages/reference-compiler/src/rlp.ts
packages/reference-compiler/src/simulation.ts
packages/reference-compiler/test/abi.test.ts
packages/reference-compiler/test/anvil-compatibility.fork.test.ts
packages/reference-compiler/test/compile.fork.test.ts
packages/reference-compiler/test/compile.test.ts
packages/reference-compiler/test/fork-quote.test.ts
packages/reference-compiler/test/payload.test.ts
packages/reference-compiler/test/review.test.ts
packages/reference-compiler/test/rlp.test.ts
packages/reference-compiler/test/simulation.test.ts
packages/reference-compiler/tsconfig.json
packages/reference-executor/LICENSE
packages/reference-executor/package.json
packages/reference-executor/src/attempts.ts
packages/reference-executor/src/file-store.ts
packages/reference-executor/src/index.ts
packages/reference-executor/src/journal.ts
packages/reference-executor/src/recovery.ts
packages/reference-executor/test/attempts.test.ts
packages/reference-executor/test/file-store.test.ts
packages/reference-executor/test/journal.test.ts
packages/reference-executor/test/recovery.test.ts
packages/reference-executor/tsconfig.json
packages/reference-reconciler/LICENSE
packages/reference-reconciler/package.json
packages/reference-reconciler/src/evidence.ts
packages/reference-reconciler/src/index.ts
packages/reference-reconciler/src/raw-transaction.ts
packages/reference-reconciler/src/reconcile.ts
packages/reference-reconciler/test/evidence.test.ts
packages/reference-reconciler/test/raw-transaction.test.ts
packages/reference-reconciler/test/reconcile.test.ts
packages/reference-reconciler/tsconfig.json
packages/workflow-contracts/schemas/v1/enforcement-matrix.schema.json
packages/workflow-contracts/src/enforcement-matrix.ts
packages/workflow-contracts/test/enforcement-matrix.test.ts
scripts/bootstrap-anvil.py
scripts/summarize-screenshot-diffs.py
tests/compatibility/v1/enforcement-matrix.json
tests/compatibility/v1/mode-a-payload-vectors.json
```

Delivered, modified (26):

```text
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/package.json
apps/reference-dapp/src/components/workflow-canvas.tsx
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/LICENSE_MAP.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
package.json
packages/action-registry/package.json
packages/reference-linter/package.json
packages/workflow-contracts/package.json
packages/workflow-contracts/src/canonical.ts
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/src/schemas.ts
packages/workflow-contracts/test/canonical.test.ts
packages/workflow-contracts/test/contracts.test.ts
pnpm-lock.yaml
scripts/bootstrap-ci.py
```

Planned but not delivered; moved to BUILD-003F, created (47):

```text
apps/reference-dapp/e2e/fork/base-fork-transcript.json
apps/reference-dapp/e2e/fork/verify-manual-wallet.mjs
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts
apps/reference-dapp/e2e/mode-a-adversarial.spec.ts-snapshots/execute-divergent-wallet-payload-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fixtures.ts
apps/reference-dapp/e2e/mode-a-fork.spec.ts
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/execute-reconciled-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/fork-simulated-chromium-linux.png
apps/reference-dapp/e2e/mode-a-fork.spec.ts-snapshots/manifest-review-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-recovered-after-restart-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-result-unknown-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-revocation-confirmed-chromium-linux.png
apps/reference-dapp/e2e/mode-a-recovery.spec.ts-snapshots/execute-swap-reverted-residual-allowance-chromium-linux.png
apps/reference-dapp/e2e/visual-evidence/build-003d/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-expired-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-expired-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-recorded-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/observation-recorded-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/review-blocked-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-current-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-current-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-expired-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-expired-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-invalidated-before.png
apps/reference-dapp/e2e/visual-evidence/build-003d/simulate-invalidated-diff.png
apps/reference-dapp/src/app/mode-a-action.ts
apps/reference-dapp/src/components/execution-panel.tsx
apps/reference-dapp/src/components/fork-simulation-panel.tsx
apps/reference-dapp/src/components/manifest-review.tsx
apps/reference-dapp/src/server/fork-rpc.test.ts
apps/reference-dapp/src/server/fork-rpc.ts
apps/reference-dapp/src/server/mode-a-service.test.ts
apps/reference-dapp/src/server/mode-a-service.ts
apps/reference-dapp/src/state/mode-a-store.tsx
apps/reference-dapp/src/wallet/eip1193.test.ts
apps/reference-dapp/src/wallet/eip1193.ts
packages/reference-executor/test/restart.fork.test.ts
packages/reference-reconciler/test/reconcile.fork.test.ts
```

Planned but not delivered; moved to BUILD-003F, modified (25). The UI label stays `BUILD-003C`, so D-17 moves too:

```text
.gitignore
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/simulate-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/domain/contracts.integration.test.ts
docs/EVIDENCE_LEVELS.md
scripts/export-schemas.mjs
```

**Gate outcomes.**

| Gate | Outcome |
|---|---|
| G0 | Local acceptance passed (200/200 normal and 100/100 throttled expiry runs, five full-suite runs, and today's guarded suite 28/28 at zero pixels). CI without a rerun is pending on the pull request |
| G1 | `PASS`: 14/14, C1–C10, with the Amendment 6 exact command |
| G2 | `PASS` |
| G3 | `PASS` |
| G4 | `PASS` offline, together with the G5 incident repairs and the Amendment 6 derivation |
| G5 | `FAIL`: three attempts stopped. Recorded Base state moves to BUILD-003F |
| G6 | `NOT_RUN`: moved to BUILD-003F |
| G7 | `NOT_RUN`: moved to BUILD-003F |
| G8 | Governance updated to this reduced scope; local results are in the report |

**§1.5 rows.** No completion or certification claim is made.

| Row | Outcome |
|---|---|
| P1 | `PASS`: schema exports, contract tests and frozen trees |
| P2–P5 | `PASS` as regression: unit suite and 28/28 guarded browser suite |
| P8 | `PASS` for scripted inputs only: deterministic compile and material-change unit tests. No fork-derived artifacts exist |
| P10 | `PASS` as regression |
| P6, P7, P9, P11, P13, P14 and Master Spec Gate 3 | `NOT_RUN`: moved to BUILD-003F. Their scripted unit tests pass, but no recorded-fork, browser-fork or manual-wallet evidence exists |
| P12 | `NOT_PERFORMED` |

**Status.** BUILD-003 remains `IN_PROGRESS`, with certification `PENDING_OWNER_DECISION`. BUILD-004 planning is blocked until BUILD-003 certification, which requires BUILD-003F.

**BUILD-003F inputs.** These are findings to carry forward, not approved work:

- wait for transaction inclusion (not an immediate receipt read) in `send()` and `submit()`;
- an offline full-fixture rehearsal against locally deployed synthetic contracts before any recording;
- a recording budget that covers the OP-stack mining reads of every transaction;
- the retained Amendment 6 accounts;
- acceptance of ADR-0004;
- the §3.15 UI, application server and wallet paths;
- the D-17 label.

A new recording budget and provider session need BUILD-003F's own approval.

### DEC-0026 delivery-security correction (owner-approved; no new execution authority)

The historical Amendment 6 derivation and G1 C1–C10 logs and hashes remain evidence from the pre-removal candidate. The delivered tree contains no phrase, seed or reconstruction input. The acceptance-only harness requires an owner-controlled untracked mode-0600 secret file and checks derived public addresses against the ten pins before Anvil can start. BUILD-003D supplies no phrase and makes no new recording. Earlier G1 is HISTORICAL_PASS_PRE_SECRET_REMOVAL; final-byte pinned-account startup is DEFERRED_TO_BUILD_003F_OWNER_SECRET_REVALIDATION. This is no waiver or certification. DEC-0026 changes no path count, scope, provider authority or later-build approval. Gryloo remains a global online non-custodial multichain product; the fork and test accounts are acceptance infrastructure only.
