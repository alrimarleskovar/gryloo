// SPDX-License-Identifier: AGPL-3.0-only
// Explicit normalized fixtures exercise UX-005 projections without RPC, signing, or execution.
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from '../domain/execution-lifecycle';
import { projectExecutionEvidence } from '../domain/execution-evidence';
import { projectExecutionStepEvidence } from '../domain/execution-step-evidence';
import { createRouterNode } from '../domain/router-authoring';
import { createAuthoredSupply } from '../domain/supply-authoring';
import { createAuthoredLending } from '../domain/lending-authoring';
import { projectDashboardRecord } from '../lib/dashboard/record-projection';
import { projectDashboardRun } from '../lib/dashboard/run-mapping';
import type { DashboardRun, DashboardRunDetail } from '../lib/dashboard/types';
import { reviewFixture, reviewOwner } from './review-fixture';

export const detailHash = '0x' + 'b'.repeat(64), detailApprovalHash = '0x' + 'a'.repeat(64), detailDestinationHash = '0x' + 'c'.repeat(64);
export const detailOrderId = '0x' + 'd'.repeat(112);
export type RunDetailCase = 'completed' | 'pending' | 'partial' | 'failed' | 'declined' | 'unresolved' | 'recovered' | 'restored'
  | 'bridge-pending' | 'bridge-completed' | 'cow-pending' | 'cow-reconciled' | 'cow-cancelled' | 'legacy' | 'record-unavailable' | 'archive-unavailable' | 'archive-unverified';
const bundle = { evidenceBundleId: 'fixture-evidence-bundle', semanticWorkflowHash: 'fixture-workflow-hash', manifestHash: 'fixture-manifest-hash',
  outcome: 'RECONCILED', environment: 'PUBLIC_TESTNET', observedAt: '2026-10-06T12:01:00.000Z', receipts: [], reconciliation: { limitations: [] } };

export function runDetailFixture(mode: RunDetailCase = 'completed', stress = false) {
  const fixture = reviewFixture(), base = 'run' in fixture.source.state ? fixture.source.state.run : null;
  const run: DashboardRun = { runId: 'fixture-detail-run', workflowId: fixture.workflow.workflowId, flow: 'base-sepolia-swap', status: 'RECONCILED', ownerAccount: reviewOwner,
    provenance: 'PUBLIC_TESTNET', hasEvidence: mode === 'completed' || mode.startsWith('archive-'), errorCode: null, needsObservation: false, attentionRequired: false,
    createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:01:00.000Z' };
  const state = mode === 'failed' ? 'REVERTED' : mode === 'declined' ? 'REJECTED' : mode === 'unresolved' ? 'UNKNOWN' : mode === 'pending' ? 'PENDING' : 'CONFIRMED';
  const actual = mode === 'completed' || mode.startsWith('archive-');
  run.status = actual ? 'RECONCILED' : state;
  const detail: DashboardRunDetail = { run, recordUnavailable: false, evidenceUnavailable: mode === 'archive-unavailable', attempts: [],
    evidence: actual && mode !== 'archive-unavailable' ? [{ bundleHash: '0x' + 'e'.repeat(64), outcome: 'RECONCILED', environment: 'PUBLIC_TESTNET', verified: mode !== 'archive-unverified', createdAt: run.updatedAt }] : [],
    record: { ...base, quote: { ...base?.quote, executionId: run.runId },
      attempts: [...(actual ? [{ step: 'approval', account: reviewOwner, state: 'CONFIRMED', txHash: detailApprovalHash, receipt: { transactionHash: detailApprovalHash, gasCostWei: '100000000000000' } }] : []),
        { step: 'swap', account: reviewOwner, state, txHash: mode === 'declined' ? null : detailHash,
          ...(actual ? { receipt: { transactionHash: detailHash, gasCostWei: stress ? '9'.repeat(72) : '200000000000000' } } : {}) }],
      outcome: actual ? { evidence: bundle, evidenceBundleHash: '0x' + 'e'.repeat(64), inputSpent: '100000000', outputReceived: stress ? '9'.repeat(96) : '24300000000000000' } : null } };
  let progress = projectDashboardRecord(detail, fixture.context);
  const project = (kind: ExecutionLifecycleSource['kind'], state: unknown, workflow = fixture.workflow) => {
    const source = { kind, state } as ExecutionLifecycleSource;
    const lifecycle = projectExecutionLifecycle(workflow, fixture.context, source);
    return { ...lifecycle, evidence: projectExecutionEvidence(source, lifecycle), stepEvidence: projectExecutionStepEvidence(source, lifecycle) };
  };
  if (mode === 'partial') {
    run.status = 'PARTIALLY_COMPLETED';
    const workflow = createAuthoredLending('fixture-lending-workflow', 1, { supply: '100', borrow: '50', slippage: '50', owner: reviewOwner });
    const nodes = workflow.nodes.filter(node => node.actionType !== 'trigger');
    progress = project('lending', { recovered: false, record: { id: run.runId, provenance: run.provenance, status: 'FAILED', observations: [],
      reviews: [{ workflow, commitment: 'fixture-review', fields: { owner: reviewOwner }, manifest: fixture.manifest,
        calls: ['SUPPLY', 'BORROW', 'SWAP'].map((id, index) => ({ id, nodeId: nodes[index]!.nodeId })) }],
      attempts: [{ id: 'fixture-supply', step: 'SUPPLY', reviewCommitment: 'fixture-review', state: 'CONFIRMED', hash: detailApprovalHash, reconciled: true },
        { id: 'fixture-borrow', step: 'BORROW', reviewCommitment: 'fixture-review', state: 'REVERTED', hash: detailHash, reconciled: false }] } }, workflow);
  }
  if (mode === 'recovered' || mode === 'restored') {
    run.flow = 'aave-supply';
    run.status = mode === 'recovered' ? 'RECONCILED' : 'CONFIRMED';
    const workflow = { ...fixture.workflow, nodes: [createAuthoredSupply('fixture-supply', { network: 'Base Sepolia', asset: 'USDC', amount: '100', beneficiary: reviewOwner })], resourceEdges: [] };
    const journal = { entries: mode === 'recovered' ? ['SUBMISSION_RESULT_UNKNOWN', 'CONFIRMED'].map(toState => ({ level: 'attempt', entityId: `${run.runId}.SUPPLY`, toState })) : [] };
    progress = project('supply', { recovered: true, record: { id: run.runId, provenance: run.provenance, journal, observations: [],
      review: { workflow, chain: 'eip155:84532', account: reviewOwner, amount: '100000000', approvalRequired: false },
      attempts: [{ step: 'SUPPLY', state: 'CONFIRMED', transactionHash: detailHash, reconciled: mode === 'recovered' }] } }, workflow);
  }
  if (mode.startsWith('bridge-')) {
    run.flow = 'crosschain-router-testnet';
    const settled = mode === 'bridge-completed';
    run.status = settled ? 'RECONCILED' : 'IN_FLIGHT';
    const workflow = { ...fixture.workflow, nodes: [createRouterNode('fixture-bridge', { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '5', recipient: '', slippage: '50', routing: 'AUTO' })], resourceEdges: [] };
    detail.record = { id: run.runId, workflow, owner: reviewOwner, provenance: run.provenance, verdict: settled ? 'RECONCILED' : 'PENDING', phase: settled ? 'RECONCILED' : 'IN_FLIGHT',
      review: { nodeId: 'fixture-bridge', intent: { sourceChain: 'eip155:84532', destinationChain: 'eip155:421614', amount: '5000000' }, quote: { expectedOutput: '4900000' },
        route: { routingProvider: 'across', inputToken: { symbol: 'USDC', decimals: 6 }, outputToken: { symbol: 'USDC', decimals: 6 } }, calls: [{ purpose: 'BRIDGE_DEPOSIT' }] },
      attempts: [{ step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: detailHash, reconciled: true }],
      source: { transactionHash: detailHash, depositId: 'fixture-provider-deposit'.repeat(stress ? 32 : 1), inputAmount: '5000000', safe: true },
      destination: { transactionHash: detailDestinationHash, transferAmount: stress ? '9'.repeat(96) : '4890000', safe: true } };
    progress = projectDashboardRecord(detail, fixture.context);
  }
  if (mode.startsWith('cow-')) {
    run.flow = 'cow'; run.provenance = 'MOCKED';
    const state = mode === 'cow-reconciled' ? 'RECONCILED' : mode === 'cow-cancelled' ? 'CANCEL_REQUESTED' : 'OPEN';
    run.status = state;
    progress = project('cow', { recoveryOnly: true, execution: { record: { executionId: run.runId, state, compiled: { orderUid: detailOrderId }, history: [{ state, at: run.updatedAt }],
      quote: { owner: reviewOwner, chainId: 'eip155:8453', quoteId: 'fixture-provider-quote'.repeat(stress ? 32 : 1),
        sellToken: 'address' in baseAssetRegistry.USDC.asset ? baseAssetRegistry.USDC.asset.address : '', buyToken: 'address' in baseAssetRegistry.WETH.asset ? baseAssetRegistry.WETH.asset.address : '',
        sellAmount: '100000000', buyAmount: '25000000000000000' },
      observed: { uid: detailOrderId, executedSellAmount: '100000000', executedBuyAmount: stress ? '9'.repeat(96) : '24300000000000000' } },
      evidence: mode === 'cow-reconciled' ? { bundle: { ...bundle, environment: 'MOCKED' } } : null } });
  }
  if (mode === 'legacy' || mode === 'record-unavailable') {
    progress = null; detail.record = null; detail.recordUnavailable = mode === 'record-unavailable';
    run.status = 'UNKNOWN'; run.createdAt = null; run.updatedAt = null;
    detail.attempts = [{ attemptId: 'fixture-approval', step: 'APPROVAL', state: 'CONFIRMED', transactionHash: detailApprovalHash, reconciled: false },
      { attemptId: 'fixture-action', step: 'SWAP', state: 'UNKNOWN', transactionHash: detailHash, reconciled: false }];
  }
  return { detail, view: projectDashboardRun(run, progress) };
}
