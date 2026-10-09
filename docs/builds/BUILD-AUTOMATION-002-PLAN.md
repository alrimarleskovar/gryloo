# BUILD-AUTOMATION-002 — Plan: Generic Delegated Execution

Date: 2026-10-10. Branch `claude/build-automation-002-delegated-execution` (worktree `~/projects/gryloo-automation-002`), from main
`7841d5657ec9a816140a180081178e2abbc27246` (PR #75: BUILD-AUTOMATION-001, `CONFIRM_EACH_TIME`; migrations end at `0010_automations`).
One coherent build, developed and validated locally, pushed once by the owner. Nothing is pushed, no PR is opened and nothing is merged
by the agent.

Historical context, read-only: BUILD-016 / Mode C (`codex/build-016-mode-c-automation`, ADR-0007: one Safe/Roles conditional swap on
chain 31337) and PR #66. Nothing is cherry-picked or revived. Lessons kept from BUILD-016: reserve before dispatch in one durable
transaction; persist the signed submission before broadcast; an uncertain result never releases budget; revocation has distinct
requested / submitted / confirmed states; already-submitted transactions are reconciled, never described as undone.

> **Framing.** AUTOMATION-001 evaluates and asks the owner every time. AUTOMATION-002 adds an explicit second mode,
> `DELEGATED_WITH_LIMITS`: the owner authorizes the scope **in advance**, once, and FloFi then executes each occurrence without a new
> owner signature — but only while every on-chain grant it needs is active and verified, only inside the limits the owner signed, only
> after a fresh simulation shows the occurrence still fits those limits, and only after its budget is atomically reserved. AI is never
> authority. `CONFIRM_EACH_TIME` is unchanged and remains the default.

## 0. What the repository actually offers (inspection summary)

| Area | Fact on main `7841d56` | Consequence |
| --- | --- | --- |
| Workflow IR | StrategySpec v1 (one action) and v2 (1–8 steps), `composeWorkflowBound`, `semanticWorkflowHash` / `workflowSequenceHash` | The authorization binds this hash; no second IR |
| Multi-step execution | `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED` for the owner path; `SEQUENTIAL` plan kind reserved "for the sequential runner" | The delegated runner is that sequential runner, for delegated mode only |
| Owner execution | Browser-signed flows (`backend/flows.ts`): prepare/simulate → review → begin → wallet result → observe → reconcile → Evidence Bundle | Step drivers reuse the flow services; only the submitter changes |
| Delegated redemptions | `verifyOwnerSubmission` already accepts and reconciles one canonical **MetaMask Delegation Framework v1.3.0** redemption (`redeemDelegations`, depth 1–2, EIP-7702 `EIP7702StatelessDeleGator` owner, `RedeemedDelegation` logs) for the Base Sepolia swap, Uniswap liquidity and Router flows | An ERC-7710 redemption by a FloFi session signer is already reconcilable by existing flows |
| Mode B / C | Safe 1.4.1 + Zodiac Roles 2.1.0, local chain 31337 only (ADR-0001/0005/0007); pinned inputs downloaded by CI, never in Git | Strong on-chain periodic allowances, but funds must live in a Safe; local-fork only |
| Credentials | `domain/credentials.ts`: browser-local public wallet references and tokenized cards; "Saving authorizes nothing" | Execution-enabled Credentials are new, server-side, and separate from these references |
| Passkeys | `/app/passkeys` is a disabled "Coming soon" placeholder; **no WebAuthn code exists** | Minimal WebAuthn (ES256) is built here with `node:crypto`; no new dependency |
| Owner identity | Proven wallet principals (EIP-4361 and Sign-In With Solana HttpOnly sessions); automations are owned by `(namespace, account)` | The FloFi owner stays the automation owner principal; other-namespace wallets are linked as Credentials when proven in the same browser |
| Durable work | `work_items` (dedupe, fenced leases, retry, DEAD), `createWorker`, Railway worker sweep | Delegated execution is a work kind on the same queue |
| Boundaries | Scheduler/evaluator/API/BFF import closures contain no signing (`boundaries.test.ts`); worker flow transports are observe-only (`WORKER_SUBMISSION_FORBIDDEN`) | Signing lives only in a new, separately enabled executor module with its own boundary test |
| Cross-chain | Router: Base ↔ Arbitrum USDC only (LI.FI or direct Across); **no EVM → Solana route** | EVM → Solana is classified `BRIDGE_ROUTE_UNAVAILABLE`; the authority graph still models it |

## 1. Authority model

Three layers; each is necessary, none is sufficient alone.

1. **Credential grant (on-chain, per authority domain).** Once per Credential grant, the owner's wallet signs a bounded delegated
   authority to a FloFi **session signer** dedicated to that grant. This is the hard ceiling: where the mechanism enforces it, a
   compromised FloFi cannot exceed it. It is a *capability class* (chain, protocols/targets/selectors, token pairs, recipient pinned
   to the owner, per-call input cap, total call count, validity window, redeemer = the session signer), not a workflow. It is part of
   the Credential enrollment lifecycle, not of a workflow.
2. **UniversalWorkflowAuthorization (off-chain, per workflow revision, ONE passkey signature).** A chain-neutral envelope over the
   exact canonical workflow hash, the DelegatedAuthorizationManifest hash (limits, budgets, chains, actions, assets, recipients, time),
   the exact Credential/grant ids and grant commitments it uses, a nonce, the revision and the FloFi environment. The owner signs it
   with a WebAuthn passkey (not a blockchain signature: an EVM signature is never presented as Solana authority or vice versa).
   Enforced by FloFi's executor (`APPLICATION_GATEWAY`), always bounded by layer 1.
3. **Execution-time checks (deterministic).** Before every occurrence: authority graph re-verification, atomic budget reservation,
   fresh simulation compared with the Manifest, re-check of authorization state in the same transaction that prepares the submission.

**Anchoring.** Each grant's owner-signed enrollment commits to the owner's authorization passkey (EVM: the delegation `salt` is a
domain-separated hash of the passkey's public key and the credential id; Solana: a Memo instruction in the owner-signed delegation
transaction). The executor therefore verifies a cryptographic chain *wallet signature → passkey → workflow authorization* and does not
trust database rows for it: an attacker who can write rows but holds neither the passkey nor a wallet key cannot mint an authorization
the executor accepts.

**Execution modes.** `CONFIRM_EACH_TIME` (existing, default, unchanged) and `DELEGATED_WITH_LIMITS` (new). The mode is immutable per
rule (database trigger); an existing rule is never upgraded; delegated mode needs a new rule created explicitly as such, and it stays
PAUSED until its authorization is signed.

## 2. Threat model

P = prevent, D = detect, C = contain, R = recover.

| Threat | P | D | C | R |
| --- | --- | --- | --- | --- |
| Compromised FloFi API / BFF | API holds no signing key; owner header set only by BFF from HttpOnly sessions; authorization requires a passkey assertion verified against an anchored key | executor re-verifies the anchor chain; audit events | on-chain grant caps (targets, recipient = owner, per-call cap, call count, expiry) | owner revokes (local + on-chain); session key destroyed |
| Compromised Railway worker (executor) | executor runs only with `FLOFI_DELEGATED_EXECUTION=enabled` and a signer provider; keys never in DB | reconciliation of every submission; ledger divergence → attention | bounded by on-chain grants only (honest: application checks are bypassable by a compromised executor) | on-chain `disableDelegation` / SPL `Revoke` by the owner |
| Compromised delegated signer key | one key per grant (no global key); provider abstraction, production KMS required | unexpected redemption detected by reconciliation sweep of the grant (call count, `RedeemedDelegation` logs) | grant ceiling (on-chain) | revoke grant on-chain; rotate = new enrollment |
| Stolen session credential (wallet session cookie) | passkey registration needs a fresh (≤ 15 min) wallet sign-in; authorizations need the passkey (user verification required) | audit trail | cookie alone cannot sign an authorization or an enrollment | revoke passkey |
| Replay | per-authorization nonce + single-use challenge; EVM nonce, `LimitedCallsEnforcer`; Solana blockhash; unique `(authorization, occurrence)` execution | duplicate-key refusals | — | — |
| Duplicate queue delivery | work-item dedupe; execution row compare-and-set per transition; unique reservation keys | `DUPLICATE` outcomes logged | one execution per occurrence | lease expiry re-delivers to the same state machine |
| Malicious price provider | price only feeds the trigger (AUTOMATION-001); never authority | stale/feed checks | per-execution and period caps | owner pause/revoke |
| Malicious quote / router response | fresh simulation checked against the Manifest (amount, min-out, slippage, recipient, target); targets compiled from registry pins | policy refusal codes | on-chain target/selector/recipient scoping | — |
| Unauthorized calldata substitution | the executor encodes calls from the reviewed plan; `AllowedTargets/Methods/Calldata` enforce shape on-chain | adapter `authorizeExecution` refuses before signing | on-chain enforcers revert | — |
| Protocol upgrade | targets are pinned addresses; code presence verified at enrollment; capability rows versioned | verification read failure → grant `UNCERTAIN` | grant scope unchanged | re-enroll |
| Wallet grant revoked externally | grant re-verified (read-only) before reservation and before each step | `disabledDelegations` / token-account delegate readback | step refused before submission | owner re-enrolls |
| Partial cross-chain execution | whole authority graph verified before the first irreversible step; recipients pinned to the owner's own credential addresses | `HALTED` state | funds stay in the owner's own accounts at a step boundary | resume when authority is valid again, or owner continues manually |
| Worker crash before/after submission | signed bytes + hash persisted before broadcast | recovery reads state | same bytes re-broadcast only; never a new spend for the same step | reconciliation decides |
| Database rollback / stale read | every transition is a CAS on `(state, version)`; reservation under row lock | CAS failures | on-chain call count / nonce | reconciliation |
| Budget race | `SELECT … FOR UPDATE` on the authorization row; usage summed inside the lock | — | — | — |
| Gas griefing | fee ceiling per step in the Manifest; session signer funded separately with a capped amount | fee check at simulation | signer balance | top-up is an operator action |
| Token decimals mismatch | amounts in integer native units resolved from registry decimals; Manifest records decimals | decimals mismatch refusal | — | — |
| Approval race | approvals are part of the step plan, reserved with it; approve spender pinned on-chain | — | spender = pinned router only | — |
| Chain reorg | reconciliation requires canonical inclusion (existing `RECEIPT_NOT_CANONICAL` rule) | re-observation | — | stays `SUBMITTED` until final |
| Revocation race | revocation and reservation/submission-preparation lock the same row | — | no submission prepared after effective revocation | in-flight tx reconciled, not undone |
| User edits workflow while queued | execution re-composes and compares the workflow hash with the authorization; rebind requires a new revision | `AUTHORIZATION_WORKFLOW_MISMATCH` | blocked before reservation | owner signs a new revision |

## 3. Universal authorization representation

**`DelegatedAuthorizationManifest` v1** (closed TypeBox schema, canonical JSON with sorted keys, hash = SHA-256 over
`"flofi.delegated-authorization-manifest.v1\0" ‖ canonical bytes`):

- identity: `owner` (`<namespace>:<account>`), `authorizationId` (`dau_…`, stable lineage), `revision` (≥ 1), `createdAt`;
- time: `validFrom`, `expiresAt`, `timezone` (period boundaries only), `cooldownSeconds`;
- `workflow`: `{ mode: 'EXACT', workflowHash, engineVersion, stepCount }` or `{ mode: 'CLASS', steps: [{ action, chains, inputAssets,
  outputAssets, maxInputAmount }], maxSteps }` (a deterministic, enforceable class; the automation UI uses `EXACT`);
- `chains` (CAIP-2), `actions` (canonical semantic action types from the IR, e.g. `asset.swap.exact-input`, never UI labels),
  `protocols` (`{ chain, protocol, targets[] }`);
- `assets`: `{ asset (CAIP-19), symbol, decimals, role: INPUT|OUTPUT|INTERMEDIATE, maxPerExecution, budgets: { DAY?, WEEK?, MONTH? } }`
  in integer native units;
- `recipients`: the owner's own credential addresses per chain;
- `limits`: `maxExecutionsPerPeriod`, `maxSlippageBps`, `maxFeePerStep` (native units per chain), `minHealthFactor` (when a lending
  step exists), `quoteMaxAgeSeconds`;
- `credentials`: `[{ credentialId, grantId, chain, mechanism, grantCommitment }]`;
- `enforcement`: for every limit, its location(s) from the Master Spec vocabulary (`SMART_ACCOUNT_MODULE_OR_GUARD`,
  `APPLICATION_GATEWAY`, `PROTOCOL_VERIFIER`, …) as the selected adapters actually provide them.

USD values are presentation only. Periods are half-open `[start, end)` in the Manifest's zone, anchored to calendar day / ISO week /
month.

**`UniversalWorkflowAuthorization` v1**: `{ type, version, environment: { origin, rpId, tenant }, owner, authorizationId, revision,
nonce (128-bit), workflowHash, manifestHash, credentials: [{ credentialId, grantId, chain, mechanism, grantCommitment }], chains,
actions, validFrom, expiresAt, passkeyId }`. Digest = SHA-256 over `"flofi.universal-workflow-authorization.v1\0" ‖ canonical bytes`.
The WebAuthn challenge **is** that digest, so the assertion signs the authorization itself. Verification: `clientDataJSON.type =
webauthn.get`, challenge = digest, origin = the deployment origin, `rpIdHash`, UP+UV flags, sign count monotonic (when non-zero),
ES256 signature over `authenticatorData ‖ SHA-256(clientDataJSON)` with the anchored key.

**Revisions** never mutate: a material change (workflow hash, chain, credential, token, budget up, slippage up, expiry later, protocol,
action, recipient, execution count up, cooldown down) is detected by `wideningOf(old, new)` and requires a new revision signed again;
the previous revision is `SUPERSEDED`. Narrowing still needs a signature (simplicity, auditability).

## 4. EVM authority adapter — `EVM_ERC7710_METAMASK_V1_3`

Mechanisms evaluated:

| Candidate | Verdict | Reason |
| --- | --- | --- |
| ERC-7715 wallet-native permissions (`wallet_grantPermissions`, MetaMask Advanced Permissions) | Not selected now | Permission types are transfer-oriented (`erc20-token-periodic`, `native-token-stream`, …): a session account may move tokens anywhere within the allowance; no target/selector/recipient scoping for DeFi calls; Flask-only at the time of writing. Kept as a future transfer-only capability |
| **ERC-7710 delegation, MetaMask Delegation Framework v1.3.0, owner = MetaMask EIP-7702 smart account** | **Selected** | Audited, deployed at deterministic addresses on Base, Base Sepolia, Ethereum (Sepolia) and Arbitrum (Sepolia); on-chain caveat enforcers scope target, selector, calldata words (recipient, tokens, spender), native value, validity window, call count and redeemer; revocation `disableDelegation`; FloFi already pins `DelegationManager 0xdb9b…dB3` and `EIP7702StatelessDeleGator 0x63c0…E32B` and already reconciles canonical redemptions |
| ERC-7579 modular smart accounts (smart sessions, policies) | Not selected | Requires moving funds into a new smart account and new dependencies; not present in the repository |
| Safe + Zodiac Roles v2 (Mode B) | Not selected now | True periodic allowances, but funds must live in a Safe and FloFi's pins are local-fork only; a later adapter candidate |
| Custom EIP-7702 delegate | **Rejected** | A FloFi-written delegate able to make calls is a critical, unaudited wallet surface. FloFi never authorizes 7702 code; the owner's own wallet performs its MetaMask smart-account upgrade, and FloFi only verifies the designator |

Grant compilation (one EIP-712 `Delegation`, domain `DelegationManager`/`1`/chainId/manager, `authority = ROOT`, `delegate` = the
grant's session signer). Top-level caveats: `RedeemerEnforcer(session)`, `TimestampEnforcer(validFrom, expiresAt)`,
`LimitedCallsEnforcer(N)`, `ValueLteEnforcer(0)`, and one `LogicalOrWrapperEnforcer` whose groups are *complete, equally safe* call
templates (the redeemer chooses a group, so no group may be weaker than intended):

- `erc20.approve`: `AllowedTargets[token]`, `AllowedMethods[0x095ea7b3]`, `AllowedCalldata(4, spender = pinned router)`;
- `uniswap-v3.exactInputSingle` (SwapRouter02 `0x04e45aaf`): `AllowedTargets[router]`, `AllowedMethods`, `AllowedCalldata(4, tokenIn)`,
  `AllowedCalldata(36, tokenOut)`, `AllowedCalldata(100, recipient = owner)`, `ERC20BalanceChange(decrease, tokenIn, owner, perCallCap)`.

Enforcer addresses are the v1.3.0 deterministic deployment (`documents/Deployments.md` at tag v1.3.0); enrollment verification reads
their code on the grant's chain and fails closed if any is absent. On-chain ceiling = `N × perCallCap` per input token, recipient owner,
pinned targets, until `expiresAt`. **Not on-chain**: period budgets, slippage (except as the reviewed `amountOutMinimum` within the
transaction), cooldown, approve amount, workflow hash — `APPLICATION_GATEWAY`, stated as such in the Manifest's enforcement map.

Adapter operations: `capabilities()`, `prepareEnrollment()` (typed data + required account state), `verifyEnrollment()` (ECDSA recovery
of the owner over the EIP-712 digest — exactly what `EIP7702StatelessDeleGator.isValidSignature` checks; owner code designator =
`0xef0100‖impl`; manager and enforcer code present; `disabledDelegations(hash) = false`; salt = passkey anchor), `authorizeExecution()`
(the exact calls against a JS model of the enforcers, before signing), `execute()` (`redeemDelegations([[delegation]], [single default],
[encodeSingle(target, 0, data)])` signed by the session key as EIP-1559), `prepareRevocation()` (owner self-call
`disableDelegation(delegation)`), `verifyRevocation()` (`disabledDelegations(hash) = true`), `reconcileAuthorityState()`.

Implemented templates in this build: ERC-20 approve and Uniswap v3 exact-input single (the swap flows FloFi executes). Aave, Across
`depositV3` and Uniswap liquidity have fixed-offset calldata and are designable as templates later; LI.FI calldata is opaque (recipient
not at a fixed offset) and cannot be scoped this way.

## 5. Solana authority adapter — `SOLANA_SPL_DELEGATE_V1`

| Mechanism | What it can delegate | Verdict |
| --- | --- | --- |
| SPL Token `ApproveChecked` to a session key | spending up to a total amount from ONE token account (one delegate per account); the delegate signs `Transfer(Checked)` or acts as token authority in programs that accept a delegate | Implemented for enrollment, verification and revocation; **on-chain ceiling = delegated amount; recipient and program are NOT enforced on-chain** |
| Native SOL | nothing: the System Program has no delegation | `NATIVE_SOL_NOT_DELEGABLE` |
| Program-controlled authority / smart wallets (Squads v4 spending limits, Swig roles/sessions) | transfer limits (Squads) or program-scoped session roles (Swig) | Not implemented: funds must move to a program wallet; no SDK or pin in the repository |
| Orca Whirlpool swap with a delegate as `token_authority` | input debit works with an SPL delegate; output account unconstrained on-chain; FloFi's Orca builders sign as the owner | `SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED` in production; exercised only by the MOCKED harness |
| Orca liquidity (position mint / authority), Jupiter routes | owner signer required | `OWNER_SIGNER_REQUIRED` |

Token delegation is never treated as permission for arbitrary Solana DeFi. One owner signature can cover several token accounts (several
`ApproveChecked` instructions in one transaction) plus the Memo anchor.

## 6. Key / signing model

- **Owner keys**: never requested, stored or derived. The owner signs only enrollments (wallet), revocations (wallet) and workflow
  authorizations (passkey).
- **Session signers**: one per grant (per owner × wallet × chain/mechanism), behind `DelegatedSignerProvider { id, kind, create(scope),
  address(ref), signEvm(ref, digest), signSolana(ref, message), destroy(ref) }`. The database stores only the opaque key reference and
  the public address.
  - `local-disposable`: keys in mode-0600 files under a configured directory below `/tmp`, refused on hosted deployments (local and
    public-testnet operation only). Not production custody.
  - `fixture`: deterministic in-memory keys for unit tests only.
  - `kms` (production: non-exportable keys, per-grant isolation, audit): **not available on current infrastructure → production
    delegated signing is BLOCKED** (`DELEGATED_SIGNER_UNAVAILABLE`), never weakened.
- No key or signature material in logs, views, `localStorage` or Git. Blast radius of a stolen session key = its grant's on-chain
  ceiling. Rotation = new enrollment; revocation destroys the key reference as defense in depth (it does not replace on-chain
  revocation, which only the owner's wallet can perform).

## 7. Enrollment flow (Credential lifecycle)

1. Owner registers a **passkey** (Passkeys workspace; requires a wallet sign-in ≤ 15 min old; user verification required).
2. Owner adds an **execution Credential**: picks a proven wallet and the chains/capabilities; FloFi creates the session signer and
   compiles the grant (scope shown in plain language: tokens, router, per-call cap, number of uses, expiry, recipient = this wallet).
3. Owner signs the grant with that wallet (EVM: `eth_signTypedData_v4` of the Delegation; Solana: the delegation transaction).
   These are **Credential enrollment signatures**, never workflow signatures; one per EVM chain grant, one per Solana wallet.
4. FloFi verifies (§4/§5) → grant `ACTIVE`, `verifiedAt` recorded. Grants expire, can be re-verified on demand, and are re-verified
   read-only before reservations.

States: `PENDING_SIGNATURE → ACTIVE → REVOCATION_REQUESTED → REVOKED`; `ACTIVE → EXPIRED`; any → `UNCERTAIN` (verification could not be
established) or `FAILED` (signature/scope invalid).

## 8. Execution flow

Workflow authorization (once): workflow → resolve every step → resolve every Credential grant (each step maps deterministically to
exactly one grant: chain, mechanism, action/protocol template, assets) → verify every grant → Universal Authorization Review (EN/PT)
→ ONE passkey signature → authorization `ACTIVE` → rule `ACTIVE`.

Per occurrence (no owner interaction):

`QUEUED → AUTHORITY_VERIFIED → RESERVED → RUNNING(step k: SIMULATED → POLICY_VERIFIED → SUBMISSION_PREPARED → SUBMITTED →
RECONCILED) → SETTLED`; failures: `BLOCKED` (nothing submitted; reservation released), `UNCERTAIN` (submission outcome unknown;
reservation kept), `HALTED` (after an irreversible step a later step cannot proceed; attention), `FAILED` (reconciled failure).

- The evaluator (AUTOMATION-001, unchanged for `CONFIRM_EACH_TIME`) creates the occurrence in state `DELEGATED` and enqueues
  `delegation.execute` in the same transaction.
- **Step drivers** (`StepDriver.simulate/submit/reconcile`) reuse FloFi's flows: the Uniswap swap driver drives the existing durable
  public-testnet swap service (prepare → review → begin → report hash → observe/reconcile with `verifyOwnerSubmission`, which already
  accepts a canonical delegated redemption) — no parallel reconciler. The `fixture` driver (MOCKED harness only, refused when hosted)
  models any step type against a MOCKED loopback chain double that verifies delegation signatures and models the v1.3.0 enforcers.
- Simulation is always fresh, immediately before the step; the deterministic `checkStepPolicy(manifest, reservation, plan, now)` refuses
  with closed codes (`SLIPPAGE_ABOVE_CAP`, `AMOUNT_CHANGED`, `TARGET_NOT_AUTHORIZED`, `RECIPIENT_NOT_AUTHORIZED`, `ASSET_NOT_AUTHORIZED`,
  `CHAIN_NOT_AUTHORIZED`, `FEE_ABOVE_CAP`, `HEALTH_FACTOR_BELOW_FLOOR`, `QUOTE_EXPIRED`, `BRIDGE_DESTINATION_CHANGED`,
  `AUTHORIZATION_EXPIRED`, `GRANT_SCOPE_EXCEEDED`, …).
- `SUBMISSION_PREPARED` is committed (signed bytes and hash persisted) in the same transaction that re-checks the authorization is
  still `ACTIVE`; broadcast happens after commit. Recovery re-broadcasts the same bytes only.

## 9. Budget reservation model

Ledger `delegated_budget_entries(authorization lineage, execution, step, asset, reserved, spent, state RESERVED|SPENT|RELEASED,
period starts)`. Reservation transaction: `SELECT … FOR UPDATE` the authorization row → state `ACTIVE`, revision current, not expired,
cooldown → usage per asset per period = Σ(RESERVED reserved) + Σ(SPENT spent) inside the lock → per-execution, per-period amount and
count limits → insert the execution and its entries → commit. Unique `(authorization, occurrence)` and `(execution, step, asset)`.
Settlement after reconciliation: `RESERVED → SPENT(actual)`; `RELEASED` only when nothing was submitted or reconciliation proves the
submission failed without spending. `UNCERTAIN` keeps `RESERVED`. A crashed worker leaves `RESERVED` entries that recovery resolves.

## 10. Revocation model

Two levels, both prominent:

- **Revoke authorization** (Automations): one transaction sets the authorization `REVOKED` (no new reservation can commit after it,
  same row lock), pauses the rule, and blocks queued executions at their next transition; in-flight submissions are reconciled. Immediate
  and local — this is the emergency stop.
- **Revoke credential** (Credentials): local `REVOCATION_REQUESTED` at once (grant unusable by FloFi), session key reference destroyed,
  then the owner's wallet signs the on-chain revocation (EVM `disableDelegation` self-call; Solana `Revoke`); FloFi verifies by readback
  → `REVOKED`, or `UNCERTAIN` if it cannot be established. Every authorization using that grant is blocked.
- Audit events are append-only for both.

## 11. Recovery model

Work items re-deliver; the execution state machine resumes from its persisted state. Before `SUBMISSION_PREPARED`: redo (fresh
simulation). After it: look up by hash, re-broadcast the same bytes, never re-sign. `SUBMITTED`: reconcile until final (canonical
inclusion). `UNCERTAIN`: periodic reconciliation by the sweep; budget held. `HALTED` (cross-chain): funds remain in the owner's own
account at the step boundary; the execution resumes only with valid authority and a fresh in-limit simulation, or the owner continues
manually. Recovery never requires a new owner signature unless authority expired/was revoked or the workflow must change.

## 12. Cross-chain semantics

The authority graph covers every step before the first irreversible submission: each step's chain, mechanism, template and assets must
map to an `ACTIVE`, verified grant of a Credential linked to the owner; bridge recipients must be the owner's own credential address on
the destination chain. A missing, expired, revoked or under-scoped grant anywhere fails the whole occurrence before reservation
(`DELEGATED_AUTHORITY_UNAVAILABLE` with the step and reason). Grants are re-checked before each step. FloFi never promises atomicity.

## 13. Capability matrix (production adapters; the MOCKED fixture harness supports every action for tests only)

| Action | Network | Protocol | Delegated? | Mechanism | Reason if not |
| --- | --- | --- | --- | --- | --- |
| swap | Base Sepolia, Ethereum Sepolia, Base | Uniswap v3 | by code: yes; production: **BLOCKED** | ERC-7710 | production signer unavailable; Base mainnet swaps have no owner flow on main and are policy-disabled |
| supply / withdraw / borrow / repay | Base Sepolia, Ethereum Sepolia | Aave v3 | no | — | `DELEGATION_TEMPLATE_NOT_IMPLEMENTED`; health-factor floor would be application-only |
| bridge | Base ↔ Arbitrum | LI.FI | no | — | `DELEGATED_TARGET_SCOPE_UNAVAILABLE` (opaque calldata) |
| bridge | Base ↔ Arbitrum | Across direct | no | — | `DELEGATION_TEMPLATE_NOT_IMPLEMENTED` |
| add_liquidity | Base Sepolia, Ethereum Sepolia | Uniswap v3 | no | — | `DELEGATION_TEMPLATE_NOT_IMPLEMENTED` |
| lending_composition | Base Sepolia | Aave + Uniswap | no | — | `DELEGATION_TEMPLATE_NOT_IMPLEMENTED` |
| swap (SPL input) | Solana Devnet | Orca | no | SPL delegate (enrollment only) | `SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED`; recipient not enforceable on-chain |
| swap (SOL input) | Solana Devnet / Solana | Orca / Jupiter | no | — | `NATIVE_SOL_NOT_DELEGABLE` |
| add_liquidity | Solana Devnet | Orca | no | — | `OWNER_SIGNER_REQUIRED` |
| bridge | EVM → Solana | — | no | — | `BRIDGE_ROUTE_UNAVAILABLE` |

## 14. Unsupported cases (fail closed, never substituted)

Any step without an active verified grant (`DELEGATED_AUTHORITY_UNAVAILABLE`); production delegated signing
(`DELEGATED_SIGNER_UNAVAILABLE`); owners whose EVM account is not a MetaMask EIP-7702 smart account (`EVM_ACCOUNT_NOT_UPGRADED`); the
rows marked "no" above; mainnet unless policy-enabled (unchanged); silent fallback from delegated to confirm-each-time (never: the owner
may create a `CONFIRM_EACH_TIME` rule instead).

## 15. Migration / data model — `0011_delegated_execution` (additive)

- `automation_rules`: `execution_mode` CHECK widened to `('CONFIRM_EACH_TIME', 'DELEGATED_WITH_LIMITS')`; new nullable
  `authorization_id`, required iff delegated; immutable (trigger replaced to include it). Existing rows keep their meaning.
- `automation_occurrences`: new terminal state `DELEGATED` (handed to the executor, `execution_id`), counted by limits; trigger replaced.
- `passkey_credentials`, `passkey_challenges` (single use, short-lived, digest only).
- `execution_credentials` (owner × wallet), `credential_grants` (per chain/mechanism: scope, scope hash, grant payload and commitment,
  session signer reference and address, passkey anchor, verification, state machine trigger).
- `delegated_authorizations` (lineage, owner, rule), `delegated_authorization_revisions` (manifest, hashes, envelope, passkey assertion,
  state `PENDING_SIGNATURE|ACTIVE|SUPERSEDED|REVOKED|EXPIRED`, immutable once signed).
- `delegated_executions`, `delegated_execution_steps` (state machines enforced by triggers, CAS version), `delegated_budget_entries`,
  `delegated_events` (append-only audit/evidence).
- `mcp_handoffs` untouched. `0010` is not edited.

## 16. Tests

- **Pure**: Manifest schema/canonical hash/validation; capability resolution; authority graph (missing/expired/under-scoped grant at any
  step); widening detection; period math (DST zones); policy checks (every refusal code); UWA digest and WebAuthn verification
  (registration + assertion, wrong origin/challenge/rp/flags/counter/signature); ERC-7710 typed-data hash vectors, caveat terms,
  LogicalOrWrapper encoding, redemption encoding (and round trip through `verifyOwnerSubmission`'s decoder), JS enforcer model accept /
  reject (target, selector, recipient, token, per-call cap, value, expiry, call count, redeemer); SPL instructions, token-account parsing,
  memo anchor; state machine transitions.
- **PostgreSQL**: migration 0010 → 0011 (existing rules unchanged, immutability, new states); ownership isolation; reservation under
  competing workers (N parallel reservations never exceed budget); reserve/release/settle; uncertain keeps budget; expiry; revocation
  race (revoke vs reserve, revoke between simulation and submission); duplicate occurrence/execution; replayed challenge.
- **Adapters**: enrollment preparation/verification, insufficient permission, external revocation, replay, expiry (ERC-7710 against the
  loopback chain double; SPL against the Solana double).
- **Integration**: trigger → occurrence → authority verification → reservation → simulation → policy → delegated execution →
  reconciliation → settlement; crash at every boundary; restart; two workers; revoked between simulation and submission; quote changed
  after trigger; the Uniswap swap step driver over the existing durable swap service (scripted RPC), reconciled by the existing verifier.
- **Browser** (fixture harness, loopback only): passkey (virtual authenticator) → EVM + Solana credentials enrolled with their wallet
  signatures → multichain workflow automation → Review → ONE passkey signature → Active → trigger → no wallet request → both domains
  execute → evidence per step names credential and grant → budget updates → revoke → later trigger cannot execute.
- **Boundaries**: only the executor/signer modules reach signing; API, BFF, evaluator, dispatch stay signing-free; `CONFIRM_EACH_TIME`
  suites unchanged.
- **Gates**: `pnpm check`, `pnpm test:postgres`, Governance Lite (+ self-tests), guarded browser profiles (+ a `delegation` profile),
  `git diff --check`.

## 17. Deployment impact

- Migration `0011_delegated_execution` (additive). New variables: `FLOFI_DELEGATION=enabled` (API/web: owner operations, passkeys,
  credentials), `FLOFI_DELEGATED_EXECUTION=enabled` + `FLOFI_DELEGATED_SIGNER=local-disposable|kms` (+ key directory) on the executor
  process, per-chain read/submit RPCs for delegated chains, the MOCKED harness switch for tests only.
- **Standard production after merge: nothing executes delegated** — no production signer provider exists (`kms` not implemented), so
  the API reports `DELEGATED_SIGNER_UNAVAILABLE` and "Automatic within limits" is shown unavailable; `CONFIRM_EACH_TIME` behaviour is
  unchanged. Passkey registration and Credential enrollment can be enabled independently but authorize nothing without an executor.
- No change to the Railway worker's existing flows (`WORKER_SUBMISSION_FORBIDDEN` stays for them); the delegated executor is a separate,
  opt-in handler with its own submission transport.

Evidence ceiling of this build: domain implemented; fixture/MOCKED end to end (loopback chain doubles with real signatures and a JS model
of the v1.3.0 enforcers); no local-fork run against the real Delegation Framework bytecode, no public testnet, no production delegated
authority, no transaction sent by the agent.
