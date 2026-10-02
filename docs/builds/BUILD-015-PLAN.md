# BUILD-015 plan — Solana liquidity / Orca Whirlpools

Work follows [GOVERNANCE-LITE](../SCOPE_GUARD.md). Branch `claude/build-015-solana-liquidity` from main `f2b8afa` (merged BUILD-DEMO-001). One PR, owner merge. Raydium, mainnet, rebalancing, auto-compounding, swap→liquidity and cross-chain composition are out of scope.

## Product principle: one semantic liquidity intent

```
asset.liquidity.concentrated  (token pair, per-token maxima/minima, immutable ticks, fee tier, slippage, one position)
        │  runtime / capability resolution (chain + protocol constraint)
        ├── eip155:8453 + uniswap-v3      → Uniswap v3 (BUILD-006, accepted spelling asset.liquidity.uniswap-v3)
        └── Solana Devnet + orca-whirlpools → Orca Whirlpools (BUILD-015)
```

BUILD-006's `asset.liquidity.uniswap-v3` already has chain-neutral ports (`amount0/1-max`, `amount0/1-min`, `tick-lower/upper`, `fee-tier`, output `position-nft`) but a provider-named id and an EVM recipient. Accepted BUILD-006/007/011C evidence binds those exact bytes, so the refactor is additive:

- `workflow-contracts` gains the neutral `asset.liquidity.concentrated` (same ports and output, slippage constraint, recipient = the executing owner bound at Review) and one reader, `readConcentratedLiquidity`, for both spellings.
- EVM authoring keeps emitting the BUILD-006 bytes; nothing EVM changes.
- There is no `solana.liquidity.*` action. Wallet is session state, never a node.

## Verified provider facts (before implementation)

- Program `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`, Devnet deploy slot 439,560,432 (2026-02-03). Source reviewed at orca-so/whirlpools `e5f089bc5c49` (the last program change before that deploy; later `main` changes are not deployed).
- Position model: `open_position_with_token_extensions` (Token-2022 NFT, position PDA `["position", mint]`); the new mint keypair signs only its own account creation; mint/freeze/close authority → position PDA; mint authority removed. Position authority = owner of the position token account.
- Lifecycle: `increase_liquidity_v2`, `decrease_liquidity_v2` (principal paid directly to the owner), `collect_fees_v2` (only `fee_owed`), `close_position_with_token_extensions` (requires zero liquidity/fees/rewards; refunds all rent).
- Existing BUILD-DEMO-001 pool `3KBZiL2g…HvPt`: tick spacing 64, fee 2000, no reward emitters, fixed-size tick arrays initialized around the price. Read-only simulation of the exact Gryloo messages succeeds for every instruction. **No blocker.**

## Transactions (minimum safe count)

| Operation | Instructions | Signers |
|---|---|---|
| OPEN | compute limit · wSOL ATA · exact wrap · sync · devUSDC ATA (idempotent) · open_position_with_token_extensions · increase_liquidity_v2 · unwrap | owner, client-side position mint |
| DECREASE_PARTIAL | compute limit · wSOL ATA · devUSDC ATA · decrease_liquidity_v2 (bps of liquidity, slippage minimums) · collect_fees_v2 · unwrap | owner |
| EXIT | compute limit · wSOL ATA · devUSDC ATA · decrease_liquidity_v2 (all) · collect_fees_v2 · close_position_with_token_extensions · unwrap | owner |

Inspect is read-only. Each operation is one reviewed message, one wallet request and one recovery boundary.

## Signer safety

The position-mint key is a non-extractable WebCrypto Ed25519 key created in the browser per OPEN simulation. Only its public key reaches the server. The wallet signs the exact reviewed message first; only if the returned message is byte-identical does the mint key add its signature. After the open, the key has no authority. A reload drops the key, so a prepared-but-unsigned OPEN is recorded as not submitted.

## Delivery

Implementation, unit/loopback/browser tests, `PUBLIC_READ_ONLY` Devnet validation, post-execution verifier, report, one PR. Stop at `READY_FOR_OWNER_EXECUTION`; the owner signs the public Devnet transactions; only then `DEVNET_EXECUTED`.
