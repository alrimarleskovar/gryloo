// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-MCP-002: wallet links and approval requests of the FloFi account in this browser. Linking needs this browser's account,
 * a wallet proven here and an explicit click; it only lets the account's MCP connections read that wallet's run status and
 * evidence (scope flofi.runs). It is never ownership and never authorizes a transaction.
 */
import { useEffect, useState } from 'react';
import { connectionsView, linkProvenWallet, revokeWalletLink, withdrawApproval, type ConnectionsView } from '../app/connections-action';
import { useWalletProof, WalletProof, type Namespace } from './wallet-proof';

export function ConnectionsPanel() {
  const [view, setView] = useState<ConnectionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState<Namespace>('eip155');
  const proof = useWalletProof(namespace);
  const apply = (result: { ok: true; value: ConnectionsView } | { ok: false; code: string }) => { if (result.ok) { setView(result.value); setError(null); } else setError(result.code); };
  useEffect(() => { void connectionsView().then(apply); }, [proof.proven]);
  if (!view) return <section className="panel approval-handoff" aria-label="Connections"><p className="muted">{error ? `Connections are unavailable (${error}).` : 'Loading…'}</p></section>;
  if (!view.account) return <section className="panel approval-handoff" aria-label="Connections"><p className="eyebrow">CONNECTIONS</p><h2>No FloFi account in this browser</h2>
    <p className="muted">Connect FloFi from Claude or ChatGPT first: the consent screen creates a pseudonymous FloFi account in this browser.</p></section>;
  const proven = view.proven.find(w => w.namespace === namespace);
  return <section className="panel approval-handoff" aria-label="Connections">
    <p className="eyebrow">CONNECTIONS</p><h2>Your FloFi account</h2>
    <p>Account <code>{view.account}</code> (pseudonymous; no email, no wallet by default).</p>
    <h3>Linked wallets</h3>
    <p className="muted">A linked wallet lets your connected assistants read the status and evidence of that wallet&apos;s FloFi runs. It never lets anyone sign or move funds.
      Links expire after {view.linkDays} days.</p>
    {view.links.length === 0 ? <p className="muted">No linked wallet.</p> : <ul className="approval-explanation">{view.links.map(link => <li key={link.linkId}>
      {link.namespace === 'solana' ? 'Solana' : 'Ethereum'} <code>{link.address}</code> · until {new Date(link.expiresAt).toLocaleDateString()}{' '}
      <button type="button" className="quiet" onClick={() => void revokeWalletLink(link.linkId).then(apply)}>Remove link</button></li>)}</ul>}
    <div className="approval-actions" role="group" aria-label="Wallet type">
      <button type="button" className={namespace === 'eip155' ? 'primary' : 'quiet'} onClick={() => setNamespace('eip155')}>Ethereum wallet</button>
      <button type="button" className={namespace === 'solana' ? 'primary' : 'quiet'} onClick={() => setNamespace('solana')}>Solana wallet</button></div>
    <WalletProof namespace={namespace} proof={proof}/>
    {proven && <div className="approval-actions"><button type="button" className="primary" onClick={() => void linkProvenWallet(namespace).then(apply)}>
      Link {proven.address.slice(0, 10)}… to my FloFi account</button></div>}
    <h3>Approval requests</h3>
    {view.approvals.length === 0 ? <p className="muted">None yet.</p> : <ul className="approval-explanation">{view.approvals.map(a => <li key={a.approvalId}>
      {a.client} · {a.status} · {a.fundsClass === 'REAL_FUNDS' ? 'real funds' : 'test funds'} · {new Date(a.createdAt).toLocaleString()}{' '}
      {(a.status === 'PENDING' || a.status === 'CLAIMED') && <button type="button" className="quiet" onClick={() => void withdrawApproval(a.approvalId).then(apply)}>Withdraw</button>}</li>)}</ul>}
    {(error ?? proof.error) && <p className="error-banner" role="alert">{error ?? proof.error}</p>}
  </section>;
}
