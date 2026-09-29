// SPDX-License-Identifier: AGPL-3.0-only
/** Direct Across review binding. FIXED provider is mandatory for BUILD-010 execution. */
import { createHash } from 'node:crypto';
import { hashArtifactBytes, type SemanticWorkflow, type QuoteStateArtifact, type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
export type AcrossQuote = { readonly provider: 'across.direct'; readonly rawHash: string; readonly owner: string; readonly refundAddress: string;
  readonly sourceChainId: 8453; readonly destinationChainId: 42161; readonly inputToken: string; readonly outputToken: string;
  readonly inputAmount: string; readonly minimumOutput: string; readonly feeMaximum: string; readonly maximumGasCostWei: string; readonly observedAt: string; readonly quoteExpiresAt: string;
  readonly approvalSpender: string; readonly approvals: readonly { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0' }[];
  readonly deposit: { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0'; readonly gas: string } };
export type ProviderBinding = { readonly kind: 'FIXED'; readonly providerId: string } |
  { readonly kind: 'AUTHORIZED_SET'; readonly providerIds: readonly string[] };
const hash = (value: unknown) => '0x' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const H = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown) => hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));
const ADAPTER = { id: 'across.direct', version: '1.0.0' } as const;
export function providerAuthorized(binding: ProviderBinding, candidate: string, materialBoundsMatch: boolean): boolean {
  if (!materialBoundsMatch) return false;
  return binding.kind === 'FIXED' ? binding.providerId === candidate : binding.providerIds.includes(candidate);
}
export type AcrossReview = { readonly provider: { readonly kind: 'FIXED'; readonly providerId: 'across.direct' };
  readonly workflowHash: string; readonly quoteHash: string; readonly manifestHash: string;
  readonly approvalHashes: readonly string[]; readonly depositHash: string;
  readonly quoteArtifact: QuoteStateArtifact; readonly artifactSet: ArtifactSet; readonly simulation: SimulationBundle;
  readonly policyArtifact: AuthorizationPolicy; readonly manifestArtifact: StrategyManifest;
  readonly policy: { readonly owner: string; readonly recipient: string; readonly refundAddress: string;
    readonly sourceChainId: 8453; readonly destinationChainId: 42161;
    readonly inputToken: string; readonly outputToken: string; readonly maximumInput: string;
    readonly minimumOutput: string; readonly maximumFee: string; readonly quoteExpiresAt: string;
    readonly approvalSpender: string; readonly depositTarget: string; readonly depositValue: '0x0'; readonly maximumGasCostWei: string } };
export function compileAcrossReview(workflow: SemanticWorkflow, quote: AcrossQuote, nowMs: number): AcrossReview {
  const node = workflow.nodes[0], amount = node?.inputs.find(x => x.name === 'amount-in');
  const slippage = node?.userConstraints.find(x => x.kind === 'MAXIMUM_SLIPPAGE_BPS');
  const output = node?.inputs.find(x => x.name === 'asset-out');
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length || node?.actionType !== 'asset.bridge'
    || node.adapterConstraints.adapters.length !== 1 || node.adapterConstraints.adapters[0]?.id !== 'across.direct'
    || node.adapterConstraints.protocols.length !== 1 || node.adapterConstraints.protocols[0] !== 'across'
    || amount?.kind !== 'QUANTITY' || output?.kind !== 'ASSET'
    || slippage?.kind !== 'MAXIMUM_SLIPPAGE_BPS' || slippage.maximumBps < 1 || slippage.maximumBps > 300
    || !/^0x[0-9a-f]{64}$/.test(quote.rawHash)
    || amount.value.amount !== quote.inputAmount || !('address' in amount.value.asset)
    || amount.value.asset.address !== quote.inputToken || !('address' in output.value)
    || output.value.address !== quote.outputToken || quote.provider !== 'across.direct'
    || Date.parse(quote.quoteExpiresAt) <= nowMs || Date.parse(quote.observedAt) > nowMs
    || quote.owner !== quote.refundAddress
    || quote.deposit.to !== quote.approvalSpender) throw new Error('ACROSS_REVIEW_INVALID');
  const policy = { owner: quote.owner, recipient: quote.owner, refundAddress: quote.refundAddress,
    sourceChainId: quote.sourceChainId, destinationChainId: quote.destinationChainId,
    inputToken: quote.inputToken, outputToken: quote.outputToken, maximumInput: quote.inputAmount,
    minimumOutput: quote.minimumOutput, maximumFee: quote.feeMaximum,
    quoteExpiresAt: quote.quoteExpiresAt, approvalSpender: quote.approvalSpender,
    depositTarget: quote.deposit.to, depositValue: quote.deposit.value, maximumGasCostWei: quote.maximumGasCostWei };
  const provider = { kind: 'FIXED' as const, providerId: 'across.direct' as const };
  const workflowHash = H('semantic-workflow', workflow);
  const inputAsset = { chainId: 'eip155:8453', address: quote.inputToken, decimals: 6 };
  const outputAsset = { chainId: 'eip155:42161', address: quote.outputToken, decimals: 6 };
  const nativeAsset = { chainId: 'eip155:8453', nativeId: 'ETH', decimals: 18 };
  const sourceOwner = { chainId: 'eip155:8453', address: quote.owner };
  const destinationOwner = { chainId: 'eip155:42161', address: quote.owner };
  const freshness = { observedAt: quote.observedAt, expiresAt: quote.quoteExpiresAt,
    maximumAgeSeconds: Math.max(1, Math.ceil((Date.parse(quote.quoteExpiresAt) - Date.parse(quote.observedAt)) / 1000)) };
  const suffix = hash(quote).slice(2, 26);
  const uncertainty = [{ code: 'CROSS_CHAIN_SETTLEMENT_NOT_SIMULATED',
    description: 'Approval, deposit, fill, refund and destination reconciliation are deterministic MOCKED observations.' }];
  const quoteArtifact = validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0',
    artifactId: 'across.quote.' + suffix, semanticWorkflowHash: workflowHash, nodeId: node.nodeId,
    sourceId: 'across.swap-api', adapter: ADAPTER, chainId: 'eip155:8453',
    chainPosition: { kind: 'BLOCK', height: 0 }, retrievedAt: freshness.observedAt, freshness,
    rawResponseHash: quote.rawHash, normalizedValues: [
      { name: 'provider', kind: 'IDENTIFIER', value: 'across.direct' },
      { name: 'destination-chain', kind: 'IDENTIFIER', value: 'eip155:42161' },
      { name: 'deposit-payload-hash', kind: 'IDENTIFIER', value: hash(quote.deposit) }],
    providerReference: { kind: 'ROUTE', id: 'across-' + suffix },
    proposedContracts: [{ chainId: 'eip155:8453', address: quote.inputToken, version: 'catalog-checked' },
      { chainId: 'eip155:8453', address: quote.deposit.to, version: 'across-quoted' }],
    proposedSpenders: [sourceOwner, { chainId: 'eip155:8453', address: quote.approvalSpender }],
    proposedRecipients: [destinationOwner],
    fees: [{ asset: inputAsset, amount: quote.feeMaximum }], gas: [{ asset: nativeAsset, amount: quote.deposit.gas }],
    outputBounds: [{ outputId: 'amount-out', expected: { asset: outputAsset, amount: quote.minimumOutput },
      minimum: { asset: outputAsset, amount: quote.minimumOutput },
      adverse: { asset: outputAsset, amount: quote.minimumOutput } }], uncertainty,
    registryValidation: { registryVersion: '1.1.0', actionType: 'asset.bridge',
      result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
  const quoteHash = H('quote-state-artifact', quoteArtifact);
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: 'across.set.' + suffix,
    semanticWorkflowHash: workflowHash, artifacts: [{ artifactId: quoteArtifact.artifactId, nodeId: node.nodeId, artifactHash: quoteHash }] });
  const artifactSetHash = H('artifact-set', artifactSet);
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0',
    simulationId: 'across.simulation.' + suffix, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash, adapters: [ADAPTER], contracts: quoteArtifact.proposedContracts,
    outputs: [{ nodeId: node.nodeId, outputId: 'amount-out', expected: { asset: outputAsset, amount: quote.minimumOutput },
      minimum: { asset: outputAsset, amount: quote.minimumOutput }, adverse: { asset: outputAsset, amount: quote.minimumOutput } }],
    propagatedOutputs: [], failurePaths: [{ failedNodeId: node.nodeId, blockedNodeIds: [],
      residualAssets: [{ asset: inputAsset, amount: quote.inputAmount }] }], uncertainty,
    unsupportedAssumptions: ['Public-chain settlement and destination balance are not simulated by the quote.',
      'MOCKED execution cannot establish public-chain success.'], freshness });
  const simulationHash = H('simulation-bundle', simulation);
  const recovery = { failurePolicy: 'PAUSE_FOR_APPROVAL' as const, residualAssetRecipient: sourceOwner,
    maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const spendLimits = [{ asset: inputAsset, maximumAmount: quote.inputAmount,
    maximumPerStepAmount: quote.inputAmount, maximumCumulativeAmount: quote.inputAmount }];
  const gasBudgets = [{ asset: nativeAsset, maximumAmount: quote.maximumGasCostWei }];
  const feeBudgets = [{ asset: inputAsset, maximumAmount: quote.feeMaximum }];
  const policyArtifact = validateArtifact('authorization-policy', { schemaVersion: '1.0.0',
    policyId: 'across.policy.' + suffix, semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash,
    requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [sourceOwner], accounts: [sourceOwner],
      recipients: [destinationOwner], chains: ['eip155:8453', 'eip155:42161'], adapters: [ADAPTER], protocols: ['across'],
      contracts: quoteArtifact.proposedContracts,
      functions: [{ chainId: 'eip155:8453', contract: quote.inputToken, functionId: '0x095ea7b3' },
        { chainId: 'eip155:8453', contract: quote.deposit.to, functionId: quote.deposit.data.slice(0, 10) }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES',
      implementation: 'NOT_IMPLEMENTED' }, spendLimits, maximumSlippageBps: slippage.maximumBps, gasBudgets, feeBudgets,
    oracleRules: [], accountRiskRules: [], checkpointRules: [], providers: provider, nonce: '0',
    deadline: quote.quoteExpiresAt, revocationEpoch: 0, recovery, enforcement: 'NOT_ENFORCED' });
  const policyHash = H('authorization-policy', policyArtifact);
  const manifestArtifact = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0',
    manifestId: 'across.manifest.' + suffix, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash,
    authorizationMode: 'MODE_A', owner: sourceOwner, executor: null, expiresAt: quote.quoteExpiresAt,
    nonce: '0', revocationEpoch: 0, spendLimits, maximumSlippageBps: slippage.maximumBps, gasBudgets, feeBudgets,
    providers: provider, recovery, enforcement: 'NOT_ENFORCED' });
  const approvalHashes = quote.approvals.map(hash), depositHash = hash(quote.deposit);
  return { provider, workflowHash, quoteHash, approvalHashes, depositHash, policy,
    quoteArtifact, artifactSet, simulation, policyArtifact, manifestArtifact,
    manifestHash: H('strategy-manifest', manifestArtifact) };
}
export function verifyAcrossReview(review: AcrossReview, workflow: SemanticWorkflow, quote: AcrossQuote, nowMs: number): void {
  const fresh = compileAcrossReview(workflow, quote, nowMs);
  if (JSON.stringify(fresh) !== JSON.stringify(review) || !providerAuthorized(review.provider, quote.provider, true))
    throw new Error('ACROSS_REVIEW_INVALIDATED');
}
