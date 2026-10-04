# BUILD-TEMPO-001 — Flofi Tempo integration

Completed repository implementation: 2026-10-04. Owner acceptance remains pending.

## Outcome and boundary

Flofi now authors and compiles one bounded pathUSD memo payment on **Tempo Moderato**
through its existing Guided/Canvas, canonical IR, capability registry, artifacts,
Review, owner-wallet boundary, generic PostgreSQL cloud runtime, observation worker,
reconciliation and evidence archive. There is no Tempo-specific persistence system,
deployment, signing service or product application.

The Phase 1 profile permits one `asset.transfer` / `tempo.tip20`, at most **10 test
pathUSD**, an explicit distinct ordinary recipient, bytes32 memo, at most **0.1
pathUSD** fees, a gas ceiling and **120-second on-chain expiry**. Mainnet is disabled.
The native type-0x76 envelope binds pathUSD as the fee token, zero native value,
one call and protocol nonce key zero. Sponsorship, delegation, batching, DEX swaps,
payment sessions and recurring authority are deferred.

**No owner wallet signature, faucet request or transaction submission occurred.**
Public read-only simulation passed. Full lifecycle tests use a MOCKED chain; they
do not establish PUBLIC_TESTNET_EXECUTED or FORK_REPRODUCED evidence for Tempo.
The capability registry's demonstrated execution evidence remains **null**.

## Base and preserved history

Worktree: `.turbo/build-tempo-001`; branch: `codex/build-tempo-001`.
Started clean at the fetched safe cloud branch `claude/build-cloud-001`, commit
`8d43ea675b5c1284c5e44c2599025776af3bcc00`. The draft PR is stacked on that branch.
Protected branches/PRs #48–52 were not edited, advanced, merged or force-pushed.
Existing historical build records, evidence, manifests, schemas and chain profiles
retain their contents and semantics. Additive network registration keeps existing defaults.
No dependency was added and the lockfile is unchanged.

## Protocol discovery and decisions

The [plan](BUILD-TEMPO-001-PLAN.md) records official discovery before implementation.
Current official documentation was downloaded from `docs.tempo.xyz/llms-full.txt`;
the links resolve to Tempo's developer documentation. Official Rust transaction and
RPC simulation source were also inspected to check encoding and normalization:
[transaction source](https://github.com/tempoxyz/tempo/blob/main/crates/primitives/src/transaction/tempo_transaction.rs),
[signature source](https://github.com/tempoxyz/tempo/blob/main/crates/primitives/src/transaction/tt_signature.rs).

| Topic | Discovery and implementation consequence |
| --- | --- |
| Networks | [Connection details](https://tempo.xyz/developers/docs/quickstart/connection-details): mainnet 4217 / `rpc.tempo.xyz`; Moderato 42431 / `rpc.moderato.tempo.xyz`, HTTP and WSS; test explorer `explore.testnet.tempo.xyz`. Devnet 31318 is documented in verification references but not enabled. Only Moderato has a capability row. |
| Transactions | [Native specification](https://tempo.xyz/developers/docs/protocol/transactions/spec-tempo-transaction): strict type 0x76 RLP verification and owner recovery. Accept secp256k1 recovery parity 0/1 or Electrum 27/28; reject changed fields, extras, sponsored/key/AA envelopes or type-2 downgrade. |
| VM / wallet | [EVM differences](https://tempo.xyz/developers/docs/quickstart/evm-compatibility): Osaka EVM, no spendable native currency; native balance RPC is a compatibility placeholder. New storage/account creation costs differ. Reuse ABI/hash/RLP tools, not Ethereum gas/balance/finality assumptions. |
| Tokens / policies | [TIP-20](https://tempo.xyz/developers/docs/protocol/tip20/spec) and [memos](https://tempo.xyz/developers/docs/guide/payments/transfer-memos): USD currency, six decimals, pause and transfer policies, invoice memo. Pin pathUSD `0x20c0000000000000000000000000000000000000` and always-allow policy 1; reject unsupported policy/code state. A successful receipt alone cannot prove recipient credit because receive policies can hold payments. |
| Fees | [Fee specification](https://tempo.xyz/developers/docs/protocol/fees/spec-fee): attodollars/gas, micro-pathUSD balances, cost `ceil(gas × price / 10^12)`. Explicit pathUSD fee token avoids preference ambiguity. Bound gas/rate/total fee and verify the protocol fee event and token balance delta. |
| Discovery / simulation | Native call-array gas estimation works. `eth_simulateV1` normalizes top-level calls: a single flattened `to/value/data` call with the native envelope fields avoids accidentally appending an extra CREATE call. Validation is true; no account/state overrides. Require exact payment/memo and one bounded fee event. |
| Venues | [Official stablecoin DEX](https://tempo.xyz/developers/docs/guide/stablecoin-dex/executing-swaps) exists at `0xdec0000000000000000000000000000000000000`; routing, approvals and liquidity need separate controls. Memo payments demonstrate chain-native payment semantics with less scope. MPP, Zones and sponsored payments are deferred. |
| Test assets | [Official faucet](https://tempo.xyz/developers/docs/quickstart/faucet) supplies test OUSD, pathUSD, AlphaUSD, BetaUSD and ThetaUSD. Documented for the owner; never invoked here. |
| Finality | [Consensus differences](https://tempo.xyz/developers/docs/quickstart/evm-compatibility): Simplex BFT deterministic finality. Check canonical inclusion against a finalized head instead of importing Base/Ethereum confirmation assumptions. |

Native network support in an EVM wallet does **not** establish support for
`eth_signTransaction` returning this envelope. The browser adapter requires that method
plus `eth_sendRawTransaction`, checks signed bytes before broadcast and fails closed
on unsupported wallets. No named production wallet has yet been owner-validated.
This is an explicit owner acceptance dependency.

## Architecture and safety

| Canonical stage | Integration |
| --- | --- |
| Guided / Canvas → IR | Same workflow store, proposal/reducer, revision invalidation and Canvas. Chain-neutral token-payment ports on existing `asset.transfer`; no IR schema change. |
| Registry / Build | Additive `tempo.tip20` PUBLIC_TESTNET row and isolated profile validation. Compiler emits existing ArtifactSet, SimulationBundle, AuthorizationPolicy, StrategyManifest and ExecutionPlan schemas. |
| Simulate / Review | Real pinned-block metadata/balances/nonce/fee/gas reads and validated RPC preflight; hash-bound exact transaction and raw preflight response. Fresh state/preflight at Review, begin and hash handoff; failed validation durably removes authorization. |
| Authorization | Browser-only native envelope signing, recovered-owner/exact-byte checks, current workflow/wallet/expiry guards before and after asynchronous wallet reads. MODE_A manifests retain honest NOT_ENFORCED strategy-policy status; no generic on-chain policy executor or recurring authority is claimed. |
| Cloud runtime | One new flow definition and projector on unchanged generic storage/leases/API idempotency/queue/worker/archive ports. PostgreSQL persists PREPARED before signing and the verified hash before browser broadcast. Server never receives raw signed bytes from the browser. |
| Observation / recovery | At most one attempt per run; nonce reservation prevents concurrent runs using the same protocol nonce. PREPARED is not cancelled by worker observation. Uncertain outcomes stay observation-only. Finalized expiry plus unused finalized/latest/pending nonce proof permits a linked new simulation with fresh Review and no authorization. |
| Reconciliation / Evidence | Verify raw public envelope/hash/owner, canonical finalized inclusion, expiry, successful receipt, token/payer/fee ceilings, exact payment/memo/fee logs, protocol nonce increment and sender/recipient token deltas. Archive standard EvidenceBundle plus reproducible artifacts/journal/public raw transaction. Public label is emitted only after actual reconciled owner execution. |

Backend RPC is an explicit read-only allowlist; workers never submit, sign or fund.
Historical EvidenceBundle v1's `TESTNET_EXECUTED` maps to the additional public
`PUBLIC_TESTNET_EXECUTED` label only after reconciliation; MOCKED remains MOCKED.
No old evidence or schema enum is rewritten.

## Public read-only artifacts

All discovery attempts are preserved; none is owner authorization or execution evidence.

| Artifact | Result |
| --- | --- |
| [Initial transcript](BUILD-TEMPO-001-PREFLIGHT-READONLY.json) | Discovery complete; RPC rate limit made preflight fail closed. Its original synthetic-account description called the account unfunded; the actual balance read shows pre-existing public funding. No faucet was called. |
| [Recheck](BUILD-TEMPO-001-PREFLIGHT-READONLY-RECHECK.json) | Native gas estimate passed; nested simulation call normalization failed closed. This led to the single-call flattening correction. |
| [Passed preflight](BUILD-TEMPO-001-PREFLIGHT-READONLY-FINAL.json) | 24 read-only calls; validated native-envelope simulation passed at 2026-10-04T00:03:16Z. |
| [Complete discovery](BUILD-TEMPO-001-PREFLIGHT-READONLY-COMPLETE.json) | 33 read-only calls at 2026-10-04T00:17:44Z. Includes raw/receipt/transaction RPC reads for unrelated already-public transactions; confirms real feeToken/feePayer fields and rounded micro-pathUSD fee events. These transactions are not Flofi execution proof. |
| [Final verified capture](BUILD-TEMPO-001-PREFLIGHT-READONLY-VERIFIED.json) | 33 read-only calls at 2026-10-04T00:26:49Z using the final strict fee-event validator. Validated payment preflight passed; zero submitted transactions, zero faucet requests, no owner signature. |

Complete discovery pinned finalized block `0x244c4e6`, hash
`0xce866805576c48cd5ec85d6389cb9666218f05534a225c058454dc133c763cfd`.
The synthetic publicly known account's actual balance was `54524817217618`
micro-pathUSD, protocol nonce 0. Payment simulation used 1 test pathUSD to
`0x2222222222222222222222222222222222222222`, memo `01` repeated 32 bytes,
gas limit 352907 and maximum fee rate 1597200002 attodollars/gas.
The ephemeral RPC-generated transaction hash in simulation logs is **not** a broadcast hash.
The final verified capture pins finalized block `0x244c875`, hash
`0xa46fc659ebc57c8cffe0e2936bf3ee9784bc373bbaa6f0137a13816b1cb711d8`.

Reproduce read-only discovery after `pnpm build` with
`node scripts/verify-tempo-readonly.mjs <new-output.json> [address]`.
The script refuses to overwrite an artifact and permits only reads. Old captures
are historical observations, not fresh authorization; the UI obtains a new preflight.

## Validation

| Gate | Final result |
| --- | --- |
| `pnpm check` | PASS: typecheck, lint, production build, all 11 unchanged schema exports; 1,218 unit tests passed, 2 existing conditional tests skipped (152 files passed, 2 skipped). |
| `TEST_DATABASE_URL=… pnpm test:postgres` | PASS: 34 tests in 5 files, including the Tempo shared-runtime test with mocked chain, concurrent nonce contention, lost browser report, API restart, worker reconciliation and archive integrity. |
| Guarded Playwright | PASS: 5 tests for Tempo Canvas/Guided authoring and bounded edits, shared workflow round-trip, external-network guard and its negative self-test. |
| `pnpm test:anvil` | PASS: 4 offline compatibility tests; 10 owner-specific tests skipped without owner material. |
| `pnpm test:fork --testTimeout=30000` | PASS: 31 tests; 29 owner/environment-gated tests skipped, no Tempo fork execution claim. |
| Dependency integrity / licenses | PASS: 262 registry entries/integrities/release ages, exact existing 16 license exceptions; no dependency/lockfile changes. |
| `pnpm audit --audit-level low` | PASS: no known vulnerabilities found at validation time. |
| Governance-lite + unittest | PASS: safety scan and 17 governance tests. `git diff --check` passed. |
| Official public Tempo RPC | PASS: final read-only discovery/validated payment simulation; 33 calls. No public Flofi execution. |

The Tempo unit/service tests cover canonical schemas, fee rounding, stale/wrong-chain
state, unsupported pause/policy/accounts, held payment, exact envelope/signature,
changed Review intent/nonce/fee/owner/expiry, wallet edits during asynchronous requests,
durable hash-before-broadcast, one submission, nonce contention, finalized expiry
recovery with fresh Review, consumed/pending nonce refusal, divergent receipts and
worker RPC method denial. MOCKED evidence remains MOCKED across restarts.

Browser tests use guarded loopback traffic, a pinned Chromium revision and synthetic local Anvil; they make
no public Tempo requests or owner signing prompts. The existing E2E runner now accepts
an optional validated `GRYLOO_E2E_PORT` to avoid another worktree's occupied port;
its default and network guard remain intact.

Initial browser setup encountered an occupied default port and missing Chromium
shared libraries; the passing run used port 3019 and existing pinned browser libraries.
An initial broader fork regression run failed because another process occupied its
fixed ports and a workspace-local TMPDIR violated its deliberate outside-repository
credential-file rule. The final passing run used a private loopback-only network
namespace and `/tmp/tempo-fork-tests`. No existing test or secret boundary was weakened,
and no other worktree's service was stopped. Skipped tests are not counted as passes.

## Limits and owner follow-up

Exact block balance deltas deliberately fail closed on unrelated same-block payments.
Finality trusts the configured official RPC; there is no independent validator proof.
Archive/reconciliation requires historical balances, receipts and raw transaction RPC
availability. Unsupported token policies, wallet envelopes or stale state stop execution.
Deployment and a compatible production wallet's native signing acceptance remain owner tasks.

Follow the [exact owner E2E instructions](BUILD-TEMPO-001-OWNER-E2E.md). Repository work
ends with a **draft PR**, without deployment, merge, wallet signature or financial transaction.

For Crypto World's Fair, demonstrate the single Flofi application: Guided or Canvas
payment → canonical artifacts → public read-only preflight → Review → durable cloud
run and evidence inspection. Describe this as a multichain workflow engine with a
Tempo-native memo payment adapter. Until owner acceptance reconciles a real transaction,
use **PUBLIC_READ_ONLY + MOCKED lifecycle tests** as the submission's evidence level.
