# BUILD-010 implementation report — direct Across bridge

Prepared from main `f455892b58561bbe740a83f1aa0837e8ac82f5e4` on `codex/build-010-direct-across` under DEC-0049. DEC-0048 records BUILD-009 as merged without inventing a post-merge CI or certification result. This BUILD-010 branch remains unmerged and is not certified.

## Scope delivered

- Base USDC → Arbitrum USDC uses the shared `asset.bridge` IR and a separate `across.direct` adapter. The server reads Across Swap API `/swap/approval` and `/deposit/status` only when an API key and integrator ID exist. Credentials stay server-side. The deterministic fixture follows the documented response structure, including `fees.totalMax.amount`, token identity, conditional approval transactions, prepared `swapTx`, gas cap and `quoteExpiryTimestamp`. Unsupported route shapes, source/destination swaps, wrong provider, assets, spenders, refund token, approval amount or expiry fail closed. The current API reference is https://docs.across.to/api-reference/swap/approval/get and status reference is https://docs.across.to/api-reference/deposit/status/get.
- The review creates schema-validated quote, artifact-set, simulation, AuthorizationPolicy and StrategyManifest artifacts. The policy and Manifest bind a FIXED `across.direct` provider; exact approval/deposit payloads, amount, minimum output, fee/gas bounds, recipient/refund address, chain/token, user slippage and expiry are bound through the quote and policy hashes. Conformance rejects replacing a FIXED LI.FI authorization with Across, and permits an `AUTHORIZED_SET` candidate only with explicit membership and matching material bounds. BUILD-010 execution itself is FIXED only.
- Financial approval, source deposit, fill, destination receipt/balance reconciliation, expiry, refund and recovery are deterministic MOCKED state transitions. An uncertain source response persists one prepared attempt; restart rechecks that attempt and cannot submit a duplicate. Source confirmation is partial until destination fill and reconciliation. No wallet signature, public-chain send or real funds occur.
- Primary workspace build/debug labels were replaced with quieter Demo mode and product-facing labels. Technical evidence remains in review and execution details. Wallet errors are concise inline feedback. Canvas Delete and Backspace dispatch semantic REMOVE for a selected deletable node; Escape clears selection. Required, locked and dependency-linked nodes are protected; text-entry and composition guards prevent destructive shortcuts.

## Local validation

- `pnpm check`: passed (typecheck, lint, build, schema export; 441 tests passed, 2 skipped).
- Focused Across quote/status normalization, canonical fixed-provider artifacts, provider immutability, durable uncertain recovery, one-attempt prevention, fill and expiry/refund tests: passed.
- Browser with the pinned headless shell: 31 default-state tests passed and 4 existing Mode B cases skipped by their gate, using a fresh runtime and checking committed snapshots without updates; 13 local-fork Mode A tests passed without snapshot updates. The direct Across restart/recheck/reconcile and canvas keyboard journeys are included in the 31.
- Local governance checker: passed against the BUILD-009 merge tree and exact BUILD-010 plan paths.
- An older BUILD-009 browser journey requires a live LI.FI quote and timed out while requesting its live LI.FI quote in this local run; the cause was not established here. Its product flow was not changed by BUILD-010. The PR-head CI result remains to be observed.

## Evidence and remaining verification

Across credentials are unavailable in this workspace. Live Across quote/status verification is pending; deterministic fixtures are used and no alternative provider was substituted. The evidence ceiling is `MOCKED`; there is no `TESTNET_EXECUTED` or `MAINNET_EXECUTED` claim. The extending-file journal is suitable for this local demo and is not a production multi-instance store. No real-funds execution or merge is authorized. Remote PR-head checks and the owner's merge decision remain separate.
