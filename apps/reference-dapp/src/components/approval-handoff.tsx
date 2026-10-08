// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

/**
 * BUILD-MCP-002: the FloFi side of an external proposal (`/approve#<secret>`). It shows that the proposal is EXTERNAL, where it came
 * from, its network, funds class, steps, summary and workflow hash, and that nothing is authorized yet. The owner proves a wallet
 * (EIP-4361 or Sign-In With Solana); the server re-verifies and returns the same authoring command FloFi's own chat produces,
 * which the owner's explicit Load proposal action loads into the existing workflow store. From there the flow panels run the fresh simulation, the Strategy Manifest
 * Review, the explicit approval and the wallet signature. This component never builds, signs or sends a transaction.
 */
import { useEffect, useRef, useState } from 'react';
import { approvalHandoffView, claimApprovalHandoff, markApprovalApplied, openBrowserApprovalHandoff, resumeApprovalHandoff, setApprovalSharing } from '../app/approve-action';
import { DEVELOPER_LINK_PREFIX } from '../developer/link-format';
import { AUTOMATION_LINK_PREFIX } from '../automations/link-format';
import type { ApprovalView } from '../mcp/handoff/service';
import { APPROVAL_SECRET_FORMAT } from '../platform/approval-link-format';
import { walletDeepLinks } from '../platform/wallet-links';
import type { ClaimedProposal } from '../platform/approvals';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from '../state/workflow-store';
import type { SolanaWalletChain } from '../wallet/solana-wallet';
import { useWalletProof, WalletProof } from './wallet-proof';
import { McpRouteState } from './mcp-route-state';

// BUILD-DEVELOPER-001: any FloFi approval link (MCP's `flofi_hs_…` and later surfaces' own tags); the server resolves which one.
const SECRET = APPROVAL_SECRET_FORMAT;
const STORAGE_KEY = 'flofi.approval.secret';
const RECOVERY_KEY = 'flofi.approval.id';
const REFERENCE = /^apr_[a-z2-7]{26}$/;
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
  if (SECRET.test(fromHash) || REFERENCE.test(fromHash)) {
    try {
      // History restoration may present the same consumed fragment again. Keep its owner-only recovery hint;
      // a different presented link must never inherit the previous proposal's hint.
      if (sessionStorage.getItem(STORAGE_KEY) !== fromHash) sessionStorage.removeItem(RECOVERY_KEY);
      sessionStorage.setItem(STORAGE_KEY, fromHash);
    } catch { /* storage may be unavailable; the page still works until reload */ }
    window.history.replaceState(null, '', window.location.pathname);
    return fromHash;
  }
  if (fromHash) return null;
  try { const stored = sessionStorage.getItem(STORAGE_KEY); return stored && (SECRET.test(stored) || REFERENCE.test(stored)) ? stored : null; } catch { return null; }
}

export function ApprovalHandoff({ onAvailabilityChange, onContinue }: { onAvailabilityChange?: (available: boolean) => void; onContinue?: () => void }) {
  const { t: tr } = useLocale();
  const { state, restoreWorkflow } = useWorkflow();
  const [secret, setSecret] = useState<string | null>(null);
  const [view, setView] = useState<ApprovalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<boolean | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [recovery, setRecovery] = useState<ClaimedProposal | null>(null);
  const [closed, setClosed] = useState(false);
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);
  const applying = useRef<number | null>(null);
  const acting = useRef(false);
  const generation = useRef(0);
  const chain: SolanaWalletChain = view?.steps.some(s => s.network === 'solana') ? 'solana:mainnet' : 'solana:devnet';
  const proof = useWalletProof(view?.walletNamespace ?? null, chain), proven = proof.proven;
  const available = resolved && view !== null && !TERMINAL.includes(view.status) && !view.refusal;

  useEffect(() => {
    let request = 0;
    const load = async () => {
      const current = ++request, found = takeSecret();
      generation.current++;
      onAvailabilityChange?.(false);
      setSecret(found); setView(null); setResolved(false); setError(null); setClaimed(false); setShare(null); setRecovery(null); setClosed(false);
      if (!found) { setResolved(true); return; }
      try {
        let capability = found;
        if (REFERENCE.test(found)) {
          const resumed = await resumeApprovalHandoff(found);
          if (current !== request) return;
          if (resumed.ok) { setRecovery(resumed.value); setView(resumed.value.view); setShare(resumed.value.view.statusShared); return; }
          capability = decodeURIComponent(new URL(unwrap(await openBrowserApprovalHandoff(found)).approvalUrl).hash.slice(1));
        }
        if (current !== request) return;
        setSecret(capability);
        try { sessionStorage.setItem(STORAGE_KEY, capability); } catch { /* tab memory still works */ }
        const result = await approvalHandoffView(capability);
        if (current !== request) return;
        if (result.ok) {
          setView(result.value); setShare(result.value.claimedByYou ? result.value.statusShared : result.value.sameAccount);
          try { sessionStorage.setItem(RECOVERY_KEY, result.value.approvalId); } catch { /* optional recovery hint */ }
        } else {
          let id: string | null = null;
          try { id = sessionStorage.getItem(RECOVERY_KEY); } catch { /* no recovery hint */ }
          const resumed = id && REFERENCE.test(id) ? await resumeApprovalHandoff(id) : null;
          if (current !== request) return;
          if (resumed?.ok) { setRecovery(resumed.value); setView(resumed.value.view); setShare(resumed.value.view.statusShared); }
          else setError(result.code);
        }
      } catch (cause) { if (current === request) setError(cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'APPROVAL_UNAVAILABLE'); }
      finally { if (current === request) setResolved(true); }
    };
    // The product's skip link is a local anchor, not a new approval handoff.
    const hashChanged = () => { if (window.location.hash !== '#workspace') void load(); };
    void load();
    window.addEventListener('hashchange', hashChanged);
    window.addEventListener('popstate', hashChanged);
    return () => { request++; generation.current++; window.removeEventListener('hashchange', hashChanged); window.removeEventListener('popstate', hashChanged); };
  }, [onAvailabilityChange, reload]);
  useEffect(() => {
    onAvailabilityChange?.(available);
    return () => onAvailabilityChange?.(false);
  }, [available, onAvailabilityChange]);
  useEffect(() => {
    if (!secret || !SECRET.test(secret) || claimed || !view || !['PENDING', 'CLAIMED'].includes(view.status)) return;
    let stopped = false;
    const current = generation.current;
    const timer = setInterval(() => {
      void approvalHandoffView(secret).then(result => {
        if (stopped || current !== generation.current) return;
        if (result.ok) setView(result.value); else setError(result.code);
      }).catch(() => { if (!stopped && current === generation.current) setError('APPROVAL_UNAVAILABLE'); });
    }, 30_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [secret, claimed, view?.status]);
  // Once the proposal is applied, the server checks that the FloFi workflow hashes to exactly the proposal.
  useEffect(() => {
    const current = generation.current;
    if (!secret || !claimed || applying.current === current || view?.status === 'APPLIED' || state.workflow.revision === 0) return;
    applying.current = current;
    void markApprovalApplied(secret, state.workflow).then(result => {
      if (current !== generation.current) return;
      if (result.ok) setView(result.value); else setError(result.code);
    }).catch(() => { if (current === generation.current) setError('APPROVAL_UNAVAILABLE'); })
      .finally(() => { if (applying.current === current) applying.current = null; });
  }, [state.workflow, claimed, secret, view?.status]);

  async function run(action: () => Promise<void>) {
    if (acting.current) return; acting.current = true; setBusy(true); setError(null);
    const current = generation.current;
    try { await action(); } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'WALLET_REQUEST_FAILED');
    }
    finally { acting.current = false; setBusy(false); }
  }
  const claim = () => run(async () => {
    const current = generation.current;
    const result = recovery ?? unwrap(await claimApprovalHandoff(secret!, share === true));
    if (current !== generation.current) return;
    setView(result.view); setClaimed(true);
    // Reuse the existing validated workflow restoration path, which invalidates prior Review authority even if the hash is unchanged.
    // The owner explicitly chose this proposal; simulation, Manifest Review and transaction signatures remain separate actions.
    restoreWorkflow(result.workflow as SemanticWorkflow);
  });
  const toggleShare = (next: boolean) => {
    setShare(next);
    const current = generation.current;
    if (claimed && secret && !recovery) void setApprovalSharing(secret, next).then(r => {
      if (current !== generation.current) return;
      if (r.ok) setView(v => v && { ...v, statusShared: r.value.statusShared }); else setError(r.code);
    }).catch(() => { if (current === generation.current) setError('APPROVAL_UNAVAILABLE'); });
  };
  const close = () => {
    generation.current++;
    try { sessionStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(RECOVERY_KEY); } catch { /* tab only */ }
    setClosed(true); setSecret(null); setView(null); setClaimed(false);
  };

  // BUILD-DEVELOPER-001: who sent the link, where the page knows it (the resolved proposal, else the link's own tag). Only the wording
  // follows it; the route states, their headings and every check are the same for every requester.
  const fromApp = view ? view.requesterKind === 'DEVELOPER_PROJECT' : secret?.startsWith(DEVELOPER_LINK_PREFIX) === true;
  // BUILD-AUTOMATION-001: a proposal the owner's own automation prepared, opened from FloFi → Automations.
  const fromAutomation = view ? view.requesterKind === 'AUTOMATION_RULE' : secret?.startsWith(AUTOMATION_LINK_PREFIX) === true;
  if (closed) return <McpRouteState label="Approval" title="Approval closed" description={fromAutomation
    ? 'Closing this page grants no transaction authority. While the proposal is still waiting for you, open it again from FloFi → Automations.'
    : 'Return to the conversation that sent you here. Closing this page grants no transaction authority. You can reopen an unused link; ask for a new link if it has expired.'}/>;
  if (!resolved) return <McpRouteState label="Approval" title={tr("Opening your approval")} loading
    description={fromAutomation ? 'Getting the proposal your automation prepared…' : fromApp ? 'Getting the proposal from the app that sent you this link…' : 'Getting the proposal from your connected assistant…'}/>;
  if (!view && error && /^APPROVAL_(EXPIRED|REVOKED|SUPERSEDED|STALE)$/.test(error)) return <McpRouteState label="Approval"
    title="This approval is no longer available" description={fromAutomation ? 'Open the proposal again from FloFi → Automations if it is still waiting for you.'
      : 'Return to the conversation that sent this link and ask for a new proposal.'}/>;
  if (!secret || !view) return <><McpRouteState label="Approval" title={tr(fromAutomation ? 'Open this proposal from FloFi Automations' : 'Open this link from your assistant')}
    description={fromAutomation ? 'Open the proposal again from FloFi → Automations: FloFi prepares a fresh approval each time you open it.'
      : fromApp ? 'Open the FloFi approval link again from the app that sent it. If the link has expired, ask that app for a new one.'
      : error === 'APPROVAL_ACCOUNT_REQUIRED' ? 'Open this link in the browser used to connect FloFi to ChatGPT or Claude. For another browser or a mobile wallet, use the FloFi panel’s wallet action.'
      : 'Open the FloFi approval link from ChatGPT, Claude, WhatsApp or Telegram. If the link has expired, ask for a new one.'}/>
      {error && <div className="approval-page"><p role="alert">{tr(error)}</p><button type="button" onClick={() => setReload(n => n + 1)}>Try again</button></div>}</>;
  if (!available) return <McpRouteState label="Approval" title={tr("This approval is no longer available")}
    description={fromAutomation ? 'Open the proposal again from FloFi → Automations if it is still waiting for you.'
      : fromApp ? 'Ask the app that sent this link to prepare a new FloFi approval link.' : 'Ask your connected assistant to prepare a new FloFi approval link.'}/>;
  const terminal = TERMINAL.includes(view.status), real = view.fundsClass === 'REAL_FUNDS', canClaim = !terminal && !view.refusal && !view.claimedByAnotherWallet;
  const fullLink = secret && SECRET.test(secret) ? `${window.location.origin}/approve#${secret}` : null;
  const links = fullLink ? walletDeepLinks(fullLink, window.location.origin) : null;
  return <div className="approval-page"><section className="panel approval-handoff" aria-label={tr("External proposal")}>
    <div className="approval-head"><div><p className="eyebrow">{tr("EXTERNAL PROPOSAL · FROM ")}{tr(view.clientName.toUpperCase())}</p>
      <h2>{tr("A strategy proposed via ")}{tr(view.clientName)}</h2></div>
      <span className="status-badge info" aria-label={tr("Approval status")}>{tr(STATUS_TEXT[view.status] ?? view.status)}</span></div>
    <p className="approval-nothing"><strong>{tr("Nothing is authorized yet.")}</strong>{tr(" This page only shows the proposal. Your wallet signs nothing until you run a fresh simulation, review the Strategy Manifest and approve each transaction yourself.")}</p>
    {real && <p className="approval-real" role="alert"><strong>{tr("Real funds.")}</strong>{tr(" This strategy uses a mainnet. Every transaction spends real assets once you sign it.")}</p>}
    <dl className="approval-facts">
      <div><dt>{tr("Network")}</dt><dd>{tr(view.networkEnvironment === 'MAINNET' ? 'Mainnet' : 'Public testnet')} · {tr([...new Set(view.steps.flatMap(s => [s.network, s.destinationNetwork].filter(Boolean)))].join(' → '))}</dd></div>
      <div><dt>{tr("Funds")}</dt><dd>{tr(real ? 'Real funds' : 'Test funds')}</dd></div>
      <div><dt>{tr("Steps")}</dt><dd><ol>{view.steps.map(s => <li key={s.index}>{tr(s.action)} · {tr(s.protocol || s.kind)} · {tr(s.network)}</li>)}</ol></dd></div>
      <div><dt>{tr("Workflow hash")}</dt><dd><code>{tr(view.workflowHash)}</code></dd></div>
    </dl>
    {view.summary && <p className="approval-summary">{tr(view.summary)}</p>}
    <p className="muted">Wallet proof → Fresh simulation → Manifest Review → Explicit authorization → Wallet signature → Execution → Reconciliation</p>
    {!claimed && !recovery && links && <details className="approval-mobile"><summary>Open with a mobile wallet</summary>
      <p>Use the browser inside your wallet app. A sign-in message proves ownership; it never approves spending.</p>
      <div className="approval-actions">{view.walletNamespace === 'eip155' && <a className="primary" href={links.metamask} rel="noreferrer">Open in MetaMask</a>}
        {view.walletNamespace === 'solana' && <a href={links.phantom} rel="noreferrer" target="_blank">Open Phantom browser</a>}
        <button type="button" onClick={() => void run(async () => { await navigator.clipboard.writeText(fullLink!); setCopied(true); })}>Copy approval link</button></div>
      <p>{copied ? 'Link copied. ' : ''}In Phantom, paste the copied link into its browser. If your app does not preserve the link, paste it into the wallet browser. Keep this link private.</p>
      <input aria-label="Private approval link" readOnly value={fullLink!}/>
    </details>}
    {view.explanation.length > 0 && <ul className="approval-explanation">{view.explanation.map((line, i) => <li key={i}>{tr(line)}</li>)}</ul>}
    <p className="muted approval-ai">{view.requesterKind === 'DEVELOPER_PROJECT'
      ? tr("Created by {0}, a third-party app registered with FloFi, not by FloFi. It is not financial advice; you decide, and only your wallet can sign.", view.clientName)
      : view.requesterKind === 'AUTOMATION_RULE'
        ? tr("Prepared by your FloFi automation from a schedule or price condition you configured. It is not financial advice; you decide, and only your wallet can sign.")
        : tr("Proposed with an AI assistant from your conversation. It is not financial advice; you decide, and only your wallet can sign.")}</p>
    {terminal && <p className="approval-ended" role="status">{tr("This request is ")}{tr(STATUS_TEXT[view.status]?.toLowerCase())}{tr(". Ask for a new proposal.")}</p>}
    {view.refusal && !terminal && <p className="approval-ended" role="status">{tr("FloFi cannot hand this proposal to a wallet on this deployment now (")}{tr(view.refusal)}).</p>}
    {view.claimedByAnotherWallet && <p className="approval-ended" role="status">{tr("Another wallet already opened this proposal. Ask for a new proposal.")}</p>}
    {canClaim && !claimed && <div className="approval-steps">
      <h3>{tr("1. Prove which wallet you are")}</h3>
      <WalletProof namespace={view.walletNamespace} proof={proof}/>
      <p className="muted">{tr("This signs a sign-in message only. It authorizes no transaction and moves no funds.")}</p>
      <h3>{tr("2. Load the proposal into FloFi")}</h3>
      {/* An automation is the owner's own: its workspace reads the owner's runs with the owner's session, so there is nothing to share. */}
      {!fromAutomation && <label className="approval-share"><input type="checkbox" checked={share === true} onChange={e => toggleShare(e.target.checked)}/>{tr("Share the status and evidence of runs started from this proposal with ")}{tr(view.clientName)}</label>}
      <div className="approval-actions"><button type="button" className="primary" disabled={busy || !proven} onClick={() => void claim()}>{tr("Load proposal")}</button></div>
    </div>}
    {claimed && <div className="approval-steps">
      {view.status !== 'APPLIED' && <p role="status">Loading your exact proposal…</p>}
      {view.status === 'APPLIED' && <p role="status"><strong>{tr("Ready for your review.")}</strong>{tr(" Open ")}<em>{tr("Simulate")}</em>{tr(" for a fresh simulation, review the Strategy Manifest, then ")}<em>{tr(" Execute")}</em>{tr(": your wallet asks you to sign each transaction.")}</p>}
      {view.status === 'APPLIED' && <button type="button" className="primary" onClick={onContinue}>Continue to simulation</button>}
      {recovery ? <p>Proposal restored for its proven owner. Run a fresh simulation before approval. Existing runs remain available in Your runs; reconcile an interrupted run before starting again.</p>
        : !fromAutomation && <label className="approval-share"><input type="checkbox" checked={view.statusShared} onChange={e => toggleShare(e.target.checked)}/>{tr("Share run status and evidence with ")}{tr(view.clientName)}</label>}
    </div>}
    {!claimed && <button type="button" disabled={busy} onClick={close}>Close approval</button>}
    {error && claimed && view.status !== 'APPLIED' && <button type="button" onClick={() => void run(async () => {
      const current = generation.current, result = unwrap(await markApprovalApplied(secret!, state.workflow));
      if (current === generation.current) setView(result);
    })}>Retry loading proposal</button>}
    {/* The shared approval surface reports APPROVALS_NOT_ENABLED (BUILD-DEVELOPER-001); MCP_OAUTH_NOT_ENABLED is its MCP-era name. */}
    {(error ?? proof.error) && <p className="error-banner" role="alert">{error === 'APPROVALS_NOT_ENABLED' || error === 'MCP_OAUTH_NOT_ENABLED'
      ? tr(fromApp ? 'Approvals are unavailable right now. Return to the app that sent this link and try again later.' : 'Approvals are unavailable right now. Return to your assistant and try again later.')
      : tr(error ?? proof.error)}</p>}
  </section></div>;
}
