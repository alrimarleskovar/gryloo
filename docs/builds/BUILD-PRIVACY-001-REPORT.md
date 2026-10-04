# BUILD-PRIVACY-001 — current implementation report

## Status and commit boundary

**The provider-supported authorization contract and genuine SDK execution/recovery path are implemented locally behind the existing financial release gate. READY_FOR_OWNER_EXECUTION is false; no challenge acceptance is claimed.** Selected policy remains **SOL → public USDC, with private SOL change**. There is no exact Jupiter route authorization, public fallback, new feature outside this build or owner financial transaction.

Work is confined to `/home/asus/projects/gryloo/.turbo/privacy001`, branch `codex/build-privacy-001-cloak`. The existing remote head is `6bded358886525d0d0e524ee0ba9013496101bcd`; the LOCAL/MOCKED checkpoint is `11670bf`. The actual-SDK investigation tests/blocker documentation/report update were already committed and pushed at that head before this continuation. PR #55 remains draft. Main, CI migration, Tempo and BUILD-016 were not modified. **The new implementation and updated documents remain uncommitted for review.** No commit/push/merge, owner signing/funding, secrets/API-key request or public-chain financial execution was performed in this continuation.

## Accepted protocol contract

The owner accepted the exact-route limitation and authorized a Cloak-specific contract covering the properties supported by SDK 0.2.5. The [contract investigation](BUILD-PRIVACY-001-LIVE-BLOCKER.md) preserves the original counterexamples and now records each actual guarantee. The old exact-route blocker is superseded for this scoped property contract; it remains a factual reason never to pretend that an internal Jupiter route was owner-approved.

The UI and exported review/evidence explicitly say:

- Routing provider: Jupiter via Cloak
- Exact DEX route: provider-managed and not authorization-bound

The signed request/proof and frozen-v1 Manifest chain bind exact gross shielded SOL spend, USDC mint, exact owner USDC ATA, minimum public output, maximum protocol fee, actual private SOL change commitment/conservation and refund authority. Fixed provider/program/mainnet guards and local review freshness remain mandatory. Genesis is a pinned RPC/observation guard; no invented SDK genesis field is signed. Signed issue time and relay first-use freshness do not enforce a settlement deadline or cancellation of an already accepted swap. Changed bound fields, extra route commitments, altered amounts/recipient/provider, stale review and missing/corrupt custody data fail closed.

Verification used the SRI-checked published SDK, its actual Poseidon/ext-data and authentication encoders, the official [request-authentication agreement](https://docs.cloak.ag/sdk/request-authentication), [instruction surface](https://docs.cloak.ag/protocol/shield-pool) and [lifecycle](https://docs.cloak.ag/platform/transaction-flows). Read-only production relay health and finalized mainnet genesis/PoolConfig reads confirmed current configuration. The relay reported open swap intake and matching sealed artifact provenance. No authenticated production request was sent, so production acceptance is not claimed. No additional security-critical property-binding blocker was identified in this model.

## Exact functionality completed

| Boundary | Current implementation |
| --- | --- |
| Prepare and simulate | Actual SDK note/mint/index/conservation/recoverable-change/refund checks; funded-nullifier unspent checks; relay Merkle membership matched to a finalized program-owned root; deployed PoolConfig fee decoding; real ceremony Groth16 proof creation and verification; exact public-signal/wire-byte checks. This verifies proof and finalized input state. It does **not** RPC-simulate the future source or settlement transaction or predict a market output. |
| Review / Manifest | Existing canonical privacy workflow and frozen v1 QuoteState → ArtifactSet → Simulation → Policy → Manifest → Plan hashes. Browser hash parity is tested against the Node implementations. Output shown is the authorized minimum, explicitly not a market prediction. Exact SDK preimage/body digest is bound to the candidate review; copying or changing branded proof/review fails. Historical artifacts are deterministically reconstructed before recovery. |
| Owner boundary | Actual Wallet Standard message-signing integration, exact returned message and Ed25519 verification, mainnet/account-change guard, current-workflow checks before/after wallet interaction. Viewing-key registration is a separate explicit action with recovery/privacy disclosure; spending keys remain local. **The existing unconditional financial release gate and capability/linter blocks remain unchanged.** |
| Submission | Immutable encrypted prepared notes/request/Manifest/journal precede signing; atomic input-note/nonce reservation precedes wallet interaction; exact signed request and submission journal precede one fixed-origin POST. Raw response or uncertainty is encrypted before interpreting status. There is no auto-signing, root retry, rebinding, resubmission or hidden public path. |
| Restart / backup | Public recovery-reference catalogue in the browser points to encrypted IndexedDB records. Complete backups retain prepared/result notes, authorization, transport evidence and hash-linked journal. Atomic restore authenticates all supplied envelopes, reserves inputs and permanently marks the attempt inspection-only. Missing intent/signature/authorized journal cannot become a reconciled success. |
| Mainnet observations | Fixed-genesis finalized transactions: exact source proof/public-input/mint/ATA/minimum match; finalized ExecuteSwap public USDC delta with exact mint/owner/ATA and no competing instruction contaminating the delta; program-owned spent-input PDAs; canonical finalized tree and exact unspent private change note/index. Relay success strings never establish settlement. |
| Timeout / refund | Actual SDK private refund Phase 1 discriminator 13 / 41-byte commitment wire, authenticated balanced nontruncated events with a matching commitment; ordered source/close slots; exact private refund leaf membership, fee-bounded amount, actual SDK NK/nullifier-derived refund authority and unspent state. Both private change and principal refund are saved and reloaded. Outcome is REFUND_RECOVERED / PARTIALLY_COMPLETED, never swap completion. No automatic close or withdrawal transaction is added. |
| Reconciliation | Uses the unchanged strict swap reconciler over independent chain and reloaded vault observations. Unknown source/settlement, missing/spent/mismatched private change, recipient/output mismatch, divergent results and unavailable checkpoints remain recovery-required. |

The private v1 note/refund codec, encryption parameters, original LOCAL route-bound compiler/ledger, fallback guards, wallet guard, journal transitions and pure reconciler are preserved. Unlocked vault instances cache a bounded set of derived encryption keys to avoid repeatedly running the same PBKDF2 operation during journal replay; salts, IVs, AES-GCM AAD and the 310,000-iteration derivation remain unchanged.

The browser CSP now allows only same-origin plus the fixed Cloak relay, Solana mainnet RPC and Google ceremony host. SDK preparation is loaded by an explicit UI click; no provider traffic or wallet action occurs on mount. The isolated browser test verifies that boundary. There is no arbitrary RPC/relay/circuit configuration or server custody route.

## What remains incomplete / owner boundary

- Actual production relay authorization/transaction acceptance, source/settlement/refund financial observations and challenge evidence have not been exercised with owner-controlled funds/notes. Real ceremony proofs in validation use synthetic notes; test-only wallet signatures and mocked chain/financial transports are not mainnet evidence.
- Browser proof generation with real owner notes, funded success/timeout, actual multi-tab IndexedDB contention and disaster recovery still need acceptance evidence. The actual browser prover has passed with SDK-verified ceremony bytes and synthetic notes against intercepted chain reads; that does not prove real mainnet acceptance.
- Source and settlement RPC transaction simulation is absent and explicitly disclosed. Candidate frozen-v1 artifacts retain NOT_ENFORCED / NOT_IMPLEMENTED flags; capability/linter/financial gates were not relaxed to turn proof verification into financial permission.
- This swap slice consumes the existing encrypted Flofi SDK-note checkpoint/reference format. Initial shielding/deposit UI and a generic third-party wallet-backup importer were not added. A manual owner-close or refund-withdrawal action also requires its own reviewed financial path; only provider close/refund observation and private-note recovery are implemented here.
- The Elliptic advisory and exact dependency/SBOM/inventory/license admission remain unresolved. They did not stop implementation, and they cannot be waived for owner execution.

The next genuine financial experiment crosses the owner-controlled note/funding/signing boundary. No wallet private key or signing authority is available to the agent. **No owner financial action is requested now:** the existing release/acceptance gates still do not permit it. Preparing the genuine path, local safe validation and the review report require no owner funding, signature, secret or API key.

## Changed files for review

Application:

- `apps/reference-dapp/src/privacy/provider-contract.ts`, `provider-contract.test.ts`, `disclosure.ts`: actual supported property/request/auth contract and exact routing disclosure.
- `apps/reference-dapp/src/privacy/live-proof.ts`, `live-proof.test.ts`, `snarkjs.d.ts`: actual SDK preparation/fee/ceremony proof flow.
- `apps/reference-dapp/src/privacy/live-review.ts`, `live-execution.ts`, `live-execution.test.ts`, `live-journal.ts`: frozen artifact/Manifest chain, explicit authorization, one submission, encrypted journal and restart recovery.
- `apps/reference-dapp/src/privacy/live-observer.ts`, `live-observer.test.ts`, `live-mainnet-observation.test.ts`: finalized source/settlement/private change/refund observations and complete mocked transport tests.
- `apps/reference-dapp/src/privacy/browser-lifecycle.ts`, `vault.ts`, `apps/reference-dapp/src/components/cloak-live-panel.tsx`, `privacy-panel.tsx`: local note/proof preparation, durable vault, complete backup/restore and browser review/recovery controls.
- `apps/reference-dapp/e2e/privacy.spec.ts`, `next.config.ts`, `package.json`: isolated browser validation, three fixed provider origins and direct pinned proving dependency.

Shared, dependency and documents:

- `packages/reference-linter/src/cloak-financial-digest.ts`, `artifact-digest.ts`, `index.ts`, `packages/reference-linter/test/cloak-financial-digest.test.ts`: bounded browser ingress and frozen financial/payload/journal hash parity; no schema/domain change.
- `pnpm-lock.yaml`: direct `snarkjs@0.7.6` importer only; it already existed in the SDK graph.
- `docs/builds/BUILD-PRIVACY-001-{PLAN,REPORT,LIVE-BLOCKER,DEPENDENCIES,DEMO}.md` and `BUILD-PRIVACY-001-feasibility.json`: accepted contract, concrete current status, blockers and newly captured non-executed browser evidence.

No CI workflow, inventory/license policy, action-registry capability, public compiler, wallet-guard, SDK note adapter, pure reconciler or unrelated build implementation was changed.

## Validation on 2026-10-04

- Full local suite with actual offline ceremony bytes: **1,488 passed**, 2 existing skips, 169 passing files. Existing fork/PostgreSQL exclusions remain unchanged. The shared /tmp ENOSPC failure was resolved by using .turbo/privacy-validation-tmp inside this worktree, without changing tests or CI.
- Final targeted regression after tightening the SDK Phase 1 refund decoder: **148 passed** in 11 files, including actual Groth16 proofs, all prior private-state/local lifecycle checks and complete mocked finalized-observation/authorization/restart/refund tests.
- Production build and all package/app type checks: **16 tasks passed**.
- ESLint: passed. Frozen schema export check: **11 verified**.
- Isolated production-browser privacy checks: **3 passed**, including actual browser Groth16 proving/Manifest generation over synthetic notes with intercepted read-only chain responses, encrypted journal backup and vault reload/recovery, plus disclosure, redacted feasibility and disabled authorization. The original feasibility case has zero non-loopback requests; the proving case intercepts and fulfills the pinned read-only providers/circuits and aborts any financial or unexpected request.
- Governance safety check and **17 self-tests**: passed. Diff whitespace check: passed.
- Audit: **blocked, one low Elliptic advisory**, zero moderate/high/critical. No exception or suppression.
- Inventory/SBOM/license verifier: **blocked, 21 violations**, 411 identities versus 262 admitted, two unapproved direct pins and the same 14 unreviewed licenses. No SRI mismatch, registry-read or release-age error in this run. No approved SBOM evidence is claimed.

Dependency detail is recorded in [BUILD-PRIVACY-001-DEPENDENCIES.md](BUILD-PRIVACY-001-DEPENDENCIES.md). Direct snarkjs uses the exact existing 0.7.6 resolution and adds one direct-pin admission finding; its GPL-3.0 obligations are still unreviewed. The published Elliptic remedy remains unavailable; no local crypto replacement, staging SDK switch or gate change was applied. No GitHub-hosted Actions result was needed or claimed.

## Preserved LOCAL/MOCKED checkpoint (`11670bf`)

`compileCloakLocalReview` validates the existing canonical privacy-required workflow and produces schema-valid QuoteStateArtifact → ArtifactSet → SimulationBundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan using the frozen v1 hash domains. Given the same SDK-prepared note commitments and fixture route, its arithmetic and artifacts are deterministic. It binds gross shielded SOL spend, included fixture fee/cap, USDC expected/minimum output, public recipient, private change, input commitments, provider/program/genesis, nonce, expiry, owner and recovery policy. Fixture price/fees are explicitly local data, not discovered market values or deployed PoolConfig evidence.

The adapter now exposes a prepare-only note-material function so the actual SDK change commitment can enter Review before saving the final Manifest-linked prepared note checkpoint. The existing persisted preparation API and completed SDK codecs remain intact. No random change note is regenerated during execution/recovery.

The local authorization function validates and hashes the entire reviewed bundle, uses the existing latched mainnet owner-wallet guard, and issues an in-process receipt only for an explicit acknowledgment of that exact digest. Copying/forging a receipt, changing route/amount/recipient/policy/Manifest after review, or switching wallets fails closed. This acknowledgment is a **simulated authorization**, not a wallet signature or financial permission; both wallet signing methods are test spies that throw if invoked. The local Manifest cannot unlock the production financial gate.

The execution controller verifies the same review and actual vault notes, then atomically commits encrypted submission intent plus reservations for each input commitment and the owner/network/program authorization nonce. A collision denies execution before submission. Reservations are conservative and never automatically released. Before the intent commits, restart requires a new review. After intent commits, restart is inspection-only, even if the submitter response was lost, the record disappeared, the wallet changed or a result/evidence write failed. No unknown attempt is automatically submitted again.

After the closed in-process ledger runs, the vault preserves the exact raw SDK hand-off before decoding or checking it, the immutable actual result, submission observations and the reconciliation verdict. It can locate a committed encrypted result whose evidence pointer was lost. Recovery reloads actual SDK notes and requires the existing reconciler to establish finalized Tx1/Tx2, SWAPPED settlement, spent inputs, reviewed public recipient/mint/minimum, exact unspent change commitment/amount/index, durable outputs and retained refund authority. Unknown chain/ledger data, absent/corrupt checkpoints or mismatches never produce success. Every outcome is explicitly **LOCAL / MOCKED**.

The local ledger has no RPC, relay, wallet-signing or external submission hooks. Tests reload the controller/vault while the independent mocked ledger still has its observation; losing that ledger makes recovery inconclusive. This does not prove public-chain transport, real chain observation, browser proving, actual owner authorization or funded execution. The local harness remains unchanged; the current UI additions and financial gate are described above.
