# BUILD-PRIVACY-001 — demonstration and owner instructions

## Available demonstration: authoring and fail-closed feasibility

This draft demonstrates privacy as a policy on Flofi's existing swap IR. **It does not execute a financial swap.** No owner wallet, funding, deposit, message signature or transaction signature is needed for this demonstration.

Use Node 24.21.0 and pnpm 11.22.0 in the isolated `codex/build-privacy-001-cloak` worktree:

```sh
pnpm install --frozen-lockfile
API_BASE_URL= API_AUTH_TOKEN= pnpm exec turbo run build --cache-dir .turbo/privacy001-cache
API_BASE_URL= API_AUTH_TOKEN= pnpm --filter @defi-workflow-engine/reference-dapp start --port 3017
```

1. Open `http://127.0.0.1:3017` in a fresh browser session.
2. Enter **`swap 0.02 SOL to USDC privately`** in the existing Guided assistant.
3. Review the proposal. It names Cloak, **Privacy REQUIRED**, public USDC proceeds and private SOL change. Apply the proposal.
4. Inspect the existing Canvas and canonical artifact inspector: one `asset.swap.exact-input` node contains the required privacy capabilities and the pinned `cloak.solana` adapter.
5. Select **Simulate → Check privacy feasibility**. The result explicitly says **financial simulation not performed / acceptance blocked**.
6. Export the non-executed feasibility report. Its workflow hash binds the policy; `execution: NOT_EXECUTED` and `acceptance: BLOCKED` prevent confusion with financial acceptance evidence. It contains no private notes or keys.
7. Select **Execute**. Owner authorization is disabled and the missing execution gates are visible. No executable Manifest is issued.
8. In a fresh session, enter **`Swap 5 USDC to SOL privately`**. Flofi rejects the unsupported direction rather than converting it into a public swap.

Canvas alternative: use the existing Solana mainnet swap form, select **Privacy → Required / Cloak**, enter 0.02 SOL → USDC and review the proposal. Guided and Canvas produce the same canonical node and hash-covered policy. Changing an existing private node into a public node is refused; remove it and author a separate public workflow if that is the intended edit.

The automated browser demonstration is isolated from other builds and uses neither Anvil nor a wallet:

```sh
pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test --config playwright.privacy.config.ts
```

Install Playwright's matching Chromium and OS libraries using your usual development setup if they are absent. The first test aborts any request to a non-loopback host and verifies none occurred. With SDK-verified offline circuits, a third test runs real browser proving/Manifest generation, encrypted backup and reload using synthetic notes and intercepted read-only provider responses; it aborts financial requests and never signs.

## Available local engineering lifecycle

The continuation adds a safe LOCAL/MOCKED simulation → reviewed acknowledgment → execution → encrypted restart/reconciliation harness. Run it in this worktree with the approved toolchain:

```sh
pnpm --filter @defi-workflow-engine/reference-compiler build
pnpm exec vitest run apps/reference-dapp/src/privacy/local-execution.test.ts --maxWorkers=2 --testTimeout=30000
```

The 40 lifecycle cases use actual SDK note codecs, synthetic note authority, an encrypted local backend, a simulated wallet acknowledgment and a closed in-process ledger. They exercise tampering, replay, lost responses and failed checkpoints as well as successful reload/reconciliation. They perform no wallet signing or public-chain transaction. The LOCAL ledger remains restricted to tests; the genuine candidate browser path described below stays behind the existing release gate. See the [report](BUILD-PRIVACY-001-REPORT.md) for the remaining engineering gates and [dependency investigation](BUILD-PRIVACY-001-DEPENDENCIES.md) for the audit/license blockers.

## Genuine SDK path available behind the existing release gate

On the same Cloak workflow, **Open encrypted vault and live preparation** loads the SDK path only after an explicit click. Loading it requests neither a signature nor external traffic. Durable local vault unlock, compatible encrypted note/reference import, actual finalized-state/proof preparation, public property Review/Manifest export, complete encrypted backup and inspection/reconciliation controls are wired. A public recovery reference lets the same browser reload an existing encrypted run after restart; a backup restored into a new vault is permanently inspection-only and reserves the inputs.

The Review binds Cloak, exact shielded SOL gross input, USDC mint, exact owner recipient ATA, exact minimum, actual protocol fee ceiling, positive private SOL change, program/mainnet guards and freshness. It explicitly states:

- Routing provider: Jupiter via Cloak
- Exact DEX route: provider-managed and not authorization-bound

Its simulation scope is real local Groth16 verification plus finalized mainnet input/root/fee checks. It does not claim a source/settlement RPC transaction simulation, an exact route approval or cancellation at review expiry. Candidate v1 artifacts retain their original `NOT_ENFORCED` flags and cannot unlock the financial release gate.

Separate viewing-key registration is an explicit owner action when gates permit it: Cloak receives viewing authority for recovery; owner wallet private keys and note spending keys never leave the wallet/browser vault. The swap requires a separate acknowledgment and exact wallet request signature. An encrypted intent/input/nonce reservation precedes signing, signed bytes and journal precede the sole POST, and raw response/uncertainty precedes reconciliation. Failed or unknown submission never automatically retries. After an outcome, the UI supports exporting an updated encrypted backup.

Run the actual ceremony proving/lifecycle fixtures with an SDK-verified offline circuits directory:

```sh
CLOAK_VERIFIED_CIRCUITS_DIRECTORY=/path/to/sdk-verified-circuits pnpm exec vitest run apps/reference-dapp/src/privacy --maxWorkers=2 --testTimeout=30000
```

The optional actual-proving cases are explicitly skipped without those local ceremony bytes. Their witnesses, wallet signatures and chain/financial transport are synthetic or mocked; they are not mainnet execution evidence. Pure policy, encoder, fee, parsing, observation and custody checks run without owner data.

## Accurate privacy explanation

Flofi makes privacy a required property of its existing canonical swap. This scoped Cloak path spends shielded SOL, pays public USDC to the reviewed ATA and retains residual SOL privately. Deposits, transaction timing and the public recipient remain observable. Jupiter routing is managed by Cloak and is not authorized as an exact DEX route. Fail-closed authorization uses the proof/request properties the actual protocol supports. Success additionally requires finalized source and settlement observations, spent inputs and exact private change that survives encrypted reload. A timeout refund is another private SOL note, independently reconstructed and checked; it is not swap completion or an automatic withdrawal. The draft has no owner-funded acceptance evidence.

## Owner boundary and present status

No owner funding, signature, secret, API-key, billing or financial action is requested now. Existing financial/linter/capability gates remain disabled, and dependency audit/inventory/license acceptance is unresolved. **READY_FOR_OWNER_EXECUTION is false.** No merge or PR readiness change is authorized.

A future genuine mainnet experiment, after those gates permit it, intrinsically needs owner-controlled existing shielded input notes, durable encrypted custody/backup and explicit wallet signatures. This implementation accepts the existing Flofi encrypted note checkpoint/reference shape; it does not add an initial deposit/shielding UI or generic third-party wallet-backup importer. Owner notes are entered only through the local browser recovery boundary, never chat, server actions or agent custody. Browser proving with real notes, signed production relay acceptance, funded success/timeout and multi-tab recovery remain unperformed acceptance checks. These limitations are recorded in the [report](BUILD-PRIVACY-001-REPORT.md), independently of the [dependency blockers](BUILD-PRIVACY-001-DEPENDENCIES.md).
