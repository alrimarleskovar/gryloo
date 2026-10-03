# BUILD-016 — One bounded Mode C automation

Date: 2026-10-03. Implementation is explicitly owner-authorized by the
BUILD-016 request, subject to genuine Source-of-Truth conflicts or decisions
requiring owner input. The dedicated worktree already exists at
`/home/asus/projects/gryloo/.turbo/build016`, on
`codex/build-016-mode-c-automation`, clean at the required CLOUD-001 baseline
`40ea29dd39e9aa487747d40e6bc99e196053b806`. No other worktree is modified.

Status: **IMPLEMENTATION AUTHORIZED — D-016-1 APPROVED** by the owner on
2026-10-03. The owner selected the separate local-chain-31337 conditional
verifier and existing WETH/USDC fee-500 pool-state mechanism. This approval is
limited to BUILD-016 local execution/certification evidence. It does not
promote the non-authorizing Base observation profile or authorize public-chain
execution. Certification still requires the implemented tests and evidence.

## 1. Single objective

Implement exactly one bounded conditional Mode C “Buy the dip” policy that
permits one existing USDC → WETH swap when an authorized WETH/USDC price
observation falls at least 5% from its Manifest-bound reference price,
subject to signed authority, atomic reservation, concurrency and replay
protection, freshness, frequency, cooldown, duration, budgets, expiry,
confirmed revocation, reconciliation and reconstructable evidence.

## 2. Relationship to v3.2

- Master Spec: §§7–8 (separate canonical artifacts and signature binding),
  §16.2 (effective delegated authority), §16.3 (Mode C), §28 Gate 8.
- Master Prompt: Build 016; §§5.1–5.2 (mandatory plan/report), §3.2 bounded
  authority, §8.3 financial safety, and Mode B/C acceptance gates.
- Existing requirement IDs remain unchanged: B001-HASH-001,
  B001-INVALIDATION-001, B001-COMPATIBILITY-001,
  B003D-JOURNAL-001, B003D-RECOVERY-001, B003D-RECONCILIATION-001,
  B003D-EVIDENCE-001, and the BUILD-004 finite-authority verification index.
  Add BUILD-016-specific rows only with implementation evidence; do not
  relabel historical requirements as newly satisfied.
- Preserved differentiator: one semantic workflow, signed bounded authority,
  recoverable deterministic execution and independently reconciled evidence.
- Product gate addressed: Gate 8, with actual local evidence and maturity reported separately from planning.
- Dependency: BUILD-004 is COMPLETE / CERTIFIED: FORK_REPRODUCED under
  DEC-0033. ADR-0001 acceptance is restricted to local chain 31337,
  disposable Safe 1.4.1 / Zodiac Roles 2.1.0, with no public-chain authority.
  ADR-0002 and frozen compatibility contracts remain binding. ADR-0005 is
  proposed composition authority and is not substituted for this isolated
  swap. CLOUD-001 is the implementation baseline, not Mode C certification.

## 3. Authorized scope

- Exactly one conditional policy and one successful existing exact-input
  USDC → WETH swap per installed policy. No refilling authority or automatic
  reauthorization. A new policy requires new owner authorization.
- Reuse the chain-31337 Safe/Roles boundary and existing swap compiler,
  executor identity separation, journal and independent reconciler.
- Reuse the existing Semantic Workflow IR and canonical swap node; observations
  and conditional authority remain separate artifacts.
- Bind every policy field listed in §7. Reserve before dispatch and persist
  the submission attempt before any side effect.
- Reuse CLOUD-001 durable storage ports, PostgreSQL transactions, fenced
  leases and append-only logs. Do not rely on process-local mutexes for
  multiple workers or multiple hosts.
- D-016-1 approves an independently enforced conditional verifier
  attached to the existing role, with direct bypass tests. Never expose
  application-only trigger checks as the complete signed authority ceiling.

## 4. Out of scope

Arbitrary automation, additional strategies, whale or macro-calendar
monitoring, AI trading advice, BTC/cbBTC, BUILD-017/018, public-chain authority,
mainnet, custody of owner keys, arbitrary LLM transaction submission,
unrelated cloud refactoring, Master Spec changes, identifier migration,
historical evidence edits, merge, and all edits to BUILD-013 or either
externally owned worktree named in the request.

## 5. Acceptance criteria

- [ ] D-016-1 resolved: exact observation semantics and independent verifier
  selected before implementation and recorded in ADR-0007 with delivery.
- [ ] Signed policy and Manifest bind all §7 fields; material changes invalidate
  authority. A hash in a database alone is never described as signature binding.
- [ ] Exact 5% integer/rational comparison, fresh verified observations only;
  malformed, wrong-source, stale and unavailable monitoring fail closed.
- [ ] One durable atomic reservation succeeds under competing workers; no
  duplicate effect across crash, restart, replay or uncertain submission.
- [ ] Both per-period and cumulative limits are enforced before dispatch;
  uncertainty retains the reservation and stops further execution.
- [ ] Policy start, expiry, cooldown and frequency enforced; no new action
  after confirmed revocation, including a trigger received afterwards.
- [ ] Token, chain, recipient, target/function, amount, trigger and slippage
  expansion rejected, including outside the ordinary application path.
- [ ] Valid trigger and signed authority execute the existing swap in the
  approved local environment, with independent effect reconciliation.
- [ ] Every attempt produces immutable, linked evidence described in §7;
  monitoring failure is recorded without inventing a price.
- [ ] Required checks and report accompany any implementation push; no merge.

## 6. Required tests

- Unit: dip below 5%, exactly 5%, above 5%; integer/rational boundary values;
  schema/canonical hash determinism; malformed value/time/block; future,
  stale, unavailable and unverifiable observations; wrong source; start,
  expiry, cooldown, frequency and per-period boundary semantics.
- Integration: wrong input/output token, chain, recipient, target/function,
  above-amount limit, cumulative budget exhaustion, per-period excess,
  slippage increase, earlier threshold, changed policy/Manifest and changed
  reference; actual signature/installation readback; confirmed revocation
  with valid unused authority followed by delayed trigger delivery.
- E2E: owner authorizes the policy; close browser; valid trigger dispatches
  the existing swap once; restart worker; receipt, exact transaction bytes,
  USDC debit, WETH credit and remaining authority independently reconcile.
- Failure/adversarial: two workers, duplicate trigger, repeated observation,
  crash before reservation, crash after reservation, crash after SUBMITTING,
  lost response, retry after uncertain result, worker restart, storage and
  monitoring failure, stale worker after lease takeover, revocation racing
  reservation/dispatch, already-submitted transaction versus new action,
  consumed action replay, authority expansion directly through the role.
- Cloud persistence: concurrent independent connections to isolated
  PostgreSQL, atomic ledger and evidence write, fenced old-writer rejection,
  durable reconstruction after restart. File tests establish only single-host
  behavior. A mocked race is not substituted for PostgreSQL proof.
- Existing compiler/executor/reconciler, compatibility, schemas, typecheck,
  lint, build, governance and applicable fork gates must continue to pass.
  Actual delivery results belong in BUILD-016-REPORT.md.

## 7. Authority and artifacts

- Authorization mode: Mode C, active only after owner-signed deployment/installation.
- Existing independent mechanism: ADR-0001 Safe 1.4.1 / Roles 2.1.0 exact
  Router02 `multicall(uint256,bytes[])` (`0x5ae401dc`) containing existing
  `exactInputSingle`, zero value / call operation, exact pair, amount,
  Safe recipient, protocol deadline/minimum output and non-refilling one-use
  allowance. Reuse `compileModeB` and `encodeSwap`; no automation swap adapter.
- Chain: approved execution `eip155:31337`, source is the approved WETH/USDC fee-500 pool-state mechanism;
  execution and certification fixtures remain on chain 31337. Genuine Base
  replay evidence requires complete closed-transcript coverage. USDC
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`; WETH
  `0x4200000000000000000000000000000000000006`; Router02
  `0x2626664c2603336e57b271c5c0b26f421741e481`. The recipient is the installed
  disposable Safe; no substituted recipient or chain is permitted.
- Policy binds: chain, exact pair and decimals, threshold exactly 500 bps
  downward, reference price/observation hash, exact source/adapter version,
  source contract/code/block identity, maximum swap amount, cumulative budget,
  per-period budget and period definition, maximum execution frequency,
  cooldown, start, expiry/duration, router/function, recipient, existing swap
  minimum output or maximum slippage, revocation mechanism/epoch, executor,
  finite permission, semantic workflow/artifact/simulation/policy/Manifest hashes.
  Runtime policy values are explicit reviewed owner inputs, never invented
  default financial authority.
- Proposed period semantics: UTC/chain timestamp seconds, half-open periods
  anchored to signed policy start; start inclusive, expiry exclusive; a fixed
  signed minimum interval and cooldown; one non-refilling action for the entire
  policy. Period rollover does not restore consumed total authority.
- Approved source under D-016-1: the existing Uniswap v3 WETH/USDC fee-500
  pool-state mechanism (`readObservedLiquidityPool`, factory `getPool`,
  token order/decimals, pinned code and `slot0`), reused as a separate typed
  Quote and State Artifact. Resolve and pin the exact pool before signing;
  never assume an address or promote a quote to an oracle price silently.
  Compare rational USDC-per-WETH prices without floating point:
  `observedPrice <= referencePrice * 95 / 100` by cross multiplication.
  Spot-price manipulation is an explicit unresolved source risk, not an oracle
  security claim. No TWAP or signed feed architecture is implicitly selected.
- Source evidence includes raw-response hash, source identity/version,
  observed value, chain/block height/hash/timestamp, observation/retrieval
  times, freshness rule and deterministic canonical artifact hash. Verify
  canonicality and freshness again before reservation and dispatch. Rejected
  observations retain their rejection evidence, not a synthesized value.
- Approved verifier: a minimal conditional check at the existing role's
  effective call path, binding the owner-installed policy and checking
  reference/threshold, pinned price source, policy start/expiry and revocation.
  The worker must not retain a route through its original unconditional role.
  This is a security-critical verifier approved by D-016-1, requiring pinned
  compilation/deployment, an authority ADR and direct bypass tests.
- Atomic reservation: within one durable transaction, lock the installed
  policy, verify authority/revocation/time/replay, record before/after total
  and period budgets and the consumed observation/action identity, and append
  reservation evidence. One-use chain allowance provides independent duplicate
  effect protection. A lease alone is not an atomic monetary ledger.
- Crash/retry: before reservation no submission can exist; after reservation
  keep the action consumed. Persist SUBMITTING before dispatch. Unknown results
  go to read-only reconciliation, never blind resubmit or budget release.
- Revocation: distinguish requested, submitted and receipt/readback confirmed.
  Requested revocation pauses dispatch conservatively; confirmed revocation
  stops new execution at both reservation and effective chain boundary.
  Already-submitted transactions are reconciled and are not described as
  undone by revocation. Preserve the existing owner emergency disable/allowance
  clearing operations.
- Evidence: append trigger artifact and hash, freshness and threshold decisions,
  policy/Manifest hashes, budget before, reservation decision, execution attempt,
  reconciliation, remaining authority, and observed revocation/expiry state.
  Produce superseding Evidence Bundles; never rewrite history.
- Material-change invalidation: new workflow, reference, source, limits,
  recipient, chain, target/function or verifier requires new simulation,
  policy, Manifest and owner signature/installation. Frozen v1/v2 compatibility
  corpus and existing hash domains retain their meanings.

## 8. Security impact

- Protected assets: Safe USDC/WETH, residual allowances and finite authority.
- Trust boundaries: owner wallet → verifier/role; external data → validated
  observation; compiler → exact call; durable reservation → worker; chain
  receipts/state → independent reconciliation and evidence.
- Threats: compromised executor/backend, fabricated or stale prices, source
  substitution, pool manipulation, expiry/start bypass, replay, simultaneous
  workers, lease loss, revocation race, crash and ambiguous submission.
- Controls: independently enforced signed bounds, strict observations,
  transaction-backed reservations, one-use chain allowance, fencing,
  append-only journal, no owner-key custody, no arbitrary model send interface.
- The existing role alone cannot implement the complete conditional ceiling.
  D-016-1 prevents silently misrepresenting application gates as that ceiling.

## 9. Evidence target

- Initial deterministic tests: MOCKED with explicit synthetic observations.
- Financial acceptance target: FORK_REPRODUCED / RECONCILED on local chain
  31337 only, after verifier selection and actual local swap/reconciliation.
- At plan creation no execution had occurred. Subsequent local EVM fixtures
  must retain MOCKED labels and cannot be called fork financial proof.
- No TESTNET_EXECUTED or MAINNET_EXECUTED claim or public send is authorized.
- Reconciliation invariants: exact authority/call/chain/signer, successful
  receipt, exact USDC debit, WETH credit ≥ signed minimum, allowance consumed
  once, durable reservation consistent with chain effect, remaining budgets
  and residual token allowance disclosed.
- Frozen replay is not live market data. Missing source reads remain closed;
  changing price cases may be MOCKED but cannot be labelled real market dips.
  No historical transcript is edited or silently extended.

## 10. License impact

- Financial compiler/executor/reconciler and application code: AGPL-3.0-only.
- Additive workflow contracts: Apache-2.0; existing license boundaries persist.
- Plan/report: existing documentation classification.
- No JavaScript dependency or lockfile changes. The approved verifier uses
  official solc 0.8.21 with digest pin and fixed flags documented in ADR-0007.

## 11. Expected files

- Create first: this plan. Deliver the report with actual evidence and tests.
- D-016-1 authorizes: Mode C authority ADR; narrow additive policy/observation
  contracts and tests; compiler authorization binding; bounded worker and
  durable reservation tests; conditional verifier and bypass harness; linked
  journal/reconciliation/Evidence Bundle tests; PostgreSQL race tests.
- Modify only as necessary: package exports, schema export
  registration for additive contracts, exact cloud projection/dispatch
  integration, requirement registry with actual new evidence, and this report.
- Do not touch: Master Spec, historical evidence/compatibility vectors,
  persistent identifiers, BUILD-013 implementation, other worktrees/branches,
  unrelated cloud-runtime architecture or BUILD-017/018.

## 12. Risks and rollback

- Resolved design decision: D-016-1 selects the independent verifier and
  separate authorizing pool-state source; Base observation remains unchanged.
- Other risks: spot manipulation, single-provider/reorg uncertainty, closed
  replay coverage, verifier/compiler/deployment review, native-unit rounding,
  conservative stranded reservation after a crash and local-only certification.
- Rollback: disable new scheduling; owner confirms role/module revocation and
  clears residual allowance; preserve all journals/reservations/evidence.
  Reverting application code is not revocation. The initial plan created no permissions. Disposable test authority must be
  confined to isolated nodes and terminated after verification.

## 13. Questions requiring human decision

**D-016-1 — APPROVED (2026-10-03):** Owner approved a separate, narrow
conditional-verifier boundary using the existing WETH/USDC fee-500 pool-state
mechanism on chain 31337, strictly for BUILD-016 local evidence. Bind source,
reference observation, threshold, freshness and verifier identity to the
policy/Manifest. Fail closed for stale/unavailable/malformed data, wrong
pool/pair/fee/chain, reference mismatch and unverifiable state. The verifier
answers eligibility only; it creates no transaction, changes no parameters or
budgets and cannot bypass existing Mode B authority. Existing Base observation
semantics remain non-authorizing. Reuse the canonical swap and report maturity
truthfully. Implementation and the full required test suite are authorized.

The question and analysis below record the original resolved blocker; they
do not require approval again. All references above to pending D-016-1 or
proposed source/verifier selection are superseded by this explicit decision.

**D-016-1:** Approve the proposed local-chain-31337 extension of Safe/Roles
with a minimal independent conditional verifier, using the existing fixed
Uniswap v3 WETH/USDC fee-500 pool-state read mechanism as the signed dip source,
or name a different approved trigger source/verifier to use?

This decision is needed because:

1. `docs/adr/ADR-0001-mode-b-authority.md` and
   `docs/contracts/MODE_B_FINITE_AUTHORITY_V1.md` certify exact one-use swap
   bytes and router expiry, not a price-trigger verifier or policy start time.
2. `packages/reference-linter/src/base-observation.ts` explicitly states:
   “This observation is never an authorization input and cannot enable signing
   or execution.” Its review result is `authorizable: false`,
   `executable: false`. It cannot simply be promoted to Mode C authority.
3. Master Spec §8.5 says: “Writing a `manifestHash` beside a transaction in a
   database is not signature binding.” Master Prompt §8.3 permits deterministic
   submission only when the action passes every onchain or protocol-verifiable
   bound and requires executor-compromise analysis. An offchain if-statement
   leaves an unconditional executable role and does not meet this request's
   executor ceiling.

Existing quote and liquidity observations can supply reusable read/artifact
code, but do not themselves install an independently enforced signed trigger.
Owner authorization for BUILD-016 is recorded and will not be requested again;
D-016-1 selects the missing security-critical mechanism within that objective.
