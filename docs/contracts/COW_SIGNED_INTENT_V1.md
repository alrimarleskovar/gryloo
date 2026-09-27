# BUILD-005 CoW signed-intent local profile

This is an additive adapter profile for `asset.swap.exact-input` and `SIGNED_INTENT`. The existing v1 schemas and direct-transaction/finite-delegation profiles remain frozen. The BUILD-005 demonstration is **MOCKED**: a deterministic orderbook bound to loopback state, a disposable injected test wallet, and scripted receipts, trades, balances and allowances. It does not contact CoW, a public RPC, a public chain or a production wallet.

## Capability and review

Capability discovery checks one Base (`eip155:8453`) USDC/WETH exact-input swap, a positive native-unit amount and a workflow node that preauthorizes `cow-protocol`. Existing Uniswap-only nodes stay valid for direct execution, but cannot be silently routed to CoW. New authoring presents both providers in the same semantic swap IR. CoW selection fixes the provider in the Authorization Policy and Manifest. Any semantic edit or provider switch requires a new quote, simulation, Manifest and signature.

The loopback quote uses a scripted 1 WETH = 1,000 USDC rate and the authored slippage minimum, with 60-second quote freshness and a five-minute order deadline. The quote, artifact set, simulation, policy, Manifest and `SIGNED_INTENT` plan carry canonical hashes. The signed order's `appData` commits the exact Manifest, quote and workflow hashes. The UI reviews the owner, receiver, token addresses, native amounts, minimum output, zero protocol fee in the signed order, settlement domain, allowance spender, expiry, order UID, Manifest and limitations. Solver fees, gas, fill probability, public liquidity and actual allowance state are not modeled or certified.

## Signature and posting

The EIP-712 domain is `Gnosis Protocol`, version `v2`, chain ID 8453 and settlement verifying contract `0x9008d19f58aabd9ed0d60971565aa8510560ab41`. The local profile signs a sell order with `partiallyFillable=false`, `feeAmount=0`, `erc20` sell/buy balances and owner as receiver. The order UID is digest + owner + `validTo`. The disposable injected EIP-1193 test wallet is checked for chain and account immediately before `eth_signTypedData_v4`. The server independently recovers the EOA signer and checks the order against the Manifest before posting. The service persists `SIGNED` and an fsynced `POSTING` attempt before transport transmission. Only one attempt per UID is allowed.

A timeout, lost response, 5xx equivalent or process restart is `POST_RESULT_UNKNOWN`. Recovery performs UID lookup only; a missing order or failed lookup never authorizes speculative reposting. The loopback orderbook and journal persist to a disposable runtime directory, and browser reload restores unfinished orders from that journal. No private key is stored in the repository or DApp server.

## Tracking, cancellation and evidence

Tracking distinguishes posted, open, partial, fulfilled, expired, cancellation requested and cancelled states. A supported cancellation is a separate `OrderCancellations` EIP-712 signature. Request acceptance is not cancellation confirmation; a subsequent lookup determines the result, including a late fill race. Fulfilled orders require reconciliation before any `RECONCILED` label. The reconciler checks UID, owner, receiver, receipt success, trade/receipt transaction identity, token deltas, fee, minimum output and allowance direction. Missing observations are `INCONCLUSIVE`; contradictions are `DIVERGENT`. The evidence bundle is explicitly `MOCKED` and identifies scripted receipt/trade/balance provenance. No public-chain or production certification follows from it.

The adapter state machine and append-only local order journal are implementation-level additions. Frozen v1 journal enums are not widened. The additive compatibility vector `tests/compatibility/v1/cow-signed-intent-vectors.json` pins digest, UID and cancellation digest without a secret or public order. Existing BUILD-003 and BUILD-004 evidence remains limited to its recorded local-fork scope.
