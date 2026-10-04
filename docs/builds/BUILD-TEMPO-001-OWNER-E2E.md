# BUILD-TEMPO-001 — owner acceptance

This build stopped before wallet signing, faucet requests or transaction submission.
Public execution is **not proven**. The steps below describe future owner acceptance;
the agent must not perform the signing or funding steps.

## Prerequisites and deployment

Use branch `codex/build-tempo-001`, stacked on cloud commit
`8d43ea675b5c1284c5e44c2599025776af3bcc00`. Follow the existing
[cloud deployment runbook](../deploy/CLOUD.md) for PostgreSQL, API, worker, BFF
and evidence storage. Tempo adds no migration, custody service or separate deployment.

1. Install the pinned Node 24.21.0 / pnpm 11.22.0 toolchain. Run
   `pnpm install --frozen-lockfile --ignore-scripts`, then `pnpm build`.
2. Configure API and worker with the same `DATABASE_URL`, `TENANT_ID` and
   evidence store. Set `NODE_ENV=production` and **`GRYLOO_TEMPO_TESTNET=live`**
   on both. Use the existing server-only `API_AUTH_TOKEN` (at least 32 characters).
   Leave `GRYLOO_TEMPO_HARNESS` unset. There is no Tempo mainnet execution gate.
3. Run `node apps/reference-dapp/backend/main.ts migrate` using the migration
   database connection. Start the API with
   `node apps/reference-dapp/backend/main.ts api` and the worker with
   `node apps/reference-dapp/backend/main.ts worker`. Configure durable S3-compatible
   `OBJECT_STORE_*` variables as in the runbook. `EVIDENCE_DIRECTORY` is for local tests.
4. Configure the frontend's server-only `API_BASE_URL` and matching
   `API_AUTH_TOKEN`; build/start or deploy the existing Next.js application.
   Verify API `/healthz` and `/readyz`. Without the BFF configuration Tempo
   returns `CLOUD_API_NOT_CONFIGURED`; without the backend gate it returns
   `TEMPO_PUBLIC_TESTNET_NOT_ENABLED`.

Wallet compatibility is a required acceptance item, not an assertion about any wallet brand.
Use an injected EIP-1193 EOA wallet whose current documentation explicitly supports
Tempo type **0x76** with `eth_signTransaction` returning raw signed bytes, followed by
`eth_sendRawTransaction`. The wallet must preserve `calls`, `feeToken`, `nonceKey=0`,
gas/fee ceilings and `validBefore`. The implementation checks the recovered owner and
every unsigned byte before broadcast. Adding Moderato to an ordinary EVM wallet does
not prove support for this signing contract. No concrete production wallet has been
owner-validated by this build. An unsupported-method refusal or envelope error is a
blocked acceptance result; do not substitute `eth_sendTransaction` or a type-2 envelope.

Use one injected provider during acceptance. Multiple-provider discovery retains Flofi's
existing selection behavior. Smart accounts, delegated keys, passkeys, sponsorship and
fee-token switching are outside this profile.

## Read-only and Review steps — no signing

1. The owner selects their own Moderato EOA and a **different** ordinary recipient
   address they control. Never use the public synthetic discovery address as an owner.
   Network: chain ID **42431** / **0xa5bf**, RPC
   `https://rpc.moderato.tempo.xyz`, explorer `https://explore.testnet.tempo.xyz`.
2. The owner obtains test pathUSD from the
   [official faucet](https://tempo.xyz/developers/docs/quickstart/faucet) if needed.
   This is a separate owner action and has not been performed by the build.
   Token/fee token: `0x20c0000000000000000000000000000000000000`, six decimals.
   Hold at least **1.01 test pathUSD** for the example. The displayed native USD/ETH
   balance is a wallet compatibility placeholder and cannot establish funding.
3. Open Flofi → **Build** → **Advanced action setup** → **Tempo payment**.
   Enter amount **1**, the explicit recipient, memo
   `0x0101010101010101010101010101010101010101010101010101010101010101`,
   maximum fee **0.01**. Click **Review payment proposal**, inspect it, and
   **Apply proposal**. The canonical node is `asset.transfer` / `tempo.tip20`;
   the same workflow revision and Canvas contain it.
4. Equivalent Guided input, replacing the recipient with the owner's chosen address:

   ```text
   pay 1 pathUSD to 0x2222222222222222222222222222222222222222 on Tempo Moderato memo 0x0101010101010101010101010101010101010101010101010101010101010101 fee 0.01
   ```

   The example recipient is a syntax illustration, not the recommended owner recipient.
5. Open **Simulate**. Click **Connect owner wallet**, then **Switch to Tempo Moderato**.
   These may require connection/network permissions, never a transaction signature.
   Click **Simulate payment**. Real read-only discovery checks chain/head, token currency,
   decimals, pause/policy, account/recipient, balances, protocol/pending nonce, fees,
   gas estimate and validated `eth_simulateV1`. No state overrides or fake funding.
6. Save the displayed run ID. Inspect owner, recipient, amount **1000000** micro-pathUSD,
   token/fee token, memo, fee budget **10000** micro-pathUSD, gas/rate ceilings,
   commitment and expiry in the same execution panel. Under technical details inspect
   the standard ArtifactSet, SimulationBundle, AuthorizationPolicy, StrategyManifest
   and ExecutionPlan. Evidence must still say **PUBLIC_READ_ONLY**.
7. Open **Execute** → **Accept payment Review**. Fresh state and preflight are required
   again. **Stop here for read-only acceptance.** The build agent stops here too.

Review expires in 120 seconds from simulation. Any edit, owner/chain change or failed
freshness check invalidates authority. Repeat simulation and Review; old artifact IDs or
commitments do not authorize a changed payment.

## Future owner-only signing and reconciliation

1. Only when the owner elects to execute, click **Authorize payment in owner wallet**.
   Check one call to pathUSD `transferWithMemo(address,uint256,bytes32)`, zero native
   value, the exact recipient/amount/memo, chain 42431, explicit pathUSD fees,
   nonce key zero, gas/rate ceilings and on-chain expiry. Reject any change.
2. The API durably records PREPARED before releasing the request. The browser asks
   the wallet to sign, verifies the raw native envelope and recovered owner, then
   durably records its hash before asking that wallet to broadcast **once**.
   Raw signed bytes never enter the API. The agent must not approve this prompt.
3. After the wallet broadcasts, save the hash and close the browser tab. Restart the
   API and worker to exercise durable recovery. Reopen Flofi in another browser/device,
   author a Tempo payment to reach its panel, enter the saved run ID into
   **Resume durable run ID**, then **Load cloud run**. Observation does not require a
   wallet or a matching newly authored workflow. Click **Observe existing payment**.
4. Require **RECONCILED · CONFIRMED** and **PUBLIC_TESTNET_EXECUTED**. Download the
   Evidence Bundle; check `bundle.environment=TESTNET_EXECUTED`, outcome RECONCILED,
   chain/token/recipient/memo/amount, raw public transaction, owner signature, exact
   fee token/payer, fee event, finalized inclusion, sender debit and recipient credit.
   The generic evidence archive must also expose the hash-verified export through
   the existing authenticated run API. Inspect the hash in the official testnet explorer.
5. Repeat observation/reload. It must return the same attempt, journal and evidence
   without a second wallet request. Workers cannot call any send/sign/fund RPC.
   MOCKED test evidence never satisfies this public acceptance step.

If a wallet refuses, the response is lost, or no hash arrives, preserve the run ID.
Observe the existing attempt; do not retry the spend. For a never-broadcast PREPARED
request or an uncertain SUBMITTING/PENDING request, **Prepare fresh Review after
on-chain expiry** works only after a finalized block reaches the signed `validBefore`
and finalized/latest/pending nonce checks prove the old nonce is unused. It creates
a new run from the current authored workflow, with new preflight and **no authorization**.
Accept a fresh Review and sign again only if the owner chooses. No pre-expiry release,
fee-bump, worker submission or automatic retry exists. If the nonce was consumed,
reconciliation/owner investigation is required instead.

A held/redirected transfer, unexpected log, fee mismatch or unrelated same-block
balance change fails closed and produces no reconciled evidence. RPC outages or missing
raw transaction/receipt data remain inconclusive. Do not describe either as public success.
