// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-MCP-002: the FloFi side of an external proposal (`/approve#<secret>`). It shows that the proposal is EXTERNAL, where it came
 * from, its network, funds class, steps, summary and workflow hash, and that nothing is authorized yet. The owner proves a wallet
 * (EIP-4361 or Sign-In With Solana); the server re-verifies and returns the same authoring command FloFi's own chat produces,
 * which enters the existing proposal card. From there the unchanged flow panels run the fresh simulation, the Strategy Manifest
 * Review, the explicit approval and the wallet signature. This component never builds, signs or sends a transaction.
 */
import { useEffect, useRef, useState } from 'react';
import { approvalHandoffView, claimApprovalHandoff, markApprovalApplied, setApprovalSharing } from '../app/approve-action';
import { DEVELOPER_LINK_PREFIX } from '../developer/link-format';
import type { ApprovalView } from '../mcp/handoff/service';
import { APPROVAL_SECRET_FORMAT } from '../platform/approval-link-format';
import { useWorkflow } from '../state/workflow-store';
import type { SolanaWalletChain } from '../wallet/solana-wallet';
import { useWalletProof, WalletProof } from './wallet-proof';
import { McpRouteState } from './mcp-route-state';

// BUILD-DEVELOPER-001: any FloFi approval link (MCP's `flofi_hs_…` and later surfaces' own tags); the server resolves which one.
const SECRET = APPROVAL_SECRET_FORMAT;
const STORAGE_KEY = 'flofi.approval.secret';
const TERMINAL = ['EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE'];
const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Waiting for you', CLAIMED: 'Loaded for your wallet', APPLIED: 'In your FloFi workflow', EXPIRED: 'Expired', SUPERSEDED: 'Replaced by a newer request',
  REVOKED: 'Withdrawn', STALE: 'No longer reproducible',
};
function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T { if (!result.ok) throw new Error(result.code); return result.value; }
/** The handoff secret travels only in the URL fragment; it is moved to this tab's session storage and removed from the address bar. */
function takeSecret(): string | null {
  let fromHash: string;
  try { fromHash = typeof window === 'undefined' ? '' : decodeURIComponent(window.location.hash.slice(1)); } catch { return null; }
  if (SECRET.test(fromHash)) {
    try { sessionStorage.setItem(STORAGE_KEY, fromHash); } catch { /* storage may be unavailable; the page still works until reload */ }
    window.history.replaceState(null, '', window.location.pathname);
    return fromHash;
  }
  if (fromHash) return null;
  try { const stored = sessionStorage.getItem(STORAGE_KEY); return stored && SECRET.test(stored) ? stored : null; } catch { return null; }
}

export function ApprovalHandoff({ onAvailabilityChange }: { onAvailabilityChange?: (available: boolean) => void }) {
  const { state, pending, propose, applyProposal } = useWorkflow();
  const [secret, setSecret] = useState<string | null>(null);
  const [view, setView] = useState<ApprovalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<boolean | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const applying = useRef(false);
  const chain: SolanaWalletChain = view?.steps.some(s => s.network === 'solana') ? 'solana:mainnet' : 'solana:devnet';
  const proof = useWalletProof(view?.walletNamespace ?? null, chain), proven = proof.proven;
  const available = resolved && view !== null && !TERMINAL.includes(view.status) && !view.refusal;

  useEffect(() => {
    let request = 0;
    const load = () => {
      const current = ++request, found = takeSecret();
      onAvailabilityChange?.(false);
      setSecret(found); setView(null); setResolved(false); setError(null); setClaimed(false); setShare(null);
      if (!found) { setResolved(true); return; }
      void approvalHandoffView(found).then(result => {
        if (current !== request) return;
        if (result.ok) { setView(result.value); setShare(result.value.sameAccount); } else setError(result.code);
      }).catch(() => { if (current === request) setError('APPROVAL_UNAVAILABLE'); })
        .finally(() => { if (current === request) setResolved(true); });
    };
    // The product's skip link is a local anchor, not a new approval handoff.
    const hashChanged = () => { if (window.location.hash !== '#workspace') load(); };
    load();
    window.addEventListener('hashchange', hashChanged);
    return () => { request++; window.removeEventListener('hashchange', hashChanged); };
  }, [onAvailabilityChange]);
  useEffect(() => {
    onAvailabilityChange?.(available);
    return () => onAvailabilityChange?.(false);
  }, [available, onAvailabilityChange]);
  // Once the proposal is applied, the server checks that the FloFi workflow hashes to exactly the proposal.
  useEffect(() => {
    if (!secret || !claimed || applying.current || view?.status === 'APPLIED' || state.workflow.revision === 0) return;
    applying.current = true;
    void markApprovalApplied(secret, state.workflow).then(result => { if (result.ok) setView(result.value); else setError(result.code); }).finally(() => { applying.current = false; });
  }, [state.workflow, claimed, secret, view?.status]);

  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'WALLET_REQUEST_FAILED'); }
    finally { setBusy(false); }
  }
  const claim = () => run(async () => {
    const result = unwrap(await claimApprovalHandoff(secret!, share === true));
    setView(result.view); setClaimed(true);
    // The same proposal card FloFi's own chat uses; nothing is applied until the owner clicks.
    propose(result.command);
  });
  const toggleShare = (next: boolean) => {
    setShare(next);
    if (claimed && secret) void setApprovalSharing(secret, next).then(r => { if (r.ok) setView(v => v && { ...v, statusShared: r.value.statusShared }); else setError(r.code); });
  };

  // BUILD-DEVELOPER-001: who sent the link, where the page knows it (the resolved proposal, else the link's own tag). Only the wording
  // follows it; the route states, their headings and every check are the same for every requester.
  const fromApp = view ? view.requesterKind === 'DEVELOPER_PROJECT' : secret?.startsWith(DEVELOPER_LINK_PREFIX) === true;
  if (!resolved) return <McpRouteState label="Approval" title="Opening your approval" loading
    description={fromApp ? 'Getting the proposal from the app that sent you this link…' : 'Getting the proposal from your connected assistant…'}/>;
  if (!secret || !view) return <McpRouteState label="Approval" title="Open this link from your assistant"
    description={fromApp ? 'Open the FloFi approval link again from the app that sent it. If the link has expired, ask that app for a new one.'
      : 'Open the FloFi approval link from your connected assistant in Claude or ChatGPT. If the link has expired, ask your assistant for a new one.'}/>;
  if (!available) return <McpRouteState label="Approval" title="This approval is no longer available"
    description={fromApp ? 'Ask the app that sent this link to prepare a new FloFi approval link.' : 'Ask your connected assistant to prepare a new FloFi approval link.'}/>;
  const terminal = TERMINAL.includes(view.status), real = view.fundsClass === 'REAL_FUNDS', canClaim = !terminal && !view.refusal && !view.claimedByAnotherWallet;
  return <div className="approval-page"><section className="panel approval-handoff" aria-label="External proposal">
    <div className="approval-head"><div><p className="eyebrow">EXTERNAL PROPOSAL · FROM {view.clientName.toUpperCase()}</p>
      <h2>A strategy proposed via {view.clientName}</h2></div>
      <span className="status-badge info" aria-label="Approval status">{STATUS_TEXT[view.status] ?? view.status}</span></div>
    <p className="approval-nothing"><strong>Nothing is authorized yet.</strong> This page only shows the proposal. Your wallet signs nothing until you run a fresh simulation,
      review the Strategy Manifest and approve each transaction yourself.</p>
    {real && <p className="approval-real" role="alert"><strong>Real funds.</strong> This strategy uses a mainnet. Every transaction spends real assets once you sign it.</p>}
    <dl className="approval-facts">
      <div><dt>Network</dt><dd>{view.networkEnvironment === 'MAINNET' ? 'Mainnet' : 'Public testnet'} · {[...new Set(view.steps.flatMap(s => [s.network, s.destinationNetwork].filter(Boolean)))].join(' → ')}</dd></div>
      <div><dt>Funds</dt><dd>{real ? 'Real funds' : 'Test funds'}</dd></div>
      <div><dt>Steps</dt><dd><ol>{view.steps.map(s => <li key={s.index}>{s.action} · {s.protocol || s.kind} · {s.network}</li>)}</ol></dd></div>
      <div><dt>Workflow hash</dt><dd><code>{view.workflowHash}</code></dd></div>
    </dl>
    {view.summary && <p className="approval-summary">{view.summary}</p>}
    {view.explanation.length > 0 && <ul className="approval-explanation">{view.explanation.map((line, i) => <li key={i}>{line}</li>)}</ul>}
    <p className="muted approval-ai">{view.requesterKind === 'DEVELOPER_PROJECT'
      ? `Created by ${view.clientName}, a third-party app registered with FloFi, not by FloFi. It is not financial advice; you decide, and only your wallet can sign.`
      : 'Proposed with an AI assistant from your conversation. It is not financial advice; you decide, and only your wallet can sign.'}</p>
    {terminal && <p className="approval-ended" role="status">This request is {STATUS_TEXT[view.status]?.toLowerCase()}. Ask for a new proposal.</p>}
    {view.refusal && !terminal && <p className="approval-ended" role="status">FloFi cannot hand this proposal to a wallet on this deployment now ({view.refusal}).</p>}
    {view.claimedByAnotherWallet && <p className="approval-ended" role="status">Another wallet already opened this proposal. Ask for a new proposal.</p>}
    {canClaim && !claimed && <div className="approval-steps">
      <h3>1. Prove which wallet you are</h3>
      <WalletProof namespace={view.walletNamespace} proof={proof}/>
      <p className="muted">This signs a sign-in message only. It authorizes no transaction and moves no funds.</p>
      <h3>2. Load the proposal into FloFi</h3>
      <label className="approval-share"><input type="checkbox" checked={share === true} onChange={e => toggleShare(e.target.checked)}/>
        Share the status and evidence of runs started from this proposal with {view.clientName}</label>
      <div className="approval-actions"><button type="button" className="primary" disabled={busy || !proven} onClick={() => void claim()}>Load proposal</button></div>
    </div>}
    {claimed && <div className="approval-steps">
      {view.status !== 'APPLIED' && pending && <><h3>3. Add it to your workflow</h3><ul className="approval-explanation">{pending.diff.map((line, i) => <li key={i}>{line}</li>)}</ul>
        <div className="approval-actions"><button type="button" className="primary" onClick={applyProposal}>Add to my workflow</button></div></>}
      {view.status === 'APPLIED' && <p role="status"><strong>Ready for your review.</strong> Open <em>Simulate</em> for a fresh simulation, review the Strategy Manifest, then
        <em> Execute</em>: your wallet asks you to sign each transaction.</p>}
      <label className="approval-share"><input type="checkbox" checked={view.statusShared} onChange={e => toggleShare(e.target.checked)}/>
        Share run status and evidence with {view.clientName}</label>
    </div>}
    {/* The shared approval surface reports APPROVALS_NOT_ENABLED (BUILD-DEVELOPER-001); MCP_OAUTH_NOT_ENABLED is its MCP-era name. */}
    {(error ?? proof.error) && <p className="error-banner" role="alert">{error === 'APPROVALS_NOT_ENABLED' || error === 'MCP_OAUTH_NOT_ENABLED'
      ? `Approvals are unavailable right now. Return to ${fromApp ? 'the app that sent this link' : 'your assistant'} and try again later.` : error ?? proof.error}</p>}
  </section></div>;
}
