# BUILD-016 — Report

Date: 2026-10-03. **BUILD-016 BLOCKED — genuine fork financial certification requires fresh owner-provided transport inputs.**
The owner accepted the local behavioral implementation but requires the original
FORK_REPRODUCED financial target before BUILD-016 acceptance. Only the missing
certification was pursued in this continuation; no product functionality or
policy semantics changed. Current financial evidence remains **MOCKED / RECONCILED**,
chain 31337 only. The owner confirmed both fresh recording inputs are unavailable.
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
| Certification continuation | e2e/fork/build016-fork-preflight.mjs; executor/test/mode-c-fork-coverage.test.ts; new BUILD-016-FORK-PREFLIGHT.json; plan/report/status updates only |

Existing base-observation implementation, Master Spec, historical vectors,
persistent identifiers, BUILD-013 and both externally owned worktrees are unchanged.

## 5. Evidence and tests

| Check | Result | Maturity / limitation |
|---|---|---|
| Full regression `pnpm test` (continuation) | 1,243 PASS; 2 pre-existing gated skips | Engineering tests, including five new NOT_EXECUTION_EVIDENCE coverage checks |
| Focused Mode C unit suite | 47 PASS | Integer threshold, authority, budget, crash/recovery and compatibility |
| PostgreSQL `pnpm test:postgres` (prior delivery) | 37 PASS, including 4 Mode C cases | Preserved result; not rerun in this certification-only continuation |
| BUILD-016 local EVM suite (prior delivery) | 11 PASS | Preserved MOCKED result; real pinned Safe/Roles + verifier, synthetic market/contracts |
| Typecheck and lint (continuation) | PASS: 15 typecheck/build-dependency tasks; workspace lint | No production code change |
| Production build / frozen schema exports (prior delivery) | PASS / 11 exports | Preserved result; not rerun in this continuation |
| Governance self-tests / scanner / whitespace (continuation) | PASS: 17 self-tests | No secret/private-key artifact committed |
| Genuine-fork read-only coverage probe (continuation) | BLOCKED: exit 3 twice; byte-identical output | NOT_EXECUTION_EVIDENCE; missing token/tick state, no financial submission |
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
| Required genuine financial fork gate | Cannot construct verified reference or drive ≥5% move from the incomplete closed state; fresh transport files unavailable | BLOCKED, no FORK_REPRODUCED financial evidence |

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
transcript lacks the smoke quote and is not edited or extended. The owner now
requires this original fork target; it remains unmet. The certification
continuation below establishes the exact missing source state and external
transport blocker. No synthetic source is called Base market data.
The authority ADR accompanies implementation delivery rather than preceding code;
D-016-1 and the mandatory plan were recorded before implementation.
No browser UI was added: the autonomous monitor test proves execution independently
of a browser, consistent with this narrow backend policy.

## 10. Demonstrable state

Branch: `codex/build-016-mode-c-automation`.
Worktree: `/home/asus/projects/gryloo/.turbo/build016`.
Verified baseline: `40ea29dd39e9aa487747d40e6bc99e196053b806`.
Accepted local implementation HEAD: `0ecf063f58c2613f8dc1ce6b28dc1e6280dc407f`.
Continuation HEAD is the commit containing this report, recorded by Git and the
final handoff. PR [#52](https://github.com/alrimarleskovar/gryloo/pull/52) stays
draft, open and unmerged; owner retains merge.

## 11. Technical debt created

Local-only adapter and policy schema extension need independent security and
interoperability review before broader authorization. Conservative stranded
reservations require human disposition. A complete genuine fork price-transition
recording remains absent. No new generic runtime or migration debt introduced.

## 12. Suggestions for the next build — NOT APPROVED

No BUILD-017/018 or additional strategy is implemented or requested here.
Do not reuse this local maturity as authority for public execution.

## 13. Next-build options

Next gate within BUILD-016 acceptance: provide the fresh transport files in §14,
complete the separately pinned recording/replay fixture, then run the genuine
fork financial certification with all existing authority semantics. The owner
has already authorized this work and requires FORK_REPRODUCED / RECONCILED.
Broader source/deployment choices and independent audit require their own authorization.

## 14. Required human decision

D-016-1 and fork certification implementation authorization are approved. The
owner explicitly confirmed there is no fresh Alchemy credential or current
Free-plan attestation and directed recording to remain blocked on this external
requirement. No credential value is requested, read by the agent or committed.
No paths are invented and no destroyed historical credential is reused.

Exactly **two owner-provided files** are required, at owner-selected absolute
paths outside all Git checkouts (actual paths have not been supplied):

1. **Current Alchemy Free-plan billing attestation JSON**, owner-owned regular
   file, mode `0600`. Use the existing recorder format
   `gryloo.build-003f-provider-billing.v1`, `provider: "Alchemy"`, `plan: "Free"`,
   `network: "Base Mainnet"`; `paymentMethod`, `paidAddOn`, `payAsYouGo`,
   `overage`, `autoUpgrade` all `false`; `reportedOn` equal to the recording's
   current UTC date. Supply actual integer `usedMonthlyCu`,
   `monthlyAllowanceCu: 30000000`, and `remainingMonthlyCu`, with used + remaining
   = allowance and remaining ≥ 39000. After the new credential-free preflight,
   add truthful `credentialRotated: true`, `previousCredentialDeleted: true`, and
   `rotatedOn` for that recording date. No credential belongs in this JSON.
2. **Fresh rotated Alchemy Base Mainnet recording credential file**, owner-owned
   nonsymlink regular file, mode `0600`, created/modified after that new preflight.
   Its trimmed content must satisfy the existing recorder's 16–128-character
   alphanumeric/underscore/hyphen validation. Only the recording proxy may read
   it and place it in its fixed Alchemy Authorization header; never provide its
   contents in chat, argv, logs, environment, artifacts or Git. The recorder
   destroys the file at completion or stop.

These preserve ADR-0004 and the existing recording contracts. A future BUILD-016
recording needs its own fresh preflight manifest, journal and request/CU
reservations, retaining limits of 1500 requests / 39000 listed CU / 30 minutes,
400 ms single-flight spacing, 30 s provider timeout and permanent first-error
stop. Historical attempt budgets are not available. Disposable local test
signers and their mode-0600 files are generated locally, not additional owner
wallet keys. The old BUILD-007 recorder must not be run against its spent root.
The BUILD-016-specific scenario/recording entrypoint and complete closed fixture
remain work for the authorized continuation after transport becomes available;
the files alone do not constitute certification. No new implementation approval
is needed to resume the already-authorized fork proof.

### Certification continuation: exact blocker and immutable evidence

New artifact: [BUILD-016-FORK-PREFLIGHT.json](BUILD-016-FORK-PREFLIGHT.json).
It records 25 read-only local RPC calls, code commitments, raw failed responses,
the unchanged collector's failure, exact reference/5% crossing requirements and
all three existing recording inventories. It is explicitly
**NOT_EXECUTION_EVIDENCE** with no financial transaction or execution Evidence
Bundle. Probe exit `3` means `BLOCKED_MISSING_PINNED_STATE`; it is not a passing
fork execution gate.

Source provenance: unchanged BUILD-007 composition recording from the fixed
Alchemy endpoint class, finalized Base chain 8453 block **51,906,032**, hash
`0x53282db3770a2993f40791f5bbd81e7cdfcded69e5f699bfb0e1c036d635dd6d`;
transcript SHA-256
`337da42d5a89f504a37ea795703b52a340a27cfbac2ccbf6793de532c30a496d`.
Pinned Anvil 1.8.3 ran a closed replay on local chain 31337 with no upstream
fallback. Real protocol code/state used for the failed preflight:

| Contract | Exact address | EVM runtime Keccak-256 |
|---|---|---|
| WETH | `0x4200000000000000000000000000000000000006` | `0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c` |
| USDC proxy | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | `0xa6705a10bb756b5dea144591118be77d7af0c3eee3bf2dfe2583dcb0364fefab` |
| V3 factory | `0x33128a8fc17869897dce68ed026d694621f6fdfd` | `0x95707a4ac71f20181a63ef7d180e3c625be5d20fc8f6f980befa966bad568132` |
| SwapRouter02 | `0x2626664c2603336e57b271c5c0b26f421741e481` | `0x38bd640f47df62b2fd5a6755a63f4976ad847dc9b946ae0d145d21d16bb124e4` |
| WETH/USDC fee-500 pool | `0xd0b53d9277642d899df5c87a3966a349a798f224` | `0xcd06f61c6db6a1d8317548aaaa0aa83254624aec741534c51815810e977587ae` |

The existing profile's pool-code pin is a byte SHA-256. The probe verifies that
pin and derives the required EVM Keccak commitment from the actual runtime
bytes; it does not reinterpret the SHA pin as Keccak or alter the profile.
Real factory/pool identity calls succeed. Reference `sqrtPriceX96` is
`4106074326487655150519822`, tick `-197363`, liquidity `1368767480568985051`.
The exact maximum eligible sqrt price is `4002106202477515253583342` (tick
`-197876`), evaluated using squared integer arithmetic. These are source
coverage facts, not an authorized fresh execution observation.

The actual WETH `decimals()` call requires unrecorded slot **2**; USDC
`decimals()` requires unrecorded slot **6**. The unchanged collector rejects
the former with `FORK_STATE_UNRECORDED`. The actual bitmap word `-78` has all
256 bits set. Reaching the 5% boundary requires crossing 51 initialized ticks
from `-197370` through `-197870`, with **201 of 204 Tick.Info storage words
missing**. Direct real `ticks(int24)` reads at both ends fail closed; the new
artifact lists every missing word. These are necessary reads, not a complete
new transaction's read set. Other recordings pin blocks 51,797,365 and
51,880,679 with different hashes; their state cannot be spliced into this one.

The minimal legitimate new fixture must pin one finalized N/H, record actual
token metadata/proxy state and all cold protocol reads needed by the existing
collector, simulation and real trades, then drive the pool down ≥5% via a
real WETH→USDC trade on local chain 31337. It must perform the already-authorized
USDC→WETH action through unchanged Mode B/Manifest/Mode C enforcement, reconcile
receipts/balances, and prove the required negative/recovery cases in closed
replay. Local ETH funding, disposable accounts and test clock must be explicit;
no token/pool/router code substitution, pool storage setter, assumed decimals,
zero-filled missing ticks or synthetic provider reply can stand in for source
state. No new fixture recording started because the external inputs are absent.

Artifact file SHA-256:
`bfcda425a1c0c2e712ca5df1351ac7d6fe9d3893596465cba71312c9a041f25d`.
Canonical document SHA-256 (excluding its own digest field):
`a95877a803f260e6f58b3e2d404944c9925c107de0ccafe054c16684aa4f696f`.
There are **no new financial transaction hashes or fork Execution Evidence
Bundle hashes**. Existing MOCKED snapshots are byte-preserved:
`BUILD-016-EVIDENCE.json` SHA-256
`fb6a92a6d11b4dcb1e5b40b61b4d438798a97602e0cb3e64a27397de429b19e4`;
`BUILD-016-MONITOR-EVIDENCE.json` SHA-256
`ace404cc81bfe31222c0825f0108bb8440b23b1e2324b87f6f4ccce24f65a1f5`.

Continuation checks: five credential-free coverage/integrity tests verify
source-response pins, independent Keccak/SHA code commitments, failed closed
reads, exact trigger boundary/missing slots and rejection of public/mismatched
RPC profiles. These run under the existing unit CI gate. CI architecture and
its MOCKED local EVM gate are unchanged; green engineering CI cannot certify
the missing financial fork gate. Financial maturity stays **MOCKED / RECONCILED**;
fork certification is **BLOCKED**, not COMPLETE. No TESTNET_EXECUTED or
MAINNET_EXECUTED claim is made.

The coverage probe was run twice against the unchanged closed node: both exit
`3`, and the complete output files match byte-for-byte. Direct comparison with
the accepted local implementation commit confirms both MOCKED evidence files
and all three source transcripts are byte-preserved. The full regression suite,
workspace lint/typecheck, 17 governance self-tests and scanner passed. No fresh
provider attempt, public-chain transaction, merge, or evidence relabel occurred.
