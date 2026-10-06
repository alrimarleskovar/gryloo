// SPDX-License-Identifier: AGPL-3.0-only
'use client';
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
  authorization: ReviewAuthorization; wallet: ReviewWallet; invalidWorkflow?: boolean; showTechnicalDetails?: boolean;
  backToBuild(): void; simulateAgain?: (() => void | Promise<void>) | undefined;
};
/** Recheck time at the click boundary. The only callable authorization capability is Review. */
export function confirmReview(props: ReviewWorkspaceProps, now = Date.now()) {
  if (projectReview(props.workflow, props.context, props.source, props.authorization, props.wallet, now, props.invalidWorkflow).canApprove)
    return props.authorization.approve?.();
}
export function ReviewTechnicalDetails({ authorization }: { authorization: ReviewAuthorization }) {
  return <section className="review-technical" aria-label="Authorization technical details"><h3>Strategy Manifest</h3><pre>{JSON.stringify({ manifest: authorization.manifest, policy: authorization.policy, review: authorization.technical }, null, 2)}</pre></section>;
}
function ReviewTokenAmount({ value }: { value: string }) {
  const symbol = value.match(/ (USDC|devUSDC|WETH|ETH|SOL|WSOL|USDT)$/)?.[1];
  return <span className="simulation-token-amount">{symbol && <TokenBrandIcon symbol={symbol}/>}<span>{value}</span></span>;
}
export function ReviewWorkspace(props: ReviewWorkspaceProps) {
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
  if (!authorization.key) return <section id="simulation-review" tabIndex={-1} className="review-workspace review-locked panel" aria-label="Review & Authorization">
    <header className="review-heading"><div><p className="eyebrow">AUTHORIZATION</p><h2>Review &amp; Authorization</h2><p>Run a valid simulation to review the permissions and limits for {workflowName}.</p></div></header>
    <p className="review-caption" role="status">{source.state.busy ? 'Simulation is running. Review will become available when it finishes.' : 'Review unavailable until simulation is ready.'}</p>
  </section>;
  return <section id="simulation-review" tabIndex={-1} className="review-workspace" aria-label="Review & Authorization">
    <header className="review-heading"><div><p className="eyebrow">AUTHORIZATION</p><h2>Review &amp; Authorization</h2><p>Check what you’re allowing FloFi to do with {workflowName}.</p></div></header>
    <div className="review-workspace-grid">
      <div className="review-strategy panel">
        {review.limits.length > 0 && <section className="review-section" aria-label="Execution limits"><h2>Execution limits</h2>
          <dl className="simulation-summary-values review-limits">{review.limits.map((line, index) => <div key={index}><dt>{line.label}</dt><dd>{line.value}{line.note && <small>{line.note}</small>}</dd></div>)}</dl>
        </section>}
        {review.permissions.length > 0 && <section className="review-section" aria-label="Permissions"><h2>Permissions</h2><ul className="review-permissions">{review.permissions.map(permission => <li key={permission}><span aria-hidden="true">✓</span>{permission}</li>)}</ul></section>}
        {review.approvals.length > 0 && <section className="review-section" aria-label="Token approvals"><h2>Token approvals</h2><div className="review-approvals">{review.approvals.map((approval, index) => <article key={index}>
          <h3><TokenBrandIcon symbol={approval.symbol}/>{approval.symbol}</h3><p className={approval.unlimited ? 'review-unlimited' : 'review-approval-amount'}>{approval.value}</p>
          <dl className="simulation-summary-values"><div><dt>Spender</dt><dd title={approval.address}>{approval.spender}</dd></div><div><dt>Network</dt><dd>{approval.network}</dd></div></dl>
          {approval.unlimited && <p className="review-caption simulation-warning-attention"><span className="simulation-warning-label">Attention</span>This allowance has no spending cap. It remains available to the spender until changed or revoked.</p>}
        </article>)}</div><p className="review-caption">A token allowance can remain after a later action fails. Changing this Review does not revoke an on-chain allowance.</p></section>}
      </div>
      <aside className="review-confirmation panel" aria-label="Final confirmation">
        <div className={`review-validity simulation-validity simulation-tone-${preparing ? 'neutral' : review.canApprove || review.status === 'approved' ? 'ready' : 'blocked'}`} role="status" aria-live="polite"><strong><span className="simulation-status-dot" aria-hidden="true"/>{preparing ? 'Preparing authorization…' : review.label}</strong><p>{preparing ? 'Checking the workflow and authorization limits before continuing.' : review.message}</p></div>
        <section className="review-section" aria-label="Wallet authorization"><h2>Wallet authorization</h2><dl className="simulation-summary-values">
          <div><dt>Wallet</dt><dd className="review-wallet-address" title={wallet.account ?? undefined}>{wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : 'Connect your wallet'}</dd></div>
          <div><dt>Environment</dt><dd>{wallet.environment === 'unknown' ? 'Unknown network' : walletEnvironmentLabel(wallet.environment)}</dd></div>
          <div><dt>Network</dt><dd>{wallet.chain ? <span className="simulation-summary-network"><NetworkBrandIcon network={shellChainLabel(wallet.chain).replace(/ \(\d+\)$/, '')}/>{shellChainLabel(wallet.chain)}</span> : '—'}</dd></div>
        </dl></section>
        {review.warnings.length > 0 && <p className="review-caption" role="note">Check the {review.warnings.length} {review.warnings.length === 1 ? 'notice' : 'notices'} in Simulation Summary above before approving.</p>}
        <section className="review-section" aria-label="Authorization preview"><h2>You are authorizing</h2><ul className="review-authorization-preview">{review.preview.map((line, index) => <li key={index}><ReviewTokenAmount value={line}/></li>)}</ul>
          {expiresAt !== null && <p className="review-caption">Valid until <time dateTime={new Date(expiresAt).toISOString()}>{new Date(expiresAt).toLocaleString()}</time></p>}
          <p className="review-caption"><button type="button" className="simulation-back" onClick={backToBuild}>Edit in Build</button> to change any action or limit.</p>
          <p className="review-caption">Changing the workflow, wallet, network or authorization limits requires a fresh Review. An expired simulation must be run again.</p>
          {review.manifest?.enforcement === 'NOT_ENFORCED' && <p className="review-caption">FloFi checks these limits before requesting execution. The chain enforces the signed transaction fields; the Manifest itself is not enforced by an on-chain contract.</p>}
        </section>
        {review.status === 'expired' && <p className="review-caption" role="status">Review unavailable until simulation is refreshed.</p>}
        <div className="review-final-actions">{!review.canApprove && review.status !== 'approved' && simulateAgain && <button type="button" className="simulation-back" disabled={Boolean(source.state.busy)} onClick={() => void simulateAgain()}>Simulate again</button>}<button type="button" className="primary" disabled={!review.canApprove} onClick={() => void confirmReview(props)}>{review.status === 'approved' ? 'Review approved' : 'Approve & Continue'}</button></div>
        <p className="review-caption review-confirmation-note">Confirms this Review. No transaction is submitted. Required wallet confirmations remain separate.</p>
      </aside>
    </div>
    <>{props.showTechnicalDetails !== false && <details className="shell-details technical-workspace review-technical"><summary>View technical details</summary><ReviewTechnicalDetails authorization={authorization}/></details>}</>
  </section>;
}
