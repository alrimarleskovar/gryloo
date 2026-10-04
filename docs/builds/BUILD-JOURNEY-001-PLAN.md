# BUILD-JOURNEY-001 — Plan: Permissionless External User Journey

Date: 2026-10-04. Branch `claude/build-journey-001`, from `origin/main` `bc4fc57` (PR #57 BUILD-ROUTER-001 merged,
PR #56 CI runner merged). No Privacy, Tempo, Mode C, Guided Chat or Copilot work is touched.

## 1. Objective

Make the existing Flofi runtime usable end to end by an arbitrary external user with their own injected wallet,
on a public testnet, from the deployed application:

```
Connect wallet → Create workflow → Simulate → Review → Accept Manifest → Sign → Execute
  → Refresh / reopen / backend or worker restart → Recover / Reconcile → Authoritative completion → Evidence
```

The journey is a product-facing shell over the canonical runtime. It adds **no** runtime, executor, wallet model,
authorization model, recovery engine or evidence format.

## 2. Inspection: what already exists (reused unchanged in substance)

| Area | Existing (origin/main `bc4fc57`) |
| --- | --- |
| Canonical IR | `asset.bridge` node with adapter `flofi.router` (BUILD-ROUTER-001): pair, amount, recipient (`CONNECTED_OWNER` or explicit), slippage, provider preference. Closed declaration validated by `readRouterBridgeNode`; pairs listed in `ROUTER_PAIRS`. |
| Quote / artifacts | LI.FI and Across normalizers decode the provider calldata independently and build the canonical route; `compileRouterArtifacts` builds Quote/State → Artifact Set → Simulation Bundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan, chain-agnostic (uses `route.sourceChain`). |
| Simulation | Real `eth_simulateV1` of the exact source-chain transactions, decoding the simulated `FundsDeposited` and owner debit. |
| Review / Manifest | Review object with SHA-256 commitment over route, route commitment, Manifest hash, simulation, observation, calls, fees, deadlines. `review(id, commitment, workflow)` sets `AUTHORIZED`. |
| Authorization binding | `begin` re-reads both chains, re-quotes the **same** provider and compares (`ROUTE_CHANGED`, no fallback), re-simulates, checks code pins, nonce, balances, deadlines; any material change clears the authorization (`deauthorized`) and requires a fresh quote + Review. Workflow edits retire the Review (`invalidate`). |
| Wallet | `Build009WalletProvider`: EIP-6963 discovery of an arbitrary injected wallet, `accountsChanged` / `chainChanged` / `disconnect` listeners, user-driven `wallet_switchEthereumChain` (Base Sepolia registered). Router `execute` checks `eth_accounts`, `eth_chainId` and the pending nonce before and after the durable preparation, then makes the single `eth_sendTransaction`. No key, no signing by Flofi. |
| Execution journal | Append-only snapshot log validated on every extension (`validateRouterLog`); attempt persisted `PREPARED` before the wallet is called, `SUBMITTING` durable at handoff; owner+nonce and per-owner in-flight-deposit economic guards; a hash is recorded once. |
| Recovery | Ambiguous results become `SUBMISSION_RESULT_UNKNOWN`; observation discovers by hash, by the Across `FundsDeposited` log of the reviewed deposit, or by nonce binary search; never resends. Workers never touch `PREPARED`. |
| Reconciliation | Source finality at `safe` head + canonical hash, destination fill proven from the Across `FilledRelay` + USDC transfer on the destination chain (provider status is a hint only), refunds verified on chain, divergence states. |
| Evidence | Frozen v1 Evidence Bundle built only at `RECONCILED`; the worker archives it to the content-addressed EvidenceStore; `GET /v1/runs/:id/evidence` re-verifies it. |
| Cloud | Stateless API (`backend/app.ts`) + workers on PostgreSQL (fenced leases, outbox, idempotency keys), BFF forwarding (`callCloudFlow`) when `API_BASE_URL` is set. Vercel (frontend/BFF) + Railway (API, worker) deployed from `main`. |
| Test infrastructure | MOCKED in-process Base/Arbitrum router harness reused by unit, PostgreSQL and loopback browser suites; scripted EIP-1193 wallet fixture; `pg-harness` disposable databases. |

## 3. Inspection: assumptions that block a permissionless external user

| # | Assumption found | Where |
| --- | --- | --- |
| A1 | The only Router pair is Base **mainnet** → Arbitrum One (real funds). Owner execution needs the deployment opt-in `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`, i.e. an operator decision per deployment. There is no testnet Router. | `action-registry/crosschain-router.ts`, `router-runtime.ts`, `flows.ts` |
| A2 | **No caller authentication.** The run owner is a *claimed* address string. Any caller who knows a run id can `review` (authorize), `invalidate`, `begin` (claiming the owner), `handoff`, `report`, `walletFailure`, `observe` or read `status` of another wallet's run through the public server actions. Nothing binds a browser to a wallet. | `router-action.ts`, `backend/flows.ts`, `backend/app.ts` |
| A3 | Run reads `GET /v1/runs`, `/v1/runs/:id`, `/journal`, `/evidence` return every tenant run to any bearer-token holder; there is no per-wallet view. | `backend/app.ts`, `cloud-runtime/queries.ts` |
| A4 | Recovery after reopening depends on a per-browser `localStorage` pointer; another browser (or cleared storage) cannot find the wallet's runs. | `router-store.tsx` |
| A5 | A wallet account switch after Review leaves the server-side authorization in place until Execute (it is only refused at the pre-submission check). | `router-store.tsx` |
| A6 | Router UI copy, explorers and chain switch are hard-wired to Base mainnet / Arbitrum One. | `router-panel.tsx`, `router-authoring.ts` |
| A7 | Router harness, mock code pins and loopback URLs are keyed to the mainnet profile only. | `e2e/router-harness.ts`, `router-mock.ts` |
| A8 | Deployment: Vercel production and previews are behind Vercel Authentication (SSO, HTTP 302 to `vercel.com/sso-api` verified 2026-10-04); Railway deploys `main` only; no testnet Router is enabled. | GitHub deployments API, `docs/deploy/CLOUD.md` |

No hard-coded owner address exists in the Router runtime, wallet store or BFF (searched: only Anvil dev accounts in the
local-fork Mode A service and placeholder recipients in mocked templates).

## 4. Provider verification: Base Sepolia → Arbitrum Sepolia (read-only, 2026-10-04)

The preferred slice was verified, not assumed:

* **Across testnet API** `https://testnet.across.to/api`: `available-routes` lists Base Sepolia USDC
  `0x036c…cf7e` → Arbitrum Sepolia USDC `0x75fa…aa4d`; `suggested-fees` returns limits min 0.126646 / max 8.000352 USDC,
  estimated fill 10 s; `swap/approval` returns a `bridgeableToBridgeable` exact-input route to the origin SpokePool
  `0x82b5…0f8f` with selector `0xad5425c6` and an exact approval. The Router's `decodeAcrossDeposit` decodes it
  byte-exactly (with the Across `0x73c0de` trailer).
* **LI.FI** `https://li.quest/v1/quote` (chains list includes 84532 and 421614) returns `tool: across` (AcrossV4) with
  `protocol/feeCollection` + `cross/across` steps through its testnet Diamond `0x816f…1770` and fee forwarder
  `0xc7e0…abeb`; `decodeLifiAcrossV4` / `decodeLifiFeeForward` decode it byte-exactly (integrator `flofi`).
* **On-chain**: Base Sepolia SpokePool `chainId()` = 84532, deposits not paused, `depositQuoteTimeBuffer` 3600 s,
  `fillDeadlineBuffer` 21600 s; Arbitrum Sepolia SpokePool `0x7e63…ee75` `chainId()` = 421614, fills not paused. Both
  SpokePool proxies have the **same runtime code hash as mainnet** (`3cc5e539…0545`, the canonical Across proxy).
  USDC on both chains: 6 decimals, symbol USDC.
* **Relayer liveness**: Arbitrum Sepolia `FilledRelay` logs from origin 84532 exist; the latest USDC fill
  (`0x7fba4c5d…7cb9`, 0.6 USDC in → 0.567769 out) was at 2026-10-04 14:12 UTC by relayer `0x9a8f…b04d`.
* **RPC**: public `https://sepolia.base.org` supports `eth_simulateV1`; both chains answer the `safe` block tag; the
  Base Sepolia GasPriceOracle answers the L1 fee upper bound.

**Conclusion:** the route is genuinely supported by the existing provider path (both LI.FI-first and Across-direct)
with the unchanged security model: calldata decoded independently, exact approvals, `eth_simulateV1`, code pins,
`FilledRelay` proof at both safe heads. No mock is substituted and settlement verification is not weakened.
Limitations: testnet relayer liquidity is small (max ≈ 8 USDC per deposit), fills are not SLA-backed (an unfilled
deposit is refunded after its fill deadline, which the Router already reconciles as `REFUNDED`).

Selected slice: **Base Sepolia USDC → Flofi Cross-chain Router → Arbitrum Sepolia USDC**, 0.5–5 USDC per bridge.

## 5. What must be exposed / reused

* The Router service, codecs, artifact compiler, linter, journal/recovery/reconciliation and Evidence Bundle — the
  testnet run is the same service bound to a second, explicit **router profile**.
* The cloud flow registry, API, worker, outbox, EvidenceStore, idempotency and BFF forwarding — one more flow entry.
* `Build009WalletProvider` for connection, account/chain events and network switching.
* The Router store/panel for Simulate / Review / Accept / Execute / Observe / Evidence.
* The router harness for unit, PostgreSQL and browser tests (parameterized, not duplicated).

## 6. What must change

1. **Testnet router profile (A1, A6, A7).** `CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA` in the action registry
   (addresses, testnet provider API bases, code pins read on 2026-10-04, `PUBLIC_TESTNET` environment), a widened
   `RouterProfile` type, the testnet pair in `ROUTER_PAIRS`, a `PUBLIC_TESTNET` capability row with no evidence
   ceiling. Router providers, service, runtime, mock pins and harness take the profile as a parameter (mainnet stays the
   default, its bytes and behavior unchanged). Testnet runs record provenance `PUBLIC_TESTNET` and evidence
   `TESTNET_EXECUTED`; `validateRouterLog` binds each log to its profile's chains and provenance.
2. **Separate cloud flow** `crosschain-router-testnet` (own PostgreSQL namespace, so testnet and mainnet nonce/deposit
   guards never collide). Gate `GRYLOO_ROUTER_TESTNET=live` (test tokens; owner execution allowed like the other
   testnet flows; `GRYLOO_ROUTER_TESTNET_EXECUTION=DISABLED` keeps it Simulate/Review-only); harness
   `GRYLOO_ROUTER_TESTNET_HARNESS=MOCKED_LOOPBACK_ONLY` for tests only.
3. **Wallet session = ownership authentication (A2).** One EIP-4361 sign-in message signed with `personal_sign` by the
   connected wallet; the BFF verifies the signature (secp256k1 recovery, EIP-191) against a server nonce bound to an
   HttpOnly, SameSite=Strict challenge cookie and issues an HMAC-signed, expiring, HttpOnly session cookie whose subject
   is the wallet address. The key is `FLOFI_SESSION_SECRET` or derived (HKDF) from the existing server-only
   `API_AUTH_TOKEN`, so the deployment needs no new secret. The session **authorizes no transaction and moves no
   funds**: it only says which runs this browser may operate. Financial authority stays exactly the Review commitment +
   Manifest + the wallet's own transaction signature.
4. **Run ownership enforcement (A2, A3)** in one shared guard used by the API (`callFlow`) and by local server actions:
   for the Router flows every method except `info`/`mode` needs a session principal; owner arguments (`simulate`,
   `begin`) must equal the principal; every run-id method loads the durable run and requires `owner == principal`
   (owner is immutable in the validated log, so the check cannot race). The BFF forwards the verified principal in a
   server-only header; the browser can never set it. Run reads (`/v1/runs*`) are filtered to the principal when present;
   the idempotency hash includes the principal.
5. **Per-wallet recovery (A4).** `listRuns` gains `flow` / `owner` filters (plus an index migration); the Router panel
   lists the signed-in wallet's runs from the server (cloud) or the journal directory (local), so reopening in any
   browser recovers the run. The local pointer remains as a convenience.
6. **Account change fails closed (A5).** When the connected account differs from the session account, the store
   invalidates an `AUTHORIZED` run of the old session (`invalidate(id, 'WALLET_CHANGED')` → new error code
   `ROUTER_WALLET_CHANGED_REVIEW_REQUIRED`), ends the session and requires the new account to sign in; another wallet
   never sees or resumes the old run. A wallet **chain** change never alters the reviewed action (it is chain-explicit):
   execution is refused unless the wallet is on the reviewed source chain at both pre-submission checks, with a
   user-driven switch button. A **workflow** chain/amount/recipient/token/slippage/provider change retires the Review
   (existing `retired` → `invalidate`) and server-side `begin` refuses any workflow that differs from the reviewed one.
7. **UI shell.** Network choice (Testnet / Mainnet) in the Router form and chat
   ("Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia"), profile-driven labels/explorers/switch target, a sign-in
   step, the wallet's runs, and a compact journey checklist. No redesign.
8. **Deployment docs (A8).** Exact Railway/Vercel variables for the testnet flow and the owner actions to make the URL
   public.

## 7. What must NOT be rebuilt

No new runtime, executor, journal, recovery engine, reconciler, evidence format, wallet store, custody model,
authorization architecture or backend service. No new bridge provider. No Guided Chat/Copilot, Mode C, privacy,
account abstraction or visual redesign. No mock presented as permissionless. No weakening of `ROUTE_CHANGED`, code
pins, simulation, nonce guards, never-resend, safe-head finality or evidence rules. Workers keep observe-only
transports.

## 8. Tests (reusing existing infrastructure)

* Unit: wallet session (valid signature, wrong signer, expired/replayed challenge, tampered cookie, domain binding),
  ownership guard (every Router method), testnet router service on the parameterized harness (arbitrary random owners,
  route change, material workflow mutation, ambiguous submission, refund path, `TESTNET`/`MOCKED` evidence rules,
  profile binding of logs).
* PostgreSQL (`crosschain-router-testnet` on the real API/worker composition): wallet A creates; wallet B refused on
  every mutating/reading method and run read route; account switch invalidation; refresh after authorization and after
  submission; fresh API and worker processes; ambiguous submission discovered without resend; duplicate-effect refusal;
  reconciliation; refund recovery; evidence archived and re-verified; per-wallet run listing.
* Browser (loopback MOCKED testnet harness, closed replay): two random wallets with in-memory ephemeral keys sign in;
  full journey to evidence; reload recovery; wallet B isolation; account switch; chain switch. The existing Router
  browser spec keeps passing with sign-in.

## 9. Status language

Implementation can reach at most MOCKED (unit/PostgreSQL/loopback) plus `PUBLIC_READ_ONLY` preflight in this build.
`PERMISSIONLESS_EXECUTED` is claimed only after a fresh external wallet completes the deployed journey; that needs
owner deployment actions (deploy this branch's API/worker with `GRYLOO_ROUTER_TESTNET=live`, make the Vercel URL
public) and an external user's own testnet funds and signatures.
