// SPDX-License-Identifier: AGPL-3.0-only
import { EVM_WALLET_NETWORKS } from '../wallet/evm-networks';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import type { Workflow } from './initial-workflow';
import { routerDetails, ROUTER_NETWORK_OPTIONS } from './router-authoring';

export const WORKFLOW_STAGES = ['Build', 'Simulate', 'Execute'] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export const STAGE_GUIDANCE: Readonly<Record<WorkflowStage, { purpose: string; detail: string }>> = Object.freeze({
  Build: { purpose: 'Compose your workflow', detail: 'Arrange actions and configure their parameters, then continue to Simulate.' },
  Simulate: { purpose: 'Understand the outcome', detail: 'Inspect the route, expected results and risks. Review the Strategy Manifest before authorizing.' },
  Execute: { purpose: 'Authorize and track execution', detail: 'Confirm each required wallet action, follow reconciliation and inspect the final evidence.' },
});

/** Display only. Unknown chains retain their canonical identity; labels imply no execution capability. */
export function shellChainLabel(chain: string): string {
  if (chain === 'mock:local') return 'Local mock';
  const evm = EVM_WALLET_NETWORKS.find(network => network.chain === chain);
  if (evm) return evm.label;
  for (const option of Object.values(ROUTER_NETWORK_OPTIONS)) {
    if (option.pair.destination.chainId === chain) return option.destinationLabel;
  }
  if (chain === 'eip155:31337') return 'Local fork (31337)';
  if (chain === 'eip155:10') return 'Optimism';
  if (chain === JUPITER_SOLANA_MAINNET.chain) return JUPITER_SOLANA_MAINNET.network;
  if (chain === ORCA_WHIRLPOOLS_DEVNET.chain) return ORCA_WHIRLPOOLS_DEVNET.network;
  return chain;
}

/** A projection of the existing IR, never an authoring representation or authorization decision. */
export function workflowShellContext(workflow: Workflow) {
  const chains = new Set<string>();
  for (const node of workflow.nodes) {
    chains.add(node.chainId);
    const router = routerDetails(node);
    if (router) chains.add(ROUTER_NETWORK_OPTIONS[router.network].pair.destination.chainId);
  }
  const firstAction = workflow.nodes.find(node => !node.actionType.startsWith('mock-'));
  return {
    workflowId: workflow.workflowId,
    revision: workflow.revision,
    actionCount: workflow.nodes.length,
    chains: [...chains].map(shellChainLabel),
    mockExample: workflow.nodes.length > 0 && workflow.nodes.every(node => node.actionType.startsWith('mock-')),
    requiredChain: firstAction?.chainId ?? null,
  };
}
