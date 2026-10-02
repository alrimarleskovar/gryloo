# BUILD-RH-001 — Robinhood Chain report

Status: **network infrastructure delivered. No Robinhood financial workflow
exists**, because the decision gate found no legitimate public-testnet DeFi
deployment. Highest truthful state for any Robinhood financial action: **not
implemented**. Evidence maturity: **none**. This is not
READY_FOR_OWNER_EXECUTION, since there is nothing for the owner to execute.

No public transaction was signed, sent, replaced or retried by the agent.
Every network interaction was a read: JSON-RPC `eth_chainId`,
`eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`, `eth_getStorageAt`
and `eth_call`, plus HTTP GET requests to explorers and registries.

Context: [Discovery](BUILD-RH-001-DISCOVERY.md) · [Plan](BUILD-RH-001-PLAN.md)
· [Read-only verification](BUILD-RH-001-READONLY.json).

## Findings summary

| Question | Answer |
| --- | --- |
| Mainnet / testnet config | 4663 / 46630, ETH gas, official RPCs and explorers; both RPCs verified live |
| Testnet RPC | Works; serves EIP-1898 block-hash-pinned reads |
| Explorers | Testnet Blockscout UI and API work. Mainnet Blockscout UI works, but its API is behind Cloudflare for scripts |
| EIP-1193 wallets | Standard; add and switch with official parameters |
| Uniswap | Mainnet canonical (49 registry records, code verified). **Testnet: none** in Uniswap's registry. The testnet v4/UniversalRouter code is an unattributed CREATE2 replay with a router bound to mainnet WETH |
| Morpho | Mainnet canonical (`morpho-ts` registry, Morpho Blue code verified). **Testnet: none** |
| Across / LI.FI | Mainnet only: 38 Across routes into 4663, LI.FI lists 4663. **Zero testnet routes.** Base USDC arrives as **USDG** |
| Canonical testnet tokens | ETH and the official L2 WETH `0x7943…52Fa` only |
| Faucet | `faucet.testnet.chain.robinhood.com` (browser-gated, so assets not confirmed headlessly) |
| Stock Tokens | 194 active, **mainnet only**; ERC-20, 18 decimals, ERC-8056 multiplier, per-token Chainlink TRV feeds (mainnet), US-person and other jurisdiction restrictions |
| Gate | **C** |

## Implementation

| Change | Files |
| --- | --- |
| Robinhood network identity, official contracts, protocol-availability gate table, expected-code builder, EIP-3085 parameters | `packages/action-registry/src/robinhood-chain.ts` (+ `index.ts` exports) |
| `PROTOCOL_NOT_DEPLOYED` blocker for Robinhood chains whose protocol has no canonical deployment. No execution row added | `packages/action-registry/src/execution-capabilities.ts`, `apps/reference-dapp/src/domain/capability-view.ts` |
| One shared-wallet network table: labels, hex→CAIP-2, switch, add on 4902, read-back. Robinhood Testnet switchable; Robinhood mainnet recognized but never a switch target | `apps/reference-dapp/src/wallet/evm-networks.ts`, `state/build009-wallet-store.tsx`, `state/capability-store.tsx` |
| Independent read-only network verifier (method allowlist, chain ID, head freshness and clock skew, block-hash-pinned code presence and absence, fail-closed parsing) | `packages/reference-reconciler/src/robinhood-network.ts` (+ export) |
| Operator script and committed output | `scripts/verify-robinhood-network.mjs`, `docs/builds/BUILD-RH-001-READONLY.json` |
| Browser spec and CI listing | `apps/reference-dapp/e2e/robinhood-network.spec.ts`, `.github/workflows/contracts.yml` (one spec name added to the default list), `package.json` (lint list) |

Shared-surface changes are minimal and additive. The wallet refactor moves
the existing Base Sepolia add-chain parameters into the network table byte
for byte (asserted by a unit test). Labels for Base, Arbitrum and Base
Sepolia are unchanged. `capability-store` maps the same three chains to the
same CAIP-2 values, and Robinhood chains now map to their own CAIP-2 instead
of `null`. The capability resolver's only behavior change is the new blocker
code for Robinhood chains; every existing chain resolves exactly as before.
No Aave, BUILD-012D, Orca, Jupiter, compiler, executor or reconciler-path
code changed.

## Simulation and Review behavior

No Robinhood simulation or Review exists, because there is no action to
simulate. A Robinhood node cannot be authored in the UI: `allowedChainRefs`
and the review contexts are unchanged. Through the API, the capability
resolver returns `PROTOCOL_NOT_DEPLOYED` (testnet) or `CHAIN_NOT_SUPPORTED`
(mainnet) with no SIMULATE, REVIEW, AUTHORIZE or EXECUTE capability and a null
evidence ceiling. `executionSupported` and `executionReady` stay false even
with a matching wallet and current artifacts (unit-tested).

## Recovery guarantees

Unchanged and not weakened. With no Robinhood submission path, there is
nothing to prepare, hand off or resubmit. The shared wallet's switch path
still never signs, sends or retries. It adds a network only after code 4902
and only from official parameters, and it requires `eth_chainId` read-back
after switching. Rejections (4001) propagate without adding or retrying.
Discovery records one Robinhood-specific recovery fact for the future path:
sequencer compliance screening can silently exclude a transaction, so an
unknown result must stay observation-only. That is already the existing rule.

## Independent verifier design

`verifyNetworkState(rpc, expectation, now)` trusts nothing from the
application:

1. The method allowlist (`eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`)
   is enforced on every call. `assertNetworkReadMethod` is exported for the
   transport egress, and the script calls it before each `fetch`.
2. The chain ID must equal the expected EIP-155 ID (`WRONG_CHAIN`).
3. The head block must be well-formed, not ahead of the local clock beyond
   tolerance (`CLOCK_SKEW`), and not older than the freshness bound
   (`STALE_HEAD`).
4. Every code read is pinned to the head hash with `requireCanonical: true`.
   Each expected contract is classified PRESENT or ABSENT with its byte length
   and keccak-256 code hash.
5. Differences are findings: `CODE_MISSING` for an official contract gone, and
   `UNEXPECTED_CODE` for code at a canonical protocol address on a network
   where the gate recorded no deployment. Either one makes the status
   `MISMATCH`, and the script exits non-zero, signalling that discovery must
   be re-run.
6. Malformed quantities, hashes, blocks or code fail closed
   (`RPC_RESPONSE_INVALID`). Malformed expectations fail before any read.

The swap-specific reconciliation the brief describes (receipt, sender,
destination, calldata, tokens, amounts, minimum output, balances, gas) belongs
to the future option-A build and is specified in the plan. It is not built
against a non-canonical deployment.

## Tests and checks

| Check | Result |
| --- | --- |
| Focused: `packages/action-registry/test/robinhood-chain.test.ts` (identity, chain IDs, CAIP/hex resolution, EIP-3085, gate table, no registry rows, `PROTOCOL_NOT_DEPLOYED` in all environments, mainnet `CHAIN_NOT_SUPPORTED`, never executable or ready, Base Sepolia vs Robinhood wallet → `WRONG_WALLET_CHAIN`, existing chains unchanged) | 11 passed |
| Focused: `apps/reference-dapp/src/wallet/evm-networks.test.ts` (CAIP mapping, labels, mainnet not switchable, direct switch, add-on-4902 with official parameters, Base Sepolia parameters byte-identical, no add for mainnets, 4001 propagated, read-back mismatch) | 9 passed |
| Focused: `packages/reference-reconciler/test/robinhood-network.test.ts` (testnet and mainnet verified, unexpected code, missing code, wrong chain ×3, stale head, clock skew, 8 malformed responses, method allowlist, malformed expectations) | 9 passed |
| Focused: capability-view message | passed |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | **pass**: 132 files, 983 tests passed; 2 skipped (pre-existing Anvil-gated: composition-service and mode-b-service fork preparation) |
| Governance-Lite + self-tests | pass; 17 self-tests OK |
| `git diff --check` | clean |
| `bootstrap-ci.py --verify-dependencies` (integrity, license, release age) | pass |
| `pnpm audit --audit-level low` | no known vulnerabilities |
| CycloneDX 1.6 SBOM gate (CI script verbatim) | pass; 247 components, 16 reviewed exceptions |
| Read-only public verification (`verify-robinhood-network.mjs`) | both networks VERIFIED; gate C; 29 RPC reads |
| Browser: new `robinhood-network.spec.ts` (Robinhood Testnet and mainnet wallets identified; no switch, sign or send requests; no external egress) | 2 passed |
| Browser: full CI list (main, supply/borrow/repay, Jupiter, Solana Devnet, Orca liquidity, Mode A, CoW), loopback only | 122 passed, 11 failed, 4 skipped. All 11 failures are `toHaveScreenshot` pixel mismatches (base-observation ×1, mock-artifact-chain ×2, swap-authoring ×1, visual-shell ×3, Mode A ×4). The same 11 fail on an untouched `git archive` of `70ce37e`, and **all 11 actual images are byte-identical (SHA-256) between baseline and branch**, so this is local font rendering, not a regression. Baselines were not updated. BUILD-009 Base↔Arbitrum switching specs pass on the refactored wallet path. The composition fork group (official artifact download harness) was not run locally |
| Anvil compatibility gate / fork suite | 4 passed, 10 skipped / 31 passed, 29 skipped. Skips are owner- or environment-gated and identical on the baseline |

## Evidence maturity

| Path | Maturity |
| --- | --- |
| Any Robinhood Chain financial action | none (not implemented) |
| Existing Base Sepolia Uniswap swap | unchanged: TESTNET_EXECUTED |
| Robinhood read-only verification | `PUBLIC_READ_ONLY` observation (the BUILD-015 convention); not an evidence level and not an Evidence Bundle |

No Evidence Bundle was created.

## Future compatibility

- **Uniswap testnet swap (option A)**: blocked on an external Uniswap or
  Robinhood publication for chain 46630, plus a canonical valueless testnet
  ERC-20. The steps are in the plan.
- **Robinhood mainnet Uniswap**: canonical addresses are recorded for
  read-only verification only. Before any mainnet build, resolve the
  UniversalRouter registry discrepancy (`0x8876…` vs `0x06Af…`/`0x204F…`).
- **Bridging (Base, Ethereum, Arbitrum ↔ Robinhood)**: Across and LI.FI both
  route mainnet 4663 today. Both Gryloo adapters are typed to Base 8453 →
  Arbitrum 42161 USDC. A Robinhood route needs a new exact profile, and since
  USDC arrives as **USDG**, it is a cross-asset route. Bridge semantics and
  reconciliation must bind the output asset explicitly, not assume like for
  like.
- **Stock Tokens**: a future workflow needs `uiMultiplier` and pending
  multiplier binding in Review, Chainlink TRV plus sequencer-uptime and
  `oraclePaused()` checks, `tradingCapabilities` and session gating, and an
  explicit jurisdiction and eligibility gate. Mainnet only.

## Owner action

None is required to merge this build. To re-check the gate at any time,
read-only:

```sh
pnpm build && node scripts/verify-robinhood-network.mjs /tmp/rh-check.json
```

A non-zero exit with `REVIEW_REQUIRED` means a testnet deployment or route
has appeared, and a follow-up option-A build can start.
