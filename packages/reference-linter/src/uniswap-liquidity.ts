// SPDX-License-Identifier: AGPL-3.0-only
import { CONCENTRATED_LIQUIDITY_ACTION, createConcentratedLiquidityNode, readConcentratedLiquidity, type ConcentratedLiquidityFields,
  type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';

/** The position asset of a Uniswap v3 position: one ERC-721 unit issued by the NonfungiblePositionManager. */
export const UNISWAP_POSITION_ASSET = Object.freeze({ chainId: profile.chain, address: profile.positionManager, decimals: 0 });
export const isUniswapLiquidityNode = (node: { actionType: string; chainId: string }) =>
  node.actionType === CONCENTRATED_LIQUIDITY_ACTION && node.chainId === profile.chain;

const fail = (code: string): never => { throw new Error(code); };
const sorted = (v: unknown): string => JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
// Usable ticks for spacing 10 (MIN/MAX_TICK ±887,272 rounded inward).
const MIN_USABLE_TICK = -887_270, MAX_USABLE_TICK = 887_270;

/**
 * The canonical concentrated-liquidity action resolved against its public EVM runtime: Uniswap v3 on Base Sepolia,
 * the verified USDC/WETH 0.05% pool. token0/token1 MUST follow the pool's order (USDC < WETH by address), ticks must
 * be usable on spacing 10, maxima are capped, minimums stay 0 in the IR (the binding minimums are derived from the
 * simulation and the slippage limit at Review), and the position recipient is always the executing owner (`null`).
 */
export function validateUniswapLiquidityNode(node: SemanticWorkflow['nodes'][number]): ConcentratedLiquidityFields {
  if (!isUniswapLiquidityNode(node)) fail('UNISWAP_LIQUIDITY_ACTION_INVALID');
  let fields: ConcentratedLiquidityFields;
  try { fields = readConcentratedLiquidity(node); } catch { return fail('UNISWAP_LIQUIDITY_DECLARATION_INVALID'); }
  const t0 = profile.token0, t1 = profile.token1;
  if (fields.token0.address === t1.address && fields.token1.address === t0.address) fail('UNISWAP_TOKEN_ORDER_INVALID');
  if (fields.token0.address !== t0.address || fields.token1.address !== t1.address || fields.token0.decimals !== t0.decimals || fields.token1.decimals !== t1.decimals)
    fail('UNISWAP_TOKEN_UNSUPPORTED');
  if (fields.protocols.length !== 1 || fields.protocols[0] !== profile.protocol) fail('UNISWAP_LIQUIDITY_PROVIDER_UNSUPPORTED');
  if (fields.feeTier !== profile.feeTier) fail('UNISWAP_FEE_TIER_UNSUPPORTED');
  if (fields.tickLower % profile.tickSpacing !== 0 || fields.tickUpper % profile.tickSpacing !== 0 || fields.tickLower < MIN_USABLE_TICK ||
      fields.tickUpper > MAX_USABLE_TICK || fields.tickLower >= fields.tickUpper) fail('UNISWAP_LIQUIDITY_RANGE_INVALID');
  if (fields.slippageBps === null || fields.slippageBps < 1 || fields.slippageBps > profile.maximumSlippageBps) fail('UNISWAP_SLIPPAGE_OUT_OF_RANGE');
  if (BigInt(fields.amount0Max) > BigInt(t0.maximumAmount) || BigInt(fields.amount1Max) > BigInt(t1.maximumAmount)) fail('AMOUNT_OUT_OF_RANGE');
  if (fields.amount0Min !== '0' || fields.amount1Min !== '0' || fields.recipient !== null || sorted(fields.positionAsset) !== sorted(UNISWAP_POSITION_ASSET))
    fail('UNISWAP_LIQUIDITY_DECLARATION_INVALID');
  // Closed declaration: the node must be byte-equivalent to the canonical construction (Mode A, ABORT, no edges).
  let canonical: SemanticWorkflow['nodes'][number];
  try { canonical = createConcentratedLiquidityNode(node.nodeId, fields); } catch { return fail('UNISWAP_LIQUIDITY_DECLARATION_INVALID'); }
  if (sorted(node) !== sorted(canonical)) fail('UNISWAP_LIQUIDITY_DECLARATION_INVALID');
  return fields;
}
/** One isolated position node; authoring templates may coexist but never connect to it. */
export function validateUniswapLiquidityWorkflow(workflow: SemanticWorkflow): ConcentratedLiquidityFields & { nodeId: string } {
  const nodes = workflow.nodes.filter(n => n.actionType === CONCENTRATED_LIQUIDITY_ACTION);
  const id = nodes[0]?.nodeId ?? '';
  if (nodes.length !== 1 || workflow.nodes.some(n => n.nodeId !== id && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === id || e.toNodeId === id) ||
      workflow.nodes.some(n => n.dependencies.includes(id))) fail('UNISWAP_LIQUIDITY_ISOLATED_ONLY');
  return { ...validateUniswapLiquidityNode(nodes[0]!), nodeId: id };
}
