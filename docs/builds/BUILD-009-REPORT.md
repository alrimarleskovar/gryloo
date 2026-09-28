# BUILD-009 implementation report — unmerged

DEC-0047 approved this implementation from certified main `308901495790416c149976aaee747c2fd5ef9f52`. Merge and certification remain separate owner decisions. BUILD-008 and every earlier certification remain unchanged.

## Provider preflight and path

Before implementation, the live LI.FI catalog returned Arbitrum USDC `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals) and WETH `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` (18 decimals). A read-only 1-USDC LI.FI quote for chain 42161 → 42161 returned HTTP 200, an Arbitrum swap step, approval spender, bounded output and transaction request. A separate read-only Base 8453 → Arbitrum 42161 USDC quote returned HTTP 200 with a cross-chain step. These are provider availability and route data, not executed transactions.

The implemented semantic workflow has a Base USDC → Arbitrum USDC `asset.bridge` node and a separate Arbitrum USDC → WETH `asset.swap.exact-input` node linked by an output reference. The BUILD-008 Base → Optimism profile is preserved. The destination quote is requested only after MOCKED destination reconciliation, using the exact reconciled Arbitrum USDC amount. Each stage has its own quote, review hash, expiry and one-attempt lifecycle. The bridge's completed arrival is explicitly `PARTIAL_COMPLETION` until a separate destination swap completes.

## Wallet and lifecycle

The top bar detects an injected EIP-1193 provider. `eth_requestAccounts` is called only after Connect Wallet is clicked. It shows the shortened account and actual chain, states the required stage chain, requests Base or Arbitrum switching only on an explicit click and rechecks `eth_chainId` afterward. `accountsChanged`, `chainChanged` and provider `disconnect` update displayed state and retire affected pending review. Refresh starts disconnected and requires another explicit connection. Disconnect/Reset clears Gryloo's displayed wallet state only; it does not revoke provider permissions. No seed phrase, private key, wallet signature or transaction request is used in BUILD-009. The injected provider integration has no localhost dependency and runs in the production browser bundle.

The source, bridge, destination swap, recovery and reconciliation states are deterministic MOCKED. An uncertain source or swap response freezes that attempt until explicit readback; no second submission is offered. A persisted MOCKED journal survives refresh without reconnecting the wallet. Late destination arrival cannot reuse a source authorization or create a destination authorization; the swap needs a fresh live quote and bounded review. Expired or changed quotes cannot be submitted. The local journal is a browser demonstration record, not public-chain proof.

## Validation

- Focused lifecycle, authoring and LI.FI normalization tests are included in `pnpm check`, including late arrival, quote expiry, uncertain attempts, token/route validation and exact destination amount.
- `pnpm check` passed: typecheck, lint, production build, 11 schema exports and 428 passing tests (2 expected skips).
- The curated first CI browser batch with BUILD-009 passed: 31 passed, 4 expected local-fork skips. Both BUILD-009 journeys passed again after the final wallet wording change.
- The existing Mode A browser batch passed 13/13 against updated top-bar screenshots; the CoW batch passed 9/9.
- Repository governance passed with exact BUILD-009 file scope and historical certified-tree protection.

No `TESTNET_EXECUTED`, `MAINNET_EXECUTED`, real-funds or public-chain financial execution claim is made. Live wallet connection and read-only LI.FI quote/route data are real; financial evidence remains `MOCKED`. Vercel staging deployment is being prepared separately; this report makes no live staging smoke-test claim.
