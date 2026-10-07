// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from the FloFi Dashboard delivery. Read models only; never execution state.
import type { ExecutionLifecycle } from '../../domain/execution-lifecycle';

export type DashboardRun = {
  runId: string; workflowId: string; flow: string; status: string; provenance: string;
  ownerAccount: string; errorCode: string | null; needsObservation: boolean;
  attentionRequired: boolean; hasEvidence: boolean; createdAt: string | null; updatedAt: string | null;
};
export type DashboardConnection = 'SIGN_IN_REQUIRED' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'CONNECTED';
export type DashboardSnapshot = { connection: DashboardConnection; account: string | null; runs: DashboardRun[]; hasMore: boolean };
export type DashboardAttempt = { attemptId: string; step: string; state: string; transactionHash: string | null; reconciled: boolean };
export type DashboardEvidence = { bundleHash: string; environment: string; outcome: string; verified: boolean; createdAt: string | null };
export type DashboardRunDetail = {
  run: DashboardRun; attempts: DashboardAttempt[]; evidence: DashboardEvidence[];
  record: unknown; evidenceUnavailable: boolean; recordUnavailable: boolean;
};
export type DashboardDetailResponse = { connection: DashboardConnection | 'NOT_FOUND'; account: string | null; detail: DashboardRunDetail | null };
export type DashboardStatus = 'Completed' | 'Completed with attention' | 'In progress' | 'Needs attention' | 'Partially completed' | 'Failed' | 'Unresolved' | 'Transaction not submitted' | 'Not started';
export type DashboardRunView = {
  run: DashboardRun; title: string; status: DashboardStatus; message: string;
  attention: string[]; networks: string[]; completed: number | null; total: number | null;
  recovered: boolean; reconciled: boolean; current: boolean; progress: ExecutionLifecycle | null;
};
