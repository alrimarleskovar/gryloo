# BUILD-014 — Jupiter / Solana portability report

STATUS: READY_FOR_OWNER_EXECUTION

Work follows [GOVERNANCE-LITE](../SCOPE_GUARD.md): branch `claude/build-014-jupiter` from main `7726970`, one PR, owner merge. No path manifest, byte pin or governance amendment was created. No mainnet transaction was signed or broadcast; nothing here is `PUBLIC_EXECUTED`.

## Jupiter source and network support

Checked 2026-10-01 against official Jupiter documentation:

- [Swap API overview](https://developers.jup.ag/docs/swap/index.md), [Build (Router)](https://developers.jup.ag/docs/swap/build), [Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute.md), [OpenAPI spec](https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml), [developer docs index](https://developers.jup.ag/docs/llms.txt).
- The Metis v1 `/swap/v1/quote` + `/swap` API is documented as no longer maintained and superseded by Swap V2.
- Gryloo uses **`GET https://api.jup.ag/swap/v2/build`** (Router, Metis routing, exact input). Jupiter documents it as the path where the integrator assembles, signs (owner wallet) and sends the transaction itself; `/execute` is unavailable for `/build` and no Jupiter swap fee is charged. `/order` was not used: it returns an opaque assembled transaction intended for Jupiter's managed `/execute`, and RFQ routes require a market-maker co-signature after the owner signs.
- Keyless access is documented at reduced rate limits; an optional `JUPITER_API_KEY` is sent only as the `x-api-key` header and is never stored or logged.
- Instruction identity: the response's swap instruction targets Jupiter v6 `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` with Anchor discriminators `route_v2` (`bb64facc31c4af14`) or `shared_accounts_route_v2` (`d19853937cfed8e9`). The public `jup-ag/jupiter-cpi` IDL predates these v2 instructions, so the fixed argument layout (`in_amount`, `quoted_out_amount`, `slippage_bps`, `platform_fee_bps`, `positive_slippage_bps`) and leading accounts were derived from live responses and verified against PDA/ATA derivations (program authority `["authority", id]`, event authority `["__event_authority"]`, owner and authority associated token accounts). Any other instruction fails closed.

**Network support:** Swap V2 has no cluster parameter; its server list is only `api.jup.ag`; the devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` returns `400 {"error":"No routes found"}`; the returned blockhash is mainnet. Jupiter execution is **mainnet-beta only**. No devnet or testnet path exists, so the build stops at READY_FOR_OWNER_EXECUTION. Cluster identity is `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`), verified on every simulation and reconciliation.

Token profile (read from mainnet-beta, slot 452337813; all classic SPL Token mints): SOL via wrapped SOL `So11111111111111111111111111111111111111112` (9), USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (6), USDT `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` (6).

## Implementation

- **Canonical action.** The existing `asset.swap.exact-input` action with the same ports (`amount-in` QUANTITY, `asset-out` ASSET), output `amount-out`, `MAXIMUM_INPUT` and `MAXIMUM_SLIPPAGE_BPS` constraints, `swap.direct-transaction` capability and Mode A authorization as the EVM swap. Only chain, mint identity (cluster + mint + decimals) and the `jupiter` protocol constraint differ. A chain-neutral reader/constructor lives in `workflow-contracts`; EVM swap code is unchanged. The owner is bound at Review, exactly as for the existing EVM swap.
- **Chat and canvas.** `Swap 10 USDC to SOL on Solana` (optional `slippage N bps`) and the canvas Swap form with Network: Solana, From, To, Amount produce byte-identical IR through the shared reducer and proposal review. `set node-002 amount …` / `slippage … bps` edit it.
- **Adapter (compiler).** Validates the `/build` quote against the intent (mints, exact input, ExactIn, slippage, minimum ≥ slippage bound, route split), then inspects every instruction against an allowlist bound to the owner: one compute-unit price, idempotent ATA creation for the owner's own input/output accounts, an exact-amount SOL wrap, the Jupiter swap with matching in-amount/quoted-out/slippage, zero platform fee, owner signer, owner source/destination accounts and no alternate destination, and only a wrapped-SOL close back to the owner. No tip or other instruction, and no signer other than the owner. Lookup-table contents are read from the chain, not taken from Jupiter. Gryloo adds the compute-unit limit, compiles the v0 message itself, round-trips it, and binds its SHA-256 as the plan payload.
- **Simulation.** Read-only `simulateTransaction` of the exact message (signature verification off, nothing signed). The owner's input spend must equal the amount, and the simulated output must meet the minimum. The UI shows Swap X → expected Y, Solana, Jupiter, quoted output, minimum received, slippage, estimated network fee, any refundable token-account deposit, and quote freshness. Technical details stay collapsed.
- **Review.** The commitment covers workflow revision, cluster, owner, mints, amount, slippage/minimum, route commitment, message hash, blockhash and expiry (60 s, and 20 blocks before `lastValidBlockHeight`). It reuses the frozen v1 artifact chain: ArtifactSet → SimulationBundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan → ExecutionJournal → EvidenceBundle. A semantic edit invalidates authorization.
- **Wallet.** A minimal Wallet Standard client (`standard:connect`, `solana:signTransaction` on `solana:mainnet`) with no new dependency. It signs only; there is no sign-and-send, no keys and no automatic signing. The server accepts only the byte-identical reviewed message carrying a valid Ed25519 owner signature. A modified, mis-signed or stale transaction is never broadcast. Any wallet error is a concrete pre-submission failure: no signature exists.
- **Execution and recovery.** An attempt is durably `PREPARED` (with an append-only per-owner lease) before the wallet is asked. The signature and signed bytes are durable before one `sendTransaction`. An RPC error leaves the attempt `SUBMISSION_RESULT_UNKNOWN`, and only the existing signature is observed. Finalized block height past the reviewed `lastValidBlockHeight` with the signature absent proves non-landing (`EXPIRED`/`NOT_FOUND`, verdict `NOT_EXECUTED`). Only then can the owner review a new swap. There is no resubmission path.
- **Reconciliation.** Uses finalized `getTransaction`. The raw transaction must be byte-identical to the owner-signed bytes, and the loaded addresses must equal the reviewed lookup resolution. It checks fee payer/owner, `meta.err`, fee ≤ estimate, and pre/post token balances for the owner's exact input/output accounts. Native SOL deltas account for fee and new-account rent. Input delta must equal the amount exactly and output must meet the minimum. Other owner token accounts must be unchanged, as must owner SOL without a native leg, and wrapped SOL must be closed. Top-level and inner program evidence is recorded. Mismatch is `DIVERGENT`; provider gaps are `INCONCLUSIVE`.
- **Evidence.** A schema-valid Evidence Bundle with cluster, owner, Jupiter, mints, requested input, quoted/minimum output, actual deltas, signature, slot, block time, fee, route/program evidence, verdict and explorer link. Classes: `MOCKED` (loopback), `PUBLIC_READ_ONLY` (public run without owner execution), `PUBLIC_EXECUTED` (only an owner-initiated, independently reconciled mainnet run; bundle environment `MAINNET_EXECUTED`).
- **Mainnet gate.** Public simulation and Review are read-only. Owner execution requires the server opt-in `GRYLOO_JUPITER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`, an explicit in-app real-funds acknowledgement, the owner's Execute click and the owner's wallet signature.

## Public read-only validation (PUBLIC_READ_ONLY)

Read-only requests only; no wallet, signature or broadcast. A public address was used solely as the hypothetical `taker`/fee payer for quoting and signature-verification-off simulation.

- 2026-10-01T16:08Z, real `/build` USDC→SOL (10 USDC): `route_v2` via one AMM, 85,020,593 lamports quoted, minimum 84,595,491, wrap/unwrap shape and one lookup table. It parses and passes inspection (recorded as a CI fixture).
- 2026-10-01T16:56:29Z, full pipeline for 1 USDC→USDT, owner `2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S` at slot 452347560: live multi-hop route (1DEX, TesseraV) via `shared_accounts_route_v2`. Two lookup tables were verified on-chain, and the exact v0 message was compiled (message hash `0x55131fc4…765a2`, compute limit 189,962). Real mainnet `simulateTransaction` spent exactly 1,000,000 USDC units and received 999,784 USDT units, against a quote of 1,000,584 and a minimum of 995,582. Owner lamports fell by exactly the estimated 5,404-lamport fee. An earlier run against a busy exchange hot wallet failed closed (`JUPITER_SIMULATED_OUTPUT_BELOW_MINIMUM`) because its balance moved between reads.
- The recorded responses are committed only as `PUBLIC_READ_ONLY` parser fixtures; no public execution is claimed.

## Validation (local, 2026-10-01)

- `pnpm check`: PASS. Typecheck, lint, production build, schema drift and 709 unit tests; 2 pre-existing opt-in skips are not counted as passes.
- Focused BUILD-014 unit tests: 71 in 7 files. They cover the compiler/codec (30, including both real fixtures and adversarial quote/instruction cases), reconciler (9), executor (5), service lifecycle (12), contracts portability (3), linter/capability (7) and chat/canvas authoring (5).
- Browser on the MOCKED loopback harness: Jupiter 9/9 (canvas and chat authoring, read-only simulation, Review, Execute, MOCKED evidence, wallet rejection, wallet-modified transaction, stale quote, semantic invalidation, uncertain submission, reload plus expiry, pending-signature freeze). Regression: main CI group 51 passed with 4 pre-existing opt-in Mode B skips and original snapshots unchanged; Supply 18/18; Mode A 13/13; CoW 9/9. Composition browser/fork suites need the BUILD-007 downloaded artifacts and were left to CI. Fonts and browser libraries used the integrity-verified extractions under `/tmp`, as in BUILD-012A.
- Dependency integrity/license/release-age: 247 entries PASS, 16 unchanged exceptions. `pnpm audit`: no known vulnerabilities. Governance-lite and its 17 self-tests: PASS. `git diff --check`: PASS.

## Intentional control changes (for owner review)

- `packages/reference-compiler` now depends on `@noble/curves@2.4.0`, already locked and pinned for the executor and reconciler, for Ed25519 verification and PDA off-curve checks. The exact-dependency allowlist in `scripts/bootstrap-ci.py` gains that one entry. The lockfile gains only the importer link; no new package enters the graph.
- `.github/workflows/contracts.yml` runs `jupiter.spec.ts` with `GRYLOO_JUPITER_E2E=MOCKED_LOOPBACK_ONLY`. All existing gates are unchanged.

## Limitations

- Only classic SPL Token mints SOL/USDC/USDT, exact input, one isolated swap.
- An owner with an existing wrapped-SOL account cannot swap a SOL leg until it is unwrapped (`JUPITER_WRAPPED_SOL_ACCOUNT_PRESENT`), because closing it would mix pre-existing balance into the measured delta.
- Some wallets add their own instructions while signing. Gryloo then refuses to broadcast (`JUPITER_TRANSACTION_CHANGED`) rather than sign-and-send an unreviewed message. No real wallet has been exercised yet.
- The public RPC is rate limited. `GRYLOO_SOLANA_RPC_URL` (HTTPS) may point to an owner-chosen provider.

## Owner action required for PUBLIC_EXECUTED

1. Merge decision is the owner's. Execution can be tested from this branch.
2. Run the DApp with `GRYLOO_JUPITER_JOURNAL=<absolute dir outside Git>` and `GRYLOO_JUPITER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`, optionally with `GRYLOO_SOLANA_RPC_URL` and `JUPITER_API_KEY`.
3. Use a Wallet Standard Solana wallet holding a small USDC amount and enough SOL for fees (about 0.00001 SOL, plus about 0.00204 SOL if a new token account is created) and no wrapped-SOL account for SOL legs.
4. Author "Swap 1 USDC to SOL on Solana", Simulate, Review, acknowledge real funds, Execute, sign in the wallet, then download the Evidence Bundle once it shows `PUBLIC_EXECUTED`.
