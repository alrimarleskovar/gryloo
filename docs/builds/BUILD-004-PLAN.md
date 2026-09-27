# BUILD-004 — Finite Mode B authority

**Status:** APPROVED for local implementation by the owner under DEC-0031; D-1 selected Safe 1.4.1 + Zodiac Roles 2.1.0 with FORK_REPRODUCED ceiling. Amendment A-1 (DEC-0032, §14) adds one created path, two direct dependency edges and the owner-selected local-fork state construction. Planning baseline: `05910364feac7f9fe0856a5c2c197eeeb12db902` on local `main`, local `origin/main`, and GitHub `main` (read-only GitHub ref check, 2026-09-27). Planning branch: `codex/build-004-plan`. This document alone grants no implementation, provider, wallet, public-chain, paid-service or financial-execution authority.

## 1. Single objective

Deliver one user-reviewed, finite Mode B Uniswap swap workflow on a controlled local chain-31337 Base fork: after the owner installs bounded authority through a wallet, a deterministic executor can complete the permitted action with the browser closed and after a worker restart, while direct calls outside Gryloo fail for wrong receiver, token, chain, target, function, amount, replay, expiry, revocation and concurrent budget use at the effective independent boundary. The user can inspect installation signatures, active permissions, native-unit remaining budget, residual token allowances, execution state, confirmed revocation and independently reconciled evidence in the Gryloo DApp.

This is one BUILD-004 with one acceptance and delivery decision. Product behavior is the primary deliverable; records and gates support it. BUILD-004 does not become a lettered certification program.

## 2. Relationship to v3.2 and certified inputs

- **Source:** Master Spec §§1, 3, 5, 7–8, 10–13, 16.2–16.4, 17, 19, 21 Phase 3, 22 and 28 Gate 4; Master Prompt §§1–5 (Build 004), 8, 9 and 11. The exact Build 004 objective is **finite Mode B authority**, not a new product direction.
- **Thesis preserved:** Gryloo remains a global, online, non-custodial multichain workflow compiler and bounded executor. Chat and canvas share one Semantic Workflow IR. The user directs the strategy and authorizes through their wallet. The local fork is acceptance infrastructure; the roadmap still includes CoW, Uniswap liquidity, LI.FI, direct Across, Aave, Jupiter on Solana, one of Orca or Raydium, Mode C after Mode B, and the embedded platform. Base is the current EVM maturity path; Solana remains required for non-EVM portability, with Robinhood Chain, Ethereum and Tempo retained at their stated priority and eligibility gates.
- **Dependency certification:** DEC-0030 certified BUILD-003 `COMPLETE / CERTIFIED: FORK_REPRODUCED` **only on local chain 31337**. Its real Base state was read to construct the controlled fork; it is not a public-chain transaction or production result. BUILD-003E remains reserved for future public-testnet evidence and is not a prerequisite inserted into this one build.
- **Consumed artifacts:** the accepted ADR-0002 hash/wire profile and frozen v1 compatibility corpus; BUILD-003A's shared chat/canvas IR and deterministic linter; BUILD-003B's separately labeled `MOCKED` artifact chain (as a negative boundary); BUILD-003C's separately labeled read-only observations (never authority inputs); ADR-0003's exact-payload profile and enforcement matrix; BUILD-003D's pure compiler, journal, recovery and reconciler packages; and BUILD-003F's credential-free finalized Base transcript, byte-identical closed replay, fork harness, Mode A service, wallet bridge, visual baselines and G7 local-fork evidence. The certified BUILD-003F transcript is reused without a new provider recording. Its signed Mode A result cannot be relabeled Mode B proof.
- **Capability dependency:** BUILD-004 proves one isolated finite delegated swap path. Master Spec §19's eventual **composed** Mode B workflow is satisfied at the later composition gate (Master Prompt Build 007), after liquidity passes its own gates. BUILD-004 must not claim that later composition is complete.

### Existing, missing, conflict and decision status

| Area | State at baseline | BUILD-004 treatment |
|---|---|---|
| Canonical artifacts, hashes, IR and Mode A local fork | Existing and locally certified by DEC-0030 | Reuse; add only versioned Mode B meaning, never mutate frozen v1 semantics |
| Independent Mode B permission, browser-independent worker and onchain budget | Missing; ADR-0001 `PROPOSED` | Build and prove as one finite path after authority selection |
| Public testnet/mainnet, production executor key and provider authority | Not approved or evidenced | Remain unavailable; no upward evidence claim |
| Spec versus Build 004 sequencing | No conflict: Phase 3 proves authority; Build 007 composes swap with liquidity | Preserve both gates and all required networks |
| Authority mechanism and its precise signed/enforced limits | Genuine owner decision | Recommendation in §13; prove each limit before accepting ADR-0001 |

## 3. Authorized implementation scope after approval

### Product journey

1. The user authors the same isolated Base USDC↔WETH swap through chat or canvas and sees one revisioned IR. A material edit invalidates the reviewed quote, simulation, policy, Manifest and installation request.
2. Gryloo validates the recorded-fork state, exact assets and contracts, simulates the bounded action and failures, and compiles a Mode B policy and Manifest with a new domain-separated binding to the enforcing permission configuration. It displays the owner account and threshold, source Safe/account, executor identity, chain, target, selector, token, recipient, exact or bounded amount, cumulative native-unit budget, nonce/replay rule, expiry, quote deadline, gas payer, token allowance, and revocation method. Every rule has an honest enforcement location. Any rule unavailable at the independent boundary is `APPLICATION_GATEWAY`, `MONITOR_ONLY` or `NOT_ENFORCED`, and cannot be presented as a certified Mode B maximum.
3. The user reviews and performs distinct wallet operations for account/module setup, any finite token allowance, and permission installation as required by the selected mechanism. Gryloo never asks for a phrase or private key. A signed permission or installation transaction must bind the effective limits; a database Manifest hash alone is insufficient. Show the exact signatures before request.
4. A local deterministic worker with a test-only executor identity persists the Execution ID, workflow/segment/step/attempt state and budget reservation before submission. It can resume from durable state when the browser is closed and after a fresh worker process starts. It may call only the selected authority path; it has no arbitrary transaction endpoint. If submission is unknown, reconcile chain nonce, receipt, permission consumption and balances before any replacement.
5. Direct adversarial calls to the module/account, bypassing UI and server API, must fail at the independent mechanism or at an explicitly named protocol-verifier boundary for every mandatory negative case. Concurrency must not consume more than the single finite cumulative budget. A successful action is independently reconciled against signed permission, call bytes, receipts, balances, fees, output recipient, token allowance, module/role/session state and residual effects.
6. The user sees local pause separately from wallet-authorized revocation. Only a chain-confirmed disable/revoke plus independent readback may display `REVOCATION_CONFIRMED`. Previously confirmed effects remain irreversible; residual token allowance is shown and, where nonzero, separately revoked or clearly left as remaining authority.

### Proposed authority profile for the owner decision

Recommend a **Safe smart account with Zodiac Roles Modifier** on the Base-derived local fork, with one disposable test owner (threshold 1 of 1) and one distinct disposable test executor identity. Pin Safe 1.4.1 source tag `bf943f80fec5ac647159d26161446ac5d716a294`, Roles contract package 2.1.0 and its exact source/deployment/ABI/code hashes in the accepted ADR before first installation; use the official published Base Roles deployment only after verifying its code at the recorded source block, or deploy that exact verified bytecode locally. The only financial target is the existing approved Uniswap swap path; disable delegatecall and arbitrary ETH value. Scope call parameters and a non-refilling one-time native-unit allowance on the independent modifier. Bind a fixed protocol deadline as part of the allowed call so that an expired call fails at the router even if a role remains listed. An active but economically unusable role is still displayed as active until actually revoked. **Expiry is an acceptance gate, not an assumed Roles feature:** if any allowed financial call can still succeed after the signed expiry, the selected profile fails and ADR-0001 stays `PROPOSED`; no weaker label or silent mechanism substitution is permitted. Inspect Safe owners/threshold/module list and Roles owner, role member, target/function conditions, one-time allowance and upgrade authority directly at the fork before enabling the worker. Keep the executor's local test key outside Git and outside the browser; it never represents a production credential.

The mechanism recommendation is based on official Safe module documentation and Zodiac Roles' published parameter conditions and one-time allowances. Upstream facts must be pinned and verified against actual local code; a mutable documentation page, SDK output or subgraph is not enforcement evidence. No third-party contract source or bytecode is copied into Git by default.

### Out of scope

No provider request, new live Base recording, public testnet or mainnet transaction, production deployment or key, user funds, paid service, agent-held user key, Mode C recurrence, CoW order, liquidity composition, bridge, lending, Solana implementation, partner platform, package publication, or unrestricted executor. BUILD-004 proves the bounded authority primitive needed by those later builds; it does not delete or defer their approved roadmap place. No change to Master Spec, Master Prompt, accepted ADR-0002/0003/0004, frozen v1 schemas/hash fixtures or historical reports.

## 4. Authority, artifacts and security boundaries

- **Mode:** `MODE_B_FINITE_DELEGATION` only for the approved chain-31337 acceptance profile. No production Mode B enablement. A model proposal, chat string, partner data or mock observation cannot install permission or submit.
- **Independent enforcement:** Safe ownership/module route and the selected Roles contract constrain the executor's target, selector, parameters and non-refilling cumulative spend/call budget; the swap contract enforces its exact deadline and minimum output where applicable. Chain ID is bound by the local deployment and signed transaction domain. The onchain role/allowance state is authoritative for spending; the durable worker reservation prevents duplicate dispatch but is not advertised as equivalent to onchain enforcement. Gas payer/gas cap and any limit that the mechanism cannot enforce independently are labeled at their real location and cannot be used to claim a stronger policy.
- **Signature/hash binding:** define an additive Mode B permission profile and reviewed-installation hash covering account, chain, Roles address/code identity, owner/threshold, executor, role, allowed call tree, token, recipient, native-unit per-call and cumulative bounds, expiry, nonce/replay and revocation scope. Prove the wallet-installed configuration equals the review and Manifest commitments by independent reads, or block the flow. Preserve frozen DWE-HASH v1 domain semantics; use a new version/domain for new material, with compatibility fixtures. The Manifest records the effective mechanism and each unenforced field truthfully.
- **Key boundary:** user owner signature only through injected EIP-1193 wallet on local chain; no owner key in app/server/repository. Disposable local executor key may exist only in the acceptance harness/worker's owner-controlled private runtime, never in code, logs, snapshots, journal or browser. No long-lived production key or remote signer is authorized. A compromised worker with that key must still fail the bypass tests at the module/protocol boundary.
- **Execution and recovery:** append-only fsynced journal; unique Execution ID, step ID, attempt ID and idempotency key; atomic local reservation before send; module's one-time allowance resolves concurrent spending onchain. Restart reloads prior state and reconciles. Null receipt, timeout and provider inconsistency are `INCONCLUSIVE` until stronger chain checks; no blind retry, cleanup, automatic replacement or broader route.
- **Revocation/upgrade:** wallet-controlled disable/revoke, onchain confirmation and direct readback, remaining token allowance and role/module permissions shown separately. Local pause cannot revoke. Owner/threshold, module and upgrade bypass are explicit adversarial tests. No account upgrade or change to Safe owner, threshold or role admin is performed outside the reviewed setup/revoke procedure.

## 5. Evidence target and acceptance criteria

**Maximum environment:** `FORK_REPRODUCED` on local chain 31337 with the BUILD-003F credential-free Base source transcript. Synthetic fixtures and unit/browser simulations are `MOCKED`; read-only source observations remain `NOT_EVIDENCE`. A submitted tx may first be `CONFIRMED_NOT_RECONCILED`; only independent invariant checks permit `RECONCILED`. Disagreement is `DIVERGENT`, unresolved reads are `INCONCLUSIVE`. No `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, production or public-chain claim is permitted.

Completion requires all of the following on final bytes:

- [ ] One real local-fork user journey: chat/canvas equivalence, quote, chained single-workflow simulation, reviewed Mode B policy/Manifest, distinct installation signature(s), browser close, worker restart, finite execution, journal and `RECONCILED` Evidence Bundle. The DApp displays current permission, cumulative remaining budget, residual token allowance and confirmed revocation.
- [ ] Accepted ADR-0001 identifies exact mechanism, source and deployed bytecode hashes, chain/account, owners/threshold, Roles admin, executor key boundary, limits, expiry, nonce, revocation, upgrade and emergency procedure, audits and limits the mechanism cannot independently enforce. Acceptance follows successful boundary proof, not a proposal alone.
- [ ] Outside-UI/API direct-call tests reject wrong receiver, token, chain/domain, target, selector, one native unit above the amount, cumulative overspend, replay, expired authority, revoked authority, simultaneous competing consumption, arbitrary value/delegatecall, altered policy/Manifest binding, and owner/module/upgrade bypass attempts. A weaker application-only failure is insufficient for a claimed independent rule.
- [ ] Unknown submission, pending, revert, restart, duplicated trigger, inconsistent RPC, post-swap residual allowance and revocation race produce honest state, no duplicate effect and independently checked funds/permission location.
- [ ] No mocked or BUILD-003C observation object can become a Mode B authorization input; IR remains free of mutable quote, simulation, runtime and evidence state. Frozen v1 schemas, fixtures, hashes and previous build evidence stay byte-identical.
- [ ] All §7 gates pass; report truthfully states what a user can use, how to test locally, what remains for BUILD-005 and whether BUILD-004 is complete. If any independent limit cannot be proven, BUILD-004 is incomplete and no delegated/autonomous claim is made. Do not split merely to award partial certification.

## 6. Package, dependency, license and notice consequences

- Reuse existing private `@defi-workflow-engine/reference-compiler`, `reference-executor`, `reference-reconciler`, `workflow-contracts`, `action-registry`, `reference-linter` and `reference-dapp`. Add no package. The one additive Mode B hash domain/API raises `workflow-contracts` from `0.2.0` to `0.2.1`; its six workspace consumers change only their exact `workspace:0.2.0` edge to `workspace:0.2.1`, and `pnpm-lock.yaml` records those edges. The `reference-*` and app package versions stay `0.1.0`; other direct and transitive versions stay pinned. `reference-compiler`, `reference-executor`, `reference-reconciler`, linter and app stay AGPL-3.0-only; additive contract/compatibility documentation stays Apache-2.0. The existing v1 schemas and vectors are protected.
- Planned new **registry dependency: none**. Amendment A-1 records two new direct edges on already-locked identities: `reference-executor` depends on `@noble/curves` 2.4.0 and `@noble/hashes` 2.4.0 for its local secp256k1 signer. The locked registry identity count stays 247. Use pinned ABI definitions and existing code for compilation/transport; do not adopt a Safe transaction service, SDK, bundler or new contract build stack merely for convenience. Use official Safe/Roles source and deployment artifacts only as digest-verified, test-time external inputs; do not vendor or redistribute contract binaries. If technical proof makes an additional package essential, select an exact version within the approved AGPL/Apache boundary, review its full transitive license/SRI/security graph and record it in plan and report before installation; a materially new distribution obligation returns to the owner under the execution policy.
- Existing 247 locked registry identities, 16 license exceptions, official legal texts, patches and preserved third-party notices are the baseline. No change to grants, `LICENSES/**`, `NOTICE`, `THIRD_PARTY_NOTICES.md` or trademark rights is planned. Update `docs/LICENSE_MAP.md` only to reflect exact new original paths and verified upstream artifact treatment; retain the Sharp/libvips distribution caveat. An LGPL upstream source or compiled artifact entering Git would require explicit license/notice review, not silent Apache classification.
- All local test phrases/keys and any future credential files are untracked, restricted and deleted at completion. No repository or CI artifact may contain them. No paid service or provider is used for this build's planned local acceptance.

## 7. Required gates

| Gate | Required proof |
|---|---|
| Unit | Native-unit bounds, canonical binding, decoded review, expiry and revocation state, atomic reservation, journal/idempotency, restart and reconciliation; negative property vectors |
| Contract/compatibility | Strict raw ingress; additive Mode B fixture and independent hash vectors; old v1 schema/fixture/tree digests unchanged; material edit changes correct hashes and invalidates dependent authorization |
| Integration/local fork | Pin and verify official Safe/Roles source/deployment/code, account owners/threshold and module state; perform reviewed setup, direct bypass transactions, one-time budget concurrency and worker restart on chain 31337; no external RPC |
| Browser/E2E | Chat/canvas round trip; installation review and signature count; browser closed/returned status; active permissions, remaining budget, residual allowance, `INCONCLUSIVE`/`DIVERGENT`/`RECONCILED`, pause versus confirmed revoke; network guard permits loopback only |
| Accessibility/visual | Keyboard and visible focus, labeled financial units/states, status not encoded by color alone, loading/error/recovery states; reviewed before/after/diff images for Build, Simulate and Execute changes; stable zero-pixel baselines after fonts/viewport settle |
| Dependency/security | Exact tool and source pins; frozen install; complete license/SRI/age inventory for all locked resolutions; low-level audit, secret scan including Git objects, no key in logs/argv/evidence, basic SAST/source-boundary review and negative tests |
| SBOM | Ephemeral CycloneDX 1.6 with exact component/workspace reconciliation and logged digest; no claim of a retained file |
| Governance/delivery | Exact created/modified/deleted path sets, protected baseline byte check, spec/prompt/ADR history checks, scope/claim/license checks, `git diff --check`, typecheck, lint, build, schema export, all relevant unit/fork/browser tests, green PR and post-merge CI on intended revision |

Do not rerun BUILD-003F's paid/read-only provider recording or owner G7 wallet ceremony: their retained evidence is a certified dependency, not BUILD-004 proof. Any new wallet ceremony is limited to the local Mode B installation/revocation and is performed by the owner when a real injected-wallet acceptance is necessary. Pure and synthetic tests run first.

## 8. Exact expected files after implementation approval

**Create** (all exact paths):

- `CLAUDE.md` (Amendment A-1, owner instruction), `docs/builds/BUILD-004-PLAN.md` (created in this planning turn), `docs/builds/BUILD-004-REPORT.md`, `docs/contracts/MODE_B_FINITE_AUTHORITY_V1.md`, `tests/compatibility/v1/mode-b-permission-vectors.json`;
- `packages/reference-compiler/src/mode-b.ts`, `packages/reference-compiler/test/mode-b.test.ts`, `packages/reference-compiler/test/mode-b.fork.test.ts`;
- `packages/reference-executor/src/mode-b.ts`, `packages/reference-executor/test/mode-b.test.ts`, `packages/reference-executor/test/mode-b.fork.test.ts`;
- `packages/reference-reconciler/src/mode-b.ts`, `packages/reference-reconciler/test/mode-b.test.ts`, `packages/reference-reconciler/test/mode-b.fork.test.ts`;
- `apps/reference-dapp/src/server/mode-b-service.ts`, `apps/reference-dapp/src/server/mode-b-service.test.ts`, `apps/reference-dapp/src/app/mode-b-action.ts`, `apps/reference-dapp/src/state/mode-b-store.tsx`, `apps/reference-dapp/src/components/mode-b-panel.tsx`;
- `apps/reference-dapp/e2e/fork/mode-b-harness.mjs`, `apps/reference-dapp/e2e/mode-b-fork.spec.ts`, `apps/reference-dapp/e2e/mode-b-adversarial.spec.ts`, `apps/reference-dapp/e2e/mode-b-fork.spec.ts-snapshots/mode-b-review-chromium-linux.png`, `apps/reference-dapp/e2e/mode-b-fork.spec.ts-snapshots/mode-b-reconciled-chromium-linux.png`, `apps/reference-dapp/e2e/mode-b-fork.spec.ts-snapshots/mode-b-revoked-chromium-linux.png`;
- `apps/reference-dapp/e2e/visual-evidence/build-004/build-before.png`, `apps/reference-dapp/e2e/visual-evidence/build-004/build-diff.png`, `apps/reference-dapp/e2e/visual-evidence/build-004/simulate-before.png`, `apps/reference-dapp/e2e/visual-evidence/build-004/simulate-diff.png`, `apps/reference-dapp/e2e/visual-evidence/build-004/execute-before.png`, `apps/reference-dapp/e2e/visual-evidence/build-004/execute-diff.png`.

**Modify** (all exact paths):

- `.github/workflows/contracts.yml`, `.github/workflows/governance.yml`, `README.md`, `package.json`, `pnpm-lock.yaml`, `scripts/bootstrap-ci.py`;
- `apps/reference-dapp/package.json`, `apps/reference-dapp/src/app/globals.css`, `apps/reference-dapp/src/components/app-shell.tsx`, `apps/reference-dapp/src/components/execution-panel.tsx`, `apps/reference-dapp/src/components/manifest-review.tsx`, `apps/reference-dapp/src/components/simulate-panel.tsx`, `apps/reference-dapp/src/components/status-badge.tsx`, `apps/reference-dapp/src/components/summary-bar.tsx`, `apps/reference-dapp/src/components/top-bar.tsx`, `apps/reference-dapp/src/state/workflow-store.tsx`, `apps/reference-dapp/e2e/interface-honesty.spec.ts`, `apps/reference-dapp/e2e/network-isolation.spec.ts`, `apps/reference-dapp/e2e/visual-shell.spec.ts`;
- `packages/reference-compiler/package.json`, `packages/reference-compiler/src/index.ts`, `packages/reference-executor/package.json`, `packages/reference-executor/src/index.ts`, `packages/reference-reconciler/package.json`, `packages/reference-reconciler/src/index.ts`, `packages/reference-linter/package.json`, `packages/action-registry/package.json`, `packages/workflow-contracts/package.json`, `packages/workflow-contracts/src/index.ts`, `packages/workflow-contracts/src/canonical.ts`, `packages/workflow-contracts/test/canonical.test.ts`, `packages/workflow-contracts/test/contracts.test.ts`;
- `docs/adr/ADR-0001-mode-b-authority.md`, `docs/AUTHORITY_MATRIX.md`, `docs/DECISIONS.md`, `docs/EVIDENCE_LEVELS.md`, `docs/LICENSE_MAP.md`, `docs/NEXT_BUILD.md`, `docs/REQUIREMENTS.md`, `docs/SCOPE_GUARD.md`, `docs/SECURITY_MODEL.md`, `docs/STATUS.md`;
- `apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png`, `apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png`, `apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png`.

Amendment A-1 makes the exact counts 31 created and 45 modified paths.

**Delete:** none. **Protected:** exactly the other 325 tracked paths at baseline `05910364feac7f9fe0856a5c2c197eeeb12db902` (370 tracked minus the 45 exact Modify paths) is byte-identical and mode-identical; every new path must occur in Create. In particular protect `docs/specs/MASTER_SPEC_V3.2.md`, the Master Prompt, accepted ADR-0002/0003/0004, all BUILD-000 through BUILD-003F historical plans/reports, `apps/reference-dapp/e2e/fork/base-fork-transcript.json`, `apps/reference-dapp/e2e/observations/base-recorded-observations.json`, `packages/workflow-contracts/schemas/v1/**`, existing `tests/compatibility/v1/**`, all legal text/patches/notices/assets and existing source/snapshots not individually listed above. No wildcard authorizes a new file. An optional file is either produced at its listed path or absent; a new path outside this list needs an updated plan before implementation, not an unreviewed silent addition.

## 9. Delivery and rollback

After owner approval, implement the working journey first on `codex/build-004-plan`, then run focused proof, full local gates, prepare the report/current governance records, and commit reviewable conceptual units. Routine code, dependency, TypeScript, CI and snapshot corrections within the approved authority and path list are engineering choices. Push and open/update one PR when authentication permits; fix failed CI autonomously within scope. Return to the owner for final merge decision after a green, reviewable PR. Do not auto-merge. On completion, `docs/NEXT_BUILD.md` points **directly to BUILD-005 planning**; no BUILD-004A/B or extra certification build is inserted.

Rollback before merge: disable the Mode B UI/worker flag, stop the local worker, inspect and revoke any local role/module permission through the owner wallet, independently confirm removal, clear remaining local token allowance with a separately reviewed wallet action when necessary, and discard the branch or revert its commits without changing BUILD-003. After merge, revert the BUILD-004 commits and keep the runtime disabled until permission state is independently confirmed; a Git revert or stopped worker never revokes onchain authority. Retain non-secret journals and evidence for investigation. No public-chain rollback procedure is asserted because public-chain deployment is outside this build.

## 10. Risks and stop conditions

- Zodiac Roles' scoped conditions or one-time allowance might not express all required nested Uniswap call parameters or effective expiry on the chosen path. A failed direct boundary test stops Mode B certification. Do not replace it with an application-only check or a custom high-authority guard without an owner security-boundary decision.
- Safe module installation, owner/upgrade powers and leftover ERC-20 allowance can exceed the finite worker permission. Show each separately and test owner bypass; do not claim the role caps the owner's direct Safe authority.
- The BUILD-003F transcript may lack data for a new contract read. Reuse it for Uniswap state and deploy verified Safe/Roles artifacts locally; do not make an unapproved provider request or reinterpret historical recordings.
- A local disposable executor key demonstrates separation and enforceability, not production key management. Public deployment, paid infrastructure, legal release and external security review remain later gates.
- A new third-party artifact or dependency with material distribution obligations, a need for live provider/paid service or real wallet/public-chain transaction, or a change to a protected source-of-truth requirement triggers the owner's narrow decision under the standing execution policy.

## 11. Completion and next build

BUILD-004 is **complete** only when the user-visible finite Mode B local-fork flow, independent bypass and restart proofs, honest UI, reconciliation, all §7 gates, final report, exact-scope governance, PR checks, merge decision and post-merge checks are satisfied. Its report must plainly answer: what the user can now do, how to test it locally, what remains for BUILD-005, and whether complete. Certification, if approved, is capped at `FORK_REPRODUCED` on chain 31337; the record must never promote DEC-0030 or BUILD-004 to public-chain or production evidence.

The next dependency-ordered build is **BUILD-005 — CoW signed-intent adapter**, reusing the same semantic swap action with its distinct EIP-712 order, posting ambiguity, tracking, expiry, cancellation and settlement evidence. It requires its own plan and approval, while the rest of the Master Spec's EVM, cross-chain, Solana, Mode C and embedded capabilities stay on the roadmap. No additional BUILD-004 certification sub-build is required.

## 12. Ordinary engineering choices delegated by plan approval

Within the fixed objective, paths and authority profile, the implementer may choose internal types, file organization inside listed files, test fixtures inside listed test paths, exact CI command ordering, retry polling intervals that do not weaken safety, UI wording faithful to evidence, and corrections for tests, toolchain or snapshots. Fix CI and update the plan/report when a minimal in-scope correction is necessary. This is not a request for separate owner approval. No new provider, chain, protocol, credential flow, contract authority, license obligation or widened file scope is delegated.

## 13. Genuine owner decision for implementation approval

**D-1 — Select the Mode B enforcement architecture and local evidence ceiling. Recommended:** approve the bounded Safe 1.4.1 + Zodiac Roles 2.1.0 profile in §3, with exact code/deployment pins and every signed/enforced limit recorded in ADR-0001 before installation; accept `FORK_REPRODUCED` chain-31337 as BUILD-004's maximum evidence. Implementation may proceed through ordinary corrections without more checkpoints. If the official mechanism cannot enforce the mandatory expiry/parameter/budget cases, stop the affected authority path and return with the concrete failed proof and an alternative mechanism; do not certify partial Mode B.

**Alternative:** select another established smart-account/session/intent mechanism through a revised ADR and path/dependency plan before implementation. **Defer:** retain ADR-0001 as `PROPOSED` and leave Mode B unavailable.

No owner decision is requested for routine tests, CI, snapshots, TypeScript fixes, internal component design or the later BUILD-005 roadmap. Wallet signature/secret input, public-chain action, paid service, material new license obligation, protected source change or irreversible/security-boundary expansion remains an owner decision if actually encountered.

Primary mechanism references checked during planning (2026-09-27): [Safe smart-account overview](https://docs.safe.global/advanced/smart-account-overview), [Safe module installation](https://docs.safe.global/reference-smart-account/modules/enableModule), [Zodiac Roles source and license](https://github.com/gnosisguild/zodiac-modifier-roles), [Zodiac parameter conditions](https://docs.roles.gnosisguild.org/general/conditions), and [Zodiac one-time allowances](https://docs.roles.gnosisguild.org/general/allowances). These references support the recommendation; exact behavior must pass the local boundary tests above.

## 14. Amendment A-1 (2026-09-27, owner-recorded under DEC-0032)

The owner confirmed DEC-0031 and directed the completion of BUILD-004 after a prior implementation session ended incomplete. This amendment records only the following changes. No other authority changes.

1. **Created path.** The owner instructed that `CLAUDE.md` be added at the repository root. It records the Master Prompt §0 authority hierarchy and conflict protocol for coding agents and adds no authority. It is Apache-2.0 like `README.md`.
2. **Dependency edges.** `packages/reference-executor/package.json` adds direct dependencies on `@noble/curves` 2.4.0 and `@noble/hashes` 2.4.0. Both identities were already locked and license-reviewed under BUILD-003D, so this adds no registry identity, license exception or notice. `scripts/bootstrap-ci.py` allows exactly these two edges. The earlier report statement that only six workspace edges changed was incorrect and is corrected in the report.
3. **Closed-replay local fork construction.** The certified BUILD-003F transcript is served unmodified and closed; it never synthesizes a response. The earlier ephemeral replay extension, which answered unrecorded reads with zeros, was removed and its evidence discarded. Anvil 1.8.3 cannot create any account that the transcript never observed, so `apps/reference-dapp/e2e/fork/mode-b-harness.mjs serve` builds the Mode B state as follows:
   - **Local-only declarations.** It declares, through `anvil_loadState`, only local-only accounts:
     - disposable owner and executor keys generated for the run;
     - a hash-derived deployer;
     - that deployer's CREATE targets.
   - **Deployment.** It deploys the digest-pinned official Safe 1.4.1 `SafeL2` and `SafeProxy` artifacts, the Roles 2.1.0 `Integrity` and `Packer` libraries, the ERC-2470 singleton factory init code and Roles 2.1.0, all by real transactions. Roles is re-linked, as a linker would, from the official Integrity, Packer and ERC-2470 factory addresses to those local deployments. The relinking is checked by exact occurrence counts.
   - **Condition pointers.** Roles stores each condition tree at a CREATE2 pointer of that local factory. The harness front forwards every request and response verbatim. Before a request containing a `scopeFunction` payload, it declares the pointer local-only only after deriving it exactly through the local `Packer` and the local factory. A CREATE2 descendant of a local-only factory cannot have Base state.
   - **Owner-selected LOCAL_SETUP.** Three Base-contract slots keyed by the new Safe are absent from the transcript. The owner chose explicit local initialization for exactly these slots, labelled `LOCAL_SETUP_NOT_BASE_OBSERVED`:
     - WETH `balanceOf(Safe)` = 2 WETH, backed by an equal ETH increase on WETH;
     - WETH `allowance(Safe, Router02)` = 0;
     - USDC `balanceOf(Safe)` = 0.

   Every other read of Base state comes from the certified transcript or fails. The external inputs are supplied outside Git and pinned by SHA-256:
   - Safe `SafeL2.json` `a57d54c0…`;
   - Safe `SafeProxy.json` `b05eaeaf…`;
   - Roles `mastercopies.json` `a80d737a…`;
   - ERC-2470 init code `dae33ba7…`, byte-identical to the specification.
4. **Test invocation.** The Mode B fork runs beside Mode A's synthetic E2E servers:
   - lineage front on `127.0.0.1:18545`, Anvil on `18547`, certified replay handler on `18546`;
   - the harness writes the profile and a mode-0600 key file under `GRYLOO_MODE_B_RUNTIME`;
   - the real browser specs run under the unchanged Playwright configuration with `GRYLOO_MODE_B=fork`, `GRYLOO_MODE_B_PROFILE` and `GRYLOO_MODE_B_EXECUTOR_KEY_FILE` set;
   - the Mode B fork tests run with `GRYLOO_MODE_B_SMOKE_PROFILE` and `--no-file-parallelism`, because they share one fork.
5. **Visual baselines.** With Mode B off, the three `visual-shell` baselines still match at zero pixels, so they are not modified. The Mode B screens are recorded as before/diff evidence under `e2e/visual-evidence/build-004/`.
