// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState } from 'react';
import type { ExecutionLifecycle } from '../../domain/execution-lifecycle';
import type { ExecutionRecovery } from '../../domain/execution-recovery';
import type { ReviewWallet } from '../../domain/review-presentation';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { dashboardRunDetail, dashboardSnapshot } from '../../app/dashboard-action';
import { walletSignInChallenge, walletSignIn } from '../../app/wallet-session-action';
import { injected, useBuild009Wallet } from '../../state/build009-wallet-store';
import { currentDashboardRun, dashboardRunIndex, projectDashboardRun, sameOwner } from '../../lib/dashboard/run-mapping';
import { projectDashboardRecord } from '../../lib/dashboard/record-projection';
import type { DashboardDetailResponse, DashboardSnapshot } from '../../lib/dashboard/types';
import { DashboardView } from './dashboard-view';
import { RunDetailView } from './run-detail-view';

export function DashboardWorkspace({ workflowName, progress, recovery, wallet, context, runId, build, execute, navigate }: {
  workflowName: string; progress: ExecutionLifecycle; recovery: ExecutionRecovery; wallet: ReviewWallet; context: ReviewContext;
  runId: string | null; build(): void; execute(): void; navigate(path: string): void;
}) {
  const sharedWallet = useBuild009Wallet();
  const account = wallet.account;
  const evm = Boolean(account && /^0x[0-9a-f]{40}$/i.test(account));
  const current = currentDashboardRun(workflowName, progress, recovery);
  const ownedCurrent = current && sameOwner(current.run.ownerAccount, account) ? current : null;
  const isCurrent = Boolean(runId && ownedCurrent?.run.runId === runId);
  const [version, refresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; snapshot?: DashboardSnapshot; response?: DashboardDetailResponse } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationIssue, setVerificationIssue] = useState<{ account: string; message: string } | null>(null);
  const key = JSON.stringify([account, runId, version]);
  useEffect(() => {
    if (!account || isCurrent) return;
    let cancelled = false;
    const request = runId ? dashboardRunDetail(account, runId).then(response => ({ key, response })) : dashboardSnapshot(account).then(snapshot => ({ key, snapshot }));
    request.then(value => { if (!cancelled) setLoaded(value); }).catch(() => {
      if (!cancelled) setLoaded(runId ? { key, response: { connection: 'UNAVAILABLE', account, detail: null } }
        : { key, snapshot: { connection: 'UNAVAILABLE', account, runs: [], hasMore: false } });
    });
    return () => { cancelled = true; };
  }, [account, evm, isCurrent, key, runId]);
  const visible = loaded?.key === key ? loaded : null;
  const loading = Boolean(account && !isCurrent && !visible);
  const snapshot = visible?.snapshot;
  const detail = visible?.response?.detail;
  // A stale session/result can never flash another account's records while the new read is pending.
  const ownedDetail = detail && sameOwner(detail.run.ownerAccount, account) && detail.run.runId === runId ? detail : null;
  const historical = ownedDetail ? projectDashboardRun(ownedDetail.run, projectDashboardRecord(ownedDetail, context)) : null;

  async function verify() {
    if (verifying || !account || !evm) return;
    setVerifying(true); setVerificationIssue(null);
    try {
      const session = await sharedWallet.session(), provider = injected();
      if (!session || !provider || !sameOwner(session.account, account)) throw new Error('WALLET_CHANGED');
      const chainId = Number.parseInt(session.chainId, 16);
      const challenge = await walletSignInChallenge(session.account, chainId);
      if (!challenge.ok) throw new Error(challenge.code);
      const message = '0x' + [...new TextEncoder().encode(challenge.value.message)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const signature = await provider.request({ method: 'personal_sign', params: [message, session.account] });
      const after = await sharedWallet.session();
      if (!after || !sameOwner(after.account, account) || injected() !== provider || typeof signature !== 'string') throw new Error('WALLET_CHANGED');
      const signed = await walletSignIn(session.account, chainId, signature);
      if (!signed.ok) throw new Error(signed.code);
      refresh(value => value + 1);
    } catch (cause) {
      setVerificationIssue({ account, message: cause instanceof Error && cause.message === 'WALLET_CHANGED' ? 'The wallet changed. Verify the wallet currently connected in the header.'
        : 'Wallet verification was not completed. Your execution records have not changed.' });
    } finally { setVerifying(false); }
  }
  if (runId) return <RunDetailView view={isCurrent ? ownedCurrent : historical} detail={ownedDetail} loading={loading}
    connection={!account ? 'DISCONNECTED' : visible?.response?.connection ?? null}
    back={() => navigate('/app/dashboard')} build={build} execute={execute} refresh={() => refresh(value => value + 1)}/>;
  const runs = dashboardRunIndex(account, snapshot?.runs ?? [], ownedCurrent);
  return <DashboardView account={account} connection={snapshot?.connection ?? null} runs={runs} hasMore={snapshot?.hasMore ?? false}
    loading={loading} build={build} openRun={id => navigate(`/app/dashboard/runs/${encodeURIComponent(id)}`)} verify={() => void verify()} verifying={verifying}
    verificationIssue={verificationIssue?.account === account ? verificationIssue.message : null} refresh={() => refresh(value => value + 1)}/>;
}
