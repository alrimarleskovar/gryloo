# BUILD-ROUTER-001 — Plan: Flofi canonical Cross-chain Router

Date: 2026-10-04. Branch `claude/build-crosschain-router-001`, from `origin/main` `ebbd4aa` (PR #51 merged). PR #56
(CI / self-hosted runner) is not copied here; this branch will be rebased when it lands. No Privacy/Zcash/Cloak, Tempo or
Mode C branch or worktree is touched.

## 1. Objective

One real vertical slice of a provider-neutral **Cross-chain Router** inside the existing workflow lifecycle:

> Base (8453) USDC → Arbitrum (42161) USDC, owner-chosen amount and recipient.

```
Canonical IR (asset.bridge, adapter flofi.router)
  → Cross-chain Router (canonical route model, route commitment, provider policy)
      → LI.FI routing layer (primary route discovery)
      → Across direct adapter (first-class, explicit alternative)
      → future adapters behind the same interface
  → Quote → Simulation → Review → Manifest → Authorization → Execute → Recover/Reconcile → Evidence
```

No separate bridge application and no parallel runtime: the router is one more service on the existing
`ExecutionStorage` port (file store locally, PostgreSQL in the cloud), one more cloud `FlowDefinition`, and one more
canvas/chat action using the same Semantic Workflow IR.

## 2. Discovery: existing architecture (what is reused)

| Area | Existing | Use in this build |
| --- | --- | --- |
| Canonical IR | `asset.bridge` (BUILD-008 LI.FI Base→Optimism, BUILD-010 `across.direct` Base→Arbitrum): amount, destination asset, slippage; **no recipient** (implicitly the owner). `ACCOUNT` / `IDENTIFIER` input kinds exist (`asset.liquidity.*`, `asset.transfer`). | Reuse `asset.bridge`. New closed declaration with adapter `flofi.router`, a `recipient` input (`CONNECTED_OWNER` or an explicit destination-chain `ACCOUNT`) and a provider-preference list in `adapterConstraints.protocols`. BUILD-008/010 nodes keep their exact bytes and validators. |
| Artifact chain | Quote/State Artifact → Artifact Set → Simulation Bundle → AuthorizationPolicy (`providers: FIXED`) → StrategyManifest → ExecutionPlan (`compileBridge`, `compileAcrossReview`). | Same frozen v1 artifacts. The quote artifact carries the **route commitment**; the policy/Manifest fix the provider (`FIXED`), spend, fee budget, slippage, recipients, contracts and functions, so the Manifest hash binds the exact route. |
| Simulation | `eth_simulateV1` of exact call sequences (Uniswap public liquidity). | Real `eth_simulateV1` of the exact approval + bridge deposit on Base, decoding the simulated Across `FundsDeposited` log. Labelled transaction simulation; the destination fill is **not** simulated. |
| Review / authorization | Review object + SHA-256 commitment; owner accepts that commitment; `begin` re-reads state and clears the authorization on material change. | Same. The commitment covers route, route commitment, Manifest hash, simulation, observation, calls, fees, deadlines. |
| Wallet | Browser `eth_sendTransaction` only after the owner's Execute click; durable `PREPARED` → `SUBMITTING` handoff; owner-submission verifier (direct or MetaMask delegated redemption); canonical-receipt rule. | Reused. The verifier gains an explicit chain parameter (Base 8453) instead of a hard-coded 84532. |
| Journal / recovery | Append-only snapshot log, CAS, fenced leases, owner+nonce economic reservation, nonce discovery by binary search, never resend. | Reused patterns; plus a per-owner in-flight-deposit guard across runs. |
| Cloud | `backend/flows.ts` flow registry, workers with observe-only transports, outbox, EvidenceStore. | One new flow `crosschain-router`. No migration. |
| Evidence | Frozen v1 Evidence Bundle; `MAINNET_EXECUTED` environment exists. | Same format; `MOCKED` for harness runs, `MAINNET_EXECUTED` only after an owner run reconciles. |
| Capability registry | `executionCapabilityRegistry` rows; `MAINNET` environment exists. | New row `asset.bridge` / `flofi.router` / `eip155:8453` / `MAINNET`, Mode A, `evidenceMaturity: null`. |

## 3. Discovery: LI.FI (verified 2026-10-04, read-only)

* `GET https://li.quest/v1/quote` (`fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, toAddress, slippage,
  integrator, allowBridges, allowDestinationCall`). No API key needed for this volume.
* **Unrestricted, LI.FI picked `polymerStandard`** for 10 USDC Base→Arbitrum; with `allowBridges=across` it picked
  `across`. This is exactly the silent-substitution risk: the router therefore **names the reconcilable underlying
  protocols explicitly** (`across` today) in the request and in the Review, and rejects any other tool.
* Response: `type: "lifi"`, `tool`, `includedSteps` (`protocol/feeCollection`, `cross/across`), `estimate.toAmount`,
  `toAmountMin`, `approvalAddress` (LI.FI Diamond `0x1231…4eae`), `feeCosts` (`LIFI Fixed Fee` 0.25%, Across relayer
  fees), `gasCosts`, `executionDuration`, `transactionRequest` (`to` = Diamond, legacy `gasPrice`, `value 0x0`).
* **No quote expiry is published.** The router derives one from the decoded Across deposit (`quoteTimestamp +
  depositQuoteTimeBuffer`, before `fillDeadline`) and caps the Review TTL.
* Calldata (verified selector via the public signature database):
  `swapAndStartBridgeTokensViaAcrossV4(BridgeData, SwapData[], AcrossV4Data)` (`0x1794958f`).
  `BridgeData` = `(transactionId, bridge="across", integrator, referrer, sendingAssetId, receiver, minAmount,
  destinationChainId, hasSourceSwaps, hasDestinationCall)`; one `SwapData` = LI.FI fee collection through the fee
  forwarder `0xce40…8cbd` (`forwardERC20Fees(token,(recipient,amount)[])`); `AcrossV4Data` = `(receiver, refund,
  sendingAsset, receivingAsset (bytes32), outputAmount, outputAmountMultiplier, exclusiveRelayer, quoteTimestamp,
  fillDeadline, exclusivityParameter, message)`. The router **decodes the calldata independently** and rejects any
  disagreement with the API fields; the calldata, not the API summary, is what is reviewed.
* `GET /v1/status?txHash=…` returns `200` even for unknown transactions; statuses `NOT_FOUND|INVALID|PENDING|DONE|FAILED`
  with substatuses. Used only as a **hint** for the destination transaction; never as settlement proof.

## 4. Discovery: Across (verified 2026-10-04, read-only)

* `GET https://app.across.to/api/swap/approval` (`tradeType=exactInput, amount, inputToken, outputToken, originChainId,
  destinationChainId, depositor, recipient, refundAddress, refundOnOrigin, slippage, strictTradeType, integratorId`).
  Documentation says a bearer key is required; the endpoint answered without one today. The adapter sends a key when
  `ACROSS_API_KEY` is configured and works without it otherwise.
* Response: `crossSwapType: bridgeableToBridgeable`, `checks.allowance/balance`, **`approvalTxns` with an unlimited
  approval** (`0xff…ff`) — Flofi never uses it and builds its own exact-amount approval —, `steps.bridge`, fees
  (`relayerCapital`, `destinationGas`, `lp`, `app`), `expectedOutputAmount = minOutputAmount`, `expectedFillTime`
  (seconds), `quoteExpiryTimestamp`, `swapTx` to the Base SpokePool `0x09ae…ec64`:
  `deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256
  outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32
  exclusivityParameter, bytes message)` (`0xad5425c6`) plus a short trailing marker.
* `GET /api/deposit/status` (`depositTxnRef`): `filled|pending|expired|refunded|slowFillRequested`, `fillTxnRef`,
  `depositRefundTxnRef`; indexing lags 1–15 s. Hint only.
* On chain (verified against real logs): Base SpokePool emits
  `FundsDeposited(bytes32,bytes32,uint256,uint256,uint256 indexed destinationChainId,uint256 indexed depositId,uint32,
  uint32,uint32,bytes32 indexed depositor,bytes32,bytes32,bytes)` (`0x32ed…5ad3`); Arbitrum SpokePool `0xe35e…5f2a` emits
  `FilledRelay(…, uint256 indexed originChainId, uint256 indexed depositId, …, bytes32 indexed relayer, …,
  (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType))` (`0x44b5…7208`).
  `depositQuoteTimeBuffer` = 3600 s, `fillDeadlineBuffer` = 21600 s on both. A fill after `fillDeadline` is rejected by
  the SpokePool; an unfilled deposit is refunded on origin to the refund address.
* Both routing providers end in the **same on-chain Across deposit/fill identity** `(originChainId, depositId)`, which is
  what makes destination reconciliation provider-independent.

## 5. Signed / reviewable before execution

Exactly two possible owner transactions on Base, both fully known at Review: an exact `USDC.approve(spender,
inputAmount)` (spender = SpokePool for Across, LI.FI Diamond for LI.FI; only when the allowance is short) and the bridge
deposit (exact `to`, `data`, `value = 0`). The router decodes the deposit calldata into recipient, refund address,
destination chain, output token, output amount (= minimum received, exact for Across), quote timestamp, fill deadline,
exclusive relayer and (LI.FI) fee recipients/amounts. Nothing on the destination chain is signed by the owner.

## 6. Design

**Canonical route model** (`workflow-contracts/src/router.ts`, provider-neutral): source/destination chain, input/output
token, input amount, expected and minimum output, recipient, depositor, refund address, routing provider, underlying
protocol, ordered steps, fee lines (+ total), slippage, approvals, transactions (to/data/value), bridge identity fields
(SpokePools, quote timestamp, fill deadline, exclusivity, message), quote id/raw hash, quote time and expiry, duration.
`routeCommitment(route)` = domain-separated SHA-256 of canonical JSON (deterministic, key-order independent).
`compareRoutes(reviewed, candidate)` lists material differences (`RECIPIENT_CHANGED`, `AMOUNT_CHANGED`,
`PROVIDER_CHANGED`, `PROTOCOL_CHANGED`, `STEPS_CHANGED`, `FEES_OUT_OF_BOUNDS`, `MINIMUM_OUTPUT_DECREASED`,
`APPROVAL_CHANGED`, `TRANSACTION_TARGET_CHANGED`, `VALUE_CHANGED`, `CHAIN_CHANGED`, `TOKEN_CHANGED`, …).

**Provider policy.** The IR lists allowed routing providers in preference order (`['lifi','across']` = automatic,
`['lifi']`, `['across']`). At **quote time only**, the router asks each allowed provider, records every outcome
(`considered[]`), and selects the first executable route; the selection and its reason are part of the Review. After
Review there is **no fallback of any kind**: `begin` re-quotes the *same* provider and compares; any material change
(including LI.FI now choosing another bridge) is `ROUTE_CHANGED`, clears the authorization and requires
Quote → Simulation → Review → new Manifest → new Authorization. The executed bytes are always the reviewed bytes.

**Lifecycle** (run phase, reusing Flofi attempt states for each Base transaction):

`PREPARED` (Review/Manifest compiled) → `AUTHORIZED` → [`APPROVAL` attempt] → `SOURCE_SUBMITTED` (deposit wallet request
may exist: `SUBMITTING` / `SUBMISSION_RESULT_UNKNOWN` / `PENDING`) → `SOURCE_CONFIRMED` (canonical receipt, owner
submission verified, `FundsDeposited` exactly as reviewed) → `IN_FLIGHT` (source at the `safe` head; awaiting fill) →
`DESTINATION_OBSERVED` (canonical Arbitrum `FilledRelay` for the same `(8453, depositId)` and the USDC `Transfer` to the
recipient) → `RECONCILED` (both blocks at their chain's `safe` head; Evidence Bundle). Exceptional: `RECONCILIATION_REQUIRED`
(any mismatch; frozen, never resent), `RECOVERY_REQUIRED` (fill deadline passed without a fill; refund expected on
origin), `REFUNDED` (verified origin refund to the refund address), `FAILED` (deposit reverted or proven never
executed; no funds moved). A proven pre-broadcast refusal or an invalidated authorization returns to `PREPARED`.

**Reconciliation** independently establishes, from chain reads only: (1) the transaction is the reviewed deposit
(owner-submission verifier, exact target/data/value); (2) canonical inclusion and `safe` finality on Base; (3) the
Across transfer identity `depositId` from the receipt's own `FundsDeposited`; (4) destination chain 42161 in that event;
(5) recipient (`updatedRecipient` in the fill); (6) Arbitrum USDC as output token; (7) the fill receipt's USDC
`Transfer` to the recipient; (8) amount ≥ reviewed minimum. Provider status APIs only supply the fill transaction hash as
a hint; without a hint the router scans Arbitrum `FilledRelay` logs by `(originChainId, depositId)` with a durable cursor.

**Recovery.** Every attempt is persisted before the wallet is called; the browser stores the hash pointer; restart
reloads from storage; ambiguous submissions are discovered by nonce or observed, never resent; a second deposit (same run
or another run of the same owner) is refused while any deposit is unresolved. Temporary RPC/provider failures leave the
run where it is and are retried by observation.

**Gating.** Read-only Simulate/Review needs `GRYLOO_ROUTER=live`; owner execution additionally needs
`GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED` (the existing real-funds deployment opt-in pattern from the Jupiter
mainnet flow). Tests and browser suites use `GRYLOO_ROUTER_HARNESS=MOCKED_LOOPBACK_ONLY` only. Profile cap: 100 USDC per
run.

## 7. Tests

Unit: route canonicalization, deterministic commitment, LI.FI/Across normalization against the recorded real response
shapes, calldata decoding (both providers) and API/calldata disagreement, mutations (recipient, amount, fee, provider,
route step, approval, calldata/value, chain), quote expiry, wallet/account change, provider fallback after Review,
source confirmed but destination absent, delayed destination, restart recovery, ambiguous submission without duplicate
resubmission (same run and across runs), deadline expiry → recovery → verified refund, fill mismatch, artifact chain.
Chat/canvas semantic equivalence. PostgreSQL: full journey through the API and a fresh worker. Browser: MOCKED loopback
journey (simulate → review → approve → deposit → reload → in flight → reconciled). Existing suites unchanged.

## 8. Owner boundary

The agent sends no transaction. Deliverable status: implementation complete with MOCKED evidence and a real
`PUBLIC_READ_ONLY` preflight (live quotes from both providers, real `eth_simulateV1` of the exact calls on Base mainnet
from a public address that holds USDC, without any authority over it). `MAINNET_EXECUTED` requires the owner's own
wallet-signed run through the deployed product.

## 9. Known limitations (documented, not guessed)

* Only Across is an independently reconcilable underlying protocol; LI.FI routes through other bridges are refused.
* LI.FI publishes no quote expiry; it is derived from the decoded Across deposit and Flofi's Review TTL.
* SpokePool and LI.FI Diamond are upgradeable proxies: proxy code is pinned and the EIP-1967 implementation observed at
  Review is bound into the commitment; a change before execution invalidates the Review.
* Refund verification relies on the Across status hint for the refund transaction and verifies the USDC `Transfer` to
  the refund address on chain; without a hint the run stays `RECOVERY_REQUIRED`.
