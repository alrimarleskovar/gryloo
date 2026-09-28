// SPDX-License-Identifier: AGPL-3.0-only
/** Pure compilation of one reviewed LI.FI route into the existing artifact chain. */
import { BRIDGE_ACTION, BRIDGE_SOURCE, BRIDGE_DESTINATION, BRIDGE_SOURCE_USDC, BRIDGE_DESTINATION_USDC,
  hashArtifactBytes, hashRawBytes, type SemanticWorkflow, type QuoteStateArtifact, type ArtifactSet,
  type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';

const enc = new TextEncoder();
const H = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown) => hashArtifactBytes(kind, enc.encode(JSON.stringify(value)));
export const BRIDGE_ADAPTER = { id: 'lifi.rest', version: '1.0.0' } as const;
export type BridgeRoute = {
  readonly routeId: string; readonly provider: string; readonly includedSteps: readonly { readonly type: string; readonly tool: string }[];
  readonly owner: string; readonly amountIn: string; readonly expectedOut: string; readonly minimumOut: string;
  readonly slippageBps: number; readonly approvalSpender: string;
  readonly fees: readonly { readonly name: string; readonly amount: string; readonly symbol: string; readonly tokenChainId: number; readonly tokenAddress: string; readonly decimals: number; readonly included: boolean }[];
  readonly gas: readonly { readonly name: string; readonly amount: string; readonly symbol: string; readonly tokenChainId: number; readonly tokenAddress: string; readonly decimals: number; readonly included: boolean }[];
  readonly transaction: { readonly from: string; readonly to: string; readonly data: string; readonly value: '0x0'; readonly chainId: 8453; readonly gasLimit: string; readonly gasPrice: string };
  readonly observedAt: string; readonly expiresAt: string; readonly rawHash: string;
};
export type BridgeCompiled = {
  readonly quote: QuoteStateArtifact; readonly artifactSet: ArtifactSet; readonly simulation: SimulationBundle;
  readonly policy: AuthorizationPolicy; readonly manifest: StrategyManifest; readonly plan: ExecutionPlan;
  readonly approval: { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0' };
  readonly source: BridgeRoute['transaction'];
  readonly hashes: { readonly workflow: string; readonly quote: string; readonly artifactSet: string; readonly simulation: string;
    readonly policy: string; readonly manifest: string; readonly plan: string; readonly approvalPayload: string; readonly sourcePayload: string };
};
function payloadHash(value: unknown): string { return hashRawBytes('payload', enc.encode(JSON.stringify(value))); }
export function compileBridge(workflow: SemanticWorkflow, route: BridgeRoute, nowMs: number): BridgeCompiled {
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length || workflow.nodes[0]?.actionType !== BRIDGE_ACTION)
    throw new Error('BRIDGE_WORKFLOW_UNSUPPORTED');
  const node = workflow.nodes[0]!;
  const input = node.inputs.find(p => p.name === 'amount-in'), output = node.inputs.find(p => p.name === 'asset-out');
  const slippage = node.userConstraints.find(p => p.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (input?.kind !== 'QUANTITY' || output?.kind !== 'ASSET' || slippage?.kind !== 'MAXIMUM_SLIPPAGE_BPS'
    || input.value.amount !== route.amountIn || slippage.maximumBps !== route.slippageBps
    || !('address' in input.value.asset) || input.value.asset.address !== BRIDGE_SOURCE_USDC
    || !('address' in output.value) || output.value.address !== BRIDGE_DESTINATION_USDC
    || route.owner !== route.transaction.from || route.approvalSpender !== route.transaction.to
    || route.transaction.chainId !== 8453 || route.transaction.value !== '0x0'
    || !/^0x[0-9a-f]{64}$/.test(route.rawHash)
    || Date.parse(route.expiresAt) <= nowMs || Date.parse(route.observedAt) > nowMs
    || Date.parse(route.expiresAt) - Date.parse(route.observedAt) > 60_000
    || !/^[A-Za-z0-9._-]{1,80}$/.test(route.provider)
    || route.includedSteps.filter(x => x.type === 'cross').length !== 1
    || route.includedSteps.some(x => !['cross', 'protocol'].includes(x.type))
    || BigInt(route.minimumOut) < 1n || BigInt(route.minimumOut) > BigInt(route.expectedOut))
    throw new Error('BRIDGE_ROUTE_REVIEW_INVALID');
  if (route.fees.some(f => f.tokenChainId !== 8453 || f.tokenAddress !== BRIDGE_SOURCE_USDC || f.decimals !== 6)
    || route.gas.some(g => g.tokenChainId !== 8453 || g.symbol !== 'ETH' || g.decimals !== 18))
    throw new Error('BRIDGE_FEE_ASSET_UNSUPPORTED');
  const inputAsset = { chainId: BRIDGE_SOURCE, address: BRIDGE_SOURCE_USDC, decimals: 6 };
  const outputAsset = { chainId: BRIDGE_DESTINATION, address: BRIDGE_DESTINATION_USDC, decimals: 6 };
  const native = { chainId: BRIDGE_SOURCE, nativeId: 'ETH', decimals: 18 };
  const sourceOwner = { chainId: BRIDGE_SOURCE, address: route.owner };
  const destinationOwner = { chainId: BRIDGE_DESTINATION, address: route.owner };
  const freshness = { observedAt: route.observedAt, expiresAt: route.expiresAt, maximumAgeSeconds: 60 };
  const workflowHash = H('semantic-workflow', workflow);
  const suffix = route.rawHash.slice(2, 26);
  const approval = { chainId: 8453 as const, to: BRIDGE_SOURCE_USDC,
    data: '0x095ea7b3' + route.approvalSpender.slice(2).padStart(64, '0') + BigInt(route.amountIn).toString(16).padStart(64, '0'),
    value: '0x0' as const };
  const approvalPayload = payloadHash(approval), sourcePayload = payloadHash(route.transaction);
  const uncertainty = [{ code: 'CROSS_CHAIN_SETTLEMENT_NOT_SIMULATED',
    description: 'Live LI.FI quote only; source submission, bridge progress and destination result are deterministic MOCKED observations.' }];
  const quote = validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0',
    artifactId: 'bridge.quote.' + suffix, semanticWorkflowHash: workflowHash, nodeId: node.nodeId,
    sourceId: 'lifi.live-api', adapter: BRIDGE_ADAPTER, chainId: BRIDGE_SOURCE,
    chainPosition: { kind: 'BLOCK', height: 0 }, retrievedAt: route.observedAt, freshness,
    rawResponseHash: route.rawHash,
    normalizedValues: [{ name: 'route-id', kind: 'IDENTIFIER', value: route.routeId },
      { name: 'underlying-provider', kind: 'IDENTIFIER', value: route.provider },
      { name: 'included-tools', kind: 'IDENTIFIER', value: route.includedSteps.map(x => x.type + ':' + x.tool).join('.') },
      { name: 'destination-chain', kind: 'IDENTIFIER', value: BRIDGE_DESTINATION },
      { name: 'source-payload-hash', kind: 'IDENTIFIER', value: sourcePayload }],
    providerReference: { kind: 'ROUTE', id: 'route-' + suffix },
    proposedContracts: [{ chainId: BRIDGE_SOURCE, address: BRIDGE_SOURCE_USDC, version: 'catalog-checked' },
      { chainId: BRIDGE_SOURCE, address: route.transaction.to, version: 'lifi-quoted' }],
    proposedSpenders: [sourceOwner, { chainId: BRIDGE_SOURCE, address: route.approvalSpender }],
    proposedRecipients: [destinationOwner],
    fees: [{ asset: inputAsset, amount: route.fees.reduce((sum, fee) => sum + BigInt(fee.amount), 0n).toString() }],
    gas: [{ asset: native, amount: route.gas.reduce((sum, fee) => sum + BigInt(fee.amount), 0n).toString() }],
    outputBounds: [{ outputId: 'amount-out', expected: { asset: outputAsset, amount: route.expectedOut },
      minimum: { asset: outputAsset, amount: route.minimumOut },
      adverse: { asset: outputAsset, amount: route.minimumOut } }],
    uncertainty, registryValidation: { registryVersion: '1.1.0', actionType: BRIDGE_ACTION,
      result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
  const quoteHash = H('quote-state-artifact', quote);
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: 'bridge.set.' + suffix,
    semanticWorkflowHash: workflowHash, artifacts: [{ artifactId: quote.artifactId, nodeId: node.nodeId, artifactHash: quoteHash }] });
  const artifactSetHash = H('artifact-set', artifactSet);
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0', simulationId: 'bridge.simulation.' + suffix,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash,
    adapters: [BRIDGE_ADAPTER], contracts: quote.proposedContracts,
    outputs: [{ nodeId: node.nodeId, outputId: 'amount-out', expected: { asset: outputAsset, amount: route.expectedOut },
      minimum: { asset: outputAsset, amount: route.minimumOut }, adverse: { asset: outputAsset, amount: route.minimumOut } }],
    propagatedOutputs: [], failurePaths: [{ failedNodeId: node.nodeId, blockedNodeIds: [],
      residualAssets: [{ asset: inputAsset, amount: route.amountIn }] }], uncertainty,
    unsupportedAssumptions: ['Cross-chain settlement, provider fees and destination balance are not simulated by the live quote.',
      'MOCKED execution cannot establish public-chain success.'], freshness });
  const simulationHash = H('simulation-bundle', simulation);
  const feeLimit = quote.fees[0]!.amount;
  const gasLimit = ((BigInt(route.transaction.gasLimit) + 100_000n) * BigInt(route.transaction.gasPrice) * 2n).toString();
  const recovery = { failurePolicy: 'PAUSE_FOR_APPROVAL' as const, residualAssetRecipient: sourceOwner,
    maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const spendLimits = [{ asset: inputAsset, maximumAmount: route.amountIn,
    maximumPerStepAmount: route.amountIn, maximumCumulativeAmount: route.amountIn }];
  const gasBudgets = [{ asset: native, maximumAmount: gasLimit }];
  const feeBudgets = [{ asset: inputAsset, maximumAmount: feeLimit }];
  const provider = { kind: 'FIXED' as const, providerId: BRIDGE_ADAPTER.id };
  const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0', policyId: 'bridge.policy.' + suffix,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, requiredAuthorizationClass: 'MODE_A',
    allowlists: { owners: [sourceOwner], accounts: [sourceOwner], recipients: [destinationOwner],
      chains: [BRIDGE_SOURCE, BRIDGE_DESTINATION], adapters: [BRIDGE_ADAPTER], protocols: ['lifi', route.provider],
      contracts: quote.proposedContracts, functions: [{ chainId: BRIDGE_SOURCE, contract: BRIDGE_SOURCE_USDC, functionId: '0x095ea7b3' },
        { chainId: BRIDGE_SOURCE, contract: route.transaction.to, functionId: route.transaction.data.slice(0, 10) }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: route.slippageBps, gasBudgets, feeBudgets, oracleRules: [], accountRiskRules: [],
    checkpointRules: [], providers: provider, nonce: '0', deadline: route.expiresAt, revocationEpoch: 0,
    recovery, enforcement: 'NOT_ENFORCED' });
  const policyHash = H('authorization-policy', policy);
  const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0', manifestId: 'bridge.manifest.' + suffix,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash,
    simulationHash, policyHash, authorizationMode: 'MODE_A', owner: sourceOwner, executor: null,
    expiresAt: route.expiresAt, nonce: '0', revocationEpoch: 0, spendLimits,
    maximumSlippageBps: route.slippageBps, gasBudgets, feeBudgets, providers: provider, recovery,
    enforcement: 'NOT_ENFORCED' });
  const manifestHash = H('strategy-manifest', manifest);
  const plan = validateArtifact('execution-plan', { schemaVersion: '1.0.0', executionPlanId: 'bridge.plan.' + suffix,
    semanticWorkflowHash: workflowHash, manifestHash,
    segments: [{ segmentId: 'bridge.segment.base', chainId: BRIDGE_SOURCE, dependencies: [],
      steps: [{ stepId: 'bridge.step.approval', nodeId: node.nodeId, chainId: BRIDGE_SOURCE, adapter: BRIDGE_ADAPTER,
        dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION', payloadHash: approvalPayload },
      { stepId: 'bridge.step.source', nodeId: node.nodeId, chainId: BRIDGE_SOURCE, adapter: BRIDGE_ADAPTER,
        dependencies: ['bridge.step.approval'], requiredAuthorizationClass: 'MODE_A',
        executionKind: 'DIRECT_TRANSACTION', payloadHash: sourcePayload }] }],
    checkpointIds: ['bridge.destination-reconciliation'], enforcement: 'NOT_ENFORCED' });
  return { quote, artifactSet, simulation, policy, manifest, plan, approval, source: route.transaction,
    hashes: { workflow: workflowHash, quote: quoteHash, artifactSet: artifactSetHash, simulation: simulationHash,
      policy: policyHash, manifest: manifestHash, plan: H('execution-plan', plan), approvalPayload, sourcePayload } };
}
export function verifyBridgeReview(compiled: BridgeCompiled, route: BridgeRoute, nowMs: number): void {
  if (Date.parse(route.expiresAt) <= nowMs || compiled.manifest.expiresAt !== route.expiresAt
    || compiled.hashes.quote !== H('quote-state-artifact', compiled.quote)
    || compiled.hashes.manifest !== H('strategy-manifest', compiled.manifest)
    || compiled.hashes.approvalPayload !== payloadHash(compiled.approval)
    || compiled.hashes.sourcePayload !== payloadHash(compiled.source)
    || compiled.source.to !== route.transaction.to || compiled.source.data !== route.transaction.data
    || compiled.manifest.spendLimits[0]?.maximumAmount !== route.amountIn
    || compiled.manifest.maximumSlippageBps !== route.slippageBps)
    throw new Error('BRIDGE_REVIEW_INVALIDATED');
}
