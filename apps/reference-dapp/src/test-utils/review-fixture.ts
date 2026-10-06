// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthorizationPolicy, StrategyManifest } from '@defi-workflow-engine/workflow-contracts';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import type { ReviewAuthorization, ReviewWallet } from '../domain/review-presentation';
import type { SimulationSource } from '../domain/simulation-presentation';
export const reviewOwner = '0x1111111111111111111111111111111111111111';
export const reviewSpender = '0x2222222222222222222222222222222222222222';
export const reviewNow = Date.parse('2026-10-06T12:00:00.000Z');
export const reviewExpiry = new Date(reviewNow + 120_000).toISOString();
export function reviewFixture() {
  const context = createBaseSepoliaReviewContext();
  const workflow = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '100', slippage: '50', source: 'CHAT', baseRevision: 0 }, context).workflow;
  const hash = (kind: 'semantic-workflow' | 'authorization-policy', value: unknown) => hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));
  const chain = context.assets.USDC.asset.chainId, owner = { chainId: chain, address: reviewOwner }, asset = context.assets.USDC.asset;
  const spends = [{ asset, maximumAmount: '100000000', maximumPerStepAmount: '75000000', maximumCumulativeAmount: '100000000' }];
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const digest = '0x' + 'a'.repeat(64);
  const policy: AuthorizationPolicy = {
    schemaVersion: '1.0.0', policyId: 'review-policy', semanticWorkflowHash: hash('semantic-workflow', workflow), artifactSetHash: digest, simulationHash: digest,
    requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [chain], adapters: [], protocols: ['uniswap-v3'], contracts: [], functions: [] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits: spends, maximumSlippageBps: 50, gasBudgets: [{ asset: { chainId: chain, nativeId: 'ETH', decimals: 18 }, maximumAmount: '1000000000000000' }], feeBudgets: [],
    oracleRules: [], accountRiskRules: [], checkpointRules: [], providers: { kind: 'FIXED', providerId: 'uniswap.v3' }, nonce: '1', deadline: reviewExpiry,
    revocationEpoch: workflow.revision, recovery, enforcement: 'NOT_ENFORCED',
  };
  const manifest: StrategyManifest = {
    schemaVersion: '1.0.0', manifestId: 'review-manifest', semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: policy.semanticWorkflowHash,
    artifactSetHash: digest, simulationHash: digest, policyHash: hash('authorization-policy', policy), authorizationMode: 'MODE_A', owner, executor: null,
    expiresAt: reviewExpiry, nonce: '1', revocationEpoch: workflow.revision, spendLimits: spends, maximumSlippageBps: 50, gasBudgets: policy.gasBudgets, feeBudgets: [], providers: policy.providers,
    recovery, enforcement: 'NOT_ENFORCED',
  };
  const quote = { executionId: 'test-review', revision: workflow.revision, workflowHash: policy.semanticWorkflowHash, nodeId: workflow.nodes.at(-1)!.nodeId, manifestHash: digest,
    chainId: 84532, inputSymbol: 'USDC', outputSymbol: 'WETH', amountIn: '100000000', expectedOut: '25000000000000000', minimumOut: '24875000000000000', slippageBps: 50, expiresAt: reviewExpiry };
  const source = { kind: 'public', state: { busy: false, error: null, retired: false, recoveryOnly: false, available: true, run: { workflow, quote, attempts: [], outcome: null, reviewedManifestHash: null } } } as unknown as SimulationSource;
  const authorization: ReviewAuthorization = {
    key: 'test-review', manifest, policy, owner: reviewOwner, chain, ready: true, accepted: false, approve: () => {}, approvals: [], tokens: [], limits: [], technical: quote,
  };
  const wallet: ReviewWallet = { account: reviewOwner, chain, environment: 'testnet', changed: false };
  return { workflow, context, source, authorization, wallet, manifest, policy };
}
