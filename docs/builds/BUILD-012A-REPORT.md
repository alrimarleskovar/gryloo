# BUILD-012A — Aave V3 Supply report

STATUS: IMPLEMENTATION_IN_PROGRESS

## Authority and deployment

DEC-0056 approves the single exact 64-path scope in BUILD-012A-PLAN §8, baseline main 64a0a46f45532d667e226193f29529d8938acf15, branch codex/build-012a-aave-v3-supply. One PR, no merge. No extra path or dependency change is authorized.

Official sources: [Aave deployed addresses](https://aave.com/docs/resources/addresses), [Aave DAO Base Sepolia address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3BaseSepolia.sol), [Aave app market configuration](https://github.com/aave/interface/blob/main/src/ui-config/marketsConfig.tsx), [Aave network configuration](https://github.com/aave/interface/blob/main/src/ui-config/networksConfig.ts), [Base network documentation](https://docs.base.org/get-started/connect-to-base).

Network Base Sepolia; chain 84532 / eip155:84532 / 0x14a34. Pool 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27; Provider 0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00; Aave test USDC 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f (6 decimals); aToken 0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC. Explorer https://sepolia.basescan.org. Pinned read RPC https://base-sepolia.gateway.tenderly.co. Faucet listed by the official Aave interface: 0xD9145b5F45Ad4519c7ACcD6E0A4A82e83bB8A6Dc. This reserve is not Circle test USDC.

Read-only live observations at block 47520269, hash 0x10d0cc500814f4aaed58424da8983dcaa9f4da5d5c86d296d5535d76b5496b5b (2026-09-30T22:53:46Z), verified chain, deployed code, Provider Pool, active/unfrozen/unpaused reserve, expected aToken/underlying, decimals and nonzero total supply. Index 1244649868421251584938024076 ray. Address book rechecked 2026-10-01. On 2026-10-01 ordinary public reads worked; eth_simulateV1 probes returned HTTP 429. Exact-token eth_call state override and eth_estimateGas override worked, including independent allowance mapping slot-1 readback. No transaction was submitted by these probes.

## Implementation and validation

The shared canonical Supply IR, validation, compiler, executor, independent reconciler and DApp authoring/financial panels are implemented. Chat and canvas use the same reducer. Allowance decides finite exact approval versus Supply-only. Attempts and nonce identities are fsynced before wallet release, and recovery only observes the existing transaction. Confirmed approval survives a later reverted Supply; partial execution records are downloadable. Reverted and mismatched attempts remain terminal across reload. Independent reconciliation binds transaction semantics, canonical receipt/events and index-aware aToken principal effects.

Local validation on 2026-10-01:

- `pnpm check`: PASS; typecheck, lint, production build, 11 schema exports, 591 unit tests; 2 existing opt-in read probes skipped, not counted as passes.
- Focused Supply: 72 tests in 8 files PASS, including transport throttling, partial failure and durable corruption rejection.
- Final stable browser run: 59 tests PASS, comprising 11 Supply journey/recovery cases, 12 canvas cases, 13 existing Mode A cases and 23 original visual/observation/mock/swap cases. The pending-signature guard prevents navigation and undo while the injected wallet request is open. Supply evidence remains MOCKED.
- Original visual/observation/mock/swap suites: 23 PASS with unchanged snapshots. WSL initially used DejaVu for Arial; the integrity-verified Ubuntu Liberation font package was extracted under /tmp to reproduce CI metrics. No host install or snapshot modification.
- Applicable fork suite: 31 PASS, 29 profile/owner-only cases skipped. Unchanged F1 five-process Anvil rehearsal: PASS, 5/5. These are development evidence.
- Existing Mode A execution browser run initially had 12 PASS and 1 failure while another check rebuilt the served app. Untouched baseline and stable final current run: all 13 PASS. CoW was initially 9 skips without its opt-in harness; the required loopback CoW run passed all 9 tests.
- Four legacy browser failures reproduced unchanged on exported baseline 64a0a46: two BUILD-UX-001 assertions (marquee and removed Toolbox position selector) and two BUILD-009 cases that require live LI.FI and fail in the mandated offline namespace. No product/test/governance check was altered to hide them. The baseline comparison used an exported /tmp test copy, no worktree or branch, leaving implementation bytes untouched.
- Exact Node 24.21.0, pnpm 11.22.0, verified Anvil 1.8.3 and Chromium headless shell 1243. Full builds/checks pass outside the sandbox because existing independent Python subprocess tests were denied EPERM and sandboxed Next TypeScript initially crashed; checks themselves are unchanged.
- Dependency integrity, license and release-age checker: PASS, 247 registry entries; exact 16 license exceptions unchanged. `pnpm audit --audit-level low`: no known vulnerabilities.
- Original governance self-tests: 22 PASS; BUILD-012A self-tests: 9 PASS. Both governance phases PASS after the final source pin refresh; documentation is checked again before commit. `git diff --check` passes. Scope remains 29 Create + 35 Modify, with acceptance Evidence absent until real public execution.

Read-only funding check at block 47522860: the previously evidenced owner 0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b holds zero Aave test USDC, 100000000000000 wei native ETH and zero Pool allowance. The aToken POOL() matches the verified Pool. The official faucet is unpermissioned; eth_call of mint(asset, owner, 1000000) succeeds and returns 1000000. This preview submitted nothing and minted nothing. Public RPC reads are paced with bounded throttle retries; only read methods are allowed. The owner will need at least 1 Aave test USDC for the planned 1 USDC acceptance Supply. Source: [official Aave faucet UI](https://app.aave.com/faucet/) and [Aave V3 faucet ABI](https://github.com/aave/aave-utilities/blob/master/packages/contract-helpers/src/v3-faucet-contract/typechain/IERC20FaucetOwnable__factory.ts).

## Public acceptance and delivery

Owner public execution: not performed. Public Supply hashes, reconciliation and Evidence Bundle: absent. No TESTNET_EXECUTED Supply claim, remote CI, commit, PR or merge is asserted. The acceptance Evidence JSON is intentionally absent until real execution succeeds. MOCKED browser/service fixtures and any fork tests are development evidence only. Owner funding/signature is requested only after implementation, deterministic validation and CI are ready. BUILD-012B/C/D remain unstarted.
