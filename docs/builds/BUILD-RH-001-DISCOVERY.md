# BUILD-RH-001 — Robinhood Chain discovery

Status: discovery complete, 2026-10-02. Decision gate result: **C**. No
legitimate public-testnet DeFi path exists today. See
[the plan](BUILD-RH-001-PLAN.md) and [the report](BUILD-RH-001-REPORT.md).

Product naming: the product is moving to Flofi. Repository code still uses
Gryloo, and this build does not rename anything.

Method. Official Robinhood Chain documentation came first. Each claim was then
checked against a canonical protocol registry, a public RPC read or an explorer
read. All reads were `eth_chainId`, `eth_blockNumber`, `eth_getCode`,
`eth_getStorageAt`, `eth_call` and explorer GET requests. Nothing was signed or
sent. `scripts/verify-robinhood-network.mjs` can repeat the RPC part
read-only; its committed output is
[BUILD-RH-001-READONLY.json](BUILD-RH-001-READONLY.json).

## 1. Network configuration (official)

Sources: <https://docs.robinhood.com/chain/connecting>,
<https://docs.robinhood.com/chain/add-network-to-wallet>,
<https://docs.robinhood.com/chain/deploy-smart-contracts>.

| Property | Robinhood Chain | Robinhood Chain Testnet |
| --- | --- | --- |
| Chain ID | 4663 (`0x1237`) | 46630 (`0xb626`) |
| CAIP-2 | `eip155:4663` | `eip155:46630` |
| Type | Arbitrum Orbit (Nitro) L2 on Ethereum, blob DA | Same, settling to Ethereum Sepolia |
| Native gas | ETH (18 decimals) | ETH (18 decimals) |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` (+ delayed backup feed) | `wss://feed.testnet.chain.robinhood.com` |
| Keyed providers | Alchemy, Chainstack, QuickNode, Blockdaemon, dRPC, Validation Cloud, GlobalStake | Alchemy and others |

Execution facts that matter for Gryloo (from "Differences from Ethereum", "Gas
& Fees" and "Transaction Finality"):

- In Solidity, `block.number` is an L1 estimate. JSON-RPC receipts and blocks use
  L2 numbers, so the reconciler must use RPC block data, not contract-visible
  `block.number`.
- A fee is L2 execution plus an L1 data fee. Both are paid in the transaction's
  gas, and `eth_estimateGas` includes the L1 part. As on Base, the network cost
  shown at Review must come from the provider estimate, not `gasUsed × base fee`.
- Ordering is first-come-first-served by the sequencer. A priority fee does not
  reorder transactions.
- A sequencer soft confirmation is sub-second. Hard finality comes after
  posting to Ethereum and Ethereum finality, about 13 minutes after posting.
  Gryloo's existing "confirmed receipt" semantics map to soft confirmation;
  higher assurance would need an L1-posting check.
- **Sequencer-level compliance screening.** A transaction tied to a sanctioned
  address is excluded and "appears as though the event never occurred". For
  recovery this means a handed-off transaction can have no receipt and never
  appear. The existing rule already covers this: an unknown result is observed
  only and never resubmitted.

## 2. Testnet RPC

Working. On 2026-10-02 the public RPC returned `eth_chainId = 0xb626`,
`net_version = 46630`, head ≈ 127,358,877, and served `eth_getCode`,
`eth_call` and `eth_getStorageAt`. A request with Python's default
`User-Agent` got HTTP 403; curl-style agents were accepted. The read-only
verifier sends an explicit `user-agent`.

Mainnet RPC also works: `eth_chainId = 0x1237`, head ≈ 77,835,312.

## 3. Explorers

- Testnet Blockscout works in a browser and through its scripted API
  (`/api/v2/...` and the Etherscan-compatible `/api?module=...`). All
  testnet provenance below came from this API.
- Mainnet Blockscout works in a browser, but its API is behind a Cloudflare
  challenge for scripted clients ("Just a moment…"). Mainnet provenance below
  therefore uses RPC `eth_getCode` plus canonical registries, not explorer
  creator data. Any future mainnet reconciler must not depend on the mainnet
  explorer API.

## 4. Wallet compatibility (EIP-1193)

Official docs say Robinhood Chain works with standard EVM wallets (MetaMask
and others) and give manual network parameters. Robinhood Wallet supports it
on mobile. Nothing is non-standard: `wallet_addEthereumChain` takes chain ID
`0xb626`, native currency ETH/18, the public RPC and the explorer URL, and
`wallet_switchEthereumChain` uses the hex chain ID. Transactions are standard
EIP-1559 type-2 with chain ID 46630 or 4663. Gryloo's single shared injected
wallet store (`build009-wallet-store`) can therefore switch to Robinhood
Testnet the same way it switches to Base Sepolia: switch, then add on `4902`,
then switch again and read back `eth_chainId`. No second wallet subsystem is
needed.

## 5. Uniswap

**Mainnet (4663): canonical, verified.** Uniswap's per-chain deployment page
says "Robinhood Chain is an Arbitrum Orbit L2 (chainId `4663`)". The unified
registry `https://developers.uniswap.org/deployments.json` (v1.0.0, generated
2026-09-22, source `Uniswap/contracts@a677c0d`) has 49 Robinhood Chain records,
all with `chainId: 4663` and `env: mainnet`. RPC shows code at every checked
address:

| Contract | Address | Code on 4663 |
| --- | --- | --- |
| UniswapV3Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | 24,535 B |
| SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` | 24,497 B |
| QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | 8,273 B |
| V4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | 24,009 B |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 B |
| UniversalRouter (registry) | `0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99` | 24,546 B |

Registry discrepancy: the per-chain v3 page lists UniversalRouter as
`0x8876789976decbfcbbbe364623c63652db8c0904`, while `deployments.json` lists
`0x06AfBA43…` and `0x204FAca1…` (v2.1.2). All three have code on mainnet.
No mainnet path is built, so this only needs resolving before a future mainnet
build.

**Testnet (46630): no canonical deployment.**

- `deployments.json` has **zero** records for 46630. It does list other
  testnets (Sepolia 11155111, Base Sepolia 84532, Arbitrum Sepolia 421614,
  Unichain Sepolia 1301), so the omission is not a registry-wide gap.
- Robinhood's official Protocol Contracts page lists no DEX for testnet.
- RPC on 46630: no code at the mainnet V3 Factory, SwapRouter02 or QuoterV2
  addresses, the registry UniversalRouters, or the V2 factory.
- Some mainnet Uniswap addresses **do** have code on testnet: V4 PoolManager
  `0x8366…`, V4 Quoter, StateView, PositionDescriptor and UniversalRouter
  `0x8876…`. The testnet explorer shows they were created through the public
  deterministic-deployment proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`
  by an unattributed EOA `0x8328F51d97B185eDAc241e4323c6EaF96eB897ce` on
  2026-07-10. The PoolManager runtime code is byte-identical to mainnet. The
  UniversalRouter code differs from mainnet in only 34 bytes: the embedded
  chain ID (`0x1237` vs `0xb626`) and one chain-bound 32-byte value. That is a
  replay of the **mainnet** init code. It still embeds mainnet WETH
  `0x0Bd7…AD73`, **which has no code on testnet**, and the testnet copy is
  unverified.
- More than 1,000 pools have been initialized permissionlessly on that testnet
  PoolManager, almost all pairing native ETH with unattributed tokens. The
  same EOA deployed unverified "White Hat (WH)" ERC-20s and initialized pools
  for them.

Conclusion: anyone can replay public CREATE2 init code, and that is not
provenance. No Uniswap or Robinhood source attests these testnet contracts,
the router is misconfigured for testnet WETH, and the pool assets are
unattributed. **Option A fails the provenance bar.**

## 6. Morpho

**Mainnet: canonical.** Morpho's SDK registry
(`morpho-org/sdks` `packages/morpho-ts/src/addresses.ts` and `chain.ts`,
commit `88e3383`) defines `ChainId.RobinhoodMainnet = 4663` with Morpho Blue
`0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` (deployment block 286), the
AdaptiveCurveIrm, Vault V2 factory, bundlers and `wNative = 0x0Bd7…AD73`.
Morpho Blue has 15,582 B of code on 4663. Public reporting says Robinhood
Earn deposits into a Morpho vault on Robinhood Chain.

**Testnet: none.** The registry has no Robinhood testnet chain ID, and Morpho
Blue's mainnet address has no code on 46630. Gryloo also has no Morpho adapter
today. **Option B via Morpho fails.**

## 7. Bridges and aggregators already in Gryloo

| Provider | Gryloo adapter | Robinhood mainnet | Robinhood testnet |
| --- | --- | --- | --- |
| Across | `across.direct` (Base USDC → Arbitrum USDC only) | 38 routes into 4663, including Base, Arbitrum and Ethereum | `testnet.across.to/api/available-routes` returns `[]` for 46630 in both directions |
| LI.FI | `lifi.rest` (Base → Arbitrum USDC only) | `li.quest/v1/chains` lists 4663 "Robinhood Chain", mainnet | LI.FI has no testnets |
| Uniswap | `uniswap.v3` (Base fork, Base Sepolia) | See §5 | None |
| CoW, Jupiter, Orca, Aave | Base or Solana only | No (Aave address book has no Robinhood entry) | No |

The live Across route table matters for future bridging. Base, Arbitrum and
Ethereum **USDC arrive on Robinhood as USDG** `0x5fc5…d168`; WETH and ETH map to
Robinhood WETH `0x0Bd7…AD73`. Outbound USDG maps to USDC on those chains.

Other routes the official Bridging page lists, not used by Gryloo: the
Arbitrum canonical bridge (deposits about 10 min, withdrawals 7 days),
LayerZero/Stargate OFT, Chainlink CCIP/Transporter, Relay and 0x.

**Option B via Across or LI.FI fails**, because neither offers a Robinhood
testnet route.

## 8. Canonical testnet tokens

From Robinhood's official Protocol Contracts page, testnet column:

- WETH `0x7943e237c7F95DA44E0301572D358911207852Fa`. This is a
  TransparentUpgradeableProxy (2,202 B), the canonical L2 WETH of the
  Arbitrum token bridge.
- Bridge infrastructure: L2 Gateway Router
  `0x77bF00A6A90c600f214b34BAFBB7918c0cF113A8`, L2 Multicall
  `0xa432504b6F04Cafe775b09D8AA92e8dbe41Ec7a8`, and Permit2 at its universal
  address.

That is the whole canonical testnet asset set: native ETH from the faucet,
plus WETH. **No canonical testnet stablecoin or USDG is documented.** An
explorer search finds dozens of permissionless lookalikes. For example,
"USDG" has many results, including `0x915E…03ec` (unverified), "Mock USDG"
and "USD Gold (testnet)". "WETH" has `0x33e4…0B94`, which is verified but
created by an unrelated EOA and is not the official one. "TSLA" has
`0xC9f9…Bd4E`, a verified `Stock` BeaconProxy with about 227k holders and
likely faucet-distributed, but not in any official registry. None meet the
provenance bar, so Gryloo will not hard-code any of them.

## 9. Can a safe, valueless public-testnet financial workflow execute?

**No.** The only canonical testnet assets are ETH and WETH, and there is no
canonical protocol to act on them. Wrapping ETH into WETH is not an existing
Gryloo action and is not DEX, lending or bridge behavior. Using the replayed
V4 contracts with unattributed tokens would be exactly the "fake testnet DEX"
the gate forbids. So would deploying a local Uniswap and presenting it as an
integration.

## 10. Faucet

The official faucet is `https://faucet.testnet.chain.robinhood.com`, as
referenced from official materials and providers. It is behind a Vercel
browser checkpoint, and scripted requests get HTTP 429, so its current
dispensed assets could not be confirmed headlessly. Other references say it
dispenses testnet ETH (some third-party pages say it also dispenses test stock
tokens; unverified). Bridging Sepolia ETH through the canonical Arbitrum
bridge (testnet L1 contracts are on the official page) is a second funding
route.

## 11. Robinhood Stock Tokens (read-only findings)

- **Registry/API**: `GET https://api.robinhood.com/rhj/assets` returned 194
  assets, all `ASSET_STATUS_ACTIVE`, **all deployed only on chainId 4663**.
  There are no testnet stock tokens in the official registry. Other endpoints
  are `/rhj/prices/{symbol}` (raw underlying bid/ask, **not**
  multiplier-adjusted, 15 s cache) and `/rhj/corporate-actions`. Each asset
  carries `id` (onchain `uid()`), `tokenSymbol`, `deployments[]` (with
  `chainId`, `contractAddress`, and in live data `itnEnabled` and
  `atomicEnabled`), `currentMultiplier`, `pendingMultiplier` and `status`.
- **ERC-20**: standard ERC-20, 18 decimals, behind a beacon proxy. The
  mainnet TSLA `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` has decimals 18 and
  beacon `0xe10b…1b00`. The tokens also implement ERC-8056:
  `uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `balanceOfUI()`,
  `totalSupplyUI()`, `UIMultiplierUpdated` and `TransferWithScaledUI`. Raw
  balances never rebase.
- **Pricing**: one Chainlink AggregatorV3 feed per token, listed for "Robinhood
  Chain Mainnet" only. The feed price is the Total Return Value (underlying ×
  multiplier). Feeds update 24/5. Integrators should check staleness, the L2
  sequencer-uptime feed and the advisory `oraclePaused()` flag during
  corporate actions.
- **Multiplier and corporate actions**: 45 of 194 assets have a multiplier
  above 1.0 and none below. One (CRWD) is at 4.0. A future swap, collateral or
  valuation workflow must bind `uiMultiplier()` (and any pending value with
  its `effectiveAt`) into Review, and must not mix REST `/prices` with onchain
  feed values without applying the multiplier.
- **Trading status and jurisdiction**: `tradingCapabilities` shows
  tradability per session (`market`/`extended`/`overnight` ×
  `whole`/`fractional`). The live payload shape differs from the
  `stock-token-apis` docs, so a parser must accept the live shape. Minting and
  burning happen only in a weekly tokenization window and only for KYB'd
  Authorized Participants. Stock Tokens are not offered to US persons and are
  restricted in Canada, the UK, Switzerland and elsewhere. Any execution
  workflow needs an explicit eligibility gate, which is out of scope here.
- **Liquidity venues**: RFQ (0x, 1inch Fusion, LI.FI) at launch, AMMs such as
  Uniswap, a proprietary AMM (Rialto), and the Lighter orderbook.

Nothing in this build executes or catalogs Stock Tokens.

## 12. Existing architecture inspected

| Area | Where | Robinhood fit |
| --- | --- | --- |
| Shared EVM injected wallet | `apps/reference-dapp/src/state/build009-wallet-store.tsx` (switch, add on 4902 for Base Sepolia only, read-back) | Add Robinhood identity; testnet switching uses the same mechanism |
| Wrong-chain detection | `apps/reference-dapp/src/state/capability-store.tsx` → `resolveWorkflowCapability` (`WRONG_WALLET_CHAIN`) | A wallet on 46630 or 4663 currently maps to `null`; it needs a precise CAIP-2 mapping |
| Execution capability registry | `packages/action-registry/src/execution-capabilities.ts` | Rows are exact `(action, adapter, chain, environment)`. A Robinhood row is legitimate only once an adapter path exists |
| Authoring validation | `reference-registry.ts` `allowedChainRefs`, linter review contexts | Robinhood stays out until an executable action exists |
| Base Sepolia public swap (TESTNET_EXECUTED) | `server/public-testnet-service.ts`, `state/public-testnet-store.tsx`, Base Sepolia profile in `domain/public-testnet-swap.ts` | The model for a future Robinhood swap: exact profile, durable PREPARED, one submission, observe-only unknowns, independent reconciliation |
| Base read-only observation | `reference-linter/src/base-observation.ts` + `server/base-rpc.ts` | The model for an allowlisted, pinned, read-only RPC transport |
| Compiler, simulation, review | `reference-compiler/*` (per-build profiles) | Chain-neutral IR; profiles are per chain |
| Executor, journal, recovery | `reference-executor/*`, `workflow-contracts/execution-journal.ts` | Chain-neutral |
| Reconciler, Evidence Bundle | `reference-reconciler/*`, `workflow-contracts/evidence-bundle.ts` (`MOCKED`, `FORK_REPRODUCED`, `TESTNET_EXECUTED`, `MAINNET_EXECUTED`) | Unchanged |
| LI.FI and Across | `server/lifi-adapter.ts`, `server/across-adapter.ts` (literal types Base 8453 → Arbitrum 42161, USDC) | A Robinhood route needs a new profile, and USDC → USDG makes it cross-asset |

## 13. What can truthfully be claimed today

| Claim | Status |
| --- | --- |
| Robinhood Chain mainnet and testnet network identity (chain ID, CAIP-2, RPC, explorer) | Verified against official docs and live RPC |
| Injected-wallet identification and testnet switching/adding | Implemented and tested with stubbed EIP-1193 providers; no real wallet run |
| Read-only network verification (chain ID, head freshness, code at canonical addresses, absence of a canonical testnet DEX) | Implemented and run against public RPC (`PUBLIC_READ_ONLY` observation, not an evidence level) |
| Any Robinhood financial action (swap, lending, bridge) on testnet | **Not possible.** No canonical deployment exists |
| Any Robinhood mainnet financial action | Not enabled. Mainnet execution is out of scope |
| Evidence maturity for any Robinhood action | None. No `MOCKED`, `FORK_REPRODUCED` or `TESTNET_EXECUTED` claim is made |

What is missing externally to unlock option A: a Uniswap deployment (v3
SwapRouter02 + QuoterV2 + Factory, or v4 with a correctly configured router)
for chain ID 46630, published in Uniswap's `deployments.json` or on Robinhood's
official Protocol Contracts page. It also needs at least one canonical,
documented, valueless ERC-20 on testnet, such as a testnet USDG or test stock
token in `rhj/assets`, with a pool paired with the official testnet WETH.
The same applies to Morpho (a Morpho registry entry for 46630) and Across (any
46630 route on `testnet.across.to`).
