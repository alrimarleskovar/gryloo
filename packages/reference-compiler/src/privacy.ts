// SPDX-License-Identifier: AGPL-3.0-only
/** Deterministic LOCAL fixtures only. No price discovery, proof generation or chain transport. */
import { CLOAK_ADAPTER, CLOAK_PRIVACY_POLICY, requireCloakPrivacy, assertPrivacyManifest,
  hashArtifactBytes, hashRawBytes, readExactInputSwap, createExactInputSwapNode, type SemanticWorkflow, type QuoteStateArtifact, type ArtifactSet,
  type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { JUPITER_SOLANA_MAINNET, SOLANA_MAINNET_TOKENS } from '@defi-workflow-engine/action-registry';

export type CloakLocalRoute = {
  environment: 'LOCAL'; provider: 'cloak'; routeId: string; owner: string; recipientAta: string;
  genesisHash: string; programId: string; inputMint: string; outputMint: string; amountIn: string;
  inputTotal: string; changeCommitment: string; inputCommitments: string[];
  priceNumerator: string; priceDenominator: string; feeLamports: string; maximumFeeLamports: string;
  observedAt: string; expiresAt: string; nonce: string;
};
export const CLOAK_LOCAL_NETWORK = Object.freeze({
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  programId: 'zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
});
export type CloakLocalReview = {
  environment: 'LOCAL'; evidence: 'MOCKED'; privacy: typeof CLOAK_PRIVACY_POLICY;
  workflow: SemanticWorkflow; route: CloakLocalRoute; quote: QuoteStateArtifact; artifactSet: ArtifactSet;
  simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan;
  expectedOutput: string; minimumOutput: string; privateChange: string;
};
const uint = (v: string) => typeof v === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) < 1n << 64n;
const address = (v: string) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const commitment = (v: string) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const hashArtifactValue = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown) => hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));
const canonicalJson = (v: unknown): string => JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);

export function compileCloakLocalReview(workflowInput: SemanticWorkflow, routeInput: CloakLocalRoute, nowMs: number): CloakLocalReview {
  const workflow = structuredClone(workflowInput), route = structuredClone(routeInput);
  validateArtifact('semantic-workflow', workflow);
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length) throw new Error('CLOAK_WORKFLOW_UNSUPPORTED');
  const f = readExactInputSwap(workflow.nodes[0]!);
  requireCloakPrivacy(workflow.nodes[0]!);
  const canonical = createExactInputSwapNode(workflow.nodes[0]!.nodeId, f);
  canonical.requiredCapabilities.push('privacy.required.cloak', 'privacy.output.public-with-private-change');
  canonical.adapterConstraints.adapters = [{ ...CLOAK_ADAPTER }];
  if (canonicalJson(canonical) !== canonicalJson(workflow.nodes[0]) || f.chain !== JUPITER_SOLANA_MAINNET.chain ||
      f.input.decimals !== 9 || f.output.decimals !== 6 || f.maximumAmount !== SOLANA_MAINNET_TOKENS.SOL.maximumAmount ||
      BigInt(f.amount) > 50_000_000n || f.slippageBps < 1 || f.slippageBps > JUPITER_SOLANA_MAINNET.maximumSlippageBps)
    throw new Error('CLOAK_WORKFLOW_UNSUPPORTED');
  if (route.environment !== 'LOCAL' || route.provider !== 'cloak')
    throw new Error('PRIVACY_PUBLIC_FALLBACK_DENIED');
  if (Object.entries(CLOAK_LOCAL_NETWORK).some(([k, v]) => route[k as keyof typeof CLOAK_LOCAL_NETWORK] !== v) ||
      !address(route.owner) || !address(route.recipientAta) || !/^[a-zA-Z0-9._-]{1,80}$/.test(route.routeId) ||
      !commitment(route.changeCommitment) || route.inputCommitments.length < 1 || route.inputCommitments.length > 2 ||
      !route.inputCommitments.every(commitment) || new Set(route.inputCommitments).size !== route.inputCommitments.length ||
      route.inputCommitments.includes(route.changeCommitment) ||
      ![route.amountIn, route.inputTotal, route.priceNumerator, route.priceDenominator, route.feeLamports, route.maximumFeeLamports, route.nonce].every(uint) ||
      route.amountIn !== f.amount || f.input.address !== route.inputMint || f.output.address !== route.outputMint ||
      BigInt(route.priceNumerator) === 0n || BigInt(route.priceDenominator) === 0n || BigInt(route.inputTotal) <= BigInt(route.amountIn) ||
      BigInt(route.feeLamports) >= BigInt(route.amountIn) || BigInt(route.feeLamports) > BigInt(route.maximumFeeLamports) ||
      !Number.isFinite(nowMs) || !Number.isFinite(Date.parse(route.observedAt)) || !Number.isFinite(Date.parse(route.expiresAt)) ||
      Date.parse(route.observedAt) > nowMs || Date.parse(route.expiresAt) <= nowMs ||
      Date.parse(route.expiresAt) - Date.parse(route.observedAt) > 60_000)
    throw new Error('CLOAK_LOCAL_ROUTE_INVALID');
  // Fixture price is USDC base units per lamport; fees are included in gross shielded SOL spend.
  const expectedOutput = ((BigInt(route.amountIn) - BigInt(route.feeLamports)) * BigInt(route.priceNumerator) / BigInt(route.priceDenominator)).toString();
  const minimumOutput = (BigInt(expectedOutput) * BigInt(10_000 - f.slippageBps) / 10_000n).toString();
  const privateChange = (BigInt(route.inputTotal) - BigInt(route.amountIn)).toString();
  if (!uint(expectedOutput) || BigInt(minimumOutput) === 0n) throw new Error('CLOAK_LOCAL_OUTPUT_INVALID');
  const node = workflow.nodes[0]!, workflowHash = hashArtifactValue('semantic-workflow', workflow);
  const routeHash = hashRawBytes('raw-response', new TextEncoder().encode(JSON.stringify(route)));
  const freshness = { observedAt: route.observedAt, expiresAt: route.expiresAt, maximumAgeSeconds: 60 };
  const contracts = [{ chainId: f.chain, address: route.programId, version: '0.2.5' }];
  const owner = { chainId: f.chain, address: route.owner }, recipient = { chainId: f.chain, address: route.recipientAta };
  const output = { nodeId: node.nodeId, outputId: 'amount-out', expected: { asset: f.output, amount: expectedOutput },
    minimum: { asset: f.output, amount: minimumOutput }, adverse: { asset: f.output, amount: minimumOutput } };
  const uncertainty = [{ code: 'CLOAK_LOCAL_ONLY', description: 'Deterministic fixture arithmetic and mocked settlement. No financial simulation or chain evidence.' }];
  const quote = validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0', artifactId: 'cloak.local.quote',
    semanticWorkflowHash: workflowHash, nodeId: node.nodeId, sourceId: 'cloak.local.fixture', adapter: CLOAK_ADAPTER,
    chainId: f.chain, chainPosition: { kind: 'BLOCK', height: 0 }, retrievedAt: route.observedAt, freshness,
    rawResponseHash: routeHash, normalizedValues: [{ name: 'route-binding', kind: 'IDENTIFIER', value: routeHash },
      { name: 'private-change-commitment', kind: 'IDENTIFIER', value: route.changeCommitment }],
    providerReference: { kind: 'ROUTE', id: route.routeId }, proposedContracts: contracts, proposedSpenders: [],
    proposedRecipients: [recipient], fees: [{ asset: f.input, amount: route.feeLamports }], gas: [],
    outputBounds: [{ outputId: output.outputId, expected: output.expected, minimum: output.minimum, adverse: output.adverse }],
    uncertainty, registryValidation: { registryVersion: '1.1.0', actionType: node.actionType, result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: 'cloak.local.set', semanticWorkflowHash: workflowHash,
    artifacts: [{ artifactId: quote.artifactId, nodeId: node.nodeId, artifactHash: hashArtifactValue('quote-state-artifact', quote) }] });
  const artifactSetHash = hashArtifactValue('artifact-set', artifactSet);
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0', simulationId: 'cloak.local.simulation',
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, adapters: [CLOAK_ADAPTER], contracts,
    outputs: [output], propagatedOutputs: [], failurePaths: [{ failedNodeId: node.nodeId, blockedNodeIds: [],
      residualAssets: [{ asset: f.input, amount: route.inputTotal }] }], uncertainty,
    unsupportedAssumptions: ['No proof, unsigned-message simulation, relay, RPC or live settlement is performed.'], freshness });
  const simulationHash = hashArtifactValue('simulation-bundle', simulation);
  const recovery = { failurePolicy: 'PAUSE_FOR_APPROVAL' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const spendLimits = [{ asset: f.input, maximumAmount: route.amountIn, maximumPerStepAmount: route.amountIn, maximumCumulativeAmount: route.amountIn }];
  const feeBudgets = [{ asset: f.input, maximumAmount: route.maximumFeeLamports }], providers = { kind: 'FIXED' as const, providerId: 'cloak' };
  const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0', policyId: 'cloak.local.policy', semanticWorkflowHash: workflowHash,
    artifactSetHash, simulationHash, requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [recipient],
      chains: [f.chain], adapters: [CLOAK_ADAPTER], protocols: ['cloak'], contracts, functions: [] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: f.slippageBps, gasBudgets: [], feeBudgets, oracleRules: [], accountRiskRules: [],
    checkpointRules: [], providers, nonce: route.nonce, deadline: route.expiresAt, revocationEpoch: 0, recovery, enforcement: 'NOT_ENFORCED' });
  const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0', manifestId: 'cloak.local.manifest', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash: hashArtifactValue('authorization-policy', policy),
    authorizationMode: 'MODE_A', owner, executor: null, expiresAt: route.expiresAt, nonce: route.nonce, revocationEpoch: 0,
    spendLimits, maximumSlippageBps: f.slippageBps, gasBudgets: [], feeBudgets, providers, recovery, enforcement: 'NOT_ENFORCED' });
  assertPrivacyManifest(workflow, workflowHash, manifest);
  const plan = validateArtifact('execution-plan', { schemaVersion: '1.0.0', executionPlanId: 'cloak.local.plan', semanticWorkflowHash: workflowHash,
    manifestHash: hashArtifactValue('strategy-manifest', manifest), segments: [{ segmentId: 'cloak.local.segment', chainId: f.chain, dependencies: [],
      steps: [{ stepId: 'cloak.local.submit', nodeId: node.nodeId, chainId: f.chain, adapter: CLOAK_ADAPTER, dependencies: [],
        requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION', payloadHash: hashRawBytes('payload', new TextEncoder().encode(JSON.stringify(route))) }] }],
    checkpointIds: ['cloak.local.reconcile'], enforcement: 'NOT_ENFORCED' });
  return { environment: 'LOCAL', evidence: 'MOCKED', privacy: CLOAK_PRIVACY_POLICY, workflow, route, quote, artifactSet, simulation, policy, manifest, plan,
    expectedOutput, minimumOutput, privateChange };
}

export function verifyCloakLocalReview(review: CloakLocalReview, nowMs: number): void {
  const rebuilt = compileCloakLocalReview(review.workflow, review.route, nowMs);
  if (JSON.stringify(rebuilt) !== JSON.stringify(review)) throw new Error('CLOAK_LOCAL_REVIEW_INVALIDATED');
}
