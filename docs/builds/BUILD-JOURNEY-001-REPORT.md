# BUILD-JOURNEY-001 — Report: Permissionless External User Journey

Date: 2026-10-04. Branch `claude/build-journey-001` from `origin/main` `bc4fc57`. Plan: [BUILD-JOURNEY-001-PLAN.md](BUILD-JOURNEY-001-PLAN.md).

## Status

**IMPLEMENTATION COMPLETE — DEPLOYED JOURNEY NOT YET RUN. `PERMISSIONLESS_EXECUTED` is not claimed.**

Evidence reached: `MOCKED` (unit, PostgreSQL and loopback browser suites with fresh random wallets) and a real
`PUBLIC_READ_ONLY` preflight of the testnet Router through the production service
([BUILD-JOURNEY-001-READONLY.json](BUILD-JOURNEY-001-READONLY.json)). No transaction was signed or sent by anyone.
`PERMISSIONLESS_EXECUTED` requires owner deployment actions (below) and then a fresh external wallet completing the deployed
journey with its own testnet funds and signatures.

## Supported external-user workflow

**Base Sepolia USDC → Flofi Cross-chain Router → Arbitrum Sepolia USDC**, 0.5–5 test USDC, LI.FI first (Across direct as the
explicit alternative), underlying Across. The preferred slice was verified, not assumed (plan §4): the Across testnet API and
LI.FI both return Base Sepolia → Arbitrum Sepolia USDC routes whose calldata the existing Router codecs decode byte-exactly; the
Base Sepolia / Arbitrum Sepolia SpokePools carry the canonical Across proxy code; an Across testnet relayer filled a Base Sepolia
USDC deposit on Arbitrum Sepolia the same day; public Base Sepolia supports `eth_simulateV1`; both chains answer `safe`. No mock
replaces any provider, and settlement verification is unchanged.

The user journey in the application:

1. Open the app. With the testnet Router enabled, the Build stage shows **Permissionless testnet journey** with a step list.
2. **Connect wallet** (any EIP-6963/injected wallet; nothing is preconfigured).
3. **Sign in with wallet**: one EIP-4361 message via `personal_sign` ("…authorizes no transaction and moves no funds").
4. **Create** the workflow: chat `Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia`, or the canvas form
   (network "Testnet"), then Apply.
5. **Simulate**: live quotes from the allowed providers, real `eth_simulateV1` of the exact Base Sepolia transactions, chain
   observation of both chains, route commitment, route-bound Manifest.
6. **Review**: provider, steps, amounts, fees, network-fee bound, exact approval, recipient, refund, deadlines, and a
   **Strategy Manifest** row (owner, spend limit, fixed provider, Manifest hash).
7. **Accept** ("Accept route review" — the text states it binds the Strategy Manifest hash).
8. **Sign / Execute**: one Execute click per wallet request (exact approval, then the deposit), each signed by the user's wallet.
9. **Refresh / reopen / restart**: the run is server-held; reloading resumes it; any other browser recovers it from
   **Your runs** after signing in.
10. **Recover / reconcile**: observation (browser or workers) rediscovers submissions and reconciles both chains.
11. **Authoritative completion**: `RECONCILED` only when the Arbitrum Sepolia `FilledRelay` + USDC transfer to the reviewed
    recipient is at the `safe` head of both chains (or `REFUNDED` after the fill deadline, verified on chain).
12. **Evidence**: the Evidence Bundle (download in the app; archived and re-verified by the API/EvidenceStore in the cloud).

## Architecture reused (no new runtime)

| Layer | Reused as is | Changed |
| --- | --- | --- |
| Canonical IR | `asset.bridge` + adapter `flofi.router`, closed declaration | One more entry in `ROUTER_PAIRS` (testnet pair) |
| Quote / artifacts | LI.FI and Across normalizers, calldata decoders, `compileRouterArtifacts` | Normalizers take a `RouterProfile` (default mainnet) |
| Simulation / Review / Manifest | `buildReview`, Review commitment, route commitment, artifact chain | Capability environment from the profile |
| Authorization binding | `review` → `AUTHORIZED`; `begin` re-reads, re-quotes the same provider (`ROUTE_CHANGED`), re-simulates, checks pins, nonce, deadlines | `invalidate` accepts `WALLET_CHANGED` (code `ROUTER_WALLET_CHANGED_REVIEW_REQUIRED`) |
| Execution journal / recovery | Append-only validated log, `PREPARED` before the wallet, durable `SUBMITTING`, owner+nonce and per-owner deposit guards, discovery by hash / `FundsDeposited` / nonce, never resend | Log validation binds a log to its profile and its evidence class to its provenance |
| Reconciliation / evidence | Safe-head source and destination proof, refunds, frozen v1 Evidence Bundle | Testnet runs record `PUBLIC_TESTNET` → `TESTNET_EXECUTED` |
| Cloud | API, workers (observe-only transports), outbox, leases, idempotency, EvidenceStore, BFF forwarding | One more flow `crosschain-router-testnet`; principal header; owner-filtered reads; index migration `0004` |
| Wallet | `Build009WalletProvider` (EIP-6963, account/chain events, switching) | None (the store reacts to its events) |
| UI | Router store/panel, chat/canvas authoring | Network choice, sign-in, runs list, journey checklist, Manifest row |

## Assumptions removed

| Before | After |
| --- | --- |
| Only a real-funds mainnet pair; execution needed an operator opt-in per deployment | Testnet profile + flow `crosschain-router-testnet`, enabled by `GRYLOO_ROUTER_TESTNET=live`; execution is the user's own wallet action |
| Run owner was a claimed string; anyone with a run id could authorize, invalidate, begin, report or read it | Wallet session principal (verified signature) + one ownership guard on every Router method, in the API and in local actions |
| `/v1/runs*` showed every tenant run | Filtered to the principal when one is forwarded (operators with the bearer token alone keep tenant access) |
| Recovery needed this browser's `localStorage` pointer | Server-side per-wallet run list; the pointer (now owner-tagged) is a convenience |
| A wallet account switch after Review left the authorization until Execute | Account switch clears the unused authorization and ends the old session (fail closed) |
| UI and labels hard-wired to Base / Arbitrum One | Profile-driven labels, explorers and network switch |
| Harness and pins keyed to mainnet; fixed test owner `0x5555…` | Profile-parameterized harness; every test wallet is a fresh random key |

No hard-coded owner existed in the Router runtime; none was added. The deployed API/worker hold no key and no owner variable.

## Wallet / session model

* **Connection**: unchanged injected-wallet discovery; any account; Flofi never requests a key and never signs.
* **Sign-in**: the server builds an EIP-4361 message (domain/URI from the request, chain id, a 128-bit nonce sealed with a
  5-minute expiry in an HttpOnly SameSite=Strict challenge cookie). The wallet signs it with `personal_sign`. The server
  recovers the signer (secp256k1, EIP-191, low-s; in `reference-reconciler`, which already verifies owner signatures) and
  only if it equals the claimed address seals `{address, issued, expiry 8 h, session id}` with HMAC-SHA256 into an HttpOnly
  SameSite=Strict (Secure on HTTPS) session cookie. The challenge cookie is deleted on every attempt.
* **Key**: `FLOFI_SESSION_SECRET` (≥ 32 chars) if set, else HKDF from the server-only `API_AUTH_TOKEN` the deployed BFF already
  has (no new deployment secret), else a per-process key for single-process local servers. A forwarding BFF without either
  fails closed (`WALLET_SESSION_NOT_CONFIGURED`).
* **Run binding**: the BFF forwards the verified address in the server-to-server `x-flofi-wallet-principal` header (the browser
  cannot reach the API). `simulate`/`begin` owner arguments must equal the principal; every run-id method requires the durable
  run's owner (immutable in the validated log) to equal the principal; methods not declared in the policy are refused.
  Idempotency hashes include the principal (a replayed key under another wallet is a conflict).
* **Account change**: the store detects `accountsChanged`; an `AUTHORIZED` run of the previous account is invalidated with
  `WALLET_CHANGED`, the previous session ends, its runs disappear from view, and the new account must sign in. A switch that
  happened while the page was closed is detected on load (passive `eth_accounts`) before anything is resumed. Reviews also
  expire within 180 s on their own.
* **Chain change**: the reviewed action is chain-explicit, so a wallet chain change does not alter it; execution is refused
  (`ROUTER_WRONG_CHAIN`) unless the wallet is on Base Sepolia at both pre-submission checks, and the user switches with the
  "Switch to Base Sepolia" button (`wallet_switchEthereumChain`). A workflow network/amount/recipient/token/slippage/provider
  change retires the Review in the browser and is refused by the server (`ROUTER_SEMANTIC_REVISION_CHANGED`).
* **Not financial authority**: the session cannot sign, send or authorize anything; it only decides which runs a browser may
  operate.

## Recovery behavior

Unchanged invariants, now exercised on the testnet profile with arbitrary wallets: the attempt is persisted `PREPARED` before
the wallet is called and `SUBMITTING` before `eth_sendTransaction`; a lost wallet answer becomes
`SUBMISSION_RESULT_UNKNOWN` and is only observed; a second attempt is refused while one is active
(`ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING`), and a second deposit of the same wallet across runs is refused
(`ROUTER_OWNER_DEPOSIT_IN_FLIGHT`); a submission whose hash was lost is rediscovered from the Across `FundsDeposited` log or the
owner nonce; a reload replays a saved hash to the server (never to the wallet); a different hash is `ROUTER_HASH_DIVERGENT`;
workers never touch `PREPARED` and their transports cannot submit. Testnet and mainnet are separate durable namespaces, so the
same wallet's nonce on each chain never collides.

## Reconciliation behavior

Unchanged: source deposit verified from the owner's receipt (exactly one reviewed `FundsDeposited`, owner debit = input) at
Base Sepolia `safe`; destination fill proven from an Arbitrum Sepolia `FilledRelay` for `(84532, depositId)` with the reviewed
recipient, ≥ minimum output and the matching USDC transfer, at Arbitrum Sepolia `safe`; provider status (LI.FI / Across testnet)
is only a hint; past the fill deadline the run is `RECOVERY_REQUIRED` until a verified refund (`REFUNDED`). Divergences go to
`RECONCILIATION_REQUIRED`.

## Evidence behavior

The frozen v1 Evidence Bundle is built only at `RECONCILED`. Testnet runs record provenance `PUBLIC_TESTNET` and
`environment: TESTNET_EXECUTED`; harness runs record `MOCKED`; the log validator now rejects any evidence class that does not
match the run's provenance. In the cloud the worker archives the bundle to the content-addressed EvidenceStore and
`GET /v1/runs/:id/evidence` re-verifies it — for the owning wallet only. The app shows the bundle hash and transaction
explorer links (Base Sepolia / Arbitrum Sepolia) and offers the download.

## Security invariants preserved

No private key custody; no server-side signing or submission (workers' observe-only transports unchanged); explicit Review,
Manifest acceptance, Execute click and wallet signature per request; fail-closed `ROUTE_CHANGED` / state / expiry checks;
exact finite approvals; code pins (testnet pins read 2026-10-04); real simulation; never-resend recovery; safe-head
reconciliation; evidence never above provenance; mainnet real-funds execution still requires the owner's
`GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`. The dependency gate is untouched: the app manifest and lockfile are
identical to `main` (signer recovery lives in `reference-reconciler`, which already pins `@noble/*`).

Intentional changes to existing tests, for review: the BUILD-ROUTER-001 PostgreSQL test now presents the owner's principal
(the API refuses Router calls without one); the Router browser spec uses a fresh random wallet per test that signs in (the
fixed `0x5555…` owner is gone); the registry test asserts one router row per network; the entrypoint test lists the new flow.
No test was deleted or skipped.

## Deployed environment

* **Existing**: Vercel project `flofi` (production and per-commit previews) and Railway project with `flofi-api` /
  `flofi-worker` (environment `production`, deployed from `main`). This branch's Vercel preview built successfully
  (`https://flofi-cofngcugy-alrimarleskovars-projects.vercel.app`, commit `8ce8586`), but both production and previews answer
  HTTP 302 to Vercel SSO, so no external user (or agent) can open them. Railway deploys only `main`.
* **Not done by the agent (owner actions)**:
  1. Deploy this revision's API and worker (merge, or a Railway environment for the branch); migration `0004` runs in the
     existing pre-deploy `migrate`.
  2. Set `GRYLOO_ROUTER_TESTNET=live` on `flofi-api` **and** `flofi-worker` (optionally keyed `GRYLOO_BASE_SEPOLIA_RPC_URL` /
     `GRYLOO_ARBITRUM_SEPOLIA_RPC_URL`). Vercel needs no new variable (optional `FLOFI_SESSION_SECRET`).
  3. Make the frontend public (Vercel → Deployment Protection, or a production domain) — `docs/deploy/CLOUD.md` step 6.
  4. A fresh external user runs the journey with their own wallet and testnet funds — `docs/deploy/CLOUD.md` step 8.
* Deploy order note: the new API refuses Router calls without a principal, so a frontend older than this revision cannot use
  the Router against the new API (it fails closed with `WALLET_SESSION_REQUIRED`) until Vercel serves the same revision.

## Real read-only preflight

[BUILD-JOURNEY-001-READONLY.json](BUILD-JOURNEY-001-READONLY.json), 2026-10-04 19:47 UTC, production testnet Router service with
execution disabled, public RPCs, simulated from the public, authority-free address `0x1111…1111` (as BUILD-ROUTER-001 did):

* **Automatic** (LI.FI first): LI.FI `SELECTED`, Across `AVAILABLE`; 1 USDC in, minimum 0.964605 USDC; LI.FI fee 0.0025 USDC;
  real `eth_simulateV1` at Base Sepolia block 47,687,473 (approval + `0x1794958f` deposit through the testnet Diamond), owner
  debit exactly 1,000,000; all six code pins matched live code; Review reached `AUTHORIZED`.
* **Across direct**: `SELECTED`, minimum 0.967102 USDC, simulated at block 47,687,478, `AUTHORIZED`.
* 46 Base Sepolia + 18 Arbitrum Sepolia read-only RPC requests, 1 LI.FI and 2 Across testnet requests. `begin` was never
  called; nothing was prepared, signed or sent.

## Tests executed (local, this WSL machine)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | 15/15 tasks |
| `pnpm lint` | pass |
| `pnpm build` | 8/8 tasks |
| `pnpm schemas:check` | 11 schema exports verified |
| `pnpm test` (unit) | **1,411 passed**, 2 skipped (pre-existing), 167 files |
| `pnpm test:postgres` (loopback PostgreSQL 18) | **40 passed**, 7 files (includes the new journey suite) |
| Browser `journey.spec.ts` (`GRYLOO_ROUTER_TESTNET_E2E`) | **3/3** |
| Browser `router.spec.ts` (`GRYLOO_ROUTER_E2E`) | 4/4 |
| Browser main CI group (base-observation … visual-shell, 18 specs) | 53/53 |
| Governance-lite gate + self-tests | pass, 17/17 |
| `bootstrap-ci.py --verify-dependencies` | pass (262 registry entries, unchanged) |

Not run locally (CI runs them): the other MOCKED browser groups (supply/lending/Solana/Jupiter/Robinhood/Uniswap/Mode A/CoW/
composition) and the Anvil fork suites.

Required coverage → where:

| # | Requirement | Tests |
| --- | --- | --- |
| 1 | Arbitrary wallet onboarding | journey spec 1; PG test 1 (random wallets, no allowlist); unit `router-testnet` 1 |
| 2 | No hard-coded owner | every journey/router test uses fresh random keys; harness `owner`/`wallets`; `wallet-session` 1 |
| 3 | Wallet A creates a run | PG 1; journey spec 1–2 |
| 4 | Wallet B cannot resume/authorize A's run | PG 1 (12 methods + 3 read routes + listing); `run-ownership` 2; journey spec 2 (forged pointer, other browser) |
| 5 | Account change after Review invalidates | journey spec 3; PG 1; `router-testnet` 3 |
| 6 | Chain change behavior | journey spec 3 (wrong chain refused, user switch, then executes) |
| 7 | Refresh after authorization | PG 1 (fresh API process keeps `AUTHORIZED`) |
| 8 | Refresh after submission | journey spec 1 (reload after deposit); PG 1 (new process, hash replay no-op) |
| 9 | Backend restart | PG 1 (four API instances) |
| 10 | Worker restart | PG 1 (fresh workers reconcile) |
| 11 | Ambiguous submission | PG 1 (deposit `UNKNOWN` → rediscovered); `router-testnet` 5 |
| 12 | Duplicate-effect prevention | PG 1 (active attempt refused, 2 sends total, idempotency conflict); `router-testnet` 5–6; PG 2 (namespaces) |
| 13 | Material mutation after Review | PG 1; `router-testnet` 4 (amount/recipient/slippage/providers, `ROUTE_CHANGED`) |
| 14 | Successful reconciliation | journey spec 1–2; PG 1; `router-testnet` 1 |
| 15 | Failure / recovery path | PG 2 and `router-testnet` 6 (fill deadline → verified refund) |
| 16 | Evidence after completion | journey spec 1 (download); PG 1 (archived, verified, owner-only) |

## Known limitations

* No deployed run yet: SSO-protected Vercel, Railway on `main`, testnet flow not enabled — owner actions above.
  `PERMISSIONLESS_EXECUTED` and `TESTNET_EXECUTED` are not claimed.
* Testnet relayer liquidity is small (≈ 8 USDC max per deposit, hence the 5 USDC ceiling) and fills are not SLA-backed;
  an unfilled deposit is refunded after its fill deadline (`REFUNDED`, not success). Arbitrum Sepolia `safe` may lag by tens
  of minutes, so `RECONCILED` can take a while after the fill.
* Public RPCs may rate-limit; reads are paced and retried, keyed endpoints are the fix.
* Sessions are stateless (HMAC cookies): a stolen session cookie stays valid until it expires (8 h) or the key rotates; it
  still cannot sign or move funds. Smart-contract (EIP-1271) wallets cannot sign in; EOAs, including EIP-7702-delegated EOAs,
  can. One sign-in per browser; a second account requires signing in again.
* Authorizations of the previous account other than the open/pointer run are not proactively invalidated on an account
  switch; they expire with their Review (180 s) and still need that account's own wallet signature.
* Local (file) mode lists a wallet's runs by scanning its journal directory (newest 50 files); the cloud uses the indexed query.
* Only the Router flows bind runs to wallet sessions; the other cloud flows keep their previous behavior (out of scope).
