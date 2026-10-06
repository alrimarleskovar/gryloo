// SPDX-License-Identifier: AGPL-3.0-only
// Normalized read-only records for browser presentation checks; no RPC or signatures.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardView } from '../components/dashboard/dashboard-view';
import { RunDetailView } from '../components/dashboard/run-detail-view';
import { currentDashboardRun, projectDashboardRun } from '../lib/dashboard/run-mapping';
import { projectDashboardRecord } from '../lib/dashboard/record-projection';
import type { DashboardConnection, DashboardRun, DashboardRunDetail } from '../lib/dashboard/types';
import { reviewFixture, reviewOwner } from './review-fixture';

type Mode = 'history' | 'current-only' | 'empty' | 'disconnected' | 'loading' | 'verify' | 'verifying' | 'verification-issue' | 'unavailable' | 'not-configured';
const row = (runId: string, status: string): DashboardRun => ({ runId, workflowId: 'browser-fixture', flow: 'base-sepolia-swap', status,
  ownerAccount: reviewOwner, provenance: 'PUBLIC_TESTNET', hasEvidence: status === 'RECONCILED', errorCode: null,
  needsObservation: false, attentionRequired: false, createdAt: null, updatedAt: null });
const fixture = reviewFixture(), base = 'run' in fixture.source.state ? fixture.source.state.run : null;
const detail: DashboardRunDetail = { run: row('fixture-current-run', 'UNKNOWN'), attempts: [], evidence: [], evidenceUnavailable: false, recordUnavailable: false,
  record: { ...base, quote: { ...base?.quote, executionId: 'fixture-current-run' }, attempts: [{ step: 'swap', account: reviewOwner, state: 'UNKNOWN', txHash: '0x' + 'a'.repeat(64) }], outcome: null } };
const progress = projectDashboardRecord(detail, fixture.context)!;
const current = currentDashboardRun('Current swap workflow', progress, { contextIssue: 'Check the original execution context before continuing.', action: null })!;
const saved = [projectDashboardRun(row('fixture-completed', 'RECONCILED')), projectDashboardRun(row('fixture-partial', 'PARTIALLY_COMPLETED')), projectDashboardRun(row('fixture-pending', 'PENDING'))];

declare global {
  interface Window {
    flofiDashboardAcceptance: { mode(value: Mode): void; longTitle(): void; counts(): { built: number; refreshed: number; verified: number; executed: number } };
  }
}
function Harness() {
  const [mode, setMode] = useState<Mode>('history');
  const [long, setLong] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ built: 0, refreshed: 0, verified: 0, executed: 0 });
  const count = (key: keyof typeof counts) => () => setCounts(value => ({ ...value, [key]: value[key] + 1 }));
  window.flofiDashboardAcceptance = { mode(value) { setMode(value); setRunId(null); }, longTitle: () => setLong(true), counts: () => counts };
  const connection: DashboardConnection | null = ['verify', 'verifying', 'verification-issue'].includes(mode) ? 'SIGN_IN_REQUIRED' : mode === 'unavailable' ? 'UNAVAILABLE' : mode === 'not-configured' ? 'NOT_CONFIGURED' : mode === 'loading' ? null : 'CONNECTED';
  const currentView = long ? { ...current, title: 'OwnerDefinedWorkflowTitle'.repeat(12) } : current;
  const runs = ['empty', 'disconnected'].includes(mode) ? [] : mode === 'history' ? [currentView, ...saved] : [currentView];
  const view = runs.find(run => run.run.runId === runId) ?? null;
  return runId ? <RunDetailView view={view} detail={view?.current ? detail : null} connection={connection} loading={false} back={() => setRunId(null)} build={count('built')} execute={count('executed')}/>
    : <DashboardView account={mode === 'disconnected' ? null : reviewOwner} connection={connection} runs={runs} hasMore={false} loading={mode === 'loading'} build={count('built')} openRun={setRunId}
      verify={count('verified')} verifying={mode === 'verifying'} verificationIssue={mode === 'verification-issue' ? 'Wallet verification was not completed. Your execution records have not changed.' : null} refresh={count('refreshed')}/>;
}
export function mount(element: HTMLElement) { createRoot(element).render(<Harness/>); }
