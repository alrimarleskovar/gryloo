# BUILD-013 Canvas authoring and cancelled preparations

The Canvas exposes the existing canonical semantic graph as **Aave Supply → Aave Borrow → Uniswap Swap**. Selecting each node opens its own amount or slippage inspector. WETH stays the fixed output asset. Borrow amount edits regenerate the same canonical IR, including the exact `OUTPUT_REFERENCE` from `lending-borrow.borrowed-amount` to `lending-swap.amount-in` and its matching maximum input.

The Supply → Borrow edge projects the existing dependency and HF ≥ 2 policy checkpoint. It adds no semantic checkpoint node or transaction. POOL_APPROVAL and ROUTER_APPROVAL remain generated execution-plan steps. The toolbar expands the existing constructor's three nodes; the previous whole-composition form is retained only as a collapsed compatibility template. All authoring edits still require proposal acceptance and invalidate previous authority.

Reload restores the exact validated durable run's IR into an untouched initial Canvas. It does not restore over an edited workflow, create a Review, or grant authority. No journal or persistence schema changes.

Proven `CANCELLED` / `notSubmitted=true` preparations are displayed in a separate historical section. They stay in the durable record but cannot appear as the active plan status. Fresh Simulate uses the existing `refreshReview` service for an unchanged run with historical attempts, preserving the run ID and its nonce/economic reservations. Unresolved submissions still block; completed checkpoints do not repeat; this creates no automatic retry or wallet request. A new Review and explicit owner click remain mandatory.

No compiler, lending service, provider, fee policy, contract identity, health constraint, simulation, recovery, or reconciliation implementation changes. The public path retains the complete sequential `eth_simulateV1`, `validation=true`, no overrides, exact principals, minimum output, pinned-state/funding/nonce checks, immutable fee ceilings and Review TTL.

Validation covers individual Canvas edits/linkage, exact durable IR recovery, two historical cancellations followed by a fresh Review and one new preparation, duplicate prevention, and the existing complete lending and MetaMask provider regressions. Public browser verification is recorded separately after rebuilding the real DApp with Alchemy and the canonical journal; no owner execution is performed by the agent.
