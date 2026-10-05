# BUILD-ETHEREUM-001 — Report: Ethereum Sepolia as a first-class execution network

Date: 2026-10-05. Branch `claude/build-ethereum-001` from `origin/main` `66d5843` (PR #60 merged). Plan:
[BUILD-ETHEREUM-001-PLAN.md](BUILD-ETHEREUM-001-PLAN.md).

## 1. Status

**IMPLEMENTATION COMPLETE — READY_FOR_OWNER_EXECUTION. No public transaction was made.** Ethereum Sepolia
(`eip155:11155111`, `0xaa36a7`) is now a `PUBLIC_TESTNET` execution network for Aave V3 WBTC Supply / Borrow / Repay /
Withdraw, the native test-ETH self-transfer, the Uniswap v3 USDC ↔ WETH swap and Uniswap v3 USDC/WETH concentrated
liquidity. Every path keeps the existing model: Author → Read → Simulate → Review → the owner's wallet on 0xaa36a7 →
owner signature → Execute → Recover / Reconcile → Evidence. Ethereum Mainnet is recognised only to stop a wallet that is
on it; it is never a switch target, never added, and has no capability row.

| Evidence | Level | Where |
| --- | --- | --- |
| Identities and relationships on public Ethereum Sepolia | `PUBLIC_READ_ONLY`, 47/47 checks, block 11,848,941 | [READONLY.json](BUILD-ETHEREUM-001-READONLY.json) |
| Full lifecycle on official contracts (Aave ×4, transfer, swap, liquidity) | `MOCKED` (local Anvil fork, block 11,849,026), 7/7 reconciled | [FORK-REHEARSAL.json](BUILD-ETHEREUM-001-FORK-REHEARSAL.json) |
| Services, reconcilers, wallet and Copilot | `MOCKED` unit and browser suites | §7 |
| Owner-signed public execution | **none** (`TESTNET_EXECUTED` not claimed) | [owner package](BUILD-ETHEREUM-001-OWNER-EXECUTION-PACKAGE-AAVE-WBTC-SUPPLY.json) |

## 2. Network

* `action-registry/ethereum-sepolia.ts`: Ethereum Sepolia (chain 11155111, Sepolia ETH 18 decimals, genesis
  `0x25a5…6dd9`, explorer `https://sepolia.etherscan.io`, default RPC `https://ethereum-sepolia-rpc.publicnode.com`),
  EIP-3085 add-chain parameters, a chain-specific asset registry (USDC, WETH, WBTC with chain, address, decimals,
  issuer, source) and `ETHEREUM_MAINNET` (`executable: false`).
* Wallet (`wallet/evm-networks.ts`): Ethereum Sepolia is switchable and is added only from those known parameters after
  an EIP-1193 `4902`; then switch again and re-read `eth_chainId`. Ethereum Mainnet is recognised (labelled) but never
  switchable or addable. Switching never signs or sends (browser-tested).
* Read RPC: one chain-bound client per profile. `eth_chainId` must equal the expected chain before use, otherwise
  `*_WRONG_CHAIN`; method allow-lists, timeouts and response-size caps as before. The only override is
  `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL`, HTTPS-only. There is no fallback to another network. The browser never receives a
  key or a provider secret.
* Services route reads by the reviewed chain (`rpcs` keyed by CAIP-2). An unconfigured network fails closed
  (`SUPPLY_NETWORK_UNAVAILABLE`, `TRANSFER_NETWORK_UNAVAILABLE`, `PUBLIC_NETWORK_UNAVAILABLE`,
  `UNISWAP_NETWORK_UNAVAILABLE`). Owner-nonce leases on Ethereum Sepolia are chain-qualified
  (`eip155-11155111-<owner>-<nonce>`); Base Sepolia and Robinhood lease names are unchanged, so existing journals
  stay valid and a nonce on one chain never blocks the same nonce on another (unit-tested).

## 3. Aave V3 (WBTC)

* **Asset decision.** Public state made USDC, USDT and DAI unusable: each reserve is above its supply cap (USDC aToken
  supply ≈ 4.50B against a 2B cap, `capReached: true` in the read-only report). The owner chose WBTC (2026-10-05):
  reserve id 3, 8 decimals, active, not frozen or paused, borrowable, no supply cap.
* **Profile, not a copy.** `AaveLendingProfile` (Base Sepolia USDC: reserve 0, 6 decimals, OP Stack `l1Fee`; Ethereum
  Sepolia WBTC: reserve 3, 8 decimals, no `l1Fee`). Linter, compiler (state readers, estimators, freshness checks,
  calldata), executor, reconcilers and evidence select it from the authored or reviewed chain. Reserve-id and decimals
  arithmetic (user-configuration bits `2·id` / `2·id+1`, base-currency scale) is profile-driven; Base values are
  unchanged. An asset must match the profile by chain, address and decimals: Base USDC in an Ethereum Sepolia node, or
  the reverse, is rejected even though both are "USDC".
* Sepolia's Aave is v3.0 (Base Sepolia is v3.4). The reconcilers already accept both rounding modes; the fork run
  confirms Supply, Borrow, Repay and Withdraw reconcile against the real v3.0 code.
* **MetaMask relayed submissions.** The Supply/Borrow/Repay/Withdraw reconcilers pin the runtime code of the MetaMask
  Delegation Framework. On Ethereum Sepolia the DelegationManager and EIP7702StatelessDeleGator differ from the Base
  Sepolia pins by exactly 35 bytes: the EIP-712 cached chain id and cached domain separator. A unit test derives the
  Ethereum Sepolia code from the captured Base Sepolia code by recomputing only those immutables, and checks the result
  against the new pins. The two enforcers are byte-identical. Pins are now per chain (`SUPPLY_METAMASK_CODE_HASHES`);
  any other chain, Mainnet included, has none and fails closed.
* The Supply → Borrow → Swap composition stays Base Sepolia only (capability exactness check and Copilot both refuse it
  on Ethereum Sepolia).

## 4. Uniswap v3

* Swap: `ETHEREUM_SEPOLIA_SWAP` profile for the existing public swap service (USDC/WETH 0.3% pool `0x9799…e244`, tick
  spacing 60, QuoterV2 and SwapRouter02 from the official registry). Factory, pool, token and fee identity are
  re-verified before each quote; a provider on another chain (Base or Mainnet), another fee tier or an L1 receipt
  carrying `l1Fee` fails closed. Authored from chat (`swap 2 USDC to WETH on Ethereum Sepolia slippage 50 bps`) or the
  Copilot.
* Concentrated liquidity: the Base Sepolia liquidity runtime is bound per profile (`uniswapLiquidityProfile`). The
  Ethereum Sepolia profile has fee 3000, tick spacing 60, no GasPriceOracle (L1 fee bound 0), its own code pins, and a
  chain-qualified nonce lease. The linter derives usable ticks from the spacing (±887,220 at 60); a Base-spacing range,
  Base tokens or the 0.05% fee tier are refused on Ethereum Sepolia.
* No pool was created, and no address came from a tutorial. Every address comes from `deployments.json` and was checked
  on chain (relationships, `getPool`, token order, fee, spacing, code SHA-256).

## 5. Native transfer

The RH-DEMO self-transfer is now profile-driven (`NativeTransferProfile`): Robinhood Chain Testnet (L2, soft
confirmation) and Ethereum Sepolia (L1, 3 confirmations, reorg-window note). Per-network enable flags:
`GRYLOO_ROBINHOOD_TESTNET=live`, `GRYLOO_ETHEREUM_SEPOLIA_TRANSFER=live`.

## 6. Safety

* AI is never financial authority. The Copilot schema adds `ETHEREUM_SEPOLIA`, `ETHEREUM` and `WBTC`. "Ethereum" without
  Sepolia, including "Ethereum mainnet", always produces a clarification ("Flofi never uses Ethereum Mainnet…"). This
  holds even if the model claims Ethereum Sepolia. Aave assets are bound to their single deployment (USDC → Base
  Sepolia, WBTC → Ethereum Sepolia). Uniswap liquidity no longer defaults to Base Sepolia because two networks now
  support it. Answers describe steps from their own IR fields (asset, network, 0.3% pool).
* No key, signing or sending in Flofi. The fork rehearsal signs only with a fresh disposable key (mode 0600 under
  `/tmp`, deleted at the end) and sends only to the loopback Anvil (checked before each send). Public reads use read
  methods only.
* Fail-closed coverage (unit unless noted): wallet on Base Sepolia during an Ethereum Sepolia Review (browser);
  wallet on Ethereum Mainnet (browser, Aave and transfer); wallet moved after Review (browser); RPC on the wrong chain
  (Base, Mainnet) for Aave, transfer, swap and liquidity; asset from another chain; protocol without code; protocol
  identity or code change; changed fee tier; stale simulation / Review; L1 receipt carrying `l1Fee`; unconfigured
  network; unpinned MetaMask chain.

## 7. Tests and validation

All local runs were on this branch at its final working tree (pinned Node 24.21.0, pnpm 11.22.0, Anvil 1.8.3).

* `pnpm check`: typecheck, lint, build and `schemas:check` (11 schema exports verified) pass. Unit tests: **185 files
  passed, 2 skipped; 1,795 tests passed, 2 skipped**. The 2 skips are environment-gated and predate this build.
* New unit coverage:
  * action-registry Ethereum Sepolia (11)
  * compiler (9), linter (3)
  * lending service: WBTC lifecycle, fail-closed cases, MetaMask pin derivation (9)
  * transfer (3), swap (4), liquidity (6)
  * read RPC guard (10)
  * authoring and Copilot answers (12)
  * Copilot V1 Ethereum cases (3)
  * Copilot eval: 14 new conversations, **212 cases in total**, with zero safety-invariant violations
* Browser (Playwright, MOCKED loopback harnesses), run in a private network namespace because port 3000 was held by
  another worktree:

  | Group | Result |
  | --- | --- |
  | default | 51 passed, 4 skipped, **2 failed** (`build009.spec.ts`: needs a live li.quest quote, not reachable offline; not touched by this branch) |
  | supply / borrow / repay / withdraw + **ethereum-sepolia-supply** | 49 passed (5 new) |
  | Copilot replay | 13 passed |
  | lending composition | 17 passed |
  | Jupiter | 9 passed |
  | Solana Devnet swap + liquidity | 13 passed |
  | Robinhood transfer + **ethereum-sepolia-transfer** | 9 passed (2 new) |
  | Uniswap liquidity | 4 passed |
  | Router | 4 passed |
  | Journey | 3 passed |
  | Mode A | 13 passed |

  The visual baselines in `visual-shell.spec.ts` passed with no baseline changes. The CoW and BUILD-007 groups were not
  run locally (untouched paths).
* Fork rehearsal (`FLOFI_ETHEREUM_SEPOLIA_FORK_REHEARSAL=local node scripts/ethereum-sepolia-fork-rehearsal.mjs …`):
  7/7 reconciled at fork block 11,849,026. Gas used:

  | Transaction | Gas used |
  | --- | --- |
  | approve | 46,215 |
  | supply | 206,044 |
  | borrow | 229,021 |
  | repay | 179,244 |
  | withdraw | 210,601 |
  | transfer | 21,000 |
  | swap | 101,571 |
  | mint | 432,865 |

* Read-only public verification: 47/47 checks (§8).
* `git diff --check` is clean; no bidirectional-control characters; no secrets. The only 64-hex values added are
  transaction, bundle and code hashes. No `.tmp` or scratch files are committed.
* Governance-Lite passed on a clean `git archive` export, self-tests 17/17 (§13).

## 8. Public-chain verification

* `scripts/verify-ethereum-sepolia.mjs` (read-only; `eth_chainId`, `net_version`, `eth_getBlockByNumber`,
  `eth_getCode`, `eth_call` at one pinned block): 47/47 checks at block **11,848,941** (51 RPC requests). It covers chain
  id, net_version, genesis; Aave provider → Pool/Oracle, Pool → provider, WBTC listed, reserve id 3, aToken /
  variable-debt token relationships, 8 decimals, active/borrowable, cap headroom, oracle price; Uniswap code pins for
  factory/NPM/pool/quoter/router, `factory()`/`WETH9()` of NPM/quoter/router, `getPool`, token order, fee 3000,
  spacing 60, pool factory, in-range liquidity, a QuoterV2 quote; MetaMask code against the Ethereum Sepolia pins; the
  Aave address book at `c8f1011` (file commit `4ee7b50`) and Uniswap `deployments.json` (content SHA-256 recorded).
* `scripts/verify-ethereum-sepolia-supply.mjs --prestate` simulated the exact WBTC Supply for a public WBTC-holding
  address (read-only, nothing signed). Result: approve gas limit 69,896, supply 329,663. That output is not committed
  because the address belongs to a third party.

## 9. Evidence

| Capability | Implemented | Simulated (public read) | Fork rehearsal (MOCKED) | Testnet executed |
| --- | --- | --- | --- | --- |
| Aave WBTC Supply | yes | yes (prestate) | RECONCILED | no |
| Aave WBTC Borrow / Repay / Withdraw | yes | via the same simulator | RECONCILED | no |
| Native test-ETH transfer | yes | — | RECONCILED | no |
| Uniswap swap USDC → WETH | yes | quote only (read-only report) | RECONCILED | no |
| Uniswap USDC/WETH 0.3% position | yes | — | RECONCILED | no |

Capability rows on `eip155:11155111` all have `evidenceMaturity: null`. The fork run is `MOCKED`, not
`FORK_REPRODUCED`, because a live fork is not a closed, byte-identical replay (`docs/EVIDENCE_LEVELS.md`).

## 10. Owner action

[BUILD-ETHEREUM-001-OWNER-EXECUTION-PACKAGE-AAVE-WBTC-SUPPLY.json](BUILD-ETHEREUM-001-OWNER-EXECUTION-PACKAGE-AAVE-WBTC-SUPPLY.json)
(`READY_FOR_OWNER_EXECUTION`). It covers prerequisites (test ETH, test WBTC from Aave's faucet, an optional read-only
prestate), then two owner-signed transactions on 0xaa36a7. The first is `WBTC.approve(Pool, 100000)` with exact
calldata. The second is `Pool.supply(WBTC, 100000, owner, 0)`, with a calldata template checked byte-for-byte against
the fork run. The package also gives gas bounds, nonce rule, 120 s Review expiry, the expected state transition and
post-transaction verification (in-app reconciliation, Evidence Bundle, then
`node scripts/verify-ethereum-sepolia-supply.mjs --evidence <bundle> out.json` → `TESTNET_EXECUTED` /
`INDEPENDENTLY_RECONCILED`). App enablement: local `GRYLOO_SUPPLY_JOURNAL` without the harness, or cloud
`GRYLOO_SUPPLY_TESTNET=live`.

## 11. Shared files (merge-sensitive with `codex/build-product-ux-001`)

`globals.css` and `copilot-panel.tsx` are untouched. No screenshot baseline changed. Minimal functional touches:

* Also changed on the Codex branch: `app-shell.tsx` (Ethereum Sepolia chain in the testnet and liquidity routing
  predicates), `workflow-canvas.tsx` (card labels from `lendingAmountLabel`, `transferCardLabel` and the liquidity
  network), `summary-bar.tsx` (testnet predicate), `artifact-inspector.tsx` (Ethereum Sepolia swap label) and
  `e2e/supply-fixtures.ts`. The fixture hunks differ (this branch: wallet route/switching; Codex: `authorSupply` /
  `reviewSupply`).
* Panels with a network selector and network-substituted copy: supply, borrow, repay, withdraw, native transfer,
  public swap, Uniswap liquidity.
* After the UX merge, the authoring steps in `e2e/ethereum-sepolia-supply.spec.ts` and
  `e2e/ethereum-sepolia-transfer.spec.ts` must follow the new authoring path, as the Codex branch already does for
  `authorSupply`.

## 12. Limitations

* No owner-signed public transaction; `TESTNET_EXECUTED` is not claimed for any Ethereum Sepolia path.
* The supply verifier's `--evidence` mode has not run end to end because no owner bundle exists yet. Its parts (hash
  checks, `reconcileSupplyAttempt`) are covered by unit tests. The verifier covers Supply only. Borrow, Repay and
  Withdraw rely on the in-app reconcilers.
* The action library (Codex-owned) has no Ethereum Sepolia swap entry; the swap is authored from chat or the Copilot.
* The swap service labels its bundles for a public RPC; the fork rehearsal reports only its outcome and labels the run
  `MOCKED` at the top level.
* Testnet prices are arbitrary (≈39M USDC per WETH on the 0.3% pool at verification time). Every swap and position
  is bounded by fresh quotes, ranges and minimums.
* `build009.spec.ts` (2 tests) needs a live li.quest quote and cannot run in the offline network namespace used
  locally. This branch does not touch it; CI runs it with network access.

## 13. Repository gates

* Governance-Lite on a clean `git archive` export of `48e8b7a`: passed (938 text files). Self-tests
  (`python3 -m unittest discover -s scripts -p 'test_governance_lite.py'`): 17/17 OK.
* Dependency integrity: `pnpm-lock.yaml`, every workspace manifest's dependencies and the pinned toolchain are
  unchanged. Root `package.json` only adds the three new scripts to the lint list. No new dependency.
* Ancestry: `origin/main` `66d5843` is an ancestor; `main` was not modified.
