# BUILD-CLOUD-001 — Capability migration matrix

Date: 2026-10-03. Inventory of every user-facing workflow capability, from the code (`apps/reference-dapp/src/app/*-action.ts`,
`src/server/*`, `src/state/*`) and the build records (`docs/STATUS.md`, `docs/builds/*`). Evidence levels are the
highest **recorded** level; nothing here upgrades them. "Cloud-backed" means the capability's execution state, leases,
reconciliation and evidence run on the BUILD-CLOUD-001 PostgreSQL/API/worker architecture.

## Status summary

| Gate | Status |
| --- | --- |
| **A. Cloud platform** | **Complete.** The runtime is generic: one storage port (`DurableLogStore`/`LeaseStore`), one PostgreSQL implementation, one outbox/queue, one worker loop, one API dispatcher, one EvidenceStore. Each flow plugs in a projector, an observation rule and a transport. No architecture is duplicated per protocol. |
| **B. Capability migration** | **Complete for every capability with a legitimate real-network execution path, except BUILD-013 lending composition** (owner-open PR #48; see blocker). Six flows are cloud-backed: Base Sepolia swap, Aave Supply/Borrow/Repay/Withdraw, Robinhood transfer, Solana Devnet Orca swap, Solana Devnet Orca liquidity, Jupiter mainnet-beta swap. |
| **C. Public capability validated online** | **None yet.** No deployment exists (owner credentials required). Validated locally: every cloud flow end-to-end on PostgreSQL with MOCKED chains; live **read-only** preflights through the real API process for the Base Sepolia swap (Base Sepolia block 47,611,431) and the Solana Devnet Orca swap/liquidity (Devnet slot 506,833,584). |
| **D. Not yet public** | All MOCKED/FORK_REPRODUCED capabilities below; each lists its missing step. |

## Matrix

Legend: FS = depends on the local filesystem; LH = depends on localhost/Anvil/WSL processes.

| # | Capability | Adapter / protocol | Chain | Latest recorded evidence | User-facing | Cloud-backed | FS | LH | Browser wallet path | Public-network execution path | Cloud work | Safe to expose publicly now | Blocker / missing step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | EVM swap (public) | Uniswap v3 exact-input USDC↔WETH | Base Sepolia | TESTNET_EXECUTED (BUILD-011D-2) | yes | **yes** (`base-sepolia-swap`) | local mode only | no | yes (injected EIP-1193) | yes | done | yes, once deployed (`GRYLOO_PUBLIC_TESTNET=record`) | owner deployment + owner online acceptance |
| 2 | Aave Supply | Aave V3 | Base Sepolia | TESTNET_EXECUTED (012A) | yes | **yes** (`aave-supply`) | local mode only | no | yes | yes | done | yes, once deployed (`GRYLOO_SUPPLY_TESTNET=live`) | owner deployment |
| 3 | Aave Borrow | Aave V3 | Base Sepolia | TESTNET_EXECUTED (012B) | yes | **yes** (`aave-supply`) | local mode only | no | yes | yes | done | yes, once deployed | owner deployment |
| 4 | Aave Repay | Aave V3 | Base Sepolia | TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED (012C) | yes | **yes** (`aave-supply`) | local mode only | no | yes | yes | done | yes, once deployed | owner deployment |
| 5 | Aave Withdraw | Aave V3 | Base Sepolia | TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED (012D) | yes | **yes** (`aave-supply`) | local mode only | no | yes | yes | done | yes, once deployed | owner deployment |
| 6 | Robinhood transfer | native self-transfer | Robinhood Chain Testnet | TESTNET_EXECUTED / INDEPENDENTLY_RECONCILED (RH-DEMO-001) | yes | **yes** (`robinhood-transfer`) | local mode only | no | yes | yes | done | yes, once deployed (`GRYLOO_ROBINHOOD_TESTNET=live`) | owner deployment |
| 7 | Solana swap (Devnet) | Orca Whirlpools `swap_v2` | Solana Devnet | DEVNET_EXECUTED (BUILD-DEMO-001) | yes | **yes** (`solana-devnet-swap`) | local mode only | no | yes (Solana wallet standard) | yes (owner-signed bytes relayed once by the API) | done | yes, once deployed (`GRYLOO_SOLANA_DEVNET=live`) | owner deployment |
| 8 | Solana liquidity (Devnet) | Orca Whirlpools open/decrease/exit | Solana Devnet | DEVNET_EXECUTED (BUILD-015) | yes | **yes** (`orca-liquidity`) | local mode only | no | yes (+ client-side position-mint key) | yes | done | yes, once deployed (`GRYLOO_SOLANA_DEVNET=live`) | owner deployment |
| 9 | Solana swap (mainnet-beta) | Jupiter | Solana mainnet-beta | READY_FOR_OWNER_EXECUTION (BUILD-014); never executed | yes | **yes** (`jupiter-swap`) | local mode only | no | yes | yes — **real funds** | done | Simulate/Review only (`GRYLOO_JUPITER=live`); execution stays off unless the owner sets `GRYLOO_JUPITER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED` | owner real-funds decision; no MAINNET_EXECUTED claim |
| 10 | Aave Supply → Borrow → Swap composition | Aave V3 + Uniswap v3 | Base Sepolia | MOCKED; PUBLIC_EXECUTION_BLOCKED (BUILD-013, open PR #48) | yes (harness) | no | yes (`GRYLOO_SUPPLY_JOURNAL`) | harness 127.0.0.1:8554 in tests | yes | implemented, never executed publicly | adapter: route `lending-composition-service.ts` through the same ports + one flow definition (same pattern as #2–#5) | no | **BUILD-013 is owner-open (PR #48) and must not be modified here**; migrate after PR #48 lands, then owner public acceptance |
| 11 | Local-fork swap (Mode A) | Uniswap v3 | local fork 31337 | FORK_REPRODUCED (BUILD-003F) | yes (fork env) | no | yes | **Anvil** | yes | no | none possible as-is | no | needs a separate public-network build (it is a local-fork rehearsal by design) |
| 12 | Delegated swap (Mode B, Safe + Zodiac Roles) | Safe 1.4.1, Roles 2.1.0, Uniswap | local fork 31337 | FORK_REPRODUCED (BUILD-004) | yes (fork env) | no | yes | **Anvil** + local executor key file | owner setup only | no | none possible as-is | no | uses a disposable **server-held executor key** (local only); a public version needs a separate custody/authority design build |
| 13 | CoW signed-intent swap | CoW Protocol (EIP-712) | loopback | MOCKED (BUILD-005) | yes (loopback env) | no | yes | **loopback orderbook** | yes (signature) | no | storage port + flow; real CoW orderbook integration | no | separate protocol build for the public CoW API |
| 14 | Uniswap v3 liquidity (Mode A) | Uniswap v3 positions | local fork 31337 | FORK_REPRODUCED (BUILD-006) | yes (fork env) | no | yes | **Anvil** | yes | no | none possible as-is | no | separate public-network build |
| 15 | Swap → liquidity composition (Mode B) | Safe/Roles + Uniswap | local fork 31337 | FORK_REPRODUCED (BUILD-007) | yes (fork env) | no | yes | **Anvil** + executor key | owner setup only | no | none possible as-is | no | same custody/authority design as #12 |
| 16 | LI.FI bridge | LI.FI (live read-only quotes) | Base → Optimism | MOCKED execution (BUILD-008) | yes | no | yes (`GRYLOO_BRIDGE_JOURNAL`) | no | no real send | no | storage port + flow once real execution exists | no | separate build for real bridge execution + destination reconciliation |
| 17 | Bridge → swap | LI.FI + Uniswap | Base → Arbitrum | MOCKED (BUILD-009) | yes | no | **browser localStorage** journal | no | wallet connect only | no | move journal server-side when execution becomes real | no | separate build for real execution |
| 18 | Across bridge | Across (live quote when keyed) | Base → Arbitrum | MOCKED execution (BUILD-010) | yes (default on) | no | yes (`os.tmpdir()`; ephemeral on serverless) | no | no real send | no | storage port + flow once real execution exists | MOCKED demo only — **not** durable in the cloud | separate build for real execution |
| 19 | Cross-chain liquidity + recovery | bridge + split + Uniswap v3 | Base → Arbitrum | MOCKED (BUILD-011C-1/2) | yes | no | server-side trace (in-process, MOCKED) | no | no | no | none until real | MOCKED demo only | separate build for real execution |
| 20 | Canvas / chat authoring, Simulate, Review UI | linter/compiler | n/a | MOCKED artifact chain, recorded Base observation replay | yes | n/a (stateless; served by Vercel) | canvas layout prefs in localStorage (presentation only) | no | n/a | n/a | none | yes | — |
| 21 | Recovery / reconciliation / Evidence Bundle | executor/reconciler | per flow | per flow | yes | **yes for #1–#9**: durable runs, worker reconciliation, append-only history, EvidenceStore archive with SHA-256 verification | — | — | — | — | done for cloud flows | with its flow | — |

## What a user anywhere can use from the public deployment today

**Nothing yet: no public deployment exists.** The branch's Vercel preview is behind Vercel Authentication and has no
backend. Once the owner provisions Neon, a bucket, Railway (API + worker) and Vercel, and makes the frontend public
(`docs/deploy/CLOUD.md`), a user anywhere with their own wallet could use:

- Base Sepolia Uniswap swap (USDC ↔ WETH), approval + exact swap;
- Aave V3 Supply, Borrow, Repay and Withdraw on Base Sepolia;
- Robinhood Chain Testnet native self-transfer;
- Solana Devnet Orca swap (SOL ↔ devUSDC);
- Solana Devnet Orca concentrated liquidity (open, partial decrease, exit);
- Jupiter mainnet-beta **Simulate and Review only** (execution only after the owner's explicit real-funds opt-in);

each with durable cloud state, worker reconciliation after the browser closes, restart survival and an archived,
integrity-verified Evidence Bundle. Each one still needs its own owner-signed online acceptance before it can be
called publicly validated.

**Not usable publicly** (and why): BUILD-013 lending composition (owner-open PR #48), every local-fork capability
(#11, #12, #14, #15: Anvil and, for Mode B, a server-held disposable executor key), CoW (#13: loopback orderbook only),
and the MOCKED bridge/cross-chain demonstrations (#16–#19: no real execution path exists yet).
