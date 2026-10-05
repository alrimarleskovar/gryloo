# BUILD-PRIVACY-001 — demonstration and owner instructions

## Product recording: existing LOCAL/MOCKED lifecycle

**Run Privacy Demo** exposes the already-tested LOCAL compiler, authorization, encrypted vault, in-process ledger and reconciler, separately from the live vault. No recovery bundle, passphrase, owner notes, wallet, funding, ceremony download, relay or mainnet access is required. The banner remains visible throughout: **LOCAL DEMO / MOCKED EXECUTION — NO MAINNET TRANSACTION**.

Launch the current production build directly with the installed Node 24.21.0, without changing the pnpm version pin. Stop the previous process on port 3017 with Ctrl+C in its terminal, then run:

```sh
cd /home/asus/projects/gryloo/.turbo/privacy001/apps/reference-dapp
API_BASE_URL= API_AUTH_TOKEN= NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3017
```

Open **http://127.0.0.1:3017** in a fresh browser session:

1. Enter **swap 0.02 SOL to USDC privately** in Guided chat, click **Send**, then **Apply proposal**. This proves the existing canonical intent is **PRIVACY REQUIRED / CLOAK**, public USDC output with private SOL change.
2. Select **Simulate**, then **Run Privacy Demo**. The isolated surface has no production execution or wallet controls.
3. Click **Simulate local privacy swap**. The existing compiler calculates 0.02 SOL gross input from a synthetic 0.03 SOL note; **2.985 USDC** expected public output; **2.970075 USDC** minimum at 50 bps; **0.01 SOL** private change; included local fee 0.0001 SOL and ceiling 0.0002 SOL. These are deterministic fixture values, not live prices or fees.
4. Click **Review privacy and simulated amounts**, then **Show bound Manifest**. Inspect actual Manifest/review hashes and optional bound-artifact details. The same workflow, simulation, privacy, amounts, provider, recipient and recovery limits enter the frozen-v1 chain.
5. Check **I approve this LOCAL simulation, privacy policy and Manifest.**, then click **Authorize LOCAL demo**. This calls the existing digest-bound acknowledgment, without a wallet signature. Original freshness remains 60 seconds; if it expires, use **Simulate again for a fresh review** and repeat Review/Manifest/authorization.
6. Click **Execute in LOCAL DEMO**. The existing engine writes encrypted intent and atomic note/nonce reservations, submits once to its local ledger, persists encrypted result/evidence and invokes its reconciler. Ledger submissions: **1**; wallet signatures: **0**. No retry control is provided.
7. Click **Simulate restart & recover**. Authorization is discarded; a new vault/controller reads authenticated encrypted checkpoints against the retained independent mocked ledger. The existing reconciler returns **RECONCILED — LOCAL / MOCKED**. Submissions stay **1**, including repeated recovery.
8. Click **Export LOCAL demo evidence**. The JSON includes actual public review/Manifest, encrypted checkpoint hashes/status, mocked observations, verdict and submission/restart/signature counts. It excludes serialized private notes, keys, viewing material, salts, refund secrets and the fixture vault passphrase.

For recording, finish Review → Manifest → authorization → execution within the displayed 60-second window. Recovery works after expiry because it inspects the original attempt.

**Recovery scope:** simulated controller restart, not full server restart or durable financial custody. Encrypted checkpoints and the independent ledger remain in isolated server memory. Server restart loses the session; unknown runs fail closed and cannot reconstruct success or resubmit. The production IndexedDB vault and all financial/linter/capability/dependency gates are unchanged. Shared pure note/vault/guard helpers no longer declare React client entry points; live owner material stays in the browser. Demo Server Actions accept only workflow/run identifier/acknowledgment, never owner private notes or keys.

Safe regression (leaves the UI server running):

```sh
cd /home/asus/projects/gryloo/.turbo/privacy001
node node_modules/vitest/vitest.mjs run apps/reference-dapp/src/privacy/local-demo.test.ts apps/reference-dapp/src/privacy/local-execution.test.ts --maxWorkers=2 --testTimeout=30000
```

Browser validation uses another localhost port:

```sh
cd /home/asus/projects/gryloo/.turbo/privacy001/apps/reference-dapp
PLAYWRIGHT_BROWSERS_PATH=/home/asus/projects/gryloo/.turbo/privacy001/.turbo/privacy-demo-browser BUILD_PRIVACY_TEST_PORT=3018 node node_modules/@playwright/test/cli.js test --config playwright.privacy.config.ts
```

The test aborts non-loopback requests, registers a forbidden real wallet to catch connection/signing, verifies the complete sequence/redacted evidence and repeat recovery, then checks the still-disabled production authorization. Recording-reference screenshots are saved under `apps/reference-dapp/.turbo/privacy001-demo-{simulation,manifest,reconciled}.png`.

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

The 40 lifecycle cases use actual SDK note codecs, synthetic note authority, an encrypted local backend, a simulated wallet acknowledgment and a closed in-process ledger. They exercise tampering, replay, lost responses and failed checkpoints as well as successful reload/reconciliation. They perform no wallet signing or public-chain transaction. The same LOCAL ledger now serves the isolated product demo above; it has no financial transport. The genuine candidate browser path below remains behind the existing release gate. See the [report](BUILD-PRIVACY-001-REPORT.md) for remaining engineering gates and [dependency investigation](BUILD-PRIVACY-001-DEPENDENCIES.md) for audit/license blockers.

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
