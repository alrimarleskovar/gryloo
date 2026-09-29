// SPDX-License-Identifier: AGPL-3.0-only
import type { CapabilityBlocker, CapabilityBlockerCode, NodeCapability, WorkflowCapability } from '@defi-workflow-engine/action-registry';

const reasons: Record<CapabilityBlockerCode, string> = {
  UNKNOWN_ACTION: 'This action is not recognized.',
  ADAPTER_NOT_AVAILABLE: 'The selected adapter is not available for this action.',
  ADAPTER_VERSION_UNSUPPORTED: 'The selected adapter version is not supported.',
  CHAIN_NOT_SUPPORTED: 'This action is not supported on its selected chain.',
  ENVIRONMENT_NOT_SUPPORTED: 'This adapter is not available in this environment.',
  ACTION_TEMPLATE_ONLY: 'This action is available for workflow authoring only.',
  PUBLIC_EXECUTION_NOT_ENABLED: 'Public test execution is not available yet.',
  MAINNET_EXECUTION_NOT_ENABLED: 'Mainnet execution is not available.',
  RUNTIME_UNAVAILABLE: 'The required local runtime or quote provider is unavailable here.',
  AUTHORIZATION_MODE_UNSUPPORTED: 'This adapter does not support the workflow authorization mode.',
  WALLET_NOT_CONNECTED: 'Connect the required wallet before execution.',
  WRONG_WALLET_CHAIN: 'Switch the wallet to the required network before execution.',
  ARTIFACTS_MISSING: 'Create and review current execution artifacts first.',
  ARTIFACTS_STALE: 'Execution artifacts changed or expired. Simulate and review again.',
  SIMULATION_REQUIRED: 'Run the exact simulation before execution.',
  AUTHORIZATION_REQUIRED: 'Review and authorize the exact action before execution.',
  CAPABILITY_NOT_IMPLEMENTED: 'Execution is not implemented for this action here.',
};
export function primaryExecutionBlocker(result: WorkflowCapability, selectedNodeId?: string | null): CapabilityBlocker | undefined {
  const relevant = result.blockers.filter(item => item.dimension === 'EXECUTE' || item.dimension === 'AUTHORIZE')
    .filter(item => !result.executionSupported || item.nodeId === selectedNodeId ||
      !result.nodes.some(node => node.nodeId === item.nodeId && node.actionType.startsWith('mock-')));
  return relevant.find(item => item.nodeId === selectedNodeId && item.code === 'ACTION_TEMPLATE_ONLY') ??
    relevant.find(item => item.nodeId === selectedNodeId) ??
    relevant.find(item => !result.nodes.some(node => node.nodeId === item.nodeId && node.actionType.startsWith('mock-'))) ??
    relevant[0];
}
export function capabilityBlockMessage(blocker: CapabilityBlocker, node?: NodeCapability): string {
  const action = node?.actionType.startsWith('mock-') ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) :
    node?.actionType === 'asset.bridge' ? 'Bridge' : node?.actionType === 'asset.swap.exact-input' ? 'Swap' :
    node?.actionType === 'asset.liquidity.uniswap-v3' ? 'Pool' : 'Action';
  const subject = node?.adapterId === 'cow.protocol' ? 'CoW swap' : action;
  return subject + ' · ' + reasons[blocker.code];
}
export function nodeCapabilityLabel(node: NodeCapability): string {
  if (node.blockers.some(blocker => blocker.code === 'ACTION_TEMPLATE_ONLY')) return 'Template only';
  if (node.profile?.environment === 'LOCAL_FORK' && node.profile.capabilities.EXECUTE)
    return node.blockers.some(blocker => blocker.code === 'RUNTIME_UNAVAILABLE') ? 'Local fork unavailable' :
      node.evidenceCeiling === 'FORK_REPRODUCED' ? 'Fork verified' : 'Local fork demo';
  if (node.profile?.environment === 'MOCK' && node.profile.capabilities.EXECUTE) return 'Mock execution';
  if (node.capabilities.SIMULATE) return 'Simulation only';
  return 'Unavailable here';
}
export function workflowExecutionLabel(result: WorkflowCapability): string {
  if (result.executionSupported) return result.environment === 'LOCAL_FORK' ? 'Local fork available' : 'Mock only';
  if (result.environment === 'PUBLIC_TESTNET') return 'Testnet unavailable';
  if (result.environment === 'MAINNET') return 'Mainnet unavailable';
  return 'Unavailable here';
}
