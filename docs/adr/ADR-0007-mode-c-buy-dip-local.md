# ADR-0007 — BUILD-016 one-action local conditional authority

- Status: ACCEPTED for D-016-1's local implementation boundary; financial maturity remains MOCKED.
- Decision date: 2026-10-03.
- Approval: explicit owner BUILD-016 authorization and OWNER DECISION D-016-1.
- Scope: one USDC→WETH fee-500 conditional swap, chain 31337 only.

The existing certified Mode B Safe 1.4.1 / Roles 2.1.0 exact-call scope is reused.
The Base observation profile remains non-authorizing and unchanged. A separate
`build016.uniswap-v3-pool-state` artifact collector verifies the fixed factory,
pool/code hash, WETH/USDC token order, decimals, fee, canonical block and slot0.
The reference, source, threshold (500 bps), freshness (1–60 seconds), verifier
identity/code, budgets and temporal/financial bounds are committed in the policy
and version-2 Mode C Manifest. No new workflow representation is introduced.

Owner-signed deployment fixes policy and Manifest hashes in a view-only
`BuyDipCondition`; owner-signed Safe calls install its Roles Custom condition
alongside the existing exact deadline, nested calldata and non-refilling call
allowance. The constructor verifies reference block hash, freshness and value.
The condition reads the approved pool synchronously in the execution block,
validates identity and state, enforces start/expiry and exact swap hash, and
answers eligibility only. It creates no transaction and has no setter or
privileged upgrade path. Worker snapshots separately enforce the signed
freshness window before reservation and dispatch. A stalled/unavailable monitor
never queues an action. Pool spot manipulation is not prevented.

Exactly one action is allowed in the entire policy. Roles' non-refilling
one-call allowance, finite token approval and fixed amount independently impose
a financial ceiling no greater than total/per-period budgets. After that action,
all cooldown/frequency/per-period limits are satisfied by permitting zero further
actions. The worker also checks those explicit signed limits before reservation.
Period rollover cannot renew authority. Larger nominal budgets leave unusable
numeric headroom once the single action is consumed.

Reservation and evidence occupy the same atomic strict-prefix log extension.
The existing file store is single-host; PostgreSQL uses the existing transactional
CAS and fenced lease ports. The ledger identity binds installed chain/Roles/role/
allowance, not worker identity. Persist signed hash/raw/nonce before broadcast;
unknown results only reconcile. A reserved action remains consumed after crash,
revert or failed dispatch and needs owner review, never automatic budget release.
The chain allowance additionally prevents duplicate financial effects after
lease loss or direct competing executor calls. This is not two-phase atomicity
between a database and Ethereum, and an executor bypassing the service can spend
its one approved action without creating application reservation evidence.

Revocation request pauses the worker. Confirmation requires successful exact
owner revocation receipts plus module/allowance readback. Confirmed chain
revocation blocks new actions independently of the monitor. Already-submitted
transactions remain receipt/reconciliation work; revocation does not undo them.

Frozen v1 artifact schemas, hash domains, approved export maps and historical
compatibility vectors remain unchanged. Mode C's additive version-2 Manifest/
plan and versioned policy use canonical format-discriminated BUILD-016 intent
envelopes; they cannot be hashed or authorized as frozen v1 artifacts. Existing
canonical IR, observation, simulation, Journal and Evidence Bundle types remain.

Solidity compiler: official solc-bin 0.8.21+commit.d9974bed Linux x64,
SHA-256 `f2857a898be15c69e8de5598dcd3f3e169e94964a0ce9a0bbb1b111f145a81df`.
Flags: `--via-ir --optimize --optimize-runs 200 --evm-version shanghai`.
Runtime and deployment template hashes are bound per compilation and checked
on installation. Safe/Roles/Anvil retain their existing exact pins. No JavaScript
dependency or lockfile change is needed.

Validation includes worker and PostgreSQL races, crash/restart/uncertain-send
recovery, owner revocation before delayed trigger delivery, and direct signed
EVM bypass attempts. The EVM suite uses synthetic pool/token/router fixtures
with real pinned Safe/Roles and the verifier, so it is MOCKED / RECONCILED local
execution evidence. It is not FORK_REPRODUCED, TESTNET_EXECUTED or MAINNET_EXECUTED.
The old closed fork transcript is unchanged. A genuine fork financial proof and
independent security review remain certification gates before broader deployment.
