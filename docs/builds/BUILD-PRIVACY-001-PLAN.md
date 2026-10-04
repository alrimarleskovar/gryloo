# BUILD-PRIVACY-001 — Cloak private execution for Flofi

## Objective and accepted demonstration

Add privacy to Flofi's existing canonical swap workflow, without a separate application or general privacy runtime. The original request was `Swap 5 USDC to SOL privately`. Discovery established that the published Cloak SDK does not support that direction or shielded swap proceeds. The owner subsequently selected the alternative demonstration: **SOL → public USDC, with private SOL change**. Never label the USDC proceeds private. Preserve a fail-closed response to the original request.

Initial base: `origin/main` at `ce78992bdb135c96caf55da90880c7aa0591958a`, fetched on 2026-10-04. The supplied workspace was already a clean, isolated worktree on `codex/build-privacy-001-cloak`. Main advanced twice during implementation; the final privacy branch is based on updated `origin/main` at `ebbd4aa3766a656f01b24a61ea71e13c4963b1f8`. Only the privacy commits were rebased onto main and their conflicts resolved. No protected branch/worktree was modified or used directly as a merge/rebase/cherry-pick source.

## Discovery and protocol requirements

Primary sources inspected on 2026-10-04:

- [Published SDK](https://www.npmjs.com/package/@cloak.dev/sdk), exact version **0.2.5**. Downloaded its npm tarball and verified the registry SHA-512 integrity before inspecting declarations and runtime.
- [Official API reference](https://docs.cloak.ag/sdk/api-reference), [transaction lifecycle](https://docs.cloak.ag/platform/transaction-flows), [wallet integration](https://docs.cloak.ag/sdk/wallet-integration), [SDK index](https://docs.cloak.ag/llms.txt).
- Package declarations are authoritative where the website still shows older web3.js APIs. SDK 0.2.5 uses `@solana/kit` addresses and `CloakRpc`, not a web3.js Connection. `transact` accepts a Kit `signer`; relay swaps accept `signMessage` and `walletPublicKey`.

Exact network: Solana mainnet-beta, genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. Program `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`. SOL pool mint `So11111111111111111111111111111111111111112`; USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Standard submission uses `CLOAK_PRODUCTION_RELAY_URL`, `https://api.cloak.ag`. Ceremony circuits are version **0.2.0**, verified by the SDK; do not override the bundle or use the older devnet SDK. This integration has a **mainnet-only constraint**; local fixtures do not establish devnet or mainnet execution evidence.

Swap Tx1 consumes shielded SOL and opens SwapState; a separate settlement performs Jupiter execution and credits a public recipient ATA. Tx1 confirmation is insufficient. The SDK returns change UTXOs and separate refund authorization. SDK 0.2.5 additionally exposes `createRecoverableChangeUtxo` and `deriveSwapRefundAuthorization`: inspect and use actual exports, never reconstruct missing randomness. `serializeUtxo` is a 128-byte spending-secret encoding; preserve explicit index metadata because encoded index zero is ambiguous on restoration. Do not substitute the unrelated `CloakNote` StorageAdapter shape.

## Reused Flofi components and boundary

- `workflow-contracts/src/swap.ts`: canonical `asset.swap.exact-input`, typed amount and output ports, Mode A, abort policy.
- Existing Guided command parser, editor reducer, revision invalidation, Canvas, proposal review and artifact inspector.
- Frozen v1 artifact hashes and schemas, ArtifactSet → SimulationBundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan.
- Existing capability resolution, owner wallet sessions, journal creation/state transitions, evidence classes and reconciliation principles.
- The current-main cloud runtime remains the public attempt/journal/evidence boundary; private spending authority must stay in the browser. No private provider route, extra runtime or cloud deployment is introduced here.
- Existing public Solana/Jupiter compilation remains unavailable to any privacy-required workflow; no public fallback.

The Cloak adapter belongs at the existing execution boundary. Proofs and spending secrets must stay in the browser. A browser component is technically required: Flofi's existing server executor cannot receive private notes. The current frontend CSP permits only same-origin connections. Do not casually broaden it to enable SDK traffic.

## IR and Manifest policy

Use existing hash-covered `requiredCapabilities` and adapter constraints to express the additive policy. A small typed projection exposes `privacy: { mode: 'required', provider: 'cloak', output: 'public-with-private-change' }`. Pin adapter version and protocol. No frozen v1 schema change is needed. A future provider can implement the same capability policy with its own adapter.

The Manifest fixes the provider to Cloak and binds the canonical workflow hash; its review displays the typed privacy projection. Missing requirements, a different provider, or a public Manifest must fail. Do not issue an executable Manifest when genuine required simulation/artifacts are absent. A blocked feasibility review is not an authorized Strategy Manifest.

## Wallet boundary

Use the explicitly selected owner's Solana wallet, on mainnet, with transaction signing for deposits and message signing for relay authentication/viewing-key registration. Require the account to remain identical at preparation, signing and result handling. Reject changes away and back during an in-flight operation. Never generate an owner keypair, sign or broadcast on behalf of the owner, request wallet seeds, or send private state to server actions. Explicit Review must bind owner, network, amount, minimum output, maximum fees, public USDC recipient, private change and recovery policy.

## Private-state persistence and recovery

An encrypted browser vault, separate from public artifacts, must retain every actual note and refund record, linked to owner, genesis, provider/program, run ID and Manifest hash. Use authenticated encryption, an owner-held unlock secret, durable atomic writes and read-back verification. Persist prepared outputs and recovery material **before** any financial side effect; persist actual SDK results before reporting completion. Keep both prepared and resulting state if submission or storage fails. Missing state is recovery-required, never an empty successful balance. No random regeneration, zero filling, note deletion or automatic retry of an ambiguous attempt.

Recovery reloads the exact encrypted record, verifies its run linkage, restores actual notes through SDK decoding (including explicit index zero), and checks spent/unspent commitments and settlement on chain. Preserve change, principal refunds and intermediate outputs; never invoke hidden many-note consolidation. A backup is sensitive spending authority and must be encrypted. Public challenge evidence must exclude serialized notes, keys, viewing keys, salts and refund secrets.

## Reconciliation definition

Require all applicable public confirmations, finalized settlement evidence for the reviewed public USDC recipient/mint/minimum, verified input spend, exact expected private change commitments/amounts/indexes, readable durable output state, and linkage to the same run/Manifest. Any unknown, skipped note, missing data, divergent value, wallet change or unsettled refund is not success. Test fixture verdicts remain MOCKED. Public confirmation by itself cannot upgrade evidence maturity.

## Security risks and implementation gates

Browser data loss, XSS, passphrase loss, leaked backups, quota failures, multi-tab races, SDK hidden note creation, two-stage swap ambiguity, stale quotes, fee changes and wallet switching are material risks. Persist-before-submit and immutable checkpoints are required. Fail closed on any gate that cannot be satisfied.

Dependency discovery during final checks: the SDK introduces legacy EVM/proving dependencies even though this demonstration is Solana-only. Preserve the audit threshold and exact integrity/license/SBOM controls. Two available scoped patches remove the Underscore/WebSocket advisories; Elliptic 6.6.1 still fails the low-severity audit and the indicated 6.6.2 patch is not published in npm. Added license/inventory review remains required. Keep these as explicit blockers rather than approving exceptions to obtain a green demo.

SDK free functions perform proving and submission together. Existing Flofi exact unsigned-message simulation cannot simply simulate the Cloak result; public Jupiter balance-delta reconciliation cannot prove private change. Build the narrow adapter/state boundary and fail-closed tests first. Keep financial execution disabled if the existing exact simulation, prepared-output persistence, browser network configuration or authoritative settlement verification cannot be safely satisfied. Record engineering blockers distinctly from owner-only signatures/funding. Do not pretend a policy feasibility check is a financial simulation.

## Challenge acceptance criteria and demonstration path

1. Guided Chat and Canvas author the same canonical SOL → USDC swap with required Cloak policy.
2. Proposal, workflow and review clearly disclose public USDC output and private SOL change.
3. Simulate performs capability/feasibility checks and blocks missing financial simulation; never invent prices, output notes or transaction evidence.
4. Executable Review/Manifest, owner authorization, funded Cloak execution, persistence, reload, reconciliation and genuine challenge evidence are acceptance gates. Until all exist, the PR stays draft and the report states which gates are incomplete.
5. Security tests prove required privacy cannot fall back to Jupiter, public confirmation alone cannot establish success, corruption/missing state/wallet changes fail closed, and actual state survives a vault reload without alteration.

Exact proposed funded path after gates are satisfied: owner shields 0.03 SOL, swaps gross 0.02 SOL via Cloak to their public USDC ATA, retains 0.01 SOL change privately, reloads, reconciles and exports redacted evidence. Live fees/minimums must come from deployed PoolConfig, not example arithmetic. Do not execute this path during development.

## Out of scope

Zcash; private USDC → SOL or shielded swap proceeds not supported by this SDK; private lending, LP or bridges; Mode C/automation; multichain privacy; B2B APIs; mainnet production rollout; public fallback; a separate privacy app; modifying, merging, rebasing or cherry-picking any BUILD-013, BUILD-016, BUILD-TEMPO-001 or CLOUD-001 branch/worktree; any merge.

## Deliverables

Implementation and meaningful security tests; BUILD-PRIVACY-001-REPORT.md; exact demo/owner instructions; truthful submission privacy explanation; draft PR with no manufactured financial acceptance evidence.
