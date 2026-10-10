// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState } from 'react';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from '../domain/initial-workflow';
import { projectReview, type ReviewAuthorization, type ReviewWallet } from '../domain/review-presentation';
import type { SimulationSource } from '../domain/simulation-presentation';
import { shellChainLabel } from '../domain/product-shell';
import { walletEnvironmentLabel } from '../wallet/environment';
import { NetworkBrandIcon, TokenBrandIcon } from './brand-icon';

export type ReviewWorkspaceProps = {
  workflowName: string; workflow: Workflow; context: ReviewContext; source: SimulationSource;
  authorization: ReviewAuthorization; wallet: ReviewWallet; invalidWorkflow?: boolean; showTechnicalDetails?: boolean; actionSurface?: 'canvas';
  backToBuild(): void; simulateAgain?: (() => void | Promise<void>) | undefined;
};
/** Recheck time at the click boundary. The only callable authorization capability is Review. */
export function confirmReview(props: ReviewWorkspaceProps, now = Date.now()) {
  if (projectReview(props.workflow, props.context, props.source, props.authorization, props.wallet, now, props.invalidWorkflow).canApprove)
    return props.authorization.approve?.();
}
export function ReviewTechnicalDetails({ authorization }: { authorization: ReviewAuthorization }) {
  const { t: tr } = useLocale();
  return <section className="review-technical" aria-label={tr("Authorization technical details")}><h3>{tr("Strategy Manifest")}</h3><pre>{JSON.stringify({ manifest: authorization.manifest, policy: authorization.policy, review: authorization.technical }, null, 2)}</pre></section>;
}
/** Normal product audit details: the same validated Review projection, without raw artifacts or another action workspace. */
export function ReviewAuthorizationDetails(props: ReviewWorkspaceProps) {
  const { t } = useLocale();
  const review = projectReview(props.workflow, props.context, props.source, props.authorization, props.wallet, Date.now(), props.invalidWorkflow);
  return <details id="simulation-review" className="review-authorization-details" aria-label={t('Review & Authorization')}>
    <summary>{t('Review & Authorization')}</summary>
    <p role="status">{t(review.message)}</p>
    <dl className="simulation-summary-values">
      <div><dt>{t('Wallet')}</dt><dd>{props.wallet.account ?? t('Connect your wallet')}</dd></div>
      <div><dt>{t('Network')}</dt><dd>{t(props.wallet.chain ? shellChainLabel(props.wallet.chain) : 'Unknown network')}</dd></div>
      {review.limits.map((line, index) => <div key={index}><dt>{t(line.label)}</dt><dd>{t(line.value)}{line.note && <small>{t(line.note)}</small>}</dd></div>)}
      {review.expiresAt !== null && <div><dt>{t('Valid until')}</dt><dd><time dateTime={new Date(review.expiresAt).toISOString()}>{new Date(review.expiresAt).toLocaleString()}</time></dd></div>}
    </dl>
    {review.permissions.length > 0 && <div aria-label={t('Permissions')}><strong>{t('Permissions')}</strong><ul>{review.permissions.map(p => <li key={p}>{t(p)}</li>)}</ul></div>}
    {review.approvals.map((approval, i) => <p key={i}>{t(approval.symbol)} · {t(approval.value)} · {t('Spender')}: {approval.address}
      {approval.unlimited && <> · {t('This allowance has no spending cap. It remains available to the spender until changed or revoked.')}</>}</p>)}
    <p>{t('Changing the workflow, wallet, network or authorization limits requires a fresh Review. An expired simulation must be run again.')}</p>
    <p>{t('Confirms this Review. No transaction is submitted. Required wallet confirmations remain separate.')}</p>
    {review.manifest?.enforcement === 'NOT_ENFORCED' && <p>{t('FloFi checks these limits before requesting execution. The chain enforces the signed transaction fields; the Manifest itself is not enforced by an on-chain contract.')}</p>}
  </details>;
}
function ReviewTokenAmount({ value }: { value: string }) {
  const { t: tr } = useLocale();
  const symbol = value.match(/ (USDC|devUSDC|WETH|ETH|SOL|WSOL|USDT)$/)?.[1];
  return <span className="simulation-token-amount">{symbol && <TokenBrandIcon symbol={symbol}/>}<span>{tr(value)}</span></span>;
}
export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  const { t: tr } = useLocale();
  const { workflowName, workflow, context, source, authorization, wallet, invalidWorkflow = false, backToBuild, simulateAgain } = props;
  const [clock, setClock] = useState(() => Date.now());
  const review = projectReview(workflow, context, source, authorization, wallet, Math.max(clock, Date.now()), invalidWorkflow);
  const expiresAt = review.expiresAt;
  const preparing = Boolean(source.state.busy) && review.status === 'blocked';
  useEffect(() => {
    if (expiresAt === null || expiresAt <= Date.now()) return;
    const update = () => setClock(Date.now());
    const timer = window.setTimeout(update, Math.min(expiresAt - Date.now() + 1, 2_147_483_647));
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [expiresAt]);
  if (!authorization.key) return <section id="simulation-review" tabIndex={-1} className="review-workspace review-locked panel" aria-label={tr("Review & Authorization")}>
    <header className="review-heading"><div><p className="eyebrow">{tr("AUTHORIZATION")}</p><h2>{tr("Review & Authorization")}</h2><p>{tr("Run a valid simulation to review the permissions and limits for ")}{workflowName}.</p></div></header>
    <p className="review-caption" role="status">{tr(source.state.busy ? 'Simulation is running. Review will become available when it finishes.' : 'Review unavailable until simulation is ready.')}</p>
  </section>;
  return <section id="simulation-review" tabIndex={-1} className="review-workspace" aria-label={tr("Review & Authorization")}>
    <header className="review-heading"><div><p className="eyebrow">{tr("AUTHORIZATION")}</p><h2>{tr("Review & Authorization")}</h2><p>{tr("Check what you’re allowing FloFi to do with ")}{workflowName}.</p></div></header>
    <div className="review-workspace-grid">
      <div className="review-strategy panel">
        {review.limits.length > 0 && <section className="review-section" aria-label={tr("Execution limits")}><h2>{tr("Execution limits")}</h2>
          <dl className="simulation-summary-values review-limits">{review.limits.map((line, index) => <div key={index}><dt>{tr(line.label)}</dt><dd>{tr(line.value)}{line.note && <small>{tr(line.note)}</small>}</dd></div>)}</dl>
        </section>}
        {review.permissions.length > 0 && <section className="review-section" aria-label={tr("Permissions")}><h2>{tr("Permissions")}</h2><ul className="review-permissions">{review.permissions.map(permission => <li key={permission}><span aria-hidden="true">✓</span>{tr(permission)}</li>)}</ul></section>}
        {review.approvals.length > 0 && <section className="review-section" aria-label={tr("Token approvals")}><h2>{tr("Token approvals")}</h2><div className="review-approvals">{review.approvals.map((approval, index) => <article key={index}>
          <h3><TokenBrandIcon symbol={approval.symbol}/>{tr(approval.symbol)}</h3><p className={approval.unlimited ? 'review-unlimited' : 'review-approval-amount'}>{tr(approval.value)}</p>
          <dl className="simulation-summary-values"><div><dt>{tr("Spender")}</dt><dd title={approval.address}>{tr(approval.spender)}</dd></div><div><dt>{tr("Network")}</dt><dd>{tr(approval.network)}</dd></div></dl>
          {approval.unlimited && <p className="review-caption simulation-warning-attention"><span className="simulation-warning-label">{tr("Attention")}</span>{tr("This allowance has no spending cap. It remains available to the spender until changed or revoked.")}</p>}
        </article>)}</div><p className="review-caption">{tr("A token allowance can remain after a later action fails. Changing this Review does not revoke an on-chain allowance.")}</p></section>}
      </div>
      <aside className="review-confirmation panel" aria-label={tr("Final confirmation")}>
        <div className={`review-validity simulation-validity simulation-tone-${preparing ? 'neutral' : review.canApprove || review.status === 'approved' ? 'ready' : 'blocked'}`} role="status" aria-live="polite"><strong><span className="simulation-status-dot" aria-hidden="true"/>{tr(preparing ? 'Preparing authorization…' : review.label)}</strong><p>{tr(preparing ? 'Checking the workflow and authorization limits before continuing.' : review.message)}</p></div>
        <section className="review-section" aria-label={tr("Wallet authorization")}><h2>{tr("Wallet authorization")}</h2><dl className="simulation-summary-values">
          <div><dt>{tr("Wallet")}</dt><dd className="review-wallet-address" title={wallet.account ?? undefined}>{tr(wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : 'Connect your wallet')}</dd></div>
          <div><dt>{tr("Environment")}</dt><dd>{tr(wallet.environment === 'unknown' ? 'Unknown network' : walletEnvironmentLabel(wallet.environment))}</dd></div>
          <div><dt>{tr("Network")}</dt><dd>{wallet.chain ? <span className="simulation-summary-network"><NetworkBrandIcon network={shellChainLabel(wallet.chain).replace(/ \(\d+\)$/, '')}/>{tr(shellChainLabel(wallet.chain))}</span> : '—'}</dd></div>
        </dl></section>
        {review.warnings.length > 0 && <p className="review-caption" role="note">{tr("Check the ")}{tr(review.warnings.length)} {tr(review.warnings.length === 1 ? 'notice' : 'notices')}{tr(" in Simulation Summary above before approving.")}</p>}
        <section className="review-section" aria-label={tr("Authorization preview")}><h2>{tr("You are authorizing")}</h2><ul className="review-authorization-preview">{review.preview.map((line, index) => <li key={index}><ReviewTokenAmount value={line}/></li>)}</ul>
          {expiresAt !== null && <p className="review-caption">{tr("Valid until ")}<time dateTime={new Date(expiresAt).toISOString()}>{tr(new Date(expiresAt).toLocaleString())}</time></p>}
          <p className="review-caption"><button type="button" className="simulation-back" onClick={backToBuild}>{tr("Edit in Build")}</button>{tr(" to change any action or limit.")}</p>
          <p className="review-caption">{tr("Changing the workflow, wallet, network or authorization limits requires a fresh Review. An expired simulation must be run again.")}</p>
          {review.manifest?.enforcement === 'NOT_ENFORCED' && <p className="review-caption">{tr("FloFi checks these limits before requesting execution. The chain enforces the signed transaction fields; the Manifest itself is not enforced by an on-chain contract.")}</p>}
        </section>
        {review.status === 'expired' && <p className="review-caption" role="status">{tr("Review unavailable until simulation is refreshed.")}</p>}
        {props.actionSurface !== 'canvas' && <div className="review-final-actions">{!review.canApprove && review.status !== 'approved' && simulateAgain && <button type="button" className="simulation-back" disabled={Boolean(source.state.busy)} onClick={() => void simulateAgain()}>{tr("Simulate again")}</button>}<button type="button" className="primary" disabled={!review.canApprove} onClick={() => void confirmReview(props)}>{tr(review.status === 'approved' ? 'Review approved' : 'Approve & Continue')}</button></div>}
        <p className="review-caption review-confirmation-note">{tr("Confirms this Review. No transaction is submitted. Required wallet confirmations remain separate.")}</p>
      </aside>
    </div>
    <>{props.showTechnicalDetails !== false && <details className="shell-details technical-workspace review-technical"><summary>{tr("View technical details")}</summary><ReviewTechnicalDetails authorization={authorization}/></details>}</>
  </section>;
}
