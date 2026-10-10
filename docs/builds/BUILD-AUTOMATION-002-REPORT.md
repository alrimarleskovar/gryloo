# BUILD-AUTOMATION-002 — Report: Generic Delegated Execution

Date: 2026-10-10. Branch `claude/build-automation-002-delegated-execution`, worktree `~/projects/gryloo-automation-002`. Local only:
nothing pushed, no PR, nothing merged. Plan: [BUILD-AUTOMATION-002-PLAN.md](BUILD-AUTOMATION-002-PLAN.md) (§18 records the restack and the
PR #76 / PR #77 composition).

## 1. Base

Started on `7841d5657ec9a816140a180081178e2abbc27246` (PR #75, BUILD-AUTOMATION-001). Rebased on 2026-10-10 onto canonical main
`974a7acad6b117662d986254b9bc9e9be6e2a356` (PR #76, BUILD-EXECUTION-CONTINUITY-001). PR #76 shares no file with this branch and adds no
migration. PR #77 (BUILD-CANVAS-AUTOMATION-UX-002, head `69b4447936744d1f0bfc57535d6c36386765bbf2`) was **open and unmerged** throughout. It
was inspected read-only and nothing of it is in this branch. The pre-restack head is kept locally as `backup/automation-002-pre-restack-6bd85de`.

## 2. HEAD

The last implementation commit is `b55b6ce`. This report and the final STATUS line are the commit after it, and the handoff message names
that final SHA. Versus `974a7ac`: 86 files changed (59 added, 27 modified; +8107/−70) before this report.

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

## 18. Production blockers

1. Custody for session signers (KMS/HSM, non-exportable, per-grant isolation, audit). Without it production delegated signing stays blocked.
2. A local-fork run against the real v1.3.0 bytecode, then an owner-operated public-testnet rehearsal.
3. A Solana delegated swap builder; also Swig or Squads if program-scoped authority is required.
4. Per-chain RPCs, monitoring and alerting, and an owner-facing runbook for `UNCERTAIN` and `HALTED` runs.
5. PR #77 integration (step B of plan §18.4): the mode choice on chat proposals, Canvas "Automate this workflow", and a shared
   authorization-details component. **Not implemented here**, because PR #77 is unmerged.

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
