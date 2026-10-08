// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';
import type { WorkflowList } from '../domain/saved-workflow';
import { WalletProof, type Namespace, type useWalletProof } from './wallet-proof';
export function WorkflowVerification({ namespace, proof, account }: { namespace: Namespace; proof: ReturnType<typeof useWalletProof>; account: string | null }) {
  const { t } = useLocale();
  return <div className="panel" role="status"><p>{t('Verify wallet ownership to save and reopen workflows.')}</p>
    {proof.proven === account ? <button type="button" disabled={proof.busy} onClick={() => void proof.refresh()}>{t('Refresh')}</button>
      : <WalletProof namespace={namespace} proof={{ ...proof, proven: null }}/>}
    {proof.error && <p role="alert">{t('Wallet verification was not completed. Try again.')}</p>}
  </div>;
}
export type WorkflowNavigation = { list: WorkflowList | null; busy: boolean; error: string | null;
  loading?: boolean; connected?: boolean; verification?: import('react').ReactNode;
  open(id: string): void; refresh(): void };
/** Reusable canonical workflow identities in the existing secondary product workspace. */
export function YourWorkflows({ list = null, busy = false, loading = false, error = null, connected = true, verification, open, refresh }: Partial<WorkflowNavigation>) {
  const { t } = useLocale();
  return <section className="saved-workflows" aria-label={t('Your workflows')}>
    <header className="secondary-workspace-heading"><h1>{t('Your workflows')}</h1><p>{t('Open a saved or previously executed workflow to continue building.')}</p></header>
    {!connected ? <div className="workspace-empty"><p>{t('Connect a wallet from the header to see your workflows.')}</p></div>
      : error === 'WALLET_SESSION_REQUIRED' ? verification ?? <div className="workspace-empty"><p>{t('Verify wallet ownership to save and reopen workflows.')}</p><button type="button" onClick={refresh}>{t('Retry')}</button></div>
        : error ? <div className="workspace-empty" role="alert"><p>{t('Your workflows are temporarily unavailable.')}</p><button type="button" disabled={busy || loading} onClick={refresh}>{t('Retry')}</button></div>
          : loading ? <p role="status">{t('Loading your workflows…')}</p>
            : !list?.items.length ? <div className="workspace-empty"><h2>{t('No workflows yet.')}</h2><p>{t('Build or execute a workflow and it will appear here.')}</p></div>
              : <ul className="saved-workflow-list">{list.items.map(item => <li key={item.workflowId}><button type="button" className="workspace-action saved-workflow-open" disabled={busy} onClick={() => open?.(item.workflowId)}><span>{item.name ?? t('Workflow')}</span><span aria-hidden="true">→</span></button></li>)}</ul>}
    {list?.hasMore && <p className="muted">{t('Showing up to 100 workflows.')}</p>}
  </section>;
}
