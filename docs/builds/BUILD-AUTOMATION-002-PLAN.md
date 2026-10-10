# BUILD-AUTOMATION-002 — Plan: Generic Delegated Execution

Date: 2026-10-10. Branch `claude/build-automation-002-delegated-execution` (worktree `~/projects/gryloo-automation-002`). Started from
main `7841d5657ec9a816140a180081178e2abbc27246` (PR #75: BUILD-AUTOMATION-001, `CONFIRM_EACH_TIME`; migrations end at `0010_automations`);
**rebased on 2026-10-10 onto canonical main `974a7acad6b117662d986254b9bc9e9be6e2a356`** (PR #76: BUILD-EXECUTION-CONTINUITY-001).
PR #77 (BUILD-CANVAS-AUTOMATION-UX-002, head `69b4447936744d1f0bfc57535d6c36386765bbf2`) is open, unmerged, and inspected read-only.
§18 records how this build adopts PR #76's execution semantics and composes with PR #77's Canvas and chat authoring.
**Update, later on 2026-10-10:** PR #77 merged as `c9f48d35aa251701f1082ba76174502686a62ba0`; the branch was restacked onto it once and
step B of §18.4 was completed, partly after a session takeover. §18.5 records that; the text above it is kept as written.
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
- **Composition (§18)**: a one-step delegated rule built from a canonical `AutomationInput` (the object PR #77's chat grounding emits)
  and the same rule built from the workspace form yield the identical strategy and workflow hash; `DAILY_WATCH` is refused for delegation;
  the AI draft cannot select a mode. In the browser, passive wallet synchronization keeps an in-flight enrollment, revocation request or
  open Authorization Review. A genuine account, chain or provider change drops it, and changing back cannot revive it. No delegated code
  writes a Review binding.
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

## 18. Composition with PR #76 (merged) and PR #77 (open)

### 18.1 Base and restack record

- Rebased from `7841d56` onto canonical main `974a7ac` (PR #76). PR #76 touches no file of this branch and adds no migration, so
  `0011_delegated_execution` keeps its number and pin. The pre-restack head is kept locally as `backup/automation-002-pre-restack-6bd85de`.
- PR #77 (`69b4447`) was fetched read-only as `refs/remotes/pr/77`. It is not merged, cherry-picked or copied. Its file overlap with this
  branch is `src/app/globals.css` and `src/i18n/pt.ts`. Both sides only add to those files, so a restack conflict should be mechanical.
- Restack rule: if PR #77 merges before step B of §18.4 starts, restack once onto the new main before continuing. If it has not merged
  when this build is delivered, step B is reported as a follow-up and not claimed. Nothing in this build is written against PR #77's
  unmerged files.

### 18.2 PR #76 execution semantics: adopted as canonical, with no second identity model

| PR #76 rule | Application in delegated execution |
| --- | --- |
| Passive wallet synchronization does not invalidate authority | The delegated UI uses the owner's EVM wallet only through the shared `useBuild009Wallet` store (provider, account, chain and semantic `revision`) and the shared Solana session. `delegation-browser.ts` currently reads `chosenEvmProvider() ?? injected()` directly; it changes to receive the shared wallet. These events never cancel an in-flight enrollment, a revocation request or an open Authorization Review: `eth_accounts` and `eth_chainId` re-reads, duplicate wallet events, and transaction-completion syncs. |
| A genuine provider, account or chain change advances the epoch and permanently invalidates old authority | Browser-held authority that is not yet persisted captures `{account, chainId, revision}` (Solana: `{address, wallet}`) when the request starts. This covers a prepared enrollment awaiting its wallet signature, a revocation transaction request, and the open Authorization Review (whose owner is the shell's wallet principal). If the epoch has advanced when the result returns, the UI discards the result, says the wallet changed, and never submits it. Changing A → B → A does not revive it. The server still verifies the signer (`ENROLLMENT_SIGNER_MISMATCH`) and the HttpOnly owner session. |
| Persisted authority is not browser authority | An active on-chain grant plus a passkey-signed Universal Workflow Authorization exist so that FloFi can act while the owner is offline. A MetaMask account switch must not stop a weekly DCA, so this authority is **not** tied to the browser epoch. It ends only through owner revocation, an observed on-chain revocation, expiry, exhausted scope, passkey revocation or a workflow change. Each of these is terminal. Re-authorizing creates a new authorization revision with a new passkey signature and never revives the old one. Prose calls the Manifest's `revision` the *authorization revision* so it is not confused with the wallet epoch. Delegated code never reads or writes `review-authorization.ts` bindings. |
| Durable multi-step execution continues without false invalidation | Each occurrence gets exactly one `delegated_executions` row (unique), and each step is a durable row. Passive observations never change authorization validity: RPC re-reads, receipts and wallet sync. The run moves to the next unattempted step only after the previous step is `RECONCILED`. PR #76's explicit owner continuation is replaced here by the signed authorization, as the product invariant requires. Every step still re-verifies the authority graph, the reservation, a fresh simulation and policy. It re-checks the authorization and grant inside the `SUBMISSION_PREPARED` transaction. |
| Recovery reuses the same run | A crash, lease expiry or restart resumes the same `executionId` and step rows (fenced leases, CAS). An occurrence never gets a second execution, and a confirmed step never runs again. The owner's Resume of a `HALTED`/`UNCERTAIN` execution reuses that run under the same authorization revision and re-checks everything. |
| `UNKNOWN` submission never blindly retries | A step at `SUBMISSION_PREPARED`, `SUBMITTED` or `UNCERTAIN` never gets a new transaction or a new signature. Recovery only observes the recorded hash or signature, and may re-broadcast the byte-identical persisted bytes: same hash, same nonce or blockhash, so no second effect is possible. The reservation stays held, later steps do not continue, and the owner sees "Outcome being confirmed" with no retry action. This is implemented and covered by the crash-after-prepare and lost-submission tests. |

### 18.3 PR #77 composition: one authoring model, one canonical object chain

```
Chat / Copilot (PR #77)       untrusted AutomationDraft → groundAutomationDraft → canonical AutomationInput → preview → explicit click
Automations workspace         existing form (CONFIRM) │ delegated form
Canvas (after PR #77)         the exact current workflow (hash-bound)
        └──────────────► canonical Workflow IR   (routeStrategy / composeWorkflowBound, semanticWorkflowHash)
                         ► canonical Automation Rule  (automation_rules, one persistence/scheduler/evaluator, execution_mode)
                         ► [DELEGATED_WITH_LIMITS only] Delegated Authorization Manifest
                         ► Credential authority graph (resolved completely, before any signature)
                         ► Universal Workflow Authorization (one passkey signature)
                         ► delegation.execute (durable run)
```

a. **No second chat authoring system.** The delegated path consumes the grounded `AutomationInput` that PR #77 emits. A pure
   `delegatedSourceFromAutomation(input)` in `delegation/` depends only on `automations/definition.ts`, which is on main. It maps
   `SCHEDULED_DCA` and `PRICE_TRIGGER` with a `ROUTE` action to `{ trigger, steps: [one step] }`. `DAILY_WATCH` is refused with
   `DELEGATION_NOT_APPLICABLE`, since there is nothing to execute. The multi-step form compiles through the same `routeStrategy`, so a
   one-step rule from chat and from the workspace has the same strategy and workflow hash. A test proves this.
b. **Execution mode is the owner's choice and never an AI output.** `AutomationDraft` gets no mode field. Words such as "automatically"
   or "sem perguntar" in the chat text do not preselect it. The proposal card keeps PR #77's preview and adds the same radiogroup: "Ask
   every time" (default) or "Automatic within limits". Choosing automatic requires the owner to enter limits (cumulative budget,
   executions per period, expiry), see the required Credentials resolved, review the Universal Authorization Review and sign it with a
   passkey. The AI can prefill only the per-execution amount the owner stated; it never supplies a budget or an expiry. Delegated creation
   stores a `PAUSED` rule and a `PENDING_SIGNATURE` authorization. Activation happens only after the passkey signature. Chat-created
   rules stay `CONFIRM_EACH_TIME` unless the owner does all of this.
c. **Saved workflows** ("execute my Base → Arbitrum workflow"). The source is the AUTOMATION-001 saved-workflow binding: exact version
   and hash, with no new snapshot model. The requirement extractor resolves every step. A bridge step resolves to
   `BRIDGE_ROUTE_UNAVAILABLE` or `DELEGATION_TEMPLATE_NOT_IMPLEMENTED`, and the preview refuses it before anything is created. Delegated
   creation currently sets `source: null`. Saved-workflow sources are in scope only by reusing that binding.
d. **Percent triggers** ("If ETH drops 5%"). The delegated trigger schema already accepts AUTOMATION-001's `PERCENT_DROP` and
   `PERCENT_RISE`. PR #77's draft parses only `PRICE_BELOW` and `PRICE_ABOVE`, and extending it changes PR #77's files, so that waits
   for the merge.
e. **Canvas.** A delegated occurrence creates no `AUTOMATION_RULE` approval handoff, because no owner Review happens per occurrence. So
   nothing enters the Canvas per occurrence, and PR #77's internal handoff stays exclusive to `CONFIRM_EACH_TIME`. A `HALTED` or
   `UNCERTAIN` delegated run is never turned into a Canvas Execute; there is no silent downgrade to owner signing and no silent upgrade.
   Attention and evidence are shown in Automations. After PR #77, "Automate this workflow" on the Canvas creates a canonical rule from
   the exact current workflow and opens the same Authorization Review. That review reuses PR #77's compact, human-readable authorization
   details (a list of limits) and shows no raw Manifest JSON in the normal product; engineering surfaces and evidence keep the Manifest.
f. **Capabilities.** The chat card's `automationCapabilityIssue` check stays as it is for confirm mode. Delegated mode adds the
   authority-graph preview (`automationPreview`). It fails closed and names the missing or under-scoped Credential before anything is
   created.

### 18.4 Sequencing

A. **Now, on `974a7ac` and without PR #77:** this plan update; `delegatedSourceFromAutomation`, with the delegated create operation
   accepting a canonical `AutomationInput` source and identity tests; PR #76 epoch binding for delegated browser requests through the
   shared wallet stores; EN/PT copy and styles; the loopback browser journey through the Automations, Credentials and Passkeys
   workspaces; documentation; gates.
B. **After PR #77 merges, restacking once first:** the mode choice on the chat proposal card; the Canvas "Automate this workflow"
   entry; reuse of PR #77's authorization details component in the Universal Authorization Review; a browser journey from chat to an
   active delegated rule; percent triggers in the draft.
   If PR #77 has not merged at delivery, step B is listed as not implemented.

### 18.5 PR #77 merged: restack, session takeover and step B (2026-10-10)

**Restack.** PR #77 merged as `c9f48d35aa251701f1082ba76174502686a62ba0`. The branch was rebased onto it once (from `695f419`, kept locally
as `backup/automation-002-pre-pr77-restack-695f419`). PR #77 adds no migration, so `0011_delegated_execution` keeps its number and pin.
Three conflicts were mechanical and kept both sides: `src/app/globals.css` and `src/i18n/pt.ts` (both sides appended), and
`scripts/guarded-release-browser.mjs`. In the last one, PR #77's new `canvas-automation-ux` and `chat-automations` profiles stay, and the
`delegated-execution` filter follows PR #77's `e2e/…` path form (PR #77 made the `automations` filter `e2e/automations.spec.ts` so that it
no longer also matches `copilot-automations.spec.ts`).

**Takeover.** A second session took over the worktree after the restack and the step-B commit `f8019e7`. It found the restack done, and one
uncommitted change: a replay entry for the chat journey. It kept both, did not rebase again, and completed what was left: the browser
journeys from chat and from the Canvas, and the small fixes listed below. The report (§22) records the takeover in detail.

**Step B as implemented.** It reuses PR #77's surfaces and the one canonical object chain of §18.3. It adds no second chat system, no
second Canvas lifecycle and no second IR.

| §18.4 B item | Implementation |
| --- | --- |
| Mode choice on the chat proposal card | PR #77's card keeps its preview and gets the radiogroup "Ask every time" (default, `CONFIRM_EACH_TIME`) / "Automatic within limits" (`DELEGATED_WITH_LIMITS`). It is offered only for a draft that executes a route, and only when the proven owner's deployment serves delegated execution. When the executor is blocked (`DELEGATED_SIGNER_UNAVAILABLE`), the option is shown disabled with that reason, as in Automations. The draft has no mode field: words such as "automatically" preselect nothing. Delegated mode prefills no limit, budget or expiry: the owner types them. The source sent is `{ source: 'AUTOMATION_INPUT', automation, terms }`, which the server compiles through `delegation/automation-source.ts`. |
| Percent triggers in the draft | `AutomationDraft` gains `PERCENT_DROP` / `PERCENT_RISE` and a `percent` field. Grounding requires the percentage, its direction and the reference price to be in the user's own words ("from $3000"). Without a stated reference it asks; it never uses the current price as the reference. |
| Canvas "Automate this workflow" | The button appears on the Build Canvas only where automations are enabled. It opens Automations with the exact Canvas workflow (shared shell state). `automations/automation-steps.ts` re-derives the steps from the document by exact node reproduction: FloFi's engine composes each candidate canonical route step, and the result must be semantically identical to the Canvas node (action, chain, inputs, constraints, protocols, failure policy and authorization class, the same comparison AUTOMATION-001 uses for saved workflows). Anything else is refused with a precise code, before anything is created. The steps keep the Canvas order. "Ask every time" opens AUTOMATION-001's own create form prefilled with the step, for one-step workflows only, because AUTOMATION-001 executes one step. "Automatic within limits" sends `{ source: 'CANVAS_WORKFLOW', workflow, trigger, name, terms }`. The server re-derives the steps from the document and never trusts steps, a hash or a mode from the browser. |
| Shared Authorization Review | There is one delegated flow for all three surfaces (`DelegatedLimitsFlow`): limits → the authority check over the complete workflow → an explicit "Create and review authorization" → the Universal Authorization Review → one passkey signature. **Deviation from §18.3 e:** PR #77's `ReviewAuthorizationDetails` component is not reused. It renders the per-transaction browser Review projection (`projectReview`: Strategy Manifest, wallet, network, approvals), which a delegated authorization does not have. The delegated Review follows the same rule instead: a compact list of steps and limits, the enforcement split under a disclosure, and no raw Manifest JSON in the normal product. |
| Browser journey from chat to an active delegated rule | `e2e/delegated-execution.spec.ts` now holds three journeys (Automations form, Chat, Canvas), each ending in one passkey signature and a MOCKED execution with no owner signature. The `delegated-execution` profile sets `FLOFI_COPILOT=replay` for the chat journey. |

**Canvas composition limits (main, unchanged).** The Canvas itself refuses a Solana swap beside any other step
(`SOLANA_SWAP_ISOLATED_ONLY`). Every EVM swap must be on the workflow's one trusted chain, so a second swap on another chain is refused
(`INVALID_SWAP_DECLARATION`, `reference-linter`). Its cross-chain workflows are bridge
compositions, and bridges are not delegable (§13). So "Automate this workflow" covers one swap on Base Sepolia, Ethereum Sepolia or Solana
Devnet, or several Base Sepolia swaps in order. A Base → Arbitrum composition is refused (`AUTOMATION_WORKFLOW_NOT_REPRESENTABLE`) before
anything is created. Multi-domain delegated workflows (EVM + Solana under one authorization) are authored in the Automations form.
