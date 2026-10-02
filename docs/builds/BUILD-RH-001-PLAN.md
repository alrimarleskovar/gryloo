# BUILD-RH-001 — Robinhood Chain plan

Inputs: [BUILD-RH-001-DISCOVERY.md](BUILD-RH-001-DISCOVERY.md). Baseline:
`70ce37efae08018c642ddcc912913c07cabcb770`. Branch:
`claude/build-rh-001-robinhood`.

## Decision gate

| Option | Requirement | Finding | Result |
| --- | --- | --- | --- |
| A. Uniswap exact-input swap on Robinhood Testnet | Canonical testnet deployment + valueless canonical test assets | Uniswap's registry has no chain 46630; the testnet contracts are an unattributed CREATE2 replay of mainnet init code (router bound to mainnet WETH); no canonical testnet ERC-20 besides WETH | **Rejected** |
| B. Other existing protocol on Robinhood Testnet | Morpho, Across, LI.FI or another adapter with a testnet deployment | Morpho: mainnet only. Across: zero 46630 routes. LI.FI: mainnet only. Aave: no Robinhood entry | **Rejected** |
| C. Network infrastructure only | — | — | **Selected** |

Under C this build adds no financial action, no capability row, no Evidence
Bundle and no evidence-maturity claim for Robinhood. It provides:

1. **Network identity.** Add `packages/action-registry/src/robinhood-chain.ts`.
   It holds frozen descriptors for `eip155:4663` and `eip155:46630` (chain ID,
   hex, CAIP-2, name, native currency, public RPC, explorer, official source).
   It also holds the official per-network contract set with provenance, and a
   protocol-availability table that records the gate result: Uniswap, Morpho,
   Across and LI.FI are mainnet only; Aave has neither.
2. **Truthful capability resolution.** Add the blocker code
   `PROTOCOL_NOT_DEPLOYED`. If a node targets a Robinhood network, no
   execution profile exists, and the availability table says the selected
   adapter's protocol has no canonical deployment there, the resolver returns
   this code instead of the generic `CHAIN_NOT_SUPPORTED`. No Robinhood row
   is added to `executionCapabilityRegistry`. The capability view gets the
   matching message.
3. **Shared wallet, not a second one.** Add
   `apps/reference-dapp/src/wallet/evm-networks.ts`, a single table of EVM
   networks the shared injected wallet recognizes. `build009-wallet-store`
   uses it for chain labels and for switch, add-on-4902, switch, read-back.
   `capability-store` uses it to map the wallet's hex chain to CAIP-2. Base,
   Arbitrum and Base Sepolia keep their exact labels, switch behavior and
   add-chain parameters. Robinhood Testnet becomes a valid switch target with
   official add-chain parameters. Robinhood mainnet is recognized for display
   and wrong-chain detection only and is never offered as a switch target.
4. **Independent read-only network verifier.** Add
   `packages/reference-reconciler/src/robinhood-network.ts`. It enforces a
   method allowlist (`eth_chainId`, `eth_getBlockByNumber`, `eth_getCode`).
   It checks the canonical chain ID and that the head is fresh and not ahead
   of the local clock. It pins every code read to the head block hash
   (EIP-1898, `requireCanonical`) and compares each expected
   PRESENT/ABSENT contract against the chain. Its outcome is `VERIFIED` or
   `MISMATCH` with explicit findings. `UNEXPECTED_CODE` on testnet means a
   deployment appeared and discovery must be redone. It fails closed on
   malformed responses.
5. **Operator script.** Add `scripts/verify-robinhood-network.mjs`. It uses
   only the public RPCs and public registries: Uniswap `deployments.json`,
   Morpho `morpho-ts` chain registry, the Across testnet and mainnet routes,
   and the LI.FI chain list. It has no wallet and no signing. Its output is
   committed as `docs/builds/BUILD-RH-001-READONLY.json`, labeled
   `PUBLIC_READ_ONLY` and `broadcast: false`, the same convention as the
   BUILD-015 and BUILD-DEMO-001 read-only artifacts. It is not an Evidence
   Bundle and carries no evidence maturity.
6. **Docs**: discovery, this plan and the report.

## Explicitly not built

- No `robinhood.swap` or any new semantic action; `asset.swap.exact-input` stays
  chain-neutral and is not extended to Robinhood chains.
- No addition to `referenceRegistry.allowedChainRefs` or the linter review
  contexts. A Robinhood node cannot be authored in the UI because nothing
  could execute it.
- No compiler, simulation, Review, executor, recovery, reconciler or evidence
  path for a Robinhood financial action. These need a canonical deployment to
  pin, and pinning the testnet replay would be a fake integration.
- No mainnet execution or mainnet switch prompt.
- No Stock Token catalog code. The findings are documented only.
- No Across or LI.FI profile for Robinhood, because the routes are mainnet-only
  and cross-asset (USDC → USDG).
- No BUILD-012D or Aave Withdraw changes, and no Gryloo → Flofi rename.

## Requested tests that do not apply

Several requested tests (compiler, simulation, Review, stale Review, semantic
edit invalidation, execution preparation, recovery, duplicate-submit,
swap-reconciler wrong sender/destination/token/amount/calldata/balance)
assume a selected Robinhood financial action. With no action selected,
writing them would test code that cannot run. The existing chain-neutral
suites for those stages run unchanged as regressions. The applicable checks
are added: network identity, chain ID, wallet switching and adding,
wrong-chain rejection, capability registry, verifier wrong chain, malformed
receipt and response, stale head, unexpected or missing code, and method
allowlist.

## Validation

Focused unit tests for each new module; `pnpm check`; Governance-Lite and its
self-tests; `git diff --check`; dependency integrity
(`pnpm install --frozen-lockfile --offline`), audit and SBOM gates as CI runs
them where available locally; browser tests including a new loopback-only
Robinhood wallet spec. Results go in the report.

## Path to option A later

When Uniswap (or Robinhood) publishes a 46630 deployment and a canonical
valueless testnet token exists, the follow-up build should:

1. Re-run `scripts/verify-robinhood-network.mjs`. It will report
   `UNEXPECTED_CODE` if the deployment reuses the mainnet addresses, and the
   registry checks will list the new records. Then update `robinhood-chain.ts`.
2. Add one `asset.swap.exact-input` / `uniswap.v3` / `eip155:46630` /
   `PUBLIC_TESTNET` row with `evidenceMaturity: null`. Clone the Base Sepolia
   exact-profile service: quote, simulation, Review binding,
   durable PREPARED, single submission, observe-only unknowns, and an
   independent receipt and balance reconciler.
3. Stop at READY_FOR_OWNER_EXECUTION. Only an owner-signed testnet
   transaction plus independent reconciliation can raise the row to
   `TESTNET_EXECUTED`.
