// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext, ReviewResult } from '@defi-workflow-engine/reference-linter';
import { liquidityDetails } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from './initial-workflow';
import { shellChainLabel } from './product-shell';
import { swapDetails, formatHumanAmount } from './swap-authoring';
import { supplyDetails, borrowDetails, repayDetails, withdrawDetails } from './supply-authoring';
import { lendingDetails, lendingCanvasEdges } from './lending-authoring';
import { bridgeDetails } from './bridge-authoring';
import { routerDetails } from './router-authoring';
import { solanaSwapDetails, solanaSwapLabels } from './jupiter-authoring';
import { solanaLiquidityDetails } from './solana-liquidity-authoring';
import { uniswapLiquidityDetails } from './uniswap-liquidity-authoring';
import { transferDetails } from './robinhood-transfer-authoring';

/** Display projections only. No editable values, validation rules or execution states live here. */
export function composerActions(workflow: Workflow) {
  return workflow.nodes.filter(node => !node.actionType.startsWith('mock-'));
}
const actionLabels: Record<string, string> = {
  'asset.swap.exact-input': 'Swap', 'asset.bridge': 'Bridge',
  'asset.liquidity.concentrated': 'Pool / Liquidity', 'asset.liquidity.uniswap-v3': 'Pool / Liquidity',
  'asset.liquidity.prepare': 'Prepare liquidity', 'asset.transfer': 'Transfer',
  supply: 'Supply', borrow: 'Borrow', repay: 'Repay', withdraw: 'Withdraw',
};
const providerLabels: Record<string, string> = {
  'aave-v3': 'Aave V3', uniswap: 'Uniswap', 'uniswap-v3': 'Uniswap V3',
  'lifi.rest': 'LI.FI', lifi: 'LI.FI', 'across.direct': 'Across',
  'flofi.router': 'Cross-chain Router', 'cow-protocol': 'CoW Protocol',
};
export function composerSummary(workflow: Workflow, node: Workflow['nodes'][number], context: ReviewContext) {
  const action = actionLabels[node.actionType] ?? 'Action';
  const lending = lendingDetails(workflow);
  const swap = swapDetails(node, context), solana = solanaSwapDetails(node);
  const router = routerDetails(node), bridge = bridgeDetails(node);
  const uni = uniswapLiquidityDetails(node), orca = solanaLiquidityDetails(node);
  const position = liquidityDetails(node, context);
  const supply = lending ? null : supplyDetails(node as Parameters<typeof supplyDetails>[0]);
  const borrow = lending ? null : borrowDetails(node as Parameters<typeof borrowDetails>[0]);
  const repay = lending ? null : repayDetails(node as Parameters<typeof repayDetails>[0]);
  const withdraw = lending ? null : withdrawDetails(node as Parameters<typeof withdrawDetails>[0]);
  const transfer = transferDetails(node as Parameters<typeof transferDetails>[0]);
  const money = supply ?? borrow ?? repay ?? withdraw;
  const providers = node.adapterConstraints.adapters.map(adapter => adapter.id);
  const protocols = node.adapterConstraints.protocols;
  const provider = solana ? solanaSwapLabels(solana.network).provider : uni?.provider ?? orca?.provider ??
    [...new Set((providers.length ? providers : protocols).map(id => providerLabels[id] ?? id))].join(' / ');
  const destination = node.inputs.find(input => input.name === 'asset-out');
  const destinationChain = destination?.kind === 'ASSET' ? destination.value.chainId : null;
  const chain = router ? `${router.source} → ${router.destination}` : destinationChain && destinationChain !== node.chainId
    ? `${shellChainLabel(node.chainId)} → ${shellChainLabel(destinationChain)}` : shellChainLabel(node.chainId);
  const linked = node.inputs.some(input => input.kind === 'OUTPUT_REFERENCE');
  const amount = lending ? `${node.actionType === 'supply' ? lending.supply : lending.borrow} USDC` : money ? `${money.amount} ${money.asset}` :
    transfer ? `${transfer.amount} ETH` : router ? `${router.amount} ${router.token}` : bridge ? `${bridge.amount} USDC` :
    solana ? `${solana.amount} ${solana.from}` : swap ? `${swap.amount} ${swap.from}` :
    uni ? `${uni.maxUsdc} USDC + ${uni.maxWeth} WETH` : orca ? `${orca.maxSol} SOL + ${orca.maxDevUsdc} devUSDC` :
    position ? `${formatHumanAmount(position.amountWeth, 'WETH', context)} WETH + ${formatHumanAmount(position.amountUsdc, 'USDC', context)} USDC` :
    linked ? 'Amount from linked step' : 'Amount not available';
  const detail = solana ? `${solana.from} → ${solana.to}` : swap ? `${swap.from} → ${swap.to}` :
    lending && node.actionType === 'asset.swap.exact-input' ? 'Borrowed USDC → WETH' :
    uni ? 'USDC / WETH' : orca ? 'SOL / devUSDC' : position ? 'WETH / USDC' : undefined;
  // Supported router and legacy bridge readers describe USDC on both ends. Build alone displays this token route.
  const bridgePair = router ? `${router.token} → ${router.token}` : bridge ? 'USDC → USDC' : undefined;
  return { action, provider, chain, amount, detail, bridgePair, linked,
    risk: node.actionType === 'borrow' ? 'Variable debt' : node.actionType === 'withdraw' ? 'Collateral change' : undefined };
}

/** Existing lint findings distinguish authoring problems from later quote/simulation gates. */
export function composerNodeState(review: ReviewResult | null, nodeId: string) {
  const findings = review?.findings.filter(finding => finding.nodeId === nodeId) ?? [];
  const authoring = findings.filter(finding => finding.field !== 'expectedOutputs' && !/SIMULATION_REQUIRED$/.test(finding.code));
  const block = authoring.find(finding => finding.severity === 'BLOCK');
  const warning = authoring.find(finding => finding.severity === 'WARNING');
  return { findings, status: block ? 'Needs attention' : warning ? 'Warning' : review ? 'Configured' : 'Draft',
    tone: block ? 'invalid' : warning ? 'warning' : 'neutral',
    message: (block ?? warning)?.message,
    next: findings.some(finding => finding.field === 'expectedOutputs' || /SIMULATION_REQUIRED$/.test(finding.code)) ? 'Simulation / review required' : undefined };
}

/** Only actual resource edges and dependencies; adjacent independent actions are never connected. */
export function composerConnections(workflow: Workflow) {
  const lending = lendingCanvasEdges(workflow);
  if (lending) return lending;
  const visible = new Set(composerActions(workflow).map(node => node.nodeId));
  const pairs = new Map<string, { id: string; source: string; target: string; label: string }>();
  for (const node of workflow.nodes) for (const source of node.dependencies) {
    if (visible.has(source) && visible.has(node.nodeId)) {
      const id = `${source}-${node.nodeId}`;
      pairs.set(id, { id, source, target: node.nodeId, label: 'After previous step' });
    }
  }
  for (const edge of workflow.resourceEdges) {
    if (!visible.has(edge.fromNodeId) || !visible.has(edge.toNodeId)) continue;
    const id = `${edge.fromNodeId}-${edge.toNodeId}`;
    const label = edge.outputId === 'swap-input' ? 'Swap input' : edge.outputId === 'liquidity-usdc' ? 'Liquidity USDC' :
      edge.outputId === 'liquidity-weth' ? 'Liquidity WETH' : edge.inputName === 'weth-from-swap' ? 'WETH output' : 'Linked output';
    const previous = pairs.get(id);
    pairs.set(id, { id, source: edge.fromNodeId, target: edge.toNodeId,
      label: previous && previous.label !== 'After previous step' ? `${previous.label} · ${label}` : label });
  }
  return [...pairs.values()];
}
