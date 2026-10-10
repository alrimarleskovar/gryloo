# BUILD-AUTOMATION-002 — Report: Generic Delegated Execution

Date: 2026-10-10. Branch `claude/build-automation-002-delegated-execution`, worktree `~/projects/gryloo-automation-002`. Local only:
nothing pushed, no PR, nothing merged. Plan: [BUILD-AUTOMATION-002-PLAN.md](BUILD-AUTOMATION-002-PLAN.md) (§18 records the restack and the
PR #76 / PR #77 composition).

**Update, later on 2026-10-10:** PR #77 merged (`c9f48d35aa251701f1082ba76174502686a62ba0`). The branch was restacked onto it once, and
step B of plan §18.4 (Chat and Canvas) was completed, partly by a second session that took over the worktree. **§22 records the takeover,
the PR #77 integration and the final gates.** Sections 1–21 are kept as written for the `974a7ac` delivery. Where a statement no longer
holds, an *Update* line says so; earlier evidence is not rewritten.

## 1. Base

Started on `7841d5657ec9a816140a180081178e2abbc27246` (PR #75, BUILD-AUTOMATION-001). Rebased on 2026-10-10 onto canonical main
`974a7acad6b117662d986254b9bc9e9be6e2a356` (PR #76, BUILD-EXECUTION-CONTINUITY-001). PR #76 shares no file with this branch and adds no
migration. PR #77 (BUILD-CANVAS-AUTOMATION-UX-002, head `69b4447936744d1f0bfc57535d6c36386765bbf2`) was **open and unmerged** throughout. It
was inspected read-only and nothing of it is in this branch. The pre-restack head is kept locally as `backup/automation-002-pre-restack-6bd85de`.

*Update:* the **canonical base is now `c9f48d35aa251701f1082ba76174502686a62ba0`** (PR #77 merged). The branch was rebased onto it once, from
`695f419` (kept as `backup/automation-002-pre-pr77-restack-695f419`). See §22.2.

## 2. HEAD

The last implementation commit is `b55b6ce`. This report and the final STATUS line are the commit after it, and the handoff message names
that final SHA. Versus `974a7ac`: 86 files changed (59 added, 27 modified; +8107/−70) before this report.

*Update:* after the PR #77 integration, see §22.1 and §22.11 for the commits on `c9f48d3` and the final HEAD.

## 3. Architecture

A second, explicit execution mode, `DELEGATED_WITH_LIMITS`, sits beside the unchanged default `CONFIRM_EACH_TIME`. Rules of both modes share
`automation_rules`, the scheduler and the evaluator. A delegated rule's occurrence becomes `DELEGATED` and enqueues the separate durable
work kind `delegation.execute`. It never creates an owner handoff.

Authority has three layers, and each is necessary.

1. **Credential grant (on-chain ceiling).** Once per Credential and chain, the owner's wallet signs a bounded grant to a FloFi session
   signer dedicated to that grant.
2. **Universal Workflow Authorization (one passkey signature per workflow revision).** A chain-neutral WebAuthn ES256 assertion over an
   envelope committing to owner, workflow hash, Delegated Authorization Manifest hash, the per-step Credential/grant commitments, chains,
   actions, limits, expiry, nonce, revision and environment. Each grant's enrollment commits to the same passkey (EVM: delegation `salt`;
   Solana: Memo), so the executor verifies wallet signature → passkey → workflow instead of trusting database rows.
3. **Execution-time checks.** For every step: re-verify the whole authority graph; atomically reserve budget in PostgreSQL; run a fresh
   simulation; check policy against the Manifest; re-check the authorization and grant inside the transaction that persists the signed
   submission (`SUBMISSION_PREPARED`); then broadcast, reconcile, settle and record evidence.

Every surface compiles to the same canonical objects: Chat (PR #77's grounded `AutomationInput`), the Automations form, and later the
Canvas → Workflow IR (`routeStrategy` / `composeWorkflowBound`) → Automation Rule → Manifest → authority graph → Universal Workflow
Authorization → durable run. `delegation/automation-source.ts` is the bridge from the canonical `AutomationInput`. Tests prove that a delegated
rule and a confirm-mode rule built from the same input bind the identical strategy and workflow hash.

**PR #76 semantics adopted.** Delegated browser requests reuse the shared wallets' semantic authority epoch; there is no second identity
model. An enrollment awaiting its wallet signature and an open Authorization Review survive passive synchronization. A genuine account,
chain or provider change, or a disconnect, discards them, and changing back never revives them. Persisted delegated authority is
independent of the browser. Each occurrence has one durable run; recovery reuses it. An `UNKNOWN` submission is never re-signed or rebuilt:
recovery only observes it and may re-broadcast the identical bytes.

## 4. Mechanisms evaluated and rejected

| Mechanism | Verdict |
| --- | --- |
| **ERC-7710, MetaMask Delegation Framework v1.3.0, owner = MetaMask EIP-7702 smart account** | **Selected for EVM** |
| ERC-7715 wallet permissions | Not selected: transfer-oriented permission types; no target, selector or recipient scoping for DeFi calls |
| ERC-7579 modular accounts / smart sessions | Not selected: funds would move to a new account; new dependencies |
| Safe + Zodiac Roles v2 | Not selected now: funds must live in a Safe; FloFi's pins are local-fork only |
| Custom EIP-7702 delegate | **Rejected**: an unaudited FloFi wallet surface; FloFi only verifies the owner's own MetaMask designator |
| SPL `ApproveChecked` to a session key | **Selected for Solana**, with its limits stated (§6) |
| Squads v4 / Swig | Not implemented: funds must move to a program wallet; no SDK or pin in the repository |

## 5. EVM capabilities (`EVM_ERC7710_METAMASK_V1_3`)

One EIP-712 `Delegation` per grant (domain `DelegationManager`/`1`/chainId/manager; `authority = ROOT`; delegate = session signer). The
caveats are Redeemer(session), Timestamp(validFrom, expiresAt), LimitedCalls(N) and ValueLte(0), plus one LogicalOrWrapper with two
complete call templates. The first is ERC-20 `approve` to the pinned router. The second is Uniswap v3 `exactInputSingle` with pinned
tokenIn and tokenOut, recipient = owner, and an ERC20BalanceChange per-call cap. Enforcer addresses come from the v1.3.0 deterministic
deployment, and enrollment fails closed if any enforcer code is absent. Revocation is the owner's self-call `disableDelegation`, verified
through `disabledDelegations`. The redemptions also pass the existing `verifyOwnerSubmission` (compatibility test). The codec was checked
against one real Base Sepolia MetaMask redemption: decode, signer recovery, and a byte-identical re-encode. Templates implemented: approve
and the Uniswap v3 exact-input single swap, on Base Sepolia and Ethereum Sepolia.

## 6. Solana capabilities (`SOLANA_SPL_DELEGATE_V1`)

One owner-signed transaction: a Memo anchoring the passkey, plus `ApproveChecked` to the grant's session key. The on-chain ceiling is the
total delegated amount per token account. **Recipient and program are not enforced on-chain**; FloFi enforces them at the application
gateway, and the Credential card and the review say so. Native SOL cannot be delegated (`NATIVE_SOL_NOT_DELEGABLE`). In production mode
FloFi's Orca builders sign as the owner, so `SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED`: **only the EVM adapter has a production-mode
execution path; the Solana swap step runs only in the MOCKED harness** (fixture swap program).

## 7. Capability matrix

| Action | EVM (Base Sepolia, Ethereum Sepolia) | Solana Devnet | Mainnets |
| --- | --- | --- | --- |
| Swap (Uniswap v3 exact-input single) | delegated (on-chain scoped) | MOCKED harness only | refused (`MAINNET_DELEGATION_DISABLED`) |
| ERC-20 approve (to pinned router) | delegated, as part of the swap | — | refused |
| Bridge (LI.FI / Across), EVM → Solana | `BRIDGE_ROUTE_UNAVAILABLE` / not scoped | — | — |
| Aave, Uniswap liquidity, Orca liquidity, Jupiter | `DELEGATION_TEMPLATE_NOT_IMPLEMENTED` / `OWNER_SIGNER_REQUIRED` | same | — |

## 8. Setup signatures

Registering a passkey takes a fresh wallet sign-in plus one passkey registration. Then **one wallet signature per Credential grant**: one
EIP-712 signature per EVM chain grant and one transaction per Solana wallet. Then **one passkey signature per workflow revision**, and zero
per occurrence or step. The browser journey asserts this for a two-domain workflow: two enrollment signatures, one passkey assertion, and no
wallet request or passkey use during execution.

## 9. Custody

The owner's keys are never requested, stored or derived. Session signers sit behind `DelegatedSignerProvider`. Owner operations get create
and destroy only (`SignerAdmin`); signing exists only in the executor (`SignerUser`); the database stores the opaque reference and public
address. Shipped providers: `memory` (tests), `local-disposable` (mode-0600 files under `/tmp`), and `none`. Hosted deployments refuse the
first two, so **production delegated signing is BLOCKED (`DELEGATED_SIGNER_UNAVAILABLE`)** until a custody provider (KMS/HSM) exists. The
plan's §6 names (`fixture`, `kms`) correspond to `memory` and to that missing provider. Key material never appears in logs, views,
`localStorage` or Git (boundary test).

## 10. Delegated Authorization Manifest (v1)

`flofi.delegated-authorization-manifest` v1 records: owner, authorization id, revision, validity and timezone; workflow (`EXACT`, hash,
engine version, step count); chains; actions; protocols and targets per chain; assets (role, per-execution cap, period budgets); recipients;
limits (executions per period, cooldown, slippage cap, quote max age of 120 s); per-step credential and grant commitments; and an
enforcement map that says, rule by rule, whether it is enforced on-chain (`SMART_ACCOUNT_MODULE_OR_GUARD:<mechanism>`) or by
`APPLICATION_GATEWAY`. Its canonical digest is domain-separated. A revision never mutates: re-authorizing creates a new revision, every
widening is named, and a new passkey signature is required.

## 11. Reservation

`reserve()` runs one PostgreSQL transaction under the authorization's row lock. It checks period budgets (day, week and month in the
authorization's timezone), executions per period and cooldown, then writes `RESERVED` budget entries. Settlement converts them to `SPENT`
with the reconciled amount. A run that is `BLOCKED` before any submission, or that fails with a proven revert, releases its entries. An
`UNCERTAIN` run never releases them. Ten concurrent reservations on separate connections admit exactly four of 50 within 200.

## 12. Revocation

"Revoke authorization" is immediate and local: the rule is paused, queued occurrences never execute, and the `SUBMISSION_PREPARED`
transaction re-checks state. Revoking a Credential makes FloFi stop using the grant at once and destroys the session key. The owner's own
wallet then disables the grant on-chain, and FloFi verifies it. A revocation made outside FloFi is observed (`ACTIVE → REVOKED`) and is
terminal.

## 13. Recovery

Fenced leases and CAS transitions apply throughout, with one execution per occurrence (unique). A crash after `SUBMISSION_PREPARED`
re-broadcasts the same persisted bytes. A submission the node lost is re-broadcast and never rebuilt. An on-chain revert is reconciled as
`FAILED`, or as `HALTED` with owner attention once an earlier step was irreversible. The owner's Resume reuses the same run and re-checks
everything.

## 14. Migrations

`0011_delegated_execution` is additive and pinned (sha256 `0c6572af…220202`). It widens the `execution_mode` CHECK to the two explicit
modes and adds an immutable `authorization_id`. It adds the occurrence state `DELEGATED` with a mode/state trigger that works both ways,
plus these tables: `passkey_credentials`, `passkey_challenges`, `execution_credentials`, `credential_grants`, `delegated_authorizations`,
`delegated_authorization_revisions`, `delegated_executions`, `delegated_execution_steps`, `delegated_budget_entries` (no delete) and
`delegated_events` (append-only). State machines and immutability are enforced by triggers. `0010` is not edited, and existing rules keep
`CONFIRM_EACH_TIME` with no in-place upgrade.

## 15. Test results (exact)

All gates ran locally on 2026-10-10 against the tree at `b55b6ce` (Node 24.21.0, pnpm 11.22.0; dependencies and lockfile unchanged), with
the self-hosted runner idle.

| Gate | Result |
| --- | --- |
| `TURBO_FORCE=true pnpm check` | **PASS**: typecheck 16/16 tasks; lint (packages, app, backend, e2e, scripts); build 9/9; `schemas:check` 11 exports; tests **304 files / 3150 passed**, 2 skipped (the existing optional fixture tests, not counted as passes) |
| `pnpm test:postgres` (loopback PostgreSQL 18.6) | **PASS**: **51 files / 329 tests** (includes this build's 27 delegation PostgreSQL tests) |
| Delegation, passkey and automation suites (unit + PostgreSQL) | **PASS**: 22 files / 204 tests |
| Governance Lite | **PASS** (`governance_lite.py`; 19/19 self-tests) |
| Guarded browser `delegated-execution` (new) | **PASS**: 1 test, passed in 3 consecutive runs (≈16 s each) |
| Guarded browser `automations` (CONFIRM_EACH_TIME) | **PASS**: 2/2 |
| Guarded browser `default-product` (shell, visual snapshots, Credentials) | **PASS**: 76/76 |
| Guarded browser `execution-continuity` (PR #76) | **PASS**: 3/3 |
| `git diff --check` | clean |

**Not run locally:** the other guarded product profiles, which this diff does not touch: review/execute components, workflow and
swap-read acceptance, provenance profiles, copilot, synthetic fork, CoW and card. CI runs all of them. No fork or public-testnet test was
required or run, because nothing here sends to a public chain.

New tests in this build:

| File | Tests |
| --- | --- |
| `packages/reference-compiler/test/erc7710.test.ts` | 21 |
| `src/delegation/domain.test.ts` | 54 |
| `src/delegation/automation-source.test.ts` | 5 |
| `src/delegation/boundaries.test.ts` | 7 |
| `src/delegation/erc7710-vector.test.ts` | 1 (real Base Sepolia redemption vector) |
| `src/passkeys/webauthn.test.ts` | 17 |
| `src/components/wallet-authority-epoch.test.tsx` | 5 (real shared wallet store) |
| `src/delegation/executor.pg.test.ts` | 13 |
| `src/delegation/adversarial.pg.test.ts` | 4 |
| `src/delegation/credentials.pg.test.ts` | 6 |
| `src/delegation/migration.pg.test.ts` | 3 |
| `src/delegation/compatibility.pg.test.ts` | 1 |
| `e2e/delegated-execution.spec.ts` | 1 Chromium journey (10 phases) |

During browser bring-up the journey exposed a real race: "Enroll with my wallet" for a Solana Credential could be clicked before the
Solana proof re-rendered, which refused the request with `WALLET_SESSION_REQUIRED`. The button now waits for the proof.

## 16. Evidence maturity

| Level | Status |
| --- | --- |
| Domain implemented | yes (EVM + Solana adapters, executor, store, UI) |
| Fixture / MOCKED | yes: PostgreSQL integration and Chromium journey on loopback chain doubles. EVM enforcement is a **JavaScript model** of the v1.3.0 enforcers, not their bytecode; the Solana swap is a fixture program |
| Local fork | **no** (no run against the deployed Delegation Framework bytecode) |
| Public testnet | **no** transaction by FloFi; one real public redemption was only decoded and verified |
| Independent verification | codec vector against real chain data; the existing `verifyOwnerSubmission` accepts the redemptions |
| Production delegated authority | **no**: blocked by missing custody |

No `FORK_REPRODUCED`, `TESTNET_EXECUTED`, mainnet or production claim is made. "Generic multichain autonomous execution" is demonstrated
only on MOCKED transports.

## 17. Unsupported cases (fail closed with a precise code, never substituted)

These cases fail closed: mainnets; bridges and EVM → Solana routes; Aave, liquidity and Jupiter; native SOL; production Solana swaps;
saved-workflow sources for delegated rules (`DELEGATED_SAVED_WORKFLOW_NOT_IMPLEMENTED`); daily watches and notify-only triggers
(`DELEGATION_NOT_APPLICABLE`); and any step without an active, sufficiently scoped Credential, refused before anything is created.
Telegram notifications for delegated results are not implemented. The Automations UI authors schedule triggers; price triggers are
accepted by the API and the canonical bridge.

*Update (§22):* chat now authors delegated price triggers, both absolute and percentage, from the canonical `AutomationInput`. "Automate
this workflow" refuses any Canvas node that FloFi cannot reproduce exactly (`AUTOMATION_WORKFLOW_NOT_REPRESENTABLE`), and also refuses
empty workflows, workflows over four steps and out-of-order dependencies, all before anything is created. The Canvas cannot author a
multi-domain swap workflow (§22.7), so EVM + Solana delegated workflows come from the Automations form.

## 18. Production blockers

1. Custody for session signers (KMS/HSM, non-exportable, per-grant isolation, audit). Without it production delegated signing stays blocked.
2. A local-fork run against the real v1.3.0 bytecode, then an owner-operated public-testnet rehearsal.
3. A Solana delegated swap builder; also Swig or Squads if program-scoped authority is required.
4. Per-chain RPCs, monitoring and alerting, and an owner-facing runbook for `UNCERTAIN` and `HALTED` runs.
5. PR #77 integration (step B of plan §18.4): the mode choice on chat proposals, Canvas "Automate this workflow", and a shared
   authorization-details component. **Not implemented here**, because PR #77 is unmerged.
   *Update:* this is no longer a blocker. It was implemented after PR #77 merged (§22.6–22.7), with one deviation: the delegated Review
   follows PR #77's compact pattern but does not reuse its `ReviewAuthorizationDetails` component (§22.7).

## 19. Safety invariants and evidence

| # | Invariant | Evidence |
| --- | --- | --- |
| 1 | per-execution limit | domain `refuses a spend above the per-execution limit`, `a changed amount`; on-chain per-call cap (adversarial: more input reverts) |
| 2 | cumulative budget | executor.pg `the cumulative weekly budget stops the third daily execution before anything is signed` |
| 3 | parallel workers cannot overspend | adversarial `ten concurrent reservations … exactly four of 50 within 200` |
| 4 | revoked authority cannot start | executor.pg `revoking the authorization pauses the rule …`, `a revocation between simulation and submission …`; browser step 9 |
| 5 | expired authority cannot execute | executor.pg `an authorization that expires between the trigger and execution cannot execute`; credentials.pg `expired grants …`; domain `refuses after the authorization expired` |
| 6 | unauthorized token | domain `another token`, `an unexpected output token`; adversarial (other token reverts on-chain) |
| 7 | unauthorized chain | domain `another chain` (CHAIN_NOT_AUTHORIZED); authority graph refusals |
| 8 | unauthorized target/protocol | domain `an unauthorized contract`, `another protocol`; adversarial (other target reverts on-chain). Solana program: application-enforced only |
| 9 | slippage cap | domain `a higher slippage`, `a minimum output below the cap`, `a slippage cap below the workflow` |
| 10 | workflow mutation invalidates | executor.pg `a changed workflow (rebind) invalidates eligibility until a new revision is signed` |
| 11 | replay cannot create another spend | adversarial passkey assertion/challenge replay; webauthn counter replay; persisted-bytes re-broadcast (one spend) |
| 12 | duplicate work | executor.pg `two workers delivering the same occurrence produce one execution and one spend` |
| 13 | stale simulation | domain `a stale quote` (QUOTE_EXPIRED); executor.pg `a price move after simulation …` |
| 14 | missing grant on any step fails before irreversible execution | executor.pg `a missing Solana Credential fails the workflow before authorization …`, `an under-scoped Credential is named per step` |
| 15 | failed/uncertain does not wrongly release budget | executor.pg crash-after-prepare, lost submission, revert (released only after reconciliation) |
| 16 | another wallet cannot use the authorization | executor.pg `… another owner can neither see nor use the authorization`; adversarial passkey anchoring |
| 17 | backend compromise bounded on-chain | adversarial `the session key alone can only do what the grant scoped …`, `the call-count ceiling …` (EVM, against the enforcer **model**) |
| 18 | `CONFIRM_EACH_TIME` unaffected | AUTOMATION-001 unit and PostgreSQL suites; `automations` browser profile; migration test (existing rules stay confirm-mode) |

## 20. Changes to existing tests (explained for owner review)

- `src/automations/boundaries.test.ts`: the AUTOMATION-001 assertion "never offers another execution mode" became "never creates delegated
  authority". Automation modules may now carry an explicitly created `DELEGATED_WITH_LIMITS` rule through, but still never create
  authority, a session key or a signer. New assertions pin that the automation input has no mode field, that the automation service never
  creates a delegated rule, and that 0011's CHECK admits exactly the two modes and stores no key material.
- `src/automations/migration.pg.test.ts`: the 0010 suite is bounded to the first ten migrations, as 0010 bounded the 0009 suite.
- No test was deleted or skipped.

## 21. Recommended PR

Title: `BUILD-AUTOMATION-002: generic delegated execution ("Automatic within limits")`

Body: summary of §3; capabilities and honest limits from §5–§7; setup signatures (§8); custody blocked in production (§9); migration 0011
(§14); exact gates (§15); evidence MOCKED only (§16); production blockers (§18); invariant table (§19); the two intentional test changes
(§20); PR #77 follow-up (§18 item 5).

*Update:* base `c9f48d3`. Add the PR #77 integration (§22.6–22.8), the takeover record (§22.1–22.5) and the final gates (§22.11). PR #77 is
no longer a follow-up.

## 22. Takeover and PR #77 integration (2026-10-10)

### 22.1 State found at takeover

A second session took over the worktree `~/projects/gryloo-automation-002` on branch `claude/build-automation-002-delegated-execution`. It
inspected the state before editing anything and did not reset, clean, pull, re-rebase or recreate anything.

| Item | Found |
| --- | --- |
| `origin/main` | `c9f48d35aa251701f1082ba76174502686a62ba0` (PR #77 merged) |
| HEAD | `f8019e7` "Chat and Canvas wiring on PR #77 (plan §18.4 step B)", 16 commits ahead of `origin/main` |
| Merge base with `origin/main` | `c9f48d3`: **the restack onto PR #77 was already done** (reflog: rebase onto `c9f48d3` at 21:40, `f8019e7` at 22:07) |
| Pre-restack backup | `backup/automation-002-pre-pr77-restack-695f419` (= the `974a7ac` delivery `695f419`) |
| Uncommitted | one file: `e2e/copilot/replay-v2.json`, +26 lines, one replay entry (the typed `PRICE_TRIGGER` / `PERCENT_DROP` draft for "If ETH drops 5% from $3000, buy 50 USDC of ETH on Base Sepolia automatically, max 200 USDC/week."), not referenced by any spec yet |
| Untracked files, stash entries | none |
| Report / plan | still described the `974a7ac` delivery (step B "not implemented") |

`f8019e7` already contained the step-B implementation: percent triggers in the chat draft, the chat card's mode choice, Canvas
"Automate this workflow" (`automations/automation-steps.ts`, `components/canvas-automation.tsx`, the `CANVAS_WORKFLOW` source), and the
one shared delegated flow (`DelegatedLimitsFlow`), with unit tests. It had no browser journey for chat or Canvas, and its gate results were
not recorded. The taking-over session first re-ran focused checks on it: the delegation, automation, chat-grounding, passkey and
wallet-epoch unit suites (10 files, 152 tests), the app typecheck and ESLint over every file the branch changes. All passed.

### 22.2 PR #77 restack (done before the takeover, verified, not repeated)

The restack is verified by the merge base and by `git range-diff 974a7ac..695f419 c9f48d3..64a88e9`. Thirteen of the fifteen commits are
identical. Two commits (`645f69a` PT catalog/styles, `69484de` browser journey) changed in three files. All three conflicts were
mechanical, and both sides were kept:

| File | Conflict | Resolution |
| --- | --- | --- |
| `src/app/globals.css` | both appended at the end (PR #77: `.review-authorization-details`, `.copilot-automation-proposal`, lifecycle rules) | PR #77's rules first, then the delegation styles |
| `src/i18n/pt.ts` | both inserted beside `...portugueseAutomations` | `...portugueseDelegation` kept first, so existing product words keep precedence; PR #77's new strings kept |
| `scripts/guarded-release-browser.mjs` | PR #77 added `canvas-automation-ux` and `chat-automations` and changed the `automations` filter to `e2e/automations.spec.ts` | PR #77's profiles kept; `delegated-execution` stays after them, and its filter becomes `e2e/delegated-execution.spec.ts` (same convention; matches exactly one file) |

PR #77 adds no migration, so `0011_delegated_execution` keeps its number and pin. No other file needed resolution. PR #77's own files
(chat draft and card, Canvas, shell) are changed only by step B (`f8019e7`, `70371cf`). Those changes extend PR #77's behaviour and replace
none of it. The one non-additive effect: the strict chat draft schema now requires the `percent` key (§22.12).

### 22.3 Changes retained

Everything was retained: all 16 commits (including `f8019e7`) and the uncommitted replay entry. The entry is now used by the chat journey
and is committed in `70371cf`.

### 22.4 Work completed by the taking-over session

| Commit | Change | Why |
| --- | --- | --- |
| `70371cf` | `e2e/delegated-execution.spec.ts`: the one-time enrollment (passkey, EVM and optionally Solana Credential) becomes a helper `enrollOnce`; journey 1 keeps every assertion. Two new journeys: **Chat** and **Canvas** (§22.6, §22.7) | step B listed "a browser journey from chat to an active delegated rule"; the Canvas entry had no browser evidence either |
| `70371cf` | `replay-v2.json`: the retained entry | the chat journey's typed AI draft |
| `70371cf` | `delegated-execution` profile sets `FLOFI_COPILOT=replay` | the chat journey uses the committed replay; the spec throws `REPLAY_REQUIRED` without it rather than skipping |
| `70371cf` | chat card: "Automatic within limits" is offered from the **proven owner's** delegation availability (`useDelegation`, as the Automations workspace does). When the executor is blocked it is disabled and shows the reason; it is hidden once the authorization is active; and the owner object is stabilised | `f8019e7` gated the choice only on `delegationEnabled()`. A deployment with `FLOFI_DELEGATION=enabled` but no signer would have offered a choice that then fails at the authority check (fail-closed, but contrary to plan §17, which says it is "shown unavailable"). The radio could also appear before the wallet was proven, above a disabled confirm-mode button |
| `70371cf` | Canvas panel: the limits flow remounts when the derived steps change; a signed authorization refreshes the Automations lists | a check of an older workflow can never be created; the new automatic workflow appears at once in "Automatic within limits" |
| docs | plan §18.5, this §22, *Update* lines | the takeover record |

No other source change was needed. No test was deleted, skipped or weakened.

### 22.5 Conflicts and resolutions during the takeover

There were no merge conflicts (no rebase was needed). Two findings changed the plan instead of the code:

1. **PR #77's `ReviewAuthorizationDetails` is not reused** (plan §18.3 e said it would be). It projects the per-transaction browser
   Review (`projectReview`: Strategy Manifest, wallet, network, approvals, expiry of one simulation), which a delegated authorization does
   not have. The delegated Review follows PR #77's rule instead: a compact list of steps and limits, enforcement under a disclosure, and no
   raw Manifest JSON in the normal product. It renders nothing with `<pre>` or `JSON.stringify`.
2. **The Canvas cannot author a multi-domain swap workflow** (main, unchanged). It refuses a Solana swap beside other steps
   (`SOLANA_SWAP_ISOLATED_ONLY`). `reference-linter` requires every EVM swap to be on the workflow's one trusted chain
   (`INVALID_SWAP_DECLARATION`). Its cross-chain workflows are bridge compositions, which are not delegable. A unit case for a
   Base + Solana Canvas workflow was tried, failed on the Canvas's own rule, and was removed; the plan documents the limit instead
   (§18.5).

### 22.6 Chat integration

PR #77's proposal flow is extended; there is no second chat system.

```
message → untrusted typed AutomationDraft (AI: interpretation only; no mode, limit, expiry, Credential or scope field)
        → groundAutomationDraft (every value must be in the user's words) → canonical AutomationInput → PR #77's preview card
        → owner: "Ask every time" (default) │ "Automatic within limits" (explicit click; offered only if the proven owner's deployment serves it)
        → owner enters expiry, executions per week, max per execution and budget per week (nothing prefilled)
        → "Check credentials and limits": the authority graph over every step (Credential, namespace, chain, mechanism, actions,
          assets, targets, caps, expiry, revocation, production capability), before anything exists
        → "Create and review authorization": a PAUSED rule + a PENDING_SIGNATURE authorization (source AUTOMATION_INPUT, compiled server-side
          by delegation/automation-source.ts through routeStrategy / composeWorkflowBound)
        → Universal Authorization Review → ONE passkey assertion → ACTIVE
```

The AI never chooses the mode, the limits, the expiry, the Credentials or the scope. The draft schema has no field for any of them.
"Automatically" in a message preselects nothing, and a limit stated in the message ("max 200 USDC/week") is not prefilled. The browser
journey asserts both. The one deterministic value is the route's slippage (50 bps), the same FloFi default as confirm mode, not an AI
output; the owner sees it as the editable slippage cap. Percentage triggers need the percentage, the direction and the reference price in
the user's words. "If ETH drops 5%, …" with no reference gets the question "From which USD reference price should the percentage be
measured?", because FloFi never infers a reference from the current price.

The user's example as one journey (`Chat: the owner — not the assistant — chooses …`):
"If ETH drops 5% from $3000, buy 50 USDC of ETH on Base Sepolia automatically, max 200 USDC/week." → the card shows "Price falls 5% from
$3000" with "Ask every time" checked → the owner checks "Automatic within limits" and types 50 USDC per execution, 200 USDC per week, four
executions per week and an expiry → the authority check names the enrolled EVM Credential → the Review lists exactly those limits and
"1 Credential(s) already enrolled — no new wallet signature is needed" → the rule is `PAUSED` / `DELEGATED_WITH_LIMITS` until the one
passkey assertion, then `ACTIVE`. At $3000 the rule arms. At $2850 there is one occurrence `price:1`, `DELEGATED`, with no handoff, and it
`SETTLED` with evidence `MOCKED` and 50 USDC spent. There is no wallet request and no second passkey use.

### 22.7 Canvas integration

PR #77's Canvas lifecycle (Simulate → Approve & Continue → Execute) is unchanged. "Automate this workflow" is an additional button on the
Build Canvas, shown only where automations are enabled and the Canvas has an action. It opens Automations on **the exact workflow in the
Canvas**: the shared shell state, with no copy and no re-entry.

```
Canvas workflow → "Automate this workflow" → Automations: steps re-derived from the document (automation-steps.ts, exact node
reproduction through FloFi's engine, Canvas order; any difference → precise refusal, nothing created)
→ schedule (frequency, day, time, time zone) → mode: "Ask every time" (AUTOMATION-001's own form, prefilled; one-step only)
  │ "Automatic within limits" → limits (editable defaults from the amounts the owner authored on the Canvas) → authority check
→ "Create and review authorization" (source CANVAS_WORKFLOW: the server re-derives the steps from the document; no steps, hash or mode
  from the browser is accepted) → Universal Authorization Review → ONE passkey assertion → ACTIVE
```

The rule binds the canonical compiled workflow hash. It is the same hash AUTOMATION-001's saved-workflow binding gives the same Canvas
workflow (unit test), and the same one the Automations form and chat produce for the same steps. A delegated occurrence never enters the
Canvas: PR #77's internal handoff stays exclusive to `CONFIRM_EACH_TIME`, and a `HALTED` / `UNCERTAIN` run is never turned into a Canvas
Execute. The Canvas entry authors schedule triggers; delegated price triggers come from chat or the API.

Browser journey (`Canvas: "Automate this workflow" …`): two Base Sepolia swaps authored on the Canvas through FloFi's deterministic grammar
and the normal proposal review → the panel lists `Step 1 · 50 USDC → WETH · Base Sepolia`, `Step 2 · 40 USDC → WETH · Base Sepolia` →
"Ask every time" is the default and explains that it runs one-step workflows only → automatic → both steps covered → defaults 90 USDC per
execution / 360 per week → one passkey assertion → Active in "Automatic within limits" → the weekly slot gives one `DELEGATED` occurrence →
`SETTLED`, `MOCKED`, with both steps spent (50 and 40 USDC) in order and no owner signature.

### 22.8 Single-workflow authorization semantics

For an enrolled EVM Credential and an enrolled Solana Credential, a workflow over both is **one** FloFi workflow authorization: one
WebAuthn ES256 assertion by the owner's passkey over a chain-neutral envelope. The envelope commits to the owner, the workflow hash, the
Delegated Authorization Manifest hash, every step's Credential and grant commitments, chains, actions, limits, expiry, nonce, revision and
environment. Underneath, each domain keeps its own mechanism and its own on-chain ceiling:

| Domain | Enrolled once, in Credentials | What executes a step |
| --- | --- | --- |
| EVM (Base Sepolia, Ethereum Sepolia) | one EIP-712 signature per chain grant: an ERC-7710 delegation (MetaMask DF v1.3.0) to a dedicated session signer, scoped by caveats, with the passkey anchored in its `salt` | the session signer redeems the delegation |
| Solana Devnet | one owner-signed transaction per wallet: SPL `ApproveChecked` to a dedicated session key, plus a Memo anchoring the passkey | the session key spends within the delegated amount (MOCKED harness only, §6) |

An EVM signature never authorizes Solana, and the reverse is also true. The passkey assertion authorizes FloFi to use, for this one
workflow and within its limits, the grants that each wallet already signed for its own domain. The executor verifies the chain: each
wallet's own grant → the passkey anchored in it → the workflow. After enrollment, nothing asks the owner's wallets or passkey again: not
per step, and not per occurrence. The three journeys assert this with wallet request logs and the authenticator's sign counter. A
material change (workflow, limits, Credentials) needs a new authorization revision with a new passkey signature. The old revision is never
revived.

"Base → Arbitrum → Solana" is not executable today, and it fails closed before anything is created or signed. Arbitrum is reachable only by
a bridge: LI.FI is not target-scopable (`DELEGATED_TARGET_SCOPE_UNAVAILABLE`), Across has no template
(`DELEGATION_TEMPLATE_NOT_IMPLEMENTED`), and there is no EVM → Solana route (`BRIDGE_ROUTE_UNAVAILABLE`). The authority graph resolves
every step before reservation and before the first irreversible submission, and re-checks before each step. An early step never runs
when a later step lacks authority (executor.pg: `a missing Solana Credential fails the workflow before authorization …`).

### 22.9 Credentials semantics

- Wallets are registered **once** in Credentials, by a wallet this browser proved (`WALLET_SESSION_REQUIRED` otherwise), anchored to one
  passkey. A workflow whose Credentials anchor different passkeys is refused (`CREDENTIALS_USE_DIFFERENT_PASSKEYS`).
- Each grant has its own on-chain scope: EVM token pairs, per-call input cap (default 100 USDC), call count (default 40), validity window
  and recipient = the owner's wallet; Solana the delegated amount, with recipient and program enforced by FloFi only. FloFi checks the
  workflow against every grant before creating anything. A missing or under-scoped grant is named per step, and the owner is sent to
  Credentials ("Enroll the missing Credentials in Credentials, then check again. Nothing was created.").
- Chat and Canvas never pick Credentials: the authority graph resolves them from the owner's own active grants.
- Saved authority has its own lifecycle (PR #76): a MetaMask account or chain switch does not end it. Owner revocation, an observed
  on-chain revocation, expiry, exhausted scope (calls or amount), passkey revocation or a material workflow change ends it, and each of
  these is terminal. Browser-held, not-yet-persisted authority does follow the wallet epoch: an enrollment awaiting its signature, a
  revocation request, or an open Review is discarded by a genuine provider, account or chain change and never revived.
- Revoking a Credential stops FloFi's use at once and destroys the session key. The owner's own wallet then disables the grant on-chain,
  and FloFi verifies it (journey 1, step 10).

### 22.10 Evidence level (unchanged)

All delegated execution evidence, including the two new journeys, is **MOCKED**. The chains are loopback doubles. EVM enforcement is a
JavaScript model of the MetaMask v1.3.0 enforcers, not their bytecode. The Solana swap is a fixture program. Signers are disposable files
under `/tmp`. The passkey is a virtual authenticator. The chat draft is a committed replay. There was no fork run, no public-testnet
transaction and no production signing. Hosted production signing stays **blocked** (`DELEGATED_SIGNER_UNAVAILABLE`, no KMS/HSM custody).
Only the EVM adapter has a production-mode execution path, and unattended Solana production execution is not proven. No fixture signing
is presented as production signing.

### 22.11 Final tests

The final gates ran on 2026-10-10, sequentially, with the self-hosted CI runner idle (checked before each run), on the tree at **`70371cf`**.
The final commit after it changes only this report and the plan. Node 24.21.0, pnpm 11.22.0; lockfile and package manifests are unchanged
versus `c9f48d3`.

| Gate | Result |
| --- | --- |
| `TURBO_FORCE=true pnpm check` | **PASS** (3 min 25 s): typecheck 16/16 tasks (0 cached); lint; build 9/9 (0 cached); `schemas:check` 11 exports verified; tests **310 files / 3219 passed**, 2 files skipped (`composition-service.test.ts`, `mode-b-service.test.ts`: the existing optional fixture suites on main, not counted as passes) |
| `pnpm test:postgres` (loopback `postgres:18.6-bookworm@sha256:3725f4e2…`, the CI pin) | **PASS**: **51 files / 329 tests** |
| Governance Lite (`scripts/governance_lite.py`) | **PASS** (1708 text files); self-tests **19/19** |
| Guarded browser `default-product` | **PASS 76/76** |
| Guarded browser `execution-continuity` (PR #76) | **PASS 3/3**. The runner script was edited while this run was in progress, and bash re-executed the run's last line, so Playwright ran twice back to back: 3/3 both times |
| Guarded browser `automations` (AUTOMATION-001, `CONFIRM_EACH_TIME`) | **PASS 2/2** |
| Guarded browser `canvas-automation-ux` (PR #77) | **PASS 18/18** |
| Guarded browser `chat-automations` (PR #77) | **PASS 8/8** |
| Guarded browser `delegated-execution` (Automations form, Chat, Canvas) | **PASS 3/3** |
| `delegated-execution`, three separate clean runs | **3/3, 3/3, 3/3** (≈23 s each). Each run had its own `flofi_e2e_<time>_<pid>` database, dispatch tokens, `/tmp` signer and price directories, and chain harness |
| Also run, as relevant to the chat panel and shell changes | `copilot` **13/13**; `review-execute-recovery-components` **39/39** |
| `git diff --check` (`c9f48d3..HEAD` and the working tree) | clean |

Each profile ran through a local wrapper that applies exactly the env and spec filters `scripts/guarded-release-browser.mjs` gives that
profile (it evaluates the script's own `profiles` list). The remaining product profiles (24 in all) were not run locally; CI runs them all.
Nothing reached a public chain or provider, apart from `default-product`'s existing read-only LI.FI quote.

Focused compatibility runs during the takeover, before the final gates:
- unit: the delegation, automation, chat-grounding, passkey and wallet-epoch suites (10 files / 152 tests); then the replay, step-B and
  component suites (26 files / 344 tests);
- browser: `chat-automations` 8/8, `automations` 2/2, `canvas-automation-ux` 18/18, `execution-continuity` 3/3 and `delegated-execution`
  3/3. The first `delegated-execution` run failed in one assertion of the new chat journey. The regex `\b50 USDC per execution\b` could
  not match because list items concatenate in `textContent` ("…execution200 USDC…"); the rendered limits were correct. The assertion
  became an exact per-item check of the limits list.

New or extended tests from step B, all passing:

| File | Tests |
| --- | --- |
| `src/automations/automation-steps.test.ts` (new in `f8019e7`) | 8 |
| `src/delegation/automation-source.test.ts` | 8 (5 → 8) |
| `src/domain/copilot-automation.test.ts` (PR #77's file) | 29 (22 → 29) |
| `e2e/delegated-execution.spec.ts` | 3 journeys (1 → 3) |

### 22.12 Changes to existing tests (explained for owner review)

- `e2e/delegated-execution.spec.ts` (this build's own journey): steps 1–4 moved verbatim into `enrollOnce`. Every assertion of journey 1 is
  kept, and the Solana enrollment runs only when asked, so journey 1 still enrolls both domains. The execution/budget SQL moved into
  helpers with the same queries.
- From `f8019e7` (step B, before the takeover): the committed replay drafts and the `copilot-automations.spec.ts` draft gain
  `percent: null`. `AutomationDraft` is a strict schema and now has that field. Behaviour is unchanged, and `chat-automations` passes 8/8.
- No test was deleted, skipped or weakened.
