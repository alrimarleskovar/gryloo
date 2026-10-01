// SPDX-License-Identifier: Apache-2.0
import { ORCA_WHIRLPOOLS_DEVNET, SOLANA_DEVNET_TOKENS } from './solana-devnet.js';

/**
 * Orca Whirlpools concentrated-liquidity positions on Solana Devnet: the Solana runtime of the canonical
 * `asset.liquidity.concentrated` action, against the same verified Devnet test pool as the BUILD-DEMO-001 swap.
 *
 * Sources (checked 2026-10-01): the Whirlpools program source at orca-so/whirlpools commit
 * e5f089bc5c49b01f5c8abb43c78457ab6c440568 (the last program change before the Devnet deployment at slot 439,560,432,
 * 2026-02-03), and read-only Devnet simulation of every instruction below against the deployed program.
 *
 * Position model: `open_position_with_token_extensions` creates a Token-2022 position mint whose address is a fresh
 * keypair. That keypair signs only to create the mint account; mint, freeze and close authority belong to the
 * position PDA ["position", mint] and the mint authority is removed after the single mint. The position authority is
 * whoever owns the position token account: the owner's wallet. Closing returns every rent deposit.
 */
export const ORCA_LIQUIDITY_ACTION = 'asset.liquidity.concentrated';
export const ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY = Object.freeze({
  chain: ORCA_WHIRLPOOLS_DEVNET.chain, network: 'Solana Devnet', cluster: 'devnet', walletChain: 'solana:devnet',
  genesisHash: ORCA_WHIRLPOOLS_DEVNET.genesisHash, protocol: 'orca-whirlpools', adapterId: 'orca.whirlpools-devnet-liquidity',
  providerLabel: 'Orca Whirlpools', rpc: ORCA_WHIRLPOOLS_DEVNET.rpc, explorer: ORCA_WHIRLPOOLS_DEVNET.explorer,
  officialSource: 'https://github.com/orca-so/whirlpools/tree/e5f089bc5c49b01f5c8abb43c78457ab6c440568/programs/whirlpool',
  docsSource: ORCA_WHIRLPOOLS_DEVNET.officialSource,
  programs: Object.freeze({ ...ORCA_WHIRLPOOLS_DEVNET.programs, token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }),
  whirlpoolsConfig: ORCA_WHIRLPOOLS_DEVNET.whirlpoolsConfig,
  pool: ORCA_WHIRLPOOLS_DEVNET.pool,
  /** Token A / token B of the pool are token0 / token1 of the canonical action. */
  token0: SOLANA_DEVNET_TOKENS.SOL, token1: SOLANA_DEVNET_TOKENS.devUSDC,
  /** Pool fee rate in hundredths of a basis point (0.20%), read from the pool account. */
  feeTier: 2000,
  /** Constraint `metadata_update_auth` of open_position_with_token_extensions (constants/nft.rs). */
  metadataUpdateAuth: '3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr',
  /** Anchor sha256("global:<name>")[0..8]. */
  instructions: Object.freeze({ openPositionWithTokenExtensions: 'd42f5f5c726683fa', increaseLiquidityV2: '851d59df45eeb00a',
    decreaseLiquidityV2: '3a7fbc3e4f52c460', collectFeesV2: 'cf755fbfe5b4e20f', closePositionWithTokenExtensions: '01b6873b9b1963df' }),
  /** Anchor sha256("event:<name>")[0..8]; equal to the events observed in Devnet simulation logs. */
  events: Object.freeze({ positionOpened: 'edaff3e693756579', liquidityIncreased: '1e0790b566fe9ba1', liquidityDecreased: 'a601244770cab5ab' }),
  /** sha256("account:Position")[0..8]. */
  positionDiscriminator: 'aabc8fe47a40f7d0',
  /** sha256("account:TickArray")[0..8]: fixed-size tick arrays (the Devnet pool's arrays are 9,988-byte fixed arrays). */
  tickArrayDiscriminator: '4561bdbe6e0742bb',
  tickArraySize: 88, minTick: -443_636, maxTick: 443_636,
  maximumSlippageBps: 300, reviewTtlSeconds: 60, baseFeeLamports: '5000', maximumComputeUnits: 400_000,
});
export type OrcaLiquidityOperation = 'OPEN' | 'DECREASE_PARTIAL' | 'EXIT';
export const ORCA_LIQUIDITY_OPERATIONS: readonly OrcaLiquidityOperation[] = Object.freeze(['OPEN', 'DECREASE_PARTIAL', 'EXIT']);
