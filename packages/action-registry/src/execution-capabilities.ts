// SPDX-License-Identifier: Apache-2.0
/** BUILD-011D-1: execution support is distinct from declarative action compatibility. */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { AuthorizationMode, ExecutionKind } from './capabilities.js';

export const executionEnvironments = ['MOCK', 'LOCAL_FORK', 'PUBLIC_TESTNET', 'MAINNET'] as const;
export type ExecutionEnvironment = typeof executionEnvironments[number];
export const capabilityDimensions = ['AUTHOR', 'QUOTE_OR_READ', 'SIMULATE', 'REVIEW', 'AUTHORIZE', 'EXECUTE', 'RECONCILE', 'RECOVER', 'EVIDENCE'] as const;
export type CapabilityDimension = typeof capabilityDimensions[number];
export type EvidenceMaturity = 'MOCKED' | 'FORK_REPRODUCED' | 'TESTNET_EXECUTED' | 'MAINNET_EXECUTED';
export type CapabilityBlockerCode = 'UNKNOWN_ACTION' | 'ADAPTER_NOT_AVAILABLE' | 'ADAPTER_VERSION_UNSUPPORTED' |
  'CHAIN_NOT_SUPPORTED' | 'ENVIRONMENT_NOT_SUPPORTED' | 'ACTION_TEMPLATE_ONLY' | 'PUBLIC_EXECUTION_NOT_ENABLED' |
  'MAINNET_EXECUTION_NOT_ENABLED' | 'RUNTIME_UNAVAILABLE' | 'AUTHORIZATION_MODE_UNSUPPORTED' |
  'WALLET_NOT_CONNECTED' | 'WRONG_WALLET_CHAIN' | 'ARTIFACTS_MISSING' | 'ARTIFACTS_STALE' |
  'SIMULATION_REQUIRED' | 'AUTHORIZATION_REQUIRED' | 'CAPABILITY_NOT_IMPLEMENTED';
export type CapabilityBlocker = { readonly nodeId: string; readonly dimension: CapabilityDimension; readonly code: CapabilityBlockerCode };
export type CapabilityFlags = Readonly<Record<CapabilityDimension, boolean>>;
export type CapabilityRequirement = 'FORK_RUNTIME' | 'INJECTED_WALLET' | 'QUOTE_PROVIDER' | 'REVIEWED_ARTIFACTS';
export type ExecutionCapabilityProfile = {
  readonly actionType: string; readonly adapterId: string; readonly adapterVersion: string;
  readonly chainId: string; readonly environment: ExecutionEnvironment;
  readonly executionKind: ExecutionKind | null; readonly authorizationModes: readonly AuthorizationMode[];
  readonly capabilities: CapabilityFlags; readonly requirements: readonly CapabilityRequirement[];
  /** Demonstrated ceiling for this exact path, never inferred from the implementation flags. */
  readonly evidenceMaturity: EvidenceMaturity | null;
};
type DeepReadonly<T> = T extends readonly (infer U)[] ? readonly DeepReadonly<U>[] :
  T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
type Node = DeepReadonly<SemanticWorkflow['nodes'][number]>;
type WorkflowLike = { readonly nodes: readonly Node[] };
const flags = (enabled: readonly CapabilityDimension[]): CapabilityFlags => Object.freeze(Object.fromEntries(
  capabilityDimensions.map(dimension => [dimension, enabled.includes(dimension)])) as Record<CapabilityDimension, boolean>);
const author = flags(['AUTHOR']);
const mock = flags(['AUTHOR', 'QUOTE_OR_READ', 'SIMULATE', 'REVIEW', 'AUTHORIZE', 'EXECUTE', 'RECONCILE', 'RECOVER', 'EVIDENCE']);
const mockNoQuote = flags(['AUTHOR', 'SIMULATE', 'REVIEW', 'AUTHORIZE', 'EXECUTE', 'RECONCILE', 'RECOVER', 'EVIDENCE']);
const mockReadOnly = flags(['AUTHOR', 'QUOTE_OR_READ', 'SIMULATE', 'REVIEW']);
const fork = flags(['AUTHOR', 'QUOTE_OR_READ', 'SIMULATE', 'REVIEW', 'AUTHORIZE', 'EXECUTE', 'RECONCILE', 'RECOVER', 'EVIDENCE']);
const preparation = flags(['AUTHOR', 'QUOTE_OR_READ', 'SIMULATE', 'REVIEW', 'EVIDENCE']);
const templateKinds = new Set(['mock-read', 'mock-transform', 'mock-condition', 'mock-bridge', 'mock-pool', 'mock-supply', 'mock-lending', 'mock-borrow']);
const definedActions = new Set(['borrow', 'supply', 'asset.swap.exact-input', 'asset.bridge', 'asset.liquidity.uniswap-v3', 'asset.liquidity.prepare', ...templateKinds]);
const adapterVersions: Readonly<Record<string, string>> = Object.freeze({
  'aave-v3': '1.0.0', 'uniswap.v3': '1.0.0', 'cow.protocol': '1.0.0', 'lifi.rest': '1.0.0', 'across.direct': '1.0.0',
  'gryloo.calculated-split': '1.0.0', 'gryloo.template': '1.0.0', 'jupiter.swap-v2': '1.0.0',
  'orca.whirlpools-devnet': '1.0.0',
});
const rows: ExecutionCapabilityProfile[] = [];
function add(actionType: string, adapterId: string, chainId: string, environment: ExecutionEnvironment,
  capabilities: CapabilityFlags, evidenceMaturity: EvidenceMaturity | null, executionKind: ExecutionKind | null,
  requirements: readonly CapabilityRequirement[] = [], authorizationModes: readonly AuthorizationMode[] = ['A', 'B']) {
  rows.push(Object.freeze({ actionType, adapterId, adapterVersion: adapterVersions[adapterId]!, chainId,
    environment, capabilities, evidenceMaturity, executionKind, requirements: Object.freeze([...requirements]),
    authorizationModes: Object.freeze([...authorizationModes]) }));
}
for (const chain of ['eip155:8453', 'eip155:42161']) {
  add('asset.swap.exact-input', 'lifi.rest', chain, 'MOCK', mock, 'MOCKED', 'DIRECT_TRANSACTION');
  add('asset.liquidity.uniswap-v3', 'uniswap.v3', chain, 'MOCK', mockNoQuote, 'MOCKED', 'DIRECT_TRANSACTION');
}
add('asset.bridge', 'lifi.rest', 'eip155:8453', 'MOCK', mock, 'MOCKED', 'DIRECT_TRANSACTION', ['QUOTE_PROVIDER'], ['A']);
add('asset.bridge', 'across.direct', 'eip155:8453', 'MOCK', mock, 'MOCKED', 'DIRECT_TRANSACTION', [], ['A']);
add('asset.swap.exact-input', 'uniswap.v3', 'eip155:8453', 'MOCK', mockReadOnly, null, 'DIRECT_TRANSACTION');
add('asset.swap.exact-input', 'uniswap.v3', 'eip155:8453', 'LOCAL_FORK', fork, 'FORK_REPRODUCED', 'DIRECT_TRANSACTION', ['FORK_RUNTIME', 'INJECTED_WALLET', 'REVIEWED_ARTIFACTS']);
add('asset.swap.exact-input', 'uniswap.v3', 'eip155:84532', 'PUBLIC_TESTNET', fork, 'TESTNET_EXECUTED', 'DIRECT_TRANSACTION', ['INJECTED_WALLET', 'QUOTE_PROVIDER', 'REVIEWED_ARTIFACTS'], ['A']);
add('asset.swap.exact-input', 'cow.protocol', 'eip155:8453', 'MOCK', mock, 'MOCKED', 'SIGNED_INTENT', ['INJECTED_WALLET'], ['A']);
add('asset.liquidity.uniswap-v3', 'uniswap.v3', 'eip155:8453', 'LOCAL_FORK', fork, 'FORK_REPRODUCED', 'DIRECT_TRANSACTION', ['FORK_RUNTIME', 'INJECTED_WALLET', 'REVIEWED_ARTIFACTS']);
add('asset.liquidity.prepare', 'gryloo.calculated-split', 'eip155:42161', 'MOCK', preparation, 'MOCKED', null, [], ['A']);
for (const kind of templateKinds) add(kind, 'gryloo.template', 'mock:local', 'MOCK', author, null, null, [], []);
add('borrow', 'aave-v3', 'eip155:84532', 'PUBLIC_TESTNET', fork, null, 'DIRECT_TRANSACTION', ['INJECTED_WALLET', 'QUOTE_PROVIDER', 'REVIEWED_ARTIFACTS'], ['A']);
add('supply', 'aave-v3', 'eip155:84532', 'PUBLIC_TESTNET', fork, null, 'DIRECT_TRANSACTION', ['INJECTED_WALLET', 'QUOTE_PROVIDER', 'REVIEWED_ARTIFACTS'], ['A']);
// Jupiter routes only Solana mainnet-beta liquidity. Owner execution is implemented; no execution is demonstrated yet.
add('asset.swap.exact-input', 'jupiter.swap-v2', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'MAINNET', fork, null, 'DIRECT_TRANSACTION', ['INJECTED_WALLET', 'QUOTE_PROVIDER', 'REVIEWED_ARTIFACTS'], ['A']);
// Orca Whirlpools on Solana Devnet with valueless test tokens. Owner execution is implemented; none is demonstrated yet.
add('asset.swap.exact-input', 'orca.whirlpools-devnet', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'PUBLIC_TESTNET', fork, null, 'DIRECT_TRANSACTION', ['INJECTED_WALLET', 'QUOTE_PROVIDER', 'REVIEWED_ARTIFACTS'], ['A']);
// Public execution and demonstrated evidence are limited to the exact Base Sepolia Uniswap swap profile.
export const executionCapabilityRegistry: readonly ExecutionCapabilityProfile[] = Object.freeze(rows);

export type CapabilityRuntime = {
  readonly forkAvailable?: boolean; readonly forkEvidence?: 'MOCKED' | 'FORK_REPRODUCED';
  readonly quoteProviderAvailable?: boolean; readonly walletConnected?: boolean; readonly walletChainId?: string | null;
  readonly artifacts?: 'CURRENT' | 'MISSING' | 'STALE'; readonly simulationReady?: boolean;
  readonly authorizationReady?: boolean;
};
export type CapabilityRequest = { readonly environment: ExecutionEnvironment | string; readonly runtime?: CapabilityRuntime };
export type NodeCapability = { readonly nodeId: string; readonly actionType: string; readonly adapterId: string | null;
  readonly profile: ExecutionCapabilityProfile | null; readonly capabilities: CapabilityFlags;
  readonly evidenceCeiling: EvidenceMaturity | null; readonly blockers: readonly CapabilityBlocker[] };
export type WorkflowCapability = { readonly environment: ExecutionEnvironment | string;
  readonly nodes: readonly NodeCapability[]; readonly capabilities: CapabilityFlags;
  /** Runtime support is separate from submission readiness. */
  readonly executionSupported: boolean; readonly executionReady: boolean;
  readonly blockers: readonly CapabilityBlocker[]; readonly evidenceCeiling: EvidenceMaturity | null };

function selectedAdapter(node: Node): { id: string; version: string } | null {
  const adapters = node.adapterConstraints.adapters;
  if (adapters.length > 1) return null;
  if (adapters.length === 1) return adapters[0]!;
  if (templateKinds.has(node.actionType)) return { id: 'gryloo.template', version: '1.0.0' };
  if (node.actionType === 'asset.liquidity.prepare') return { id: 'gryloo.calculated-split', version: '1.0.0' };
  if (node.actionType === 'asset.liquidity.uniswap-v3') return node.adapterConstraints.protocols.includes('uniswap-v3') ? { id: 'uniswap.v3', version: '1.0.0' } : null;
  if (node.actionType === 'asset.swap.exact-input') {
    if (node.adapterConstraints.protocols.length === 1 && node.adapterConstraints.protocols[0] === 'jupiter') return { id: 'jupiter.swap-v2', version: '1.0.0' };
    if (node.adapterConstraints.protocols.length === 1 && node.adapterConstraints.protocols[0] === 'orca-whirlpools') return { id: 'orca.whirlpools-devnet', version: '1.0.0' };
    if (node.adapterConstraints.protocols.includes('cow-protocol')) return { id: 'cow.protocol', version: '1.0.0' };
    if (node.adapterConstraints.protocols.includes('uniswap')) return { id: 'uniswap.v3', version: '1.0.0' };
  }
  return null;
}
function failure(node: Node, adapterId: string | null, code: CapabilityBlockerCode, capabilities: CapabilityFlags = author): NodeCapability {
  return { nodeId: node.nodeId, actionType: node.actionType, adapterId, profile: null, capabilities: code === 'UNKNOWN_ACTION' ? flags([]) : capabilities,
    evidenceCeiling: null, blockers: [{ nodeId: node.nodeId, dimension: 'EXECUTE', code }] };
}
function rank(evidence: EvidenceMaturity): number { return ['MOCKED', 'FORK_REPRODUCED', 'TESTNET_EXECUTED', 'MAINNET_EXECUTED'].indexOf(evidence); }
function lower(a: EvidenceMaturity | null, b: EvidenceMaturity | null): EvidenceMaturity | null {
  return a && b ? rank(a) <= rank(b) ? a : b : null;
}
export function resolveNodeCapability(node: Node, request: CapabilityRequest): NodeCapability {
  if (!definedActions.has(node.actionType)) return failure(node, null, 'UNKNOWN_ACTION');
  const adapter = selectedAdapter(node);
  if (!adapter || !(adapter.id in adapterVersions)) return failure(node, adapter?.id ?? null, 'ADAPTER_NOT_AVAILABLE');
  if (adapterVersions[adapter.id] !== adapter.version) return failure(node, adapter.id, 'ADAPTER_VERSION_UNSUPPORTED');
  if (templateKinds.has(node.actionType) && request.environment !== 'MOCK')
    return failure(node, adapter.id, 'ACTION_TEMPLATE_ONLY');
  const matching = executionCapabilityRegistry.filter(row => row.actionType === node.actionType && row.adapterId === adapter.id);
  if (!matching.some(row => row.chainId === node.chainId)) return failure(node, adapter.id, 'CHAIN_NOT_SUPPORTED');
  const profile = matching.find(row => row.chainId === node.chainId && row.environment === request.environment);
  if (!profile) return failure(node, adapter.id, request.environment === 'PUBLIC_TESTNET' ? 'PUBLIC_EXECUTION_NOT_ENABLED' :
    request.environment === 'MAINNET' ? 'MAINNET_EXECUTION_NOT_ENABLED' : 'ENVIRONMENT_NOT_SUPPORTED',
    flags(['AUTHOR', ...matching.some(row => row.chainId === node.chainId && row.capabilities.SIMULATE) ? ['SIMULATE', 'REVIEW'] as const : []]));
  const blockers: CapabilityBlocker[] = [];
  const block = (dimension: CapabilityDimension, code: CapabilityBlockerCode) => blockers.push({ nodeId: node.nodeId, dimension, code });
  if (templateKinds.has(node.actionType)) block('EXECUTE', 'ACTION_TEMPLATE_ONLY');
  if (node.requiredAuthorizationClass !== 'NONE' && !profile.authorizationModes.includes(node.requiredAuthorizationClass.slice(5) as AuthorizationMode))
    block('AUTHORIZE', 'AUTHORIZATION_MODE_UNSUPPORTED');
  if (profile.requirements.includes('FORK_RUNTIME') && !request.runtime?.forkAvailable) block('EXECUTE', 'RUNTIME_UNAVAILABLE');
  if (profile.requirements.includes('QUOTE_PROVIDER') && request.runtime?.quoteProviderAvailable === false) block('QUOTE_OR_READ', 'RUNTIME_UNAVAILABLE');
  const evidenceCeiling = profile.evidenceMaturity && request.environment === 'LOCAL_FORK' && request.runtime?.forkEvidence === 'MOCKED'
    ? lower(profile.evidenceMaturity, 'MOCKED') : profile.evidenceMaturity;
  return { nodeId: node.nodeId, actionType: node.actionType, adapterId: adapter.id, profile,
    capabilities: profile.capabilities, evidenceCeiling, blockers };
}
/** All financial nodes must support execution. A calculated split is a modeled non-financial step. */
export function resolveWorkflowCapability(workflow: WorkflowLike, request: CapabilityRequest): WorkflowCapability {
  const nodes = workflow.nodes.map(node => resolveNodeCapability(node, request));
  const isDerived = (node: NodeCapability) => node.actionType === 'asset.liquidity.prepare' && Boolean(node.profile?.capabilities.SIMULATE);
  // Authoring templates can coexist with isolated financial actions. They never
  // gain execution authority and do not become required financial steps.
  const financial = nodes.filter(node => !node.actionType.startsWith('mock-') && !isDerived(node));
  const operational = financial.length ? nodes.filter(node => !node.actionType.startsWith('mock-')) : nodes;
  const capabilities = flags(capabilityDimensions.filter(dimension => operational.length > 0 && operational.every(node =>
    isDerived(node) && ['AUTHORIZE', 'EXECUTE', 'RECONCILE', 'RECOVER'].includes(dimension) ? true : node.capabilities[dimension])));
  const blockers = nodes.flatMap(node => node.blockers);
  const executionSupported = financial.length > 0 && financial.every(node => node.capabilities.EXECUTE &&
    !node.blockers.some(blocker => ['AUTHORIZATION_MODE_UNSUPPORTED', 'RUNTIME_UNAVAILABLE', 'ACTION_TEMPLATE_ONLY'].includes(blocker.code)));
  for (const node of financial) {
    if (!node.capabilities.EXECUTE && !node.blockers.some(blocker => blocker.dimension === 'EXECUTE'))
      blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'CAPABILITY_NOT_IMPLEMENTED' });
    if (!node.profile?.requirements.includes('INJECTED_WALLET')) continue;
    if (!request.runtime?.walletConnected) blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'WALLET_NOT_CONNECTED' });
    else if (request.runtime.walletChainId !== (request.environment === 'LOCAL_FORK' ? 'eip155:31337' : node.profile.chainId))
      blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'WRONG_WALLET_CHAIN' });
  }
  if (executionSupported) for (const node of financial) {
    if (request.runtime?.artifacts === 'STALE') blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'ARTIFACTS_STALE' });
    else if (node.profile?.requirements.includes('REVIEWED_ARTIFACTS') && request.runtime?.artifacts !== 'CURRENT')
      blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'ARTIFACTS_MISSING' });
    if (node.capabilities.SIMULATE && request.runtime?.simulationReady === false)
      blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'SIMULATION_REQUIRED' });
    if (node.capabilities.AUTHORIZE && request.runtime?.authorizationReady === false)
      blockers.push({ nodeId: node.nodeId, dimension: 'EXECUTE', code: 'AUTHORIZATION_REQUIRED' });
  }
  const evidenceCeiling = operational.length && operational.every(node => node.evidenceCeiling) ? operational.reduce<EvidenceMaturity | null>(
    (ceiling, node) => lower(ceiling, node.evidenceCeiling), operational[0]!.evidenceCeiling) : null;
  const requiredIds = new Set(operational.map(node => node.nodeId));
  return { environment: request.environment, nodes, capabilities, executionSupported, executionReady: executionSupported &&
    !blockers.some(blocker => requiredIds.has(blocker.nodeId) && (blocker.dimension === 'EXECUTE' || blocker.dimension === 'AUTHORIZE')),
    blockers, evidenceCeiling };
}
