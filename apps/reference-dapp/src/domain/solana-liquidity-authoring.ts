// SPDX-License-Identifier: AGPL-3.0-only
import { CONCENTRATED_LIQUIDITY_ACTION, createConcentratedLiquidityNode, readConcentratedLiquidity, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import { orcaAlignPriceRange, orcaPriceFromSqrtPrice, orcaSqrtPriceAtTick } from '@defi-workflow-engine/reference-compiler';
import { formatTokenAmount, parseTokenAmount } from './jupiter-authoring';

/**
 * Chat and canvas author the same canonical `asset.liquidity.concentrated` node. The network selects the runtime below
 * the IR: Solana Devnet → Orca Whirlpools (the verified SOL/devUSDC test pool). A price range is aligned to usable
 * ticks deterministically (lower bound down, upper bound up), so the IR always stores immutable ticks.
 */
export type SolanaLiquidityInput = { network: 'Solana Devnet'; maxSol: string; maxDevUsdc: string;
  /** Prices in devUSDC per SOL (`PRICE`) or tick indexes (`TICK`). */
  rangeUnit: 'PRICE' | 'TICK'; lower: string; upper: string; slippage: string };
export const SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE = '100';
const token = (t: typeof profile.token0) => ({ chainId: profile.chain, address: t.mint, decimals: t.decimals });
const amount = (text: string, decimals: number) => text === '0' ? '0' : parseTokenAmount(text, decimals);
export function solanaLiquidityTicks(input: Pick<SolanaLiquidityInput, 'rangeUnit' | 'lower' | 'upper'>): { tickLower: number; tickUpper: number } {
  if (input.rangeUnit === 'PRICE') return orcaAlignPriceRange(input.lower.trim(), input.upper.trim());
  if (!/^-?(0|[1-9][0-9]{0,5})$/.test(input.lower.trim()) || !/^-?(0|[1-9][0-9]{0,5})$/.test(input.upper.trim())) throw new Error('SOLANA_LIQUIDITY_RANGE_INVALID');
  const tickLower = Number(input.lower.trim()), tickUpper = Number(input.upper.trim());
  if (tickLower >= tickUpper || tickLower % profile.pool.tickSpacing || tickUpper % profile.pool.tickSpacing) throw new Error('SOLANA_LIQUIDITY_RANGE_INVALID');
  return { tickLower, tickUpper };
}
export function createSolanaLiquidityNode(nodeId: string, input: SolanaLiquidityInput): SemanticWorkflow['nodes'][number] {
  if (input.network !== 'Solana Devnet') throw new Error('SOLANA_CLUSTER_UNSUPPORTED');
  if (!/^[1-9][0-9]{0,3}$/.test(input.slippage) || Number(input.slippage) > profile.maximumSlippageBps) throw new Error('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  const amount0Max = amount(input.maxSol, profile.token0.decimals), amount1Max = amount(input.maxDevUsdc, profile.token1.decimals);
  if (amount0Max === '0' && amount1Max === '0') throw new Error('SOLANA_LIQUIDITY_ZERO');
  if (BigInt(amount0Max) > BigInt(profile.token0.maximumAmount) || BigInt(amount1Max) > BigInt(profile.token1.maximumAmount)) throw new Error('AMOUNT_OUT_OF_RANGE');
  const { tickLower, tickUpper } = solanaLiquidityTicks(input);
  return createConcentratedLiquidityNode(nodeId, { chain: profile.chain, token0: token(profile.token0), token1: token(profile.token1), amount0Max, amount1Max,
    amount0Min: '0', amount1Min: '0', tickLower, tickUpper, feeTier: profile.feeTier, slippageBps: Number(input.slippage), protocols: [profile.protocol], recipient: null,
    positionAsset: { chainId: profile.chain, address: profile.programs.whirlpool, decimals: 0 } });
}
export type SolanaLiquidityDetails = { network: 'Solana Devnet'; maxSol: string; maxDevUsdc: string; tickLower: number; tickUpper: number; lowerPrice: string;
  upperPrice: string; slippage: string; provider: string };
export function solanaLiquidityDetails(node: SemanticWorkflow['nodes'][number] | { readonly actionType: string; readonly chainId: string }): SolanaLiquidityDetails | null {
  if (node.actionType !== CONCENTRATED_LIQUIDITY_ACTION || node.chainId !== profile.chain) return null;
  try {
    const f = readConcentratedLiquidity(node as SemanticWorkflow['nodes'][number]);
    if (f.token0.address !== profile.token0.mint || f.token1.address !== profile.token1.mint || f.protocols.join() !== profile.protocol) return null;
    const price = (tick: number) => orcaPriceFromSqrtPrice(orcaSqrtPriceAtTick(tick), profile.token0.decimals, profile.token1.decimals);
    return { network: 'Solana Devnet', maxSol: formatTokenAmount(f.amount0Max, profile.token0.decimals), maxDevUsdc: formatTokenAmount(f.amount1Max, profile.token1.decimals),
      tickLower: f.tickLower, tickUpper: f.tickUpper, lowerPrice: price(f.tickLower), upperPrice: price(f.tickUpper), slippage: String(f.slippageBps ?? ''),
      provider: profile.providerLabel };
  } catch { return null; }
}
/** Editing input that reproduces the node exactly (ticks are already aligned). */
export function solanaLiquidityInputOf(details: SolanaLiquidityDetails): SolanaLiquidityInput {
  return { network: 'Solana Devnet', maxSol: details.maxSol, maxDevUsdc: details.maxDevUsdc, rangeUnit: 'TICK', lower: String(details.tickLower), upper: String(details.tickUpper),
    slippage: details.slippage };
}
const N = '([0-9]+(?:\\.[0-9]+)?)', T = '(-?[0-9]+)';
export const SOLANA_LIQUIDITY_PATTERN = new RegExp(`^(?:add|provide|create) (?:orca )?liquidity (?:with )?${N} (?:test )?SOL and ${N} (?:test USDC|devUSDC|USDC) ` +
  `(?:from ${N} to ${N} devUSDC per SOL|ticks ${T} to ${T}) on Solana Devnet(?: (?:with )?slippage ([0-9]+) bps)?$`, 'i');
/** "Add liquidity 0.01 SOL and 0.30 devUSDC from 20.12 to 24.59 devUSDC per SOL on Solana Devnet [slippage 100 bps]". */
export function parseSolanaLiquidityChat(text: string): SolanaLiquidityInput | null {
  const match = SOLANA_LIQUIDITY_PATTERN.exec(text.trim());
  if (!match) return null;
  const price = match[3] !== undefined;
  return { network: 'Solana Devnet', maxSol: match[1]!, maxDevUsdc: match[2]!, rangeUnit: price ? 'PRICE' : 'TICK', lower: price ? match[3]! : match[5]!,
    upper: price ? match[4]! : match[6]!, slippage: match[7] ?? SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE };
}
