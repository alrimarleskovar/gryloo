# BUILD-ROUTER-001 — Report: Flofi canonical Cross-chain Router

Date: 2026-10-04. Branch `claude/build-crosschain-router-001` from `origin/main` `ebbd4aa`. Plan:
[BUILD-ROUTER-001-PLAN.md](BUILD-ROUTER-001-PLAN.md). PR #56 (CI / self-hosted runner) was not copied, cherry-picked or
reproduced; this branch is to be rebased onto main after it lands. No Privacy/Zcash/Cloak, Tempo or Mode C branch, worktree
or architecture was touched.

**Status: IMPLEMENTATION COMPLETE — READY FOR OWNER MAINNET E2E.** Evidence: `MOCKED` (unit, PostgreSQL and loopback
browser suites) and a real `PUBLIC_READ_ONLY` preflight on Base mainnet and Arbitrum One with live LI.FI and Across quotes
([BUILD-ROUTER-001-READONLY.json](BUILD-ROUTER-001-READONLY.json)). **No transaction was signed or sent by the agent.**
`MAINNET_EXECUTED` requires the owner's own wallet-signed run (below).

## What was built

One real vertical slice — Base USDC → Arbitrum One USDC — through Flofi's existing lifecycle, not a parallel runtime:

```
Canonical IR (asset.bridge · adapter flofi.router)
 → Cross-chain Router (canonical route, route commitment, provider policy, ROUTE_CHANGED)
    → LI.FI (primary discovery; executes through the LI.FI Diamond) | Across direct (first-class) | future adapters
 → Quote → Simulation → Review → Manifest → Authorization → Execute → Recover/Reconcile → Evidence
```

| Layer | Change |
| --- | --- |
| Canonical IR (`workflow-contracts/src/router.ts`, `router-pairs.ts`) | `asset.bridge` closed declaration with adapter `flofi.router`: source/destination chain, input/output token, amount, **recipient** (`CONNECTED_OWNER` or an explicit destination-chain `ACCOUNT`), slippage, and the allowed routing providers in preference order. BUILD-008/009/010 bridge nodes are unchanged and keep their own validators. The schema's cross-chain output exception admits only supported router pairs. |
| Canonical route model | Provider-neutral `CanonicalRoute`: chains, tokens, input/expected/minimum output, recipient, depositor, refund address, routing provider, underlying protocol, ordered steps, fee lines + total, slippage, exact approval (token/spender/amount), deposit transaction (to/data/value), Across bridge identity (SpokePools, quote timestamp, fill deadline, exclusivity, message), quote id/raw hash/time/expiry/duration. `canonicalizeRoute` validates amounts, fees and shape; `routeCommitment` is a domain-separated SHA-256 of canonical JSON (key, fee order and case independent); `compareRoutes` lists material changes. |
| Lifecycle contract | `ROUTER_PHASES` and `ROUTER_PHASE_TRANSITIONS`: `PREPARED → AUTHORIZED → SOURCE_SUBMITTED → SOURCE_CONFIRMED → IN_FLIGHT → DESTINATION_OBSERVED → RECONCILED`, plus `RECONCILIATION_REQUIRED`, `RECOVERY_REQUIRED`, `REFUNDED`, `FAILED`. Success is unreachable without an observed destination; terminal phases never change. Base attempts reuse Flofi's attempt states (`PREPARED`, `SUBMITTING`, `SUBMISSION_RESULT_UNKNOWN`, `PENDING`, `CONFIRMED`, `REVERTED`, `NOT_FOUND`, `CANCELLED`, `RECONCILIATION_REQUIRED`). |
| Registry (`action-registry`) | Deployment profile `CROSSCHAIN_ROUTER_BASE_ARBITRUM` (addresses and runtime-code SHA-256 pins verified read-only) and one capability row `asset.bridge` / `flofi.router` / `eip155:8453` / `MAINNET`, Mode A, `evidenceMaturity: null`. |
| Linter | `validateRouterBridgeWorkflow` (one isolated canonical node); lint finding `ROUTER_ROUTE_REQUIRED`. |
| Compiler (`reference-compiler/src/crosschain-router.ts`) | Strict, byte-exact (decode → re-encode → equal) codecs for `approve`, Across `SpokePool.deposit` (bytes32 variant, with Across's short trailer), LI.FI `swapAndStartBridgeTokensViaAcrossV4` / `startBridgeTokensViaAcrossV4`, LI.FI `forwardERC20Fees`; decoders for `FundsDeposited`, `FilledRelay`, ERC-20 `Transfer`/`Approval`. Selectors and topics are pinned to their Solidity signatures by test and were checked against real logs. `compileRouterArtifacts` builds the frozen-v1 Quote/State → Artifact Set → Simulation Bundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan chain with the route commitment as a normalized quote value and `providers: FIXED` (`lifi:across` / `across:across`). |
| Providers (`router-providers.ts`) | LI.FI and Across adapters normalize into the canonical route. **The calldata is the source of truth**: it is decoded independently and every API field that matters (recipient, refund address, output, fee recipients and amounts, spender, target, value, chain) must agree or the quote is refused. LI.FI is asked only for bridges Flofi can reconcile (`allowBridges=across`); any other tool is refused. Flofi never uses Across's suggested unlimited approval. Status endpoints are normalized into hints. |
| Service (`router-service.ts`) | One implementation on the `ExecutionStorage` port (files locally, PostgreSQL in the cloud); never signs or sends. Details below. |
| Runtime and cloud | `router-runtime.ts` (gates, allowlisted read-only RPCs, paced/retrying reads), server action `app/router-action.ts`, cloud flow `crosschain-router` in `backend/flows.ts` (workers get observe-only transports for both chains). No database migration (existing domains already admit `PUBLIC_MAINNET`, the phase names and attempt states), no new service. |
| UI | Guided Chat (`Bridge 5 USDC from Base to Arbitrum [to 0x…] [via LI.FI\|Across\|auto] [slippage N bps]`) and Canvas (action library form, inspector editor, canvas card) produce the identical IR. One Simulate/Review/Execute panel and store with reload recovery. |

## Authorization invariant

* The Review commitment covers the canonical route and its commitment, the route-bound Manifest and artifact hashes, the
  real simulation, the chain observation (block, balances, allowance, code hashes, **EIP-1967 implementations of both
  SpokePools**, SpokePool buffers), the exact calls, fees, deadlines, recipient, owner and workflow hash. The owner authorizes
  exactly that commitment.
* `begin` re-reads both chains, **re-quotes the same provider** and compares: any material change (recipient, amount,
  provider, protocol, steps, approval, target, function, value, bridge contracts, message, fees above the reviewed total,
  lower minimum, fee recipient, chain, token) is `ROUTE_CHANGED`. The authorization is cleared, the run is marked
  `requote`, the old Review cannot be re-accepted, and only Quote → Simulation → Review → new Manifest → new Authorization
  continues. A provider that now routes through another bridge is `ROUTE_CHANGED` (`PROTOCOL_CHANGED`); the other provider is
  **never** asked as a substitute after Review. Provider unavailability at `begin` fails closed without clearing the
  authorization (`ROUTER_ROUTE_REVALIDATION_UNAVAILABLE`).
* The executed bytes are always the reviewed bytes; the browser additionally checks the prepared transaction against the
  reviewed calls, and the account, chain and pending nonce before and after the durable handoff.
* Fail-closed checks: expired Review or quote, changed IR (recipient/amount), changed code or implementation, wrong owner,
  wrong chain, pending wallet transaction, insufficient USDC/ETH, simulation revert or missing `eth_simulateV1`, a simulated
  deposit that differs from the route.

## Execution, recovery and reconciliation

* **Quote-time provider policy.** Each allowed provider is asked in preference order; every outcome is recorded in the
  Review (`SELECTED` / `AVAILABLE` / `REFUSED` / `UNAVAILABLE`, with codes and minimums). This is the only place a fallback
  can happen, and it is shown before authorization.
* **Simulation vs. quote vs. observation.** `review.quote` (provider claims), `review.simulation` (`eth_simulateV1` of the
  exact approval + deposit on Base, with the simulated `FundsDeposited` decoded and matched to the route; destination fill,
  relayer behaviour and refunds explicitly not simulated) and `review.observation` (chain reads) are separate objects and are
  labelled separately in the UI.
* **Source.** Owner-submission verification (direct or one canonical MetaMask delegated redemption; the shared verifier
  gained an explicit chain parameter) with canonical-block inclusion; exactly one `FundsDeposited` from the Base SpokePool
  matching depositor, recipient, tokens, amounts, destination, quote timestamp, fill deadline, relayer and empty message;
  exactly one USDC debit of the reviewed input from the owner. Mismatch → `RECONCILIATION_REQUIRED`, never resent.
* **Bridge identity.** `(originChainId 8453, depositId)` from the receipt's own event. `IN_FLIGHT` once the source block
  is at Base's `safe` head.
* **Destination.** A provider hint (Across `deposit/status`, then LI.FI `status`) is verified on chain; without a usable
  hint, Arbitrum `FilledRelay` logs are scanned by `(originChainId, depositId)` with a durable cursor. The fill must be
  canonical, match the deposit field by field, deliver `updatedOutputAmount ≥ minimum` to `updatedRecipient = recipient`, and
  carry the USDC `Transfer` to the recipient in the same receipt. A lying hint is ignored; a fill to another recipient or
  below the minimum freezes the run. `RECONCILED` only when both blocks are at their chain's `safe` head; then the Evidence
  Bundle.
* **Recovery.** No fill once the scan has covered a destination block past the fill deadline → `RECOVERY_REQUIRED`; a
  refund hint is verified on chain (USDC `Transfer` from the SpokePool to the refund address, deposit amount) → `REFUNDED`.
* **No duplicate effects.** Attempts persist before the wallet is called; reload resumes from a local pointer and the server
  run; ambiguous results are observed, never resent; nonce discovery; **log-based discovery of a deposit by its on-chain
  Across identity**, so a relayed deposit whose hash was lost (owner nonce unchanged) is still found instead of being
  declared not executed; at most one unresolved deposit per owner across all runs; owner+nonce reservation. Guards are held
  across the attempt's save, so a reservation for an attempt that never persisted cannot block the owner.
* **Durability.** Unchanged snapshots are not appended; the scan cursor is persisted in steps (smaller than one
  observation's scan capacity), so a long wait for a fill or refund cannot grow the log toward its size limit.

## Discovery findings (all read-only)

* LI.FI chose **`polymerStandard`** (10 USDC, first probe) and **`layerswap`** (1 USDC, preflight) when unrestricted; with
  `allowBridges=across` it routes through the Across facet V4. The router refuses the former and binds the latter.
* LI.FI publishes no quote expiry; it is derived from the decoded deposit (`quoteTimestamp + depositQuoteTimeBuffer` minus
  a safety margin, before `fillDeadline`) and capped by Flofi's 180 s Review TTL.
* LI.FI charges a fixed 0.25% fee collected on Base through the fee forwarder; at 1 USDC the LI.FI route cost 1.03%
  (fee + relayer gas) against 0.78% for Across direct. The default policy still prefers LI.FI (owner requirement); the
  Review shows both, and the owner can choose "Across direct only".
* The Across Swap API answered without an API key, though its documentation requires one; a key is sent when configured.
* The public Base RPC allows a burst of about five `eth_call`s and then returns HTTP 429 for several seconds. The live
  transport now paces reads and retries transport failures with backoff; a keyed `GRYLOO_BASE_RPC_URL` is recommended.

## Real read-only preflight

`node scripts/router-readonly-preflight.mjs docs/builds/BUILD-ROUTER-001-READONLY.json` ran the production service with
`executionEnabled: false`, simulating from the public address `0x1111…1111` (holds USDC and ETH on Base; no authority over
it is needed or used):

* Automatic policy: LI.FI **selected**, Across **available**. 1 USDC → expected and minimum **0.989674 USDC**; steps
  LI.FI fee collection (1.000000 → 0.997500) then Across (0.997500 → 0.989674); fees LI.FI 0.0025, relayer gas 0.007727,
  relayer 0.000099 USDC.
* Real `eth_simulateV1` at Base block 52,172,125 of approve (55,437 gas) + LI.FI deposit (170,660 gas): the simulated Across
  `FundsDeposited` (depositId 6,292,056) matched the route — depositor and recipient the owner, input 0.9975, output
  0.989674, destination 42161. Fee upper bound ≈ 0.0000038 ETH.
* Route-bound Manifest `0xc311ee66…4667`, provider `FIXED lifi:across`; route commitment `0x7b2ce785…6b06`.
* Across direct: minimum **0.992169 USDC**, simulated deposit matched.
* Unrestricted LI.FI: `layerswap` → `LIFI_UNDERLYING_PROTOCOL_NOT_RECONCILABLE`.
* Review accepted; `begin` refused with `ROUTER_EXECUTION_NOT_ENABLED`. 62 read-only RPC requests; **0 transactions**.

## Tests (local)

| Gate | Result |
| --- | --- |
| Contracts `router.test.ts` | 8: canonicalization, deterministic commitment, every material mutation changes it, comparison (`REQUOTE` vs `EXACT`), node closure, phases |
| Registry, linter | 3 + 3 |
| Compiler `crosschain-router.test.ts` | 7: selectors/topics from signatures; real LI.FI and Across calldata decoded and re-encoded byte-exact; tampering; real `FundsDeposited`/`FilledRelay` logs; route-bound Manifest |
| Providers `router-providers.test.ts` | 7 on the recorded real responses: normalization, unrestricted route refused, API/calldata disagreement (recipient, refund, output, fees, spender, value, chain, expiry), status hints, credentials |
| Service `router-service.test.ts` | 26 on MOCKED chains: Review content and provenance separation; explicit recipient; quote-time fallback; fee, provider-fallback, route-step, recipient and amount mutation; quote expiry; wallet change; provider outage; disabled execution; tampered store; full LI.FI and Across journeys; source confirmed but destination absent (and no log growth while waiting); delayed fill; lying and failing hints; divergent fills; deadline → recovery → refund; never-executed deposit; restart; lost browser; ambiguous submission (same run and other runs); relayed lost hash; stale guard; wallet refusal; PREPARED cancellation; corrupt storage |
| Authoring `router-authoring.test.ts` | 4: Guided Chat ≡ Canvas IR, defaults, edits, rejections |
| Runtime `router-runtime.test.ts` | 3: gates, read-only allowlists, pacing/retry |
| PostgreSQL `crosschain-router-cloud.pg.test.ts` | 2: API + fresh workers reconcile both chains after browser loss and restarts, verified evidence, projections, racing API instances; in-flight observation, tenant isolation, stale work item never cancels PREPARED |
| Browser `router.spec.ts` (MOCKED loopback) | 4: chat → route → Review → approval → deposit → in flight → fill → reconciled + evidence; reload in flight; route change after Review; Canvas authoring with explicit recipient and Across-only routing |
| `pnpm check` (typecheck, lint, build, schema drift, unit) | **pass**: 1,389 passed, 2 skipped (the same pre-existing environment-gated suites) |
| `pnpm test:postgres` (PostgreSQL 18, loopback) | **pass**: 38 passed |
| Browser: main CI list | **pass**: 53 passed, 4 skipped (gated Mode B fork specs); visual baselines passed unchanged |
| Browser: `uniswap-liquidity`, `robinhood-transfer`, Supply family, `router` | 4/4, 7/7, 44/44, 4/4 |
| `governance_lite.py` + self-tests | pass (17 self-tests) |
| Not run locally | Anvil fork suites, CoW / Mode A / composition / lending / Jupiter / Solana browser suites (untouched code paths), dependency audit (network). CI runs them. No dependency was added or changed. |

During validation one regression was found and fixed: the router form's "Bridge slippage (bps)" label duplicated the
BUILD-009 form's label and made `build009.spec.ts` ambiguous; the router labels are now unique. The backend entry-point
test's expected flow list now includes `crosschain-router` (an intentional new flow).

## Owner actions for `MAINNET_EXECUTED` (real funds)

Only the owner can do this; the agent sends nothing.

1. Deploy this branch on the BUILD-CLOUD-001 runtime ([docs/deploy/CLOUD.md](../deploy/CLOUD.md)) or run it locally with
   `GRYLOO_ROUTER_JOURNAL=<absolute dir>`.
2. Set `GRYLOO_ROUTER=live` (API and worker). Strongly recommended: `GRYLOO_BASE_RPC_URL` (and optionally
   `GRYLOO_ARBITRUM_RPC_URL`) to keyed HTTPS RPCs supporting `eth_simulateV1`. Optional secrets: `ACROSS_API_KEY`,
   `ACROSS_INTEGRATOR_ID`, `LIFI_API_KEY`.
3. To allow your wallet to execute, set `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED` (API and worker). Without it,
   quotes, simulation and Review stay read-only.
4. Fund your wallet on Base with a small amount of USDC (e.g. 1–5 USDC; cap is 100 USDC per run) and a little ETH.
5. In Flofi: chat `Bridge 1 USDC from Base to Arbitrum` (or use the canvas form) → Apply → Simulate → **Get route and
   simulate**. Check provider, steps, minimum received, fees, approval (exact amount, never unlimited), recipient, refund
   address and quote expiry. Execute → **Accept route review** → **Execute: Approve…** (wallet) → **Execute: Deposit…**
   (wallet). Keep the page open or reload later; the worker observes Base and Arbitrum.
6. When the panel shows **Bridge reconciled**, download the Evidence Bundle and confirm `GET /v1/runs/<id>/evidence`
   returns `verified: true`. Share the approval, deposit and fill transaction hashes for independent verification. Only then
   may the registry row's evidence ceiling become `MAINNET_EXECUTED`.

## Limitations

* One pair (Base USDC → Arbitrum USDC); one reconcilable underlying protocol (Across). LI.FI routes through other bridges
  are refused, not executed.
* Proxy implementations are bound per Review, not pinned globally (upgrades invalidate an open Review only).
* Refund verification depends on a provider hint for the refund transaction; without it the run stays
  `RECOVERY_REQUIRED` (funds are returned by Across regardless; Flofi just cannot prove it yet).
* Delegated-redemption verification on Base mainnet relies on the same MetaMask Delegation Framework addresses as Base
  Sepolia (code present on Base mainnet, verified 2026-10-04).
* Finality is the `safe` head (≈ 40 s on Base, ≈ 12 min on Arbitrum during discovery), not L1 finality.
