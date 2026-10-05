# BUILD-ETHEREUM-001 — Plan: Ethereum Sepolia as a first-class execution network

Date: 2026-10-05. Branch `claude/build-ethereum-001`, from `origin/main` `66d5843` (PR #60 BUILD-COPILOT-002 merged).
Runs alongside the Codex UX redesign (`codex/build-product-ux-001`, worktree `flofi-product`), which owns layout,
styling and visual components. This build owns network identity, registries, adapters, domain semantics, simulation,
execution, reconciliation, capability and evidence, plus the smallest functional UI touches needed to select the new
network.

## 1. Objective

Make Ethereum Sepolia (`eip155:11155111`) a real Flofi execution environment, not a label. The new network must inherit
the existing guarantees: Author → Quote/Read → Simulate → Manifest → Review → wallet switches to Ethereum Sepolia →
owner signs → Execute → Recover/Reconcile → Evidence. No custody, no server-side signing, no hidden execution, and no
path to Ethereum Mainnet execution.

## 2. Verified network and protocol identities (read-only, 2026-10-05)

Identity was taken from first-party sources and then checked against public chain state
(`https://ethereum-sepolia-rpc.publicnode.com`, head ≈ 11,846,500). The full record is produced by
`scripts/verify-ethereum-sepolia.mjs` into `docs/builds/BUILD-ETHEREUM-001-READONLY.json`.

| Item | Source | Value |
| --- | --- | --- |
| Network | ethereum.org networks page (Sepolia is the recommended application testnet; it defers chain IDs to Chainlist / `ethereum-lists/chains`); `ethereum-lists/chains` `eip155-11155111.json`; live `eth_chainId` `0xaa36a7`, `net_version` `11155111`, genesis `0x25a5…6dd9` | Ethereum Sepolia, chain ID 11155111 (`0xaa36a7`), native ETH (18 decimals), explorer `https://sepolia.etherscan.io` |
| Public RPC | listed in `ethereum-lists/chains`; returned `0xaa36a7`; supports `eth_simulateV1` and state overrides | `https://ethereum-sepolia-rpc.publicnode.com` (overridable server-side) |
| Aave V3 | `aave-dao/aave-address-book` `src/AaveV3Sepolia.sol` (main `c8f1011`, file last changed `4ee7b50`) | Provider `0x012b…6C9A` → `getPool()` = Pool `0x6Ae4…8951`; `getPriceOracle()` = Oracle `0x2da8…a663`; Pool `ADDRESSES_PROVIDER()` = Provider |
| Uniswap v3 | `developers.uniswap.org/deployments.json` (Uniswap/contracts `a677c0d`) | Factory `0x0227…aC1c`, NonfungiblePositionManager `0x1238…cDA52`, QuoterV2 `0xEd1f…2FB3`, SwapRouter02 `0x3bFA…e48E`; each reports `factory()` = Factory and `WETH9()` = `0xfff9…6b14` |

## 3. Decisive public-state findings

1. **Aave USDC is not usable.** A read-only `eth_simulateV1` of faucet mint → approve → `supply(USDC)` reverts with
   Aave error `51` (SUPPLY_CAP_EXCEEDED). The reserve's aToken supply (≈4.49B USDC, grown by interest at full
   utilisation) exceeds its 2B cap, and only 0.548626 USDC is available to borrow. USDT and DAI are capped the same way.
   Only WBTC and LINK accept Supply and a self-collateralised Borrow today.
2. **Owner decision (2026-10-05): the Ethereum Sepolia Aave profile uses WBTC.** WBTC reserve: id 3, 8 decimals, LTV
   70%, liquidation threshold 75%, active, not frozen or paused, borrowing enabled, no supply/borrow cap, no debt
   ceiling, eMode 0, ≈8.27M WBTC liquidity, oracle price 60,000 USD (8-decimal base unit). aToken `0x1804…EefF` and
   variable-debt token `0xEB01…ac37` match the address book and report `UNDERLYING_ASSET_ADDRESS()` = WBTC and
   `POOL()` = Pool. The Aave faucet mints WBTC permissionlessly.
3. **Sepolia Aave is v3.0, Base Sepolia Aave is v3.4.** Pool revision 1 (string error codes) versus 10. Reserve ids
   differ (Base USDC is 0, Sepolia WBTC is 3). The existing reader rejects any reserve id other than 0 and reads user
   configuration bits 0/1. Both must become profile-driven (`2·id` borrowing, `2·id+1` collateral).
4. **Uniswap USDC/WETH exists.** The Aave test USDC `0x94a9…E4C8` (6 decimals, faucet-mintable) is paired with
   Uniswap's Sepolia WETH at every fee tier. Token order is USDC = token0, WETH = token1, the same as Base Sepolia. The
   0.3% pool (`0x9799…e244`, tick spacing 60) has the deepest in-range liquidity. Testnet prices are arbitrary
   (≈39M USDC per WETH), which is why every swap and position is bounded by fresh quotes, ranges and minimums.
5. **No mainnet.** Ethereum Mainnet (`eip155:1`) may be recognised for wrong-chain detection only. It is not a switch
   target and has no capability row.

## 4. Scope

### Mandatory

| Layer | Plan |
| --- | --- |
| Network identity | `action-registry/ethereum-sepolia.ts`: network constant, EIP-3085 parameters, recognised-only mainnet constant, chain-specific asset registry (USDC, WETH, WBTC with CAIP-2 chain, address, decimals, source). |
| Wallet | `wallet/evm-networks.ts`: Ethereum Sepolia switchable (added from official parameters only after EIP-1193 `4902`), Ethereum Mainnet recognised but never switchable; existing switch → add → switch → re-read `eth_chainId` model unchanged. |
| RPC | One chain-bound read-only client: explicit expected chain id checked on every `eth_chainId` and before first use, method allowlist, timeout, 1 MiB response cap, JSON-RPC validation, bounded throttle retry, no send methods. HTTPS-only override `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL`; never a fallback to another network. |
| Aave lending profile | `AaveLendingProfile` with `reserveId`; `AAVE_V3_ETHEREUM_SEPOLIA` (WBTC); `aaveLendingProfile(chain)`. Linter, compiler (state readers, estimators, freshness checks, calls), executor types, reconcilers and evidence select the profile from the authored/reviewed chain. Hard-coded 6-decimal and reserve-0 arithmetic becomes profile-driven, with every Base Sepolia value unchanged. |
| Aave runtime | Supply service routes reads by reviewed chain; Ethereum Sepolia nonce leases are chain-qualified (Base lease names unchanged). Recovery, observation, reconciliation and evidence paths are the existing ones. |
| Native test ETH | Generalise the RH-DEMO native self-transfer profile so the same compiler/executor/reconciler serve Ethereum Sepolia as the minimal owner-execution smoke path (L1: no L2 soft-confirmation note). |
| Capability registry | `PUBLIC_TESTNET` rows on `eip155:11155111` only for implemented actions, all with evidence maturity `null`. The lending composition stays Base Sepolia only and is blocked on Ethereum Sepolia. |
| Authoring | Chat grammar (`… WBTC … on Ethereum Sepolia`), panel network option, details/summaries carry the real network and asset. |

### Targets (enabled only if public state permits, verified at build time)

* Uniswap v3 swap USDC ↔ WETH on Ethereum Sepolia: parameterise the Base Sepolia swap service by a chain profile
  (factory/pool/token/fee/tick-spacing/router/quoter identity re-verified before each quote; no L1 data fee on L1).
* Uniswap v3 concentrated liquidity USDC/WETH on Ethereum Sepolia: parameterise the Base Sepolia liquidity runtime.

### Copilot

Smallest schema addition so "Ethereum Sepolia" is a recognised network and WBTC a recognised asset. "Ethereum" alone
asks for clarification and never means Mainnet. No change to the conversational security model.

### Out of scope

Ethereum Mainnet execution of any kind, more than one Aave asset, Supply → Borrow → Swap on Ethereum Sepolia, new
protocols, autonomous agents, price monitoring, scheduling, custody, server signing, UX redesign.

## 5. Safety model (unchanged, extended)

* The authored node's CAIP-2 chain selects the profile; the profile's RPC must report that chain; the wallet must
  report it before preparation and again before the single `eth_sendTransaction`. Any mismatch stops before submission.
* Asset identity is chain + address + decimals. A Base USDC asset in an Ethereum Sepolia node, or the reverse, fails
  validation even though both display as `USDC`.
* Every protocol address is re-read for code and relationships at the reviewed block; stale reviews, changed state,
  changed nonce or changed workflow fail closed.
* Evidence maturity for every new path is `null` until an owner-signed transaction lands and is reconciled.

## 6. Validation plan

Unit tests per layer (network, wallet switching/adding, RPC guard, assets and cross-network collisions, Aave identity,
calldata, approvals, beneficiary, simulation, staleness, wrong chain, owner refusal, uncertain submission, recovery,
reconciliation, capability honesty, swap/LP if enabled, Copilot). Anvil fork of Ethereum Sepolia for an end-to-end
WBTC Supply → Borrow → Repay → Withdraw run through the real compiler, executor model and reconcilers
(FORK_REPRODUCED-level evidence, labelled as local). Full `pnpm check`, Governance-Lite, browser suites, and a
read-only public verification artefact. Owner execution, if requested, is delivered as a bounded
READY_FOR_OWNER_EXECUTION package.
