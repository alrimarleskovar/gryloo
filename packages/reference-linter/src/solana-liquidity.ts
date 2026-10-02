// SPDX-License-Identifier: AGPL-3.0-only
import { CONCENTRATED_LIQUIDITY_ACTION, createConcentratedLiquidityNode, readConcentratedLiquidity, type ConcentratedLiquidityFields,
  type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';

type NodeLike = { actionType: string; chainId: string };
export const isConcentratedLiquidityNode = (node: NodeLike) => node.actionType === CONCENTRATED_LIQUIDITY_ACTION;
/** The position asset of an Orca Whirlpools position: one unit issued by the Whirlpools program. */
export const ORCA_POSITION_ASSET = Object.freeze({ chainId: profile.chain, address: profile.programs.whirlpool, decimals: 0 });

const fail = (code: string): never => { throw new Error(code); };
const sorted = (v: unknown): string => JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);

/**
 * The canonical concentrated-liquidity action resolved against its only Solana runtime: Orca Whirlpools on Devnet,
 * the verified SOL/devUSDC test pool. Token0/token1 follow the pool's token A/B order; ticks must be usable on the
 * pool's tick spacing; maxima are capped; the position recipient is always the executing owner.
 */
export function validateSolanaLiquidityNode(node: SemanticWorkflow['nodes'][number]): ConcentratedLiquidityFields {
  if (!isConcentratedLiquidityNode(node)) fail('SOLANA_LIQUIDITY_ACTION_INVALID');
  let fields: ConcentratedLiquidityFields;
  try { fields = readConcentratedLiquidity(node); } catch { return fail('SOLANA_LIQUIDITY_DECLARATION_INVALID'); }
  if (!fields.chain.startsWith('solana:')) fail('LIQUIDITY_RUNTIME_UNSUPPORTED');
  if (fields.chain !== profile.chain) fail('SOLANA_CLUSTER_UNSUPPORTED');
  const t0 = profile.token0, t1 = profile.token1;
  if (fields.token0.address !== t0.mint || fields.token1.address !== t1.mint || fields.token0.decimals !== t0.decimals || fields.token1.decimals !== t1.decimals)
    fail('SOLANA_MINT_UNSUPPORTED');
  if (fields.protocols.length !== 1 || fields.protocols[0] !== profile.protocol) fail('SOLANA_LIQUIDITY_PROVIDER_UNSUPPORTED');
  if (fields.feeTier !== profile.feeTier) fail('SOLANA_LIQUIDITY_POOL_UNSUPPORTED');
  const spacing = profile.pool.tickSpacing;
  if (fields.tickLower % spacing !== 0 || fields.tickUpper % spacing !== 0 || fields.tickLower < profile.minTick || fields.tickUpper > profile.maxTick ||
      fields.tickLower >= fields.tickUpper) fail('SOLANA_LIQUIDITY_RANGE_INVALID');
  if (fields.slippageBps === null || fields.slippageBps < 1 || fields.slippageBps > profile.maximumSlippageBps) fail('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  if (BigInt(fields.amount0Max) > BigInt(t0.maximumAmount) || BigInt(fields.amount1Max) > BigInt(t1.maximumAmount)) fail('AMOUNT_OUT_OF_RANGE');
  if (fields.recipient !== null || sorted(fields.positionAsset) !== sorted(ORCA_POSITION_ASSET)) fail('SOLANA_LIQUIDITY_DECLARATION_INVALID');
  // Closed declaration: the node must be byte-equivalent to the canonical construction.
  let canonical: SemanticWorkflow['nodes'][number];
  try { canonical = createConcentratedLiquidityNode(node.nodeId, fields); } catch { return fail('SOLANA_LIQUIDITY_DECLARATION_INVALID'); }
  if (sorted(node) !== sorted(canonical)) fail('SOLANA_LIQUIDITY_DECLARATION_INVALID');
  return fields;
}
/** One isolated position node; authoring templates may coexist but never connect to it. */
export function validateSolanaLiquidityWorkflow(workflow: SemanticWorkflow): ConcentratedLiquidityFields & { nodeId: string } {
  const nodes = workflow.nodes.filter(isConcentratedLiquidityNode);
  const id = nodes[0]?.nodeId ?? '';
  if (nodes.length !== 1 || workflow.nodes.some(n => n.nodeId !== id && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === id || e.toNodeId === id) ||
      workflow.nodes.some(n => n.dependencies.includes(id))) fail('SOLANA_LIQUIDITY_ISOLATED_ONLY');
  return { ...validateSolanaLiquidityNode(nodes[0]!), nodeId: id };
}
