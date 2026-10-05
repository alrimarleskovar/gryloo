// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { isLendingComposition, LENDING_NODE_IDS } from '@defi-workflow-engine/workflow-contracts';
import type { Workflow } from './initial-workflow';
import { canDeleteCanvasNode } from './canvas-keyboard';
import { SWAP_ACTION, swapDetails } from './swap-authoring';
import { solanaSwapDetails, solanaSwapLabels, type SolanaSwapInput } from './jupiter-authoring';
import { routerDetails, routerInputOf, ROUTER_NETWORK_OPTIONS, ROUTER_ROUTING_LABEL, type RouterBridgeInput, type RouterNetwork } from './router-authoring';
import { borrowDetails, repayDetails, supplyDetails, withdrawDetails, type SupplyInput, type WithdrawInput } from './supply-authoring';
import { uniswapLiquidityDetails, uniswapLiquidityInputOf, type UniswapLiquidityInput } from './uniswap-liquidity-authoring';
import { solanaLiquidityDetails, solanaLiquidityInputOf, type SolanaLiquidityInput } from './solana-liquidity-authoring';
import { lendingDetails, type LendingInput } from './lending-authoring';

/**
 * BUILD-COPILOT-002: ordered, typed descriptions of the canonical workflow's steps, read only from the IR through the
 * existing `*Details` readers. AI-agnostic and read-only: nothing here edits, quotes or observes a chain.
 */
export type StepKind = 'SWAP' | 'BRIDGE' | 'SUPPLY' | 'BORROW' | 'REPAY' | 'WITHDRAW' | 'LIQUIDITY' | 'TEMPLATE' | 'OTHER';
export type StepDetail =
  | { readonly type: 'EVM_SWAP'; readonly network: 'Base' | 'Base Sepolia'; readonly from: 'USDC' | 'WETH'; readonly to: 'USDC' | 'WETH'; readonly amount: string;
      readonly slippage: string }
  | { readonly type: 'SOLANA_SWAP'; readonly input: SolanaSwapInput }
  | { readonly type: 'ROUTER'; readonly input: RouterBridgeInput; readonly network: RouterNetwork }
  | { readonly type: 'AAVE'; readonly operation: 'SUPPLY' | 'BORROW' | 'REPAY'; readonly input: SupplyInput }
  | { readonly type: 'AAVE_WITHDRAW'; readonly input: WithdrawInput }
  | { readonly type: 'UNISWAP_LIQUIDITY'; readonly input: UniswapLiquidityInput; readonly lowerPrice: string; readonly upperPrice: string }
  | { readonly type: 'ORCA_LIQUIDITY'; readonly input: SolanaLiquidityInput; readonly lowerPrice: string; readonly upperPrice: string }
  | { readonly type: 'LENDING_COMPOSITION'; readonly role: 'SUPPLY' | 'BORROW' | 'SWAP'; readonly input: LendingInput }
  | { readonly type: 'TEMPLATE'; readonly template: string }
  | { readonly type: 'OTHER'; readonly actionType: string };
export type WorkflowStep = {
  readonly index: number; readonly nodeId: string; readonly kind: StepKind; readonly detail: StepDetail;
  readonly protocol: string; readonly network: string;
  /** Test tokens (Base Sepolia, Arbitrum Sepolia, Solana Devnet, templates) or real funds; null when unknown. */
  readonly testFunds: boolean | null;
  readonly failurePolicy: string; readonly authorization: string; readonly dependencies: readonly string[]; readonly removable: boolean;
};

const CHAIN_LABEL: Readonly<Record<string, string>> = { 'eip155:8453': 'Base', 'eip155:84532': 'Base Sepolia', 'eip155:42161': 'Arbitrum One',
  'eip155:421614': 'Arbitrum Sepolia', 'mock:local': 'local template' };
const TEST_CHAINS: ReadonlySet<string> = new Set(['eip155:84532', 'eip155:421614', 'mock:local']);
const MAIN_CHAINS: ReadonlySet<string> = new Set(['eip155:8453', 'eip155:42161']);
const LENDING_ROLE = { 'lending-supply': 'SUPPLY', 'lending-borrow': 'BORROW', 'lending-swap': 'SWAP' } as const;

type Node = Workflow['nodes'][number];
type Described = Pick<WorkflowStep, 'kind' | 'detail' | 'protocol' | 'network' | 'testFunds'>;
function describe(node: Node, workflow: Workflow, context: ReviewContext): Described {
  const read = <T>(reader: () => T): T | null => { try { return reader(); } catch { return null; } };
  const lending = isLendingComposition(workflow) && (LENDING_NODE_IDS as readonly string[]).includes(node.nodeId) ? lendingDetails(workflow) : null;
  if (lending) {
    const role = LENDING_ROLE[node.nodeId as keyof typeof LENDING_ROLE];
    return { kind: role, detail: { type: 'LENDING_COMPOSITION', role, input: lending }, protocol: role === 'SWAP' ? 'Uniswap v3' : 'Aave V3',
      network: 'Base Sepolia', testFunds: true };
  }
  const solana = read(() => solanaSwapDetails(node));
  if (solana) return { kind: 'SWAP', detail: { type: 'SOLANA_SWAP', input: solana }, protocol: solanaSwapLabels(solana.network).provider,
    network: solana.network, testFunds: solana.network === 'Solana Devnet' };
  const routed = read(() => routerDetails(node));
  if (routed) {
    const option = ROUTER_NETWORK_OPTIONS[routed.network];
    return { kind: 'BRIDGE', detail: { type: 'ROUTER', input: routerInputOf(routed), network: routed.network },
      protocol: `Cross-chain Router (${ROUTER_ROUTING_LABEL[routed.routing]})`, network: `${option.sourceLabel} → ${option.destinationLabel}`,
      testFunds: routed.network === 'testnet' };
  }
  const withdrawn = read(() => withdrawDetails(node as Parameters<typeof withdrawDetails>[0]));
  if (withdrawn) return { kind: 'WITHDRAW', detail: { type: 'AAVE_WITHDRAW', input: withdrawn }, protocol: 'Aave V3', network: withdrawn.network, testFunds: true };
  for (const [operation, reader] of [['REPAY', repayDetails], ['BORROW', borrowDetails], ['SUPPLY', supplyDetails]] as const) {
    const input = read(() => reader(node as Parameters<typeof reader>[0]));
    if (input) return { kind: operation, detail: { type: 'AAVE', operation, input }, protocol: 'Aave V3', network: input.network, testFunds: true };
  }
  const uni = read(() => uniswapLiquidityDetails(node));
  if (uni) return { kind: 'LIQUIDITY', detail: { type: 'UNISWAP_LIQUIDITY', input: uniswapLiquidityInputOf(uni), lowerPrice: uni.lowerPrice, upperPrice: uni.upperPrice },
    protocol: uni.provider, network: uni.network, testFunds: true };
  const orca = read(() => solanaLiquidityDetails(node));
  if (orca) return { kind: 'LIQUIDITY', detail: { type: 'ORCA_LIQUIDITY', input: solanaLiquidityInputOf(orca), lowerPrice: orca.lowerPrice, upperPrice: orca.upperPrice },
    protocol: orca.provider, network: orca.network, testFunds: true };
  const network = CHAIN_LABEL[node.chainId] ?? node.chainId;
  const testFunds = TEST_CHAINS.has(node.chainId) ? true : MAIN_CHAINS.has(node.chainId) ? false : null;
  // CoW swaps and the legacy bridges, compositions and transfers keep their own panels; they are described, not typed.
  if (node.actionType === SWAP_ACTION && node.adapterConstraints.protocols.join() === 'uniswap' && (node.chainId === 'eip155:8453' || node.chainId === 'eip155:84532')) {
    const swap = read(() => swapDetails(node, node.chainId === 'eip155:84532' ? createBaseSepoliaReviewContext() : context));
    if (swap && swap.slippage !== null) return { kind: 'SWAP', detail: { type: 'EVM_SWAP', network: network as 'Base' | 'Base Sepolia', from: swap.from, to: swap.to,
      amount: swap.amount, slippage: String(swap.slippage) }, protocol: 'Uniswap v3', network, testFunds };
  }
  if (node.actionType.startsWith('mock-')) return { kind: 'TEMPLATE', detail: { type: 'TEMPLATE', template: node.actionType.slice(5) }, protocol: 'Template (authoring only)',
    network, testFunds: true };
  return { kind: 'OTHER', detail: { type: 'OTHER', actionType: node.actionType }, protocol: node.adapterConstraints.protocols.join(', ') || node.actionType, network, testFunds };
}

/** Steps in canonical IR order, numbered from 1, as the canvas and the Copilot present them. */
export function workflowSteps(workflow: Workflow, context: ReviewContext): readonly WorkflowStep[] {
  return Object.freeze(workflow.nodes.map((node, index) => Object.freeze({ index: index + 1, nodeId: node.nodeId, ...describe(node, workflow, context),
    failurePolicy: node.failurePolicy, authorization: node.requiredAuthorizationClass, dependencies: [...node.dependencies],
    removable: canDeleteCanvasNode(workflow, node.nodeId) })));
}
/** One node's step in a given workflow, which may be a proposal's preview rather than the canonical workflow. */
export function stepOfNode(workflow: Workflow, nodeId: string, context: ReviewContext): WorkflowStep | null {
  return workflowSteps(workflow, context).find(step => step.nodeId === nodeId) ?? null;
}
