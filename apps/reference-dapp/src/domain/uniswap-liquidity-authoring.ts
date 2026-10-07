// SPDX-License-Identifier: AGPL-3.0-only
import { CONCENTRATED_LIQUIDITY_ACTION, createConcentratedLiquidityNode, readConcentratedLiquidity, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY, UNISWAP_LIQUIDITY_PROFILES, uniswapLiquidityProfile, type UniswapLiquidityProfile } from '@defi-workflow-engine/action-registry';
import { validateUniswapLiquidityNode } from '@defi-workflow-engine/reference-linter';
import { uniswapAlignQuotePriceRange, uniswapBandAroundSqrtPrice, uniswapQuotePriceAtTick } from '@defi-workflow-engine/reference-compiler';
import { formatTokenAmount, parseTokenAmount } from './jupiter-authoring';

/**
 * Chat and canvas author the same canonical `asset.liquidity.concentrated` node. On Base Sepolia (USDC/WETH 0.05%) and
 * Ethereum Sepolia (USDC/WETH 0.3%, BUILD-ETHEREUM-001) the runtime is Uniswap v3 executed by the owner's browser wallet.
 * The named network selects the profile (pool, fee tier, tick spacing). Ranges are entered as USDC-per-WETH prices, as
 * ticks, or as ±N% around the current pool price; all three become immutable aligned ticks in the IR by exact integer
 * search (no floating point), so the reviewed ticks are exactly what executes.
 */
export type UniswapLiquidityNetwork = UniswapLiquidityProfile['network'];
export type UniswapLiquidityInput = { network: UniswapLiquidityNetwork; maxUsdc: string; maxWeth: string;
  /** Prices in USDC per WETH (`PRICE`) or tick indexes (`TICK`). */
  rangeUnit: 'PRICE' | 'TICK'; lower: string; upper: string; slippage: string };
export const UNISWAP_LIQUIDITY_NETWORKS: readonly UniswapLiquidityNetwork[] = Object.freeze(UNISWAP_LIQUIDITY_PROFILES.map(profile => profile.network));
export const UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE = String(UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY.defaultSlippageBps);
/** The profile of a named network; any other name is unsupported. */
export function uniswapLiquidityProfileFor(network: string): UniswapLiquidityProfile {
  const profile = UNISWAP_LIQUIDITY_PROFILES.find(item => item.network === network);
  if (!profile) throw new Error('UNISWAP_LIQUIDITY_NETWORK_UNSUPPORTED');
  return profile;
}
const token = (profile: UniswapLiquidityProfile, t: UniswapLiquidityProfile['token0'] | UniswapLiquidityProfile['token1']) =>
  ({ chainId: profile.chain, address: t.address, decimals: t.decimals });
const amount = (text: string, decimals: number) => text.trim() === '0' ? '0' : parseTokenAmount(text.trim(), decimals);
const BASE = UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY;
/** USDC per WETH at a tick (token0 per token1: a higher tick is a lower price). Both profiles are USDC (6) / WETH (18). */
export const uniswapPriceAtTick = (tick: number) => uniswapQuotePriceAtTick(tick, BASE.token0.decimals, BASE.token1.decimals, 8);
export function uniswapLiquidityTicks(input: Pick<UniswapLiquidityInput, 'network' | 'rangeUnit' | 'lower' | 'upper'>): { tickLower: number; tickUpper: number } {
  const profile = uniswapLiquidityProfileFor(input.network);
  if (input.rangeUnit === 'PRICE') {
    try { return uniswapAlignQuotePriceRange(input.lower.trim(), input.upper.trim(), profile.token0.decimals, profile.token1.decimals, profile.tickSpacing); }
    catch { throw new Error('UNISWAP_LIQUIDITY_RANGE_INVALID'); }
  }
  if (input.rangeUnit !== 'TICK' || !/^-?(0|[1-9][0-9]{0,5})$/.test(input.lower.trim()) || !/^-?(0|[1-9][0-9]{0,5})$/.test(input.upper.trim()))
    throw new Error('UNISWAP_LIQUIDITY_RANGE_INVALID');
  const tickLower = Number(input.lower.trim()), tickUpper = Number(input.upper.trim());
  if (tickLower >= tickUpper || tickLower % profile.tickSpacing || tickUpper % profile.tickSpacing) throw new Error('UNISWAP_LIQUIDITY_RANGE_INVALID');
  return { tickLower, tickUpper };
}
/**
 * ±bandBps around the current pool price (read-only state), returned as exact ticks plus their prices. The network's tick
 * spacing aligns the band (Base Sepolia unless named); a band on the wrong spacing is refused when the node is created.
 */
export function uniswapBandInput(sqrtPriceX96: string, bandBps: number, network: UniswapLiquidityNetwork = BASE.network): Pick<UniswapLiquidityInput, 'rangeUnit' | 'lower' | 'upper'> & { lowerPrice: string; upperPrice: string } {
  if (!/^[1-9][0-9]{0,48}$/.test(sqrtPriceX96)) throw new Error('UNISWAP_PRICE_INVALID');
  const { tickLower, tickUpper } = uniswapBandAroundSqrtPrice(BigInt(sqrtPriceX96), bandBps, uniswapLiquidityProfileFor(network).tickSpacing);
  return { rangeUnit: 'TICK', lower: String(tickLower), upper: String(tickUpper), lowerPrice: uniswapPriceAtTick(tickUpper), upperPrice: uniswapPriceAtTick(tickLower) };
}
export function createUniswapLiquidityNode(nodeId: string, input: UniswapLiquidityInput): SemanticWorkflow['nodes'][number] {
  const profile = uniswapLiquidityProfileFor(input.network), t0 = profile.token0, t1 = profile.token1;
  if (!/^[1-9][0-9]{0,3}$/.test(input.slippage) || Number(input.slippage) > profile.maximumSlippageBps) throw new Error('UNISWAP_SLIPPAGE_OUT_OF_RANGE');
  const amount0Max = amount(input.maxUsdc, t0.decimals), amount1Max = amount(input.maxWeth, t1.decimals);
  if (amount0Max === '0' && amount1Max === '0') throw new Error('UNISWAP_LIQUIDITY_ZERO');
  if (BigInt(amount0Max) > BigInt(t0.maximumAmount) || BigInt(amount1Max) > BigInt(t1.maximumAmount)) throw new Error('AMOUNT_OUT_OF_RANGE');
  const { tickLower, tickUpper } = uniswapLiquidityTicks(input);
  const node = createConcentratedLiquidityNode(nodeId, { chain: profile.chain, token0: token(profile, t0), token1: token(profile, t1), amount0Max, amount1Max,
    amount0Min: '0', amount1Min: '0', tickLower, tickUpper, feeTier: profile.feeTier, slippageBps: Number(input.slippage), protocols: [profile.protocol],
    recipient: null, positionAsset: { chainId: profile.chain, address: profile.positionManager, decimals: 0 } });
  validateUniswapLiquidityNode(node);
  return node;
}
export type UniswapLiquidityDetails = { network: UniswapLiquidityNetwork; maxUsdc: string; maxWeth: string; tickLower: number; tickUpper: number;
  /** USDC per WETH: the LOWER price comes from tickUpper. */
  lowerPrice: string; upperPrice: string; slippage: string; provider: string; pool: string; feeTier: number };
export function uniswapLiquidityDetails(node: SemanticWorkflow['nodes'][number] | { readonly actionType: string; readonly chainId: string }): UniswapLiquidityDetails | null {
  const profile = node.actionType === CONCENTRATED_LIQUIDITY_ACTION ? uniswapLiquidityProfile(node.chainId) : null;
  if (!profile) return null;
  const t0 = profile.token0, t1 = profile.token1;
  try {
    const f = readConcentratedLiquidity(node as SemanticWorkflow['nodes'][number]);
    if (f.token0.address !== t0.address || f.token1.address !== t1.address || f.protocols.join() !== profile.protocol) return null;
    return { network: profile.network, maxUsdc: formatTokenAmount(f.amount0Max, t0.decimals), maxWeth: formatTokenAmount(f.amount1Max, t1.decimals),
      tickLower: f.tickLower, tickUpper: f.tickUpper, lowerPrice: uniswapPriceAtTick(f.tickUpper), upperPrice: uniswapPriceAtTick(f.tickLower),
      slippage: String(f.slippageBps ?? ''), provider: profile.providerLabel, pool: profile.pool, feeTier: f.feeTier };
  } catch { return null; }
}
/** Editing input that reproduces the node exactly (ticks are already aligned). */
export function uniswapLiquidityInputOf(details: UniswapLiquidityDetails): UniswapLiquidityInput {
  return { network: details.network, maxUsdc: details.maxUsdc, maxWeth: details.maxWeth, rangeUnit: 'TICK', lower: String(details.tickLower),
    upper: String(details.tickUpper), slippage: details.slippage };
}
const N = '([0-9]+(?:\\.[0-9]+)?)', T = '(-?[0-9]+)';
export const UNISWAP_LIQUIDITY_PATTERN = new RegExp(`^(?:add|provide|create) (?:uniswap )?liquidity (?:with )?${N} (?:test )?USDC and ${N} (?:test )?WETH ` +
  `(?:from ${N} to ${N} USDC per WETH|ticks ${T} to ${T}) on (Base Sepolia|Ethereum Sepolia)(?: (?:with )?slippage ([0-9]+) bps)?$`, 'i');
/** "Add liquidity 10 USDC and 0.005 WETH from 2000 to 3000 USDC per WETH on Base Sepolia [slippage 100 bps]" (or on Ethereum Sepolia). */
export function parseUniswapLiquidityChat(text: string): UniswapLiquidityInput | null {
  const match = UNISWAP_LIQUIDITY_PATTERN.exec(text.trim());
  if (!match) return null;
  const price = match[3] !== undefined;
  return { network: /^base sepolia$/i.test(match[7]!) ? 'Base Sepolia' : 'Ethereum Sepolia', maxUsdc: match[1]!, maxWeth: match[2]!,
    rangeUnit: price ? 'PRICE' : 'TICK', lower: price ? match[3]! : match[5]!, upper: price ? match[4]! : match[6]!, slippage: match[8] ?? UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE };
}
