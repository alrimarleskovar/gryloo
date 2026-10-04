// SPDX-License-Identifier: AGPL-3.0-only
/** Existing frozen v1 artifact/Manifest chain, with provider-managed routing and honest proof-level simulation. */
import { CLOAK_ADAPTER, assertPrivacyManifest, readExactInputSwap, requireCloakPrivacy,
  type SemanticWorkflow, type QuoteStateArtifact, type ArtifactSet, type SimulationBundle,
  type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { digestArtifact, digestRawResponse, digestPayload, digestCloakFinancialArtifact, validateSolanaSwapWorkflow } from '@defi-workflow-engine/reference-linter';
import { canonicalJson, type RelayAuthPreimage } from '@cloak.dev/sdk';
import { assertVerifiedCloakProof, type CloakPreparedProof } from './live-proof';
import { assertCloakAuth, cloakRequestDigest, prepareCloakAuth, type CloakProperties } from './provider-contract';

export type CloakLiveReview = { environment: 'LIVE'; properties: CloakProperties; quote: QuoteStateArtifact;
  artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest;
  plan: ExecutionPlan; manifestHash: string; reviewDigest: string; requestDigest: string;
  simulationScope: 'LOCAL_PROOF_AND_FINALIZED_INPUT_STATE'; transactionSimulation: 'NOT_PERFORMED' };
const reviews = new WeakMap<CloakLiveReview, string>();
const fail = (code: string): never => { throw new Error(code); };
export async function compileCloakLiveReview(workflowInput: SemanticWorkflow, prepared: CloakPreparedProof): Promise<{
  review: CloakLiveReview; auth: RelayAuthPreimage }> {
  assertVerifiedCloakProof(prepared);
  const auth = await prepareCloakAuth(prepared.properties, prepared.body, Date.now());
  const review = await reconstructCloakLiveReview(workflowInput, prepared, auth, Date.now());
  reviews.set(review, JSON.stringify(review)); return { review, auth };
}
/** Deterministic historical reconstruction for encrypted recovery only; does not mint an executable Review brand. */
export async function reconstructCloakLiveReview(workflowInput: SemanticWorkflow,
  prepared: Pick<CloakPreparedProof, 'properties' | 'body' | 'circuitDigests' | 'sourceSlot'>, auth: RelayAuthPreimage,
  inspectedAt: number): Promise<CloakLiveReview> {
  const workflow = structuredClone(workflowInput), p = structuredClone(prepared.properties);
  validateSolanaSwapWorkflow(workflow); requireCloakPrivacy(workflow.nodes[0]!);
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length) fail('CLOAK_WORKFLOW_UNSUPPORTED');
  const node = workflow.nodes[0]!, f = readExactInputSwap(node);
  if (f.input.address !== p.inputMint || f.output.address !== p.outputMint || f.amount !== p.grossInputLamports ||
      f.slippageBps !== p.slippageBps) fail('CLOAK_WORKFLOW_PROPERTIES_CHANGED');
  await assertCloakAuth(p, prepared.body, auth, inspectedAt);
  const workflowHash = await digestArtifact('semantic-workflow', workflow), requestDigest = await cloakRequestDigest(prepared.body, p.owner);
  const propertiesHash = await digestRawResponse(new TextEncoder().encode(canonicalJson(p)));
  const freshness = { observedAt: new Date(p.reviewedAt).toISOString(), expiresAt: new Date(p.expiresAt).toISOString(), maximumAgeSeconds: 60 };
  const contracts = [{ chainId: f.chain, address: p.programId, version: '0.2.5' }];
  const owner = { chainId: f.chain, address: p.owner }, recipient = { chainId: f.chain, address: p.recipientAta };
  const output = { nodeId: node.nodeId, outputId: 'amount-out', expected: { asset: f.output, amount: p.minimumOutput },
    minimum: { asset: f.output, amount: p.minimumOutput }, adverse: { asset: f.output, amount: p.minimumOutput } };
  const uncertainty = [{ code: 'CLOAK_PROVIDER_MANAGED_ROUTING', description: 'Routing provider: Jupiter via Cloak. Exact DEX route: provider-managed and not authorization-bound. Output shown is the authorized minimum, not a market prediction.' },
    { code: 'CLOAK_PROOF_SIMULATION_SCOPE', description: 'Groth16 proof verified locally and funded inputs/root checked against finalized mainnet reads. No source or settlement transaction was RPC-simulated; no settlement deadline is guaranteed.' }];
  const quote: QuoteStateArtifact = { schemaVersion: '1.0.0', artifactId: 'cloak.live.properties', semanticWorkflowHash: workflowHash,
    nodeId: node.nodeId, sourceId: 'cloak.sdk.0.2.5', adapter: CLOAK_ADAPTER, chainId: f.chain,
    chainPosition: { kind: 'BLOCK', height: prepared.sourceSlot }, retrievedAt: freshness.observedAt, freshness,
    rawResponseHash: await digestRawResponse(new TextEncoder().encode(canonicalJson({ properties: p, requestDigest, circuitDigests: prepared.circuitDigests }))),
    normalizedValues: [{ name: 'bound-properties', kind: 'IDENTIFIER', value: propertiesHash }, { name: 'authenticated-request', kind: 'IDENTIFIER', value: requestDigest },
      { name: 'private-change-commitment', kind: 'IDENTIFIER', value: p.privateChange.commitment }],
    providerReference: { kind: 'NONE' }, proposedContracts: contracts, proposedSpenders: [], proposedRecipients: [recipient],
    fees: [{ asset: f.input, amount: p.maximumProtocolFeeLamports }], gas: [], outputBounds: [{ outputId: output.outputId, expected: output.expected,
      minimum: output.minimum, adverse: output.adverse }], uncertainty,
    registryValidation: { registryVersion: '1.1.0', actionType: node.actionType, result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } };
  const artifactSet: ArtifactSet = { schemaVersion: '1.0.0', artifactSetId: 'cloak.live.set', semanticWorkflowHash: workflowHash,
    artifacts: [{ artifactId: quote.artifactId, nodeId: node.nodeId, artifactHash: await digestArtifact('quote-state-artifact', quote) }] };
  const artifactSetHash = await digestArtifact('artifact-set', artifactSet);
  const simulation: SimulationBundle = { schemaVersion: '1.0.0', simulationId: 'cloak.live.proof-simulation', semanticWorkflowHash: workflowHash,
    semanticWorkflowRevision: workflow.revision, artifactSetHash, adapters: [CLOAK_ADAPTER], contracts, outputs: [output], propagatedOutputs: [],
    failurePaths: [{ failedNodeId: node.nodeId, blockedNodeIds: [], residualAssets: [{ asset: f.input, amount: p.privateChange.amount }] }],
    uncertainty, unsupportedAssumptions: ['No exact Jupiter route authorization.', 'No RPC transaction simulation.', 'Review expiry does not cancel an already accepted swap.'], freshness };
  const simulationHash = await digestArtifact('simulation-bundle', simulation);
  const spendLimits = [{ asset: f.input, maximumAmount: p.grossInputLamports, maximumPerStepAmount: p.grossInputLamports, maximumCumulativeAmount: p.grossInputLamports }];
  const feeBudgets = [{ asset: f.input, maximumAmount: p.maximumProtocolFeeLamports }], providers = { kind: 'FIXED' as const, providerId: 'cloak' };
  const recovery = { failurePolicy: 'PAUSE_FOR_APPROVAL' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const nonce = BigInt('0x' + auth.auth_nonce.replaceAll('-', '')).toString();
  const policy: AuthorizationPolicy = { schemaVersion: '1.0.0', policyId: 'cloak.live.policy', semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash,
    requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [recipient], chains: [f.chain], adapters: [CLOAK_ADAPTER],
      protocols: ['cloak'], contracts, functions: [] }, budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: p.slippageBps, gasBudgets: [], feeBudgets, oracleRules: [], accountRiskRules: [], checkpointRules: [],
    providers, nonce, deadline: freshness.expiresAt, revocationEpoch: 0, recovery, enforcement: 'NOT_ENFORCED' };
  const manifest: StrategyManifest = { schemaVersion: '1.0.0', manifestId: 'cloak.live.manifest', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash: await digestCloakFinancialArtifact('authorization-policy', policy), authorizationMode: 'MODE_A',
    owner, executor: null, expiresAt: freshness.expiresAt, nonce, revocationEpoch: 0, spendLimits, maximumSlippageBps: p.slippageBps,
    gasBudgets: [], feeBudgets, providers, recovery, enforcement: 'NOT_ENFORCED' };
  assertPrivacyManifest(workflow, workflowHash, manifest);
  const manifestHash = await digestCloakFinancialArtifact('strategy-manifest', manifest);
  const plan: ExecutionPlan = { schemaVersion: '1.0.0', executionPlanId: 'cloak.live.plan', semanticWorkflowHash: workflowHash, manifestHash,
    segments: [{ segmentId: 'cloak.live.segment', chainId: f.chain, dependencies: [], steps: [{ stepId: 'cloak.live.submit', nodeId: node.nodeId, chainId: f.chain,
      adapter: CLOAK_ADAPTER, dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION', payloadHash: await digestPayload(auth.message) }] }],
    checkpointIds: ['cloak.live.reconcile'], enforcement: 'NOT_ENFORCED' };
  // Frozen v1 enforcement flags are retained; neither these artifacts nor this helper enable the financial gate.
  await digestCloakFinancialArtifact('execution-plan', plan);
  const value = { environment: 'LIVE' as const, properties: p, quote, artifactSet, simulation, policy, manifest, plan, manifestHash,
    requestDigest, simulationScope: 'LOCAL_PROOF_AND_FINALIZED_INPUT_STATE' as const, transactionSimulation: 'NOT_PERFORMED' as const };
  const review = { ...value, reviewDigest: await digestRawResponse(new TextEncoder().encode(canonicalJson(value))) };
  return review;
}
export async function assertCloakLiveReview(review: CloakLiveReview, prepared: CloakPreparedProof, auth: RelayAuthPreimage,
  workflow: SemanticWorkflow, acknowledgedDigest: string): Promise<void> {
  assertVerifiedCloakProof(prepared);
  if (reviews.get(review) !== JSON.stringify(review) || acknowledgedDigest !== review.reviewDigest ||
      canonicalJson(prepared.properties) !== canonicalJson(review.properties) ||
      await digestArtifact('semantic-workflow', workflow) !== review.manifest.semanticWorkflowHash ||
      workflow.revision !== review.manifest.semanticWorkflowRevision ||
      review.manifestHash !== await digestCloakFinancialArtifact('strategy-manifest', review.manifest)) fail('CLOAK_LIVE_REVIEW_CHANGED');
  await assertCloakAuth(review.properties, prepared.body, auth, Date.now());
  assertPrivacyManifest(workflow, review.manifest.semanticWorkflowHash, review.manifest);
}
