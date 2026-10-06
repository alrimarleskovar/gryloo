// SPDX-License-Identifier: AGPL-3.0-only
/** Adapt an owned backend status record to the existing UX-005 read-only projectors. */
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from '../../domain/initial-workflow';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from '../../domain/execution-lifecycle';
import { projectExecutionEvidence } from '../../domain/execution-evidence';
import { projectExecutionStepEvidence } from '../../domain/execution-step-evidence';
import { object, sameOwner } from './run-mapping';
import type { DashboardRunDetail } from './types';

export function projectDashboardRecord(detail: DashboardRunDetail, context: ReviewContext) {
  const record = detail.record;
  if (!object(record)) return null;
  const kinds: Record<string, ExecutionLifecycleSource['kind']> = { 'aave-supply': 'supply', 'base-sepolia-swap': 'public',
    'crosschain-router': 'router', 'crosschain-router-testnet': 'router', 'robinhood-transfer': 'transfer',
    'solana-devnet-swap': 'solana-swap', 'jupiter-swap': 'solana-swap', 'orca-liquidity': 'solana-pool', 'uniswap-liquidity': 'uniswap-pool' };
  const kind = kinds[detail.run.flow];
  if (!kind) return null;
  const review = object(record.review) ? record.review : null;
  const saved = kind === 'router' || kind === 'uniswap-pool' || kind === 'public' ? record.workflow : review?.workflow;
  if (!object(saved) || !Array.isArray(saved.nodes) || !Array.isArray(saved.resourceEdges) || typeof saved.workflowId !== 'string') return null;
  // The status endpoint loads validated durable records. Defaults describe the read operation only;
  // no attempts, workflow values, outcomes, receipts or reconciliation are supplied by this adapter.
  const source = { kind, state: { ...(kind === 'public' ? { run: record } : { record }),
    busy: false, signing: false, recovered: false, recoveryOnly: false, error: null } } as unknown as ExecutionLifecycleSource;
  try {
    const progress = projectExecutionLifecycle(saved as unknown as Workflow, context, source);
    const evidence = projectExecutionEvidence(source, progress);
    if (progress.runKey !== detail.run.runId || !sameOwner(evidence.wallet, detail.run.ownerAccount)) return null;
    return { ...progress, evidence, stepEvidence: projectExecutionStepEvidence(source, progress) };
  } catch { return null; }
}
