# BUILD-DEMO-001 — Solana Devnet real execution report

STATUS: DEVNET_EXECUTED

Work follows [GOVERNANCE-LITE](../SCOPE_GUARD.md): branch `claude/build-demo-001-solana-devnet` from main `148f79c`, one PR, owner merge. No path manifest, byte pin, historical baseline fetch or governance amendment was created. Nothing was signed or broadcast during implementation. On 2026-10-01 the owner executed one real public Solana Devnet swap through Gryloo with their own wallet. It was independently reconciled and produced an Evidence Bundle, so the status is **`DEVNET_EXECUTED`**. It used valueless Devnet test tokens; no real funds and no mainnet execution are involved.

## DEVNET_EXECUTED acceptance

| Fact | Value |
|---|---|
| Network | Solana Devnet, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| Provider / program | Orca Whirlpools `swap_v2`, `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` |
| Pool | `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt` (SOL / devUSDC) |
| Owner (sole signer) | `6Mc7hRBcjoYukC7PNqKUbfS5pHeJwf41bogtUfKuMYQR` |
| Transaction | [`5Aoo6QX3b7rh3wAX5fxY8ybx7R7k1VgrT95QhuAf5HNF2zNiaCVAoTZtus3HbdwtZthSY9BiMKWiJRVQc67dLCbB`](https://explorer.solana.com/tx/5Aoo6QX3b7rh3wAX5fxY8ybx7R7k1VgrT95QhuAf5HNF2zNiaCVAoTZtus3HbdwtZthSY9BiMKWiJRVQc67dLCbB?cluster=devnet) |
| Slot / block time / finality | 506,389,990 / 1790885251 (2026-10-01T20:07:31Z) / finalized |
| Input | 0.1 Devnet SOL = 100,000,000 lamports (exact) |
| Output | 2.231352 devUSDC = 2,231,352 raw (quoted 2,231,352 at Review) |
| Minimum output / slippage | 2,220,195 raw / 50 bps |
| Network fee | 5,000 lamports |
| Owner SOL | 4,999,977,280 → 4,898,483,840 lamports (−100,000,000 swap − 5,000 fee − 1,488,440 refundable devUSDC account deposit) |
| Owner devUSDC (`H2GQvRuH6yP1nESoAYNyuA8Py3sHgyFW8TpRqNPp6GzD`) | 0 → 2,231,352 |
| Orca `Traded` event | input 100,000,000, output 2,231,352, LP fee 194,000, protocol fee 6,000 lamports |
| Message hash | `0xacda1c3eb8c8a2b9def250706a8004011e410edf2fe3fe756de154b063f03cd8` |
| Gryloo journal | `orca-9fb765270fc68d7a1e1c9cac72ed9242`: PREPARED → SUBMITTING → PENDING → CONFIRMED, verdict RECONCILED |
| Evidence class | `DEVNET_EXECUTED` (owner-initiated, independently reconciled, `realFunds: false`) |
| Evidence Bundle hash | `0x621c869a0dbee6e0d827ed536d32230c1ef14e0281a84c92d2d0619e9716e6c9` |

**Independent verification: VERIFIED (35/35 checks).** `scripts/solana-devnet-execution-verification.mjs` is read-only; its transport refuses `sendTransaction`. It re-derives the chain facts from the public finalized transaction using the raw wire codec, not Gryloo's reconciler:
- **Signature and instructions.**
  - Cluster genesis and finality.
  - The owner's Ed25519 signature over the exact message, with the owner as the only signer.
  - The instruction allowlist and no lookup tables.
  - Exactly one Orca Whirlpools `swap_v2`: exact input, SOL→devUSDC, no price limit.
  - The exact pool, mints, vaults and oracle.
  - The owner's own token accounts.
- **Fee and balances.**
  - Fee of 5,000 lamports.
  - Owner SOL input delta equal to the amount, net of fee and deposit.
  - devUSDC output ≥ minimum.
  - Pool vault deltas mirror the owner deltas.
  - The temporary wrapped-SOL account was opened and closed in the transaction.
  - No other owner token account moved.
- **Traded event.** Exactly one Orca `Traded` event matching pool, direction, input and output.

It then binds the journal:
- Every line validates and the Review commitment recomputes.
- The on-chain message is byte-identical to the reviewed message and the ExecutionPlan payload hash.
- The journal's signature and signed bytes equal the finalized transaction.
- The attempt sequence shows durable persistence before signing and the signature before broadcast.
- Gryloo's reconciler, re-run against public Devnet, still returns `RECONCILED` / `DEVNET_EXECUTED`.

It also binds the Evidence Bundle:
- The downloaded bundle equals the journal evidence.
- The artifact hash recomputes to `0x621c…e6c9`.
- It binds the journal head, Manifest and ExecutionPlan.
- Every reported fact equals the chain.

The same 35 checks pass against the archived copies.

**Schema note (honest labelling).** The frozen generic v1 Evidence Bundle schema has no Devnet environment value. The archived bundle therefore carries `bundle.environment: TESTNET_EXECUTED`, meaning a public non-mainnet network. The Gryloo runtime and evidence classification is **`DEVNET_EXECUTED`**: `evidenceClass` and `publicExecution.environment` are `DEVNET_EXECUTED`, `realFunds` is `false`, and the bundle's limitations state Solana Devnet with valueless test tokens. Nothing in the evidence says `MAINNET_EXECUTED`. This is not mainnet execution and involved no real funds.

**Archived evidence** in [`BUILD-DEMO-001-EVIDENCE/`](BUILD-DEMO-001-EVIDENCE/), immutable byte copies listed in `SHA256SUMS`:
- `evidence-bundle.json` (the owner's download, SHA-256 `d139251470503017f8ae873eaca0666212ec24b8e0ac0cadb01d30858192048b`)
- `execution-journal.jsonl` (the run's append-only journal, `f82fd4335fddced99301a1231b8bcf02fbcb35b2fbc6759dc4bafa5201eb7248`)
- `devnet-transaction.json` (the raw finalized `getTransaction` result, `7ebc7bd807cd49c15bdec72266c672bdad9327afdc94cd292ff659d74d7e3ad7`)
- `independent-verification.json` (the verifier output, `cc2fca241f358d867e25e223debaf19d2d6782daffaa47652b0105ee0f88484d`)

**Earlier fail-closed attempt.** Before the explicit wallet selector (commit `038b13e`), a run from another wallet account (`6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy`, journal `orca-e17951a4df9578bc78c9a5a0f0396ea2`) went `PREPARED → CANCELLED` with `DEVNET_SWAP_TRANSACTION_CHANGED`. The wallet returned bytes that differed from the Review. Gryloo stored no signature, broadcast nothing, and released the owner lease. This is the exact-byte guard working as designed; it was not relaxed.

## Goal

The same canonical `asset.swap.exact-input` intent and IR flows through Build → Simulate → Review → Execute → Result on **Solana Devnet**, with a real owner wallet, valueless test tokens, a real public transaction, independent reconciliation and an Evidence Bundle. Jupiter is untouched and is never shown for Devnet; Jupiter Swap V2 remains mainnet-only (BUILD-014).

## DEVNET_SWAP_OPTIONS (checked 2026-10-01)

| Protocol | Official source | Devnet support | Program ID (Devnet) | Test-token liquidity | Transaction complexity | Wallet compatibility | Suitability |
|---|---|---|---|---|---|---|---|
| **Orca Whirlpools** (selected) | [docs.orca.so/llms.txt](https://docs.orca.so/llms.txt) "Protocol Constants" and "Devnet Test Pool"; [Whirlpool parameters](https://docs.orca.so/developers/architecture/whirlpool-parameters) | Documented. Same program on all networks, a Devnet WhirlpoolsConfig, and a Devnet test pool "used in all SDK examples and safe for testing" | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` (executable, upgradeable loader, last deploy slot 439,560,432) | Documented SOL/devUSDC pool `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt`: ≈357 SOL / ≈7,143 devUSDC, actively traded (SwapV2 every few minutes) | One `swap_v2` (15 accounts, no lookup table), plus owner ATA creation, an exact SOL wrap and a wrapped-SOL close. ≈700-byte v0 message, ≈60–70k CU | Any Wallet Standard wallet signing `solana:devnet` (classic SPL tokens only) | **Best.** Official, current, documented test pool. Needs only Devnet SOL |
| Raydium CPMM | [docs.raydium.io/reference/program-addresses](https://docs.raydium.io/reference/program-addresses) | Devnet program documented | `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb` (executable) | No officially designated Devnet test pool or test tokens; pools are arbitrary user-created ones | `swap_base_input` is simple, but a pool and mints must be picked without an authoritative source | Wallet Standard | Viable, but no authoritative test pair |
| SPL Token Swap | [solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library) | Repository archived (last push 2025-03-11); not maintained | — | — | — | — | Rejected (unmaintained) |
| Jupiter Swap V2 | BUILD-014 report | Mainnet-only (no cluster parameter; Devnet mints return "No routes found") | — | — | — | — | Rejected. Must not be faked |

`DEVNET_PROTOCOL_FALLBACK_REQUIRED` is **not** needed: a maintained third-party Devnet protocol with usable liquidity exists, so no Gryloo-owned program or token was created.

## Selected profile (read from Devnet)

- Cluster: Solana Devnet, genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, CAIP-2 `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, Wallet Standard chain `solana:devnet`.
- Provider: Orca Whirlpools `swap_v2` (Anchor discriminator `2b04ed0b1ac91e62`). The `Traded` event is `e1ca49af932ba096`.
- WhirlpoolsConfig `FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR`. Pool `3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt`: token A wrapped SOL, vault `C9zLV5zWF66j3rZj3uuhDqvfuA8esJyWnruGzDW9qEj2`; token B devUSDC, vault `7DM3RMz2yzUB8yPRQM3FMZgdFrwZGMsabsfsKopWktoX`. Orca's docs label this pool as tick spacing 8; the on-chain account says **64**. The chain is authoritative, and every simulation re-reads and re-verifies the pool.
- Test tokens (smallest usable pair):
  - Devnet SOL: native SOL, wrapped `So11111111111111111111111111111111111111112`, 9 decimals.
  - devUSDC: `BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k`, 6 decimals, Orca's documented Devnet test token. Classic SPL; the mint authority belongs to Orca's test setup. It is not Circle USDC.
  - Both are valueless, and the UI labels them "Devnet SOL" and "devUSDC (test)". No Gryloo token was minted.

## Implementation

BUILD-014's Solana execution core is now shared by both runtimes. It is not duplicated. Provider-specific work stays in one adapter.

- **Runtime model (`action-registry`).** `SOLANA_SWAP_RUNTIMES` defines two runtimes: mainnet-beta via Jupiter (`MAINNET`) and Devnet via Orca (`PUBLIC_TESTNET`). Each carries cluster, genesis, wallet chain, provider program, explorer, tokens and evidence mapping. `solanaTokenOn(chain, mint)` makes asset identity cluster + mint + decimals: mainnet USDC on Devnet is rejected. A new capability row is `orca.whirlpools-devnet` on Devnet, `PUBLIC_TESTNET`, with no demonstrated evidence ceiling.
- **Canonical swap.** The same `asset.swap.exact-input` action, ports, constraints, capability and Mode A authorization. Only chain, mint identity and the single `orca-whirlpools` protocol constraint differ. There is no `devnet-swap`, `demo-swap` or similar action. The linter enforces the runtime's tokens, provider, slippage (≤ 300 bps) and amount caps (10 SOL, 1,000 devUSDC).
- **Chat and Canvas.** "Swap 10 test USDC to test SOL on Solana Devnet" (also `devUSDC`/`USDC`, with optional `slippage N bps`) and the canvas Swap form with Network **Solana Devnet** produce byte-identical IR. A "test" token named on mainnet resolves to an unsupported token, never to a real asset.
- **Shared core (`reference-compiler/src/solana-swap.ts`).** Provides account reads, the cluster genesis check, exact-message simulation, owner deltas, message round-trip, the frozen v1 artifact chain, the Review guard and signed-transaction verification, all moved out of `jupiter.ts`. Jupiter behaviour and exported names are unchanged.
- **Orca adapter (`orca-whirlpool.ts`).** Verifies the pool account: discriminator, Devnet config, mints, vaults, tick spacing and liquidity. It derives the program's own three tick arrays in the swap direction, plus the oracle PDA, and checks that the tick arrays are owned by Whirlpools or uninitialized. Gryloo builds every instruction itself:
  - compute-unit limit;
  - idempotent ATA creation for the owner's own wrapped-SOL and output accounts;
  - an exact-amount SOL wrap;
  - one exact-input `swap_v2` (`amount`, `other_amount_threshold = minimum`, no price limit, owner as the only signer);
  - a wrapped-SOL close back to the owner.

  It compiles the v0 message, round-trips it and binds its SHA-256. A pre-existing owner wrapped-SOL account fails closed.
- **Simulation (read-only).** `simulateTransaction` with signature verification off. The expected output is the pool's own `Traded` event for the exact input against current Devnet state. The minimum is `floor(expected × (10,000 − slippage) / 10,000)`. A second simulation of the final message must spend exactly the amount and receive at least the minimum. The UI shows:
  - Swap X → expected Y, network Solana Devnet, provider Orca Whirlpools;
  - expected output, minimum received, slippage, estimated network fee and any refundable token-account deposit;
  - quote freshness (60 s), with technical details collapsed.
- **Review.** The commitment covers workflow revision, Devnet cluster, owner, mints, amount, slippage/minimum, pool/route commitment, exact message hash, blockhash and expiry. The Devnet guard also decodes the reviewed bytes and requires exactly one owner-signed `swap_v2` with the reviewed amount and minimum on the verified pool. Any semantic or transaction change invalidates Review.
- **Wallet.** The BUILD-014 Wallet Standard client, parameterized by cluster (`solana:devnet`). It only connects and signs (`solana:signTransaction`), with no keys, no seed phrases, no sign-and-send and no automatic signing. Only the byte-identical reviewed message with a valid owner Ed25519 signature is broadcast, once. Devnet needs no real-funds checkbox; it shows a "test tokens only" note instead.
- **Execution and recovery.** These reuse BUILD-014 unchanged:
  - The attempt is durably `PREPARED`, under an append-only per-owner lease (`<owner>.orca-lease`), before the wallet is asked.
  - The signature and signed bytes are durable before a single `sendTransaction`.
  - An RPC error leaves `SUBMISSION_RESULT_UNKNOWN`, and only the existing signature is observed.
  - Finalized block height past the reviewed validity proves non-landing.
  - There is no resubmission path.

  Journals live under `GRYLOO_SOLANA_DEVNET_JOURNAL` (absolute, outside Git). Execution is on by default for Devnet; it still requires Review, an Execute click and the owner's signature. `GRYLOO_SOLANA_DEVNET_EXECUTION=DISABLED` turns it off.
- **Reconciliation.** The shared finalized reconciliation checks:
  - Devnet genesis, owner/fee payer and exact signature;
  - byte-identical owner-signed bytes and successful status;
  - that the Whirlpools program was invoked;
  - fee ≤ estimate;
  - owner input/output token accounts with pre/post balances, exact input delta, output delta and the minimum-output constraint;
  - native SOL net of fee and deposits, no unrelated owner asset movement, and the wrapped-SOL account closed.

  For Devnet it additionally requires exactly one Orca `Traded` event from the verified pool, with the reviewed direction, the exact input, and an output equal to the measured delta. Top-level and inner programs are recorded. A mismatch is `DIVERGENT`; a provider gap is `INCONCLUSIVE`.
- **Evidence.** Classes are `MOCKED`, `PUBLIC_READ_ONLY`, `PUBLIC_EXECUTED` (mainnet only) and **`DEVNET_EXECUTED`**. `DEVNET_EXECUTED` requires an owner-initiated, reconciled Devnet run. The bundle's `publicExecution` record carries:
  - `environment: DEVNET_EXECUTED`, cluster, genesis, owner, provider/program and pool;
  - input/output mints and token accounts;
  - requested amount, expected and minimum output, actual input/output deltas;
  - signature, slot, block time, fee and balances;
  - the `Traded` event, programs and inner programs;
  - verdict, `realFunds: false` and the `explorer.solana.com/tx/<sig>?cluster=devnet` link.
- **Result UX.** A prominent "Success" heading with the transaction signature, a "View on Solana Explorer (Devnet)" link, and the amounts paid and received. Evidence class and download are below it; technical JSON stays collapsed.
- **Explicit wallet selection.** Connect Solana wallet lists every registered Wallet Standard wallet that advertises the current cluster (`solana:devnet` or `solana:mainnet`) together with `standard:connect` and `solana:signTransaction`. The owner picks one by name, even when only one exists. `connectSolanaWallet` requires that exact name, with no first-registered fallback, and refuses ambiguous duplicate names. Simulate and Execute never connect implicitly.
- **One wallet experience.** The panel shows "Wallet connected · Solana Devnet". The Solana session is per cluster and separate from EVM accounts. There is no new account abstraction.

## Intentional changes for owner review

- **Frozen Evidence Bundle enum.** The frozen v1 `evidence-bundle` schema allows only `MOCKED | FORK_REPRODUCED | TESTNET_EXECUTED | MAINNET_EXECUTED` and is protected by schema and hash tests, so it was not edited. A Devnet bundle therefore uses `bundle.environment: TESTNET_EXECUTED` (Devnet is a public non-mainnet cluster). The Gryloo evidence class and `publicExecution.environment` are `DEVNET_EXECUTED`, and its limitations state "Solana Devnet … not mainnet execution and not real funds". It is never `MAINNET_EXECUTED`. A future schema version could add a Devnet member.
- **Updated BUILD-014 linter test.** `packages/reference-linter/test/solana-swap.test.ts` "rejects devnet" asserted `SOLANA_CLUSTER_UNSUPPORTED` for any Devnet node. Devnet is now a supported runtime, so the case was rewritten rather than deleted. It still rejects mainnet USDC on Devnet (`SOLANA_MINT_UNSUPPORTED`), Jupiter on Devnet and Orca on mainnet (`SOLANA_SWAP_PROVIDER_UNSUPPORTED`), an unknown Solana cluster (`SOLANA_CLUSTER_UNSUPPORTED`) and composition.
- **BUILD-014 latent defect fixed.** On real public RPC, `simulateTransaction` reports an account closed by the transaction (the temporary wrapped-SOL account) as an empty, zero-lamport account, not `null`. The shared token-balance reader rejected it (`SOLANA_TOKEN_ACCOUNT_INVALID`). This affected Jupiter SOL legs too, which BUILD-014 had validated only with mocks and a USDC→USDT public simulation. Such accounts now read as absent. Found during the public Devnet read-only validation.
- **Generalized BUILD-014 internals.** The executor, reconciler, service, store and wallet now take the runtime from the review's chain. Error codes keep the `JUPITER_` prefix on mainnet and use `DEVNET_SWAP_` on Devnet. BUILD-014 names remain as aliases, and all BUILD-014 tests pass unchanged except the linter case above.
- **No dependency changes.** No dependency, lockfile, toolchain or BUILD-014 fixture changed.
- **CI.** `.github/workflows/contracts.yml` runs `solana-devnet.spec.ts` with `GRYLOO_SOLANA_DEVNET_E2E=MOCKED_LOOPBACK_ONLY` (loopback `127.0.0.1:8552`). All existing gates are unchanged.

## Public Devnet read-only validation (PUBLIC_READ_ONLY)

`node scripts/solana-devnet-readonly-validation.mjs <publicDevnetAddressWithSol>` uses a read-only transport that refuses `sendTransaction`. The 2026-10-01 run is recorded in [BUILD-DEMO-001-DEVNET-READONLY.json](BUILD-DEMO-001-DEVNET-READONLY.json). A public Devnet address belonging to an active pool trader was used only as the hypothetical fee payer for simulation with signature verification off; nothing was signed or sent.

- Genesis = Devnet. The Whirlpools program is executable (last deploy slot 439,560,432). The WhirlpoolsConfig is owned by Whirlpools.
- Both mints verified. Pool matches config, mints, vaults and tick spacing 64 (slot 506,358,693, liquidity 811,988,777,984). All six direction tick arrays are initialized.
- Exact Gryloo v0 message, SOL → devUSDC, 0.1 SOL:
  - expected 2.231353 devUSDC, minimum 2.220196 (50 bps), price impact incl. fee 0.2018%;
  - simulated spend exactly 100,000,000 lamports, output 2,231,353;
  - fee 5,000 lamports, 67,895 CU, 733-byte message;
  - Review guard PASS.
- Exact Gryloo v0 message, devUSDC → SOL, 1 devUSDC:
  - expected 0.044635568 SOL, minimum 0.04441239;
  - simulated output exact, 701-byte message;
  - Review guard PASS.
- A real Devnet pool account and a real `Traded` log are committed only as `PUBLIC_READ_ONLY` parser fixtures (`packages/reference-compiler/test/fixtures/orca-devnet-pool.json`).

## Validation

Local runs, 2026-10-01. Fixtures and the loopback harness are `MOCKED`; they are not `DEVNET_EXECUTED`.

- `pnpm check`: PASS. Typecheck, lint, production build, schema drift (no schema change) and 747 unit tests passed. The 2 pre-existing opt-in skips are not counted as passes. BUILD-014 recorded 709.
- New focused unit tests (38):
  - Orca compiler/codec: 17, including the real Devnet pool and `Traded` fixtures; tick-array sequence; exact-input `swap_v2` encoding; wrong cluster, token, decimals and provider; slippage; insufficient SOL/devUSDC; pre-existing wrapped SOL; pool-config mismatch; missing `Traded` event; below-minimum; stale, wrong-owner, semantic-change, tampered and changed-transaction Review; signature binding.
  - Devnet reconciliation and evidence: 6. Success in both directions, failed transaction, input and SOL balance mismatch, minimum violation, `Traded` mismatch, mainnet RPC, signature/transaction mismatch, finality and observation gaps, and `DEVNET_EXECUTED` vs `TESTNET_EXECUTED` vs `MOCKED` classification with a schema-valid bundle.
  - Devnet service lifecycle: 9. Full lifecycle, read-only and disabled execution, provenance/cluster/id isolation, stale/owner/semantic invalidation, wallet rejection, changed transaction, duplicate prevention, uncertain submission, expiry, restart cancellation, failed transaction and journal tamper.
  - Chat/canvas Devnet authoring: 5.
  - Linter/capability: 1 new, 1 updated.
- All BUILD-014 Jupiter unit suites pass unchanged.
- Browser, on the MOCKED loopback harnesses:
  - Solana Devnet: 7/7. Canvas and chat authoring; read-only simulation with network/provider labels; Review; Execute with the wallet asked for `solana:devnet`; Success result with signature and Devnet explorer link; wallet rejection; wallet-changed transaction; stale Review plus semantic invalidation; uncertain submission; reload plus expiry.
  - BUILD-014 Jupiter regression: 9/9.
  - Main CI browser group: 51 passed with the 4 pre-existing opt-in Mode B skips and original visual snapshots unchanged.

  Port 3000 was held by a server from the main checkout, which was left untouched. These runs therefore used a temporary, uncommitted local edit pointing the app origin at port 3100; it was reverted and verified identical. CI uses the committed configuration.
- Governance-lite and its 17 self-tests: PASS. `git diff --check`: PASS.
- No dependency or lockfile change; `pnpm audit` and the SBOM/integrity gates are left to CI.

## Owner execution (completed 2026-10-01; recorded above)

1. Fund a Wallet Standard Solana wallet (for example Phantom with Testnet Mode → Solana Devnet, or Solflare on Devnet) with **1 Devnet SOL** from [faucet.solana.com](https://faucet.solana.com). Nothing else is needed. The demo swap needs 0.1 SOL plus ≈0.0021 SOL refundable account deposits plus a 0.000005 SOL fee. To try "test USDC → SOL" later, first swap SOL → devUSDC in Gryloo.
2. From this branch: `pnpm build`, then `GRYLOO_SOLANA_DEVNET_JOURNAL=/absolute/dir/outside/git pnpm --filter @defi-workflow-engine/reference-dapp start`. Optionally set `GRYLOO_SOLANA_DEVNET_RPC_URL=https://…` for a Devnet RPC provider.
3. In Gryloo: click Connect Solana wallet and choose your wallet by name (for example Solflare). Then Swap, Network **Solana Devnet**, From Devnet SOL, To devUSDC (test), Amount 0.1, or chat "Swap 0.1 SOL to test USDC on Solana Devnet". Then Simulate → Review → Accept → Execute, sign the one transaction in the wallet, and wait for **Success**. Download the Evidence Bundle (class `DEVNET_EXECUTED`).
