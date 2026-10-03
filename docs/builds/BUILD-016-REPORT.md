# BUILD-016 — Report

Date: 2026-10-03. **IMPLEMENTATION COMPLETE; OWNER ACTION REQUIRED for acceptance/merge and the unachieved fork financial-certification target.**
The authorized local implementation and required behavioral tests are complete.
Evidence maturity is **MOCKED / RECONCILED**, chain 31337 only.
D-016-1 is APPROVED; no renewed mechanism-selection decision is requested.
No merge or public-chain transaction occurred.

## 1. Approved objective

Implement exactly one bounded conditional Mode C “Buy the dip” policy that
permits one existing USDC → WETH swap when an authorized WETH/USDC price
observation falls at least 5% from its Manifest-bound reference price,
subject to signed authority, atomic reservation, concurrency and replay
protection, freshness, frequency, cooldown, duration, budgets, expiry,
confirmed revocation, reconciliation and reconstructable evidence.

**D-016-1 — APPROVED:** The owner selected a separate eligibility-only verifier
using the existing WETH/USDC fee-500 pool-state mechanism on local chain 31337,
strictly for BUILD-016 local evidence. Source, reference, threshold, freshness
and verifier identity are bound to policy/Manifest. All requested invalid-data
cases fail closed. Existing Base observation remains non-authorizing. The
verifier creates no transaction, changes no authority or swap parameters, and
cannot bypass the existing Mode B boundary. The owner authorized implementation
and all required tests. This decision is recorded in the plan, DECISIONS and ADR-0007.

## 2. What was implemented

- One canonical MODE_C exact-input swap node, additive versioned policy,
  Manifest and execution plan, linked existing observation/artifact/simulation types.
- Separate fixed-pair/factory/fee pool-state collector with canonical block,
  raw-response, code and artifact commitments, strict normalization and freshness.
- Owner-deployed view-only Roles Custom condition, binding policy/Manifest and
  reference block/value/freshness; fresh synchronous trigger check in execution
  block, inclusive start, exclusive expiry, fixed target/value/operation/call hash.
- Existing compileModeB/encodeSwap, Safe 1.4.1 / Roles 2.1.0 exact parameters,
  one-call non-refilling allowance, finite approval, minimum output and revocation.
- Local-only bounded monitor, signed polling interval, wall/chain freshness,
  exact installation storage/bytecode readback and one deterministic dispatch.
- Atomic persistent reservation with consumed action/observation and budget
  before/after evidence in the same durable append; independent worker races,
  restart and conservative crash/unknown-result recovery.
- Canonical Journal transitions, hash-linked immutable attempt history,
  receipt-block owner/permission/balance reconciliation using reconcileModeB,
  content-addressed Evidence Bundle export and validated superseding lineage.
- PostgreSQL integration through unchanged CLOUD-001 transactional/fenced ports;
  no unrelated persistence architecture or migration.
- Pinned test compiler bootstrap, CI local EVM gate, additive compatibility vector,
  requirement registry, decision/ADR, plan, report and preserved execution evidence.

## 3. What was not implemented

No generic scheduler/oracle/automation engine, additional strategy, whale/calendar
monitoring, AI recommendations, BTC/cbBTC, BUILD-017/018, public-chain activation,
cloud deployment, UI authorization flow, owner-key custody or arbitrary LLM send.
The local adapter is explicitly constructed with an already-reviewed compiled
policy and existing storage; scheduling is its narrow `watch()` function.

The financial FORK_REPRODUCED target in plan §9 is **not achieved**. Synthetic
pool/token/router are explicit local test fixtures. Real Safe/Roles and verifier
execution does not promote those fixtures to fork financial certification.
No TESTNET_EXECUTED or MAINNET_EXECUTED claim is made.

## 4. Changes by component

| Component | Changed paths |
|---|---|
| Contracts | workflow-contracts/src/mode-c.ts and index export |
| Compiler | reference-compiler/src/mode-c.ts; optional conditional scope in mode-b.ts; index |
| Executor/verifier | reference-executor/src/mode-c.ts, contracts/BuyDipCondition.sol; index |
| Local runtime | reference-dapp/src/server/mode-c-service.ts |
| Reconciler/evidence | reference-reconciler/src/mode-c.ts; index |
| Tests | executor Mode C unit/fixture/local EVM contracts and tests; cloud Mode C PostgreSQL tests; additive authority vector |
| CI/tooling | contracts.yml adds local gate; bootstrap-build016-solc.py |
| Documentation | ADR-0007; BUILD-016 plan/report/two immutable evidence snapshots; DECISIONS, REQUIREMENTS, STATUS |

Existing base-observation implementation, Master Spec, historical vectors,
persistent identifiers, BUILD-013 and both externally owned worktrees are unchanged.

## 5. Evidence and tests

| Check | Result | Maturity / limitation |
|---|---|---|
| Full regression `pnpm test` | 1,238 PASS; 2 pre-existing gated skips | MOCKED engineering/compatibility tests |
| Focused Mode C unit suite | 47 PASS | Integer threshold, authority, budget, crash/recovery and compatibility |
| PostgreSQL `pnpm test:postgres` | 37 PASS, including 4 new Mode C cases | Real disposable local PostgreSQL; synthetic financial driver |
| BUILD-016 local EVM suite | 11 PASS | MOCKED: real pinned Safe/Roles + verifier, synthetic market/contracts |
| Typecheck, lint, production build | PASS | All workspace packages, including Next production build |
| Frozen schema export check | PASS: 11 exports | Existing schemas and hashes unchanged |
| Governance self-tests / scanner / whitespace | PASS: 17 self-tests | No secret/private-key artifact committed |
| Existing closed-fork Mode B smoke probe | FAIL CLOSED: MODE_B_NO_QUOTE | Existing composition replay does not provide this quote; no new financial effect |
| Initial closed-fork source-pin probe | REJECTED: MODE_C_UNVERIFIABLE_STATE | Existing profile uses SHA-256 code pins; verifier uses explicitly bound EVM Keccak code hash. No silent reinterpretation |

Local EVM proof includes actual signed owner deployment/installation/revocation
and executor transactions on isolated Anvil chain 31337. It independently checks
exact USDC debit 1,000,000 units, WETH credit 1,000 units ≥ minimum 990, consumed
Roles allowance, zero residual token approval, exact signer/bytes and one swap.
The successful automatic monitor record is
[BUILD-016-MONITOR-EVIDENCE.json](BUILD-016-MONITOR-EVIDENCE.json).
Its transaction is `0x3fbec1545b636995c976e1053c1bfb38c267e9a81ee425cff32ab6c5c143924f` and Evidence Bundle hash is `0xd3049ad548b95202243f391b4b06c8188b850e00ca9b90fa4bca09cb0f5358c7`.
The earlier independently executed fixture remains preserved in
[BUILD-016-EVIDENCE.json](BUILD-016-EVIDENCE.json); it is not overwritten.
These are separate disposable fixture executions, each with its own owner
installation and one consumed action, not retries of the same financial action.

## 6. Acceptance criteria

| Owner cases | Verification | Result |
|---|---|---|
| 1–3: <5%, exactly 5%, >5% | Rational 96/95/94 boundary; EVM nearest representable sqrt and next higher value | PASS |
| 4–6: stale, malformed, wrong source | Strict artifact/raw/source checks; unavailable monitor; malformed onchain slot0 | PASS |
| 7–9: cooldown, expiry, confirmed revocation | Unit controls; direct expired EVM call; unused owner-revoked authority then later valid trigger | PASS |
| 10–13: tokens, chain, recipient, target/function | Policy/action mutation and direct signed EVM bypass; broadened installed scope readback | PASS |
| 14–15: amount / cumulative and period budget | Exact-call mismatch, reservation limits, exhausted budget and no refill after rollover | PASS |
| 16–18: concurrency, replay, restart | Independent file/PG workers; exactly one reservation; same-block EVM success + revert; persisted state | PASS |
| 19: uncertain execution result | Signed hash/raw/nonce persisted before send; read-only reconciliation; no blind resend or budget release | PASS |
| 20: valid authority + trigger executes canonical swap | Autonomous monitor observes dip, dispatches once, reconciles, stops | PASS, MOCKED local EVM |

Crash-before/after reservation and after SUBMITTING, stale/revoked dispatch recheck,
monitor failure, requested/confirmed revocation, already-submitted recovery, storage
rollback and immutable Evidence Bundle supersession are additionally covered.
Exact 5% is tested as rational price equality. Finite integer pool sqrt ratios
cannot represent sqrt(0.95) exactly; the EVM boundary test proves the adjacent
integer values with cross multiplication and no early execution from rounding.

Plan precedes implementation; D-016-1 resolved the original blocker. All local
implementation criteria are met. The stronger fork financial-certification target
and owner acceptance/merge remain open and are not relabeled complete.

## 7. Security and authority semantics

The owner signs verifier deployment and exact Safe installation transactions.
Onchain immutable terms fix policy/Manifest/reference commitments; the Roles
scope fixes the checker/tag and exact financial call. Recording a hash beside
an unsigned transaction is not presented as signature binding.

One non-refilling action is the entire authority. Maximum amount, total and
period budgets, frequency/cooldown, start/expiry, source/pair/fee and recipient/
router/function/minimum are signed. The worker checks explicit limits; Roles'
one-call allowance and finite exact amount independently enforce a stricter
ceiling after the first action. Period rollover never renews it. Any numeric
budget headroom after consumption is unusable.

Reservation/evidence commit atomically through existing log CAS. File storage is
single-host; PostgreSQL supplies transaction and fencing guarantees. Leases alone
are not monetary reservation. Crash/revert/uncertainty strands the reservation
conservatively; owner review is needed to grant a new policy. No blind resubmit.

Requested revocation is a conservative local pause, not confirmed chain revocation.
Confirmed revocation requires all exact owner receipts plus effective module and
approval readback and blocks new actions independently of monitoring. Submitted
transactions remain reconciliation work; revocation does not reverse them.

The checker is read-only and cannot submit or alter transactions/budgets. It reads
current pool state synchronously; the monitoring artifact separately obeys signed
freshness. The adapter pins exact installed condition bytes, non-refilling allowance,
Safe/Roles identity, owner and verifier terms/runtime before dispatch.

Residual risks: manipulable spot price; trusted local RPC/state and possible reorgs;
no production verifier audit; no public authorization profile; database/chain are
not one transaction; a compromised executor can spend its single approved action
directly without application reservation/evidence, but cannot duplicate it or
bypass installed financial/trigger/expiry/revocation bounds. Owner control can
reauthorize or change Safe permissions and is outside executor authority.
Remaining fixture authority is terminated with the disposable local nodes.

## 8. Licenses

Existing AGPL-3.0-only compiler/executor/reconciler/app boundaries and Apache-2.0
workflow-contract boundary retained. No JavaScript dependencies or lockfile changes.
Official solc 0.8.21+commit.d9974bed has a fixed SHA-256 pin and flags in ADR-0007;
test-time third-party Safe/Roles/Anvil inputs retain existing pins and remain
outside Git. Compiler/bootstrap adds no deployed third-party dependency.

## 9. Deviations from the plan

The plan's target was FORK_REPRODUCED financial acceptance. Delivery proves the
approved local boundary at MOCKED maturity; the unchanged closed composition
transcript lacks the smoke quote and is not edited or extended. Genuine fork
proof remains an explicit next gate. No synthetic source is called Base market data.
The authority ADR accompanies implementation delivery rather than preceding code;
D-016-1 and the mandatory plan were recorded before implementation.
No browser UI was added: the autonomous monitor test proves execution independently
of a browser, consistent with this narrow backend policy.

## 10. Demonstrable state

Branch: `codex/build-016-mode-c-automation`.
Worktree: `/home/asus/projects/gryloo/.turbo/build016`.
Verified baseline: `40ea29dd39e9aa487747d40e6bc99e196053b806`.
Delivery HEAD is the commit containing this report, recorded by Git and the final
handoff. Plan, implementation, tests and report are delivered together. PR is
unmerged if created; owner retains merge.

## 11. Technical debt created

Local-only adapter and policy schema extension need independent security and
interoperability review before broader authorization. Conservative stranded
reservations require human disposition. A complete genuine fork price-transition
recording remains absent. No new generic runtime or migration debt introduced.

## 12. Suggestions for the next build — NOT APPROVED

No BUILD-017/018 or additional strategy is implemented or requested here.
Do not reuse this local maturity as authority for public execution.

## 13. Next-build options

Next gate within BUILD-016 acceptance: review the local evidence and authority
ADR, then obtain an explicitly approved complete fork recording/proof if the
original FORK_REPRODUCED financial-certification target is required. Broader
source/deployment choices and independent audit require their own authorization.

## 14. Required human decision

D-016-1 is resolved and approved. Owner acceptance/review and merge remain owner
actions. The fork financial-certification target remains unmet; the owner may
accept the bounded MOCKED local implementation or authorize the missing genuine
fork proof separately. No fresh permission to implement BUILD-016 is needed.
