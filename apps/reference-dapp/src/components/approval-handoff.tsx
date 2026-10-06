// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-MCP-002: the FloFi side of a chat proposal (`/approve#<secret>`). It shows that the proposal is EXTERNAL, where it came
 * from, its network, funds class, steps, summary and workflow hash, and that nothing is authorized yet. The owner proves a wallet
 * (EIP-4361 or Sign-In With Solana); the server re-verifies and returns the same authoring command FloFi's own chat produces,
 * which enters the existing proposal card. From there the unchanged flow panels run the fresh simulation, the Strategy Manifest
 * Review, the explicit approval and the wallet signature. This component never builds, signs or sends a transaction.
 */
import { useEffect, useRef, useState } from 'react';
import { approvalHandoffView, claimApprovalHandoff, markApprovalApplied, setApprovalSharing } from '../app/approve-action';
import { solanaSessionStatus, solanaSignIn, solanaSignInChallenge, walletSessionStatus, walletSignIn, walletSignInChallenge } from '../app/wallet-session-action';
import type { ApprovalView } from '../mcp/handoff/service';
import { useWorkflow } from '../state/workflow-store';
import { injectedProvider } from '../wallet/eip1193';
import { connectSolanaWallet, signSolanaMessage, solanaWalletNames, type SolanaWalletChain } from '../wallet/solana-wallet';

const SECRET = /^flofi_hs_[A-Za-z0-9_-]{43}$/;
const STORAGE_KEY = 'flofi.approval.secret';
const utf8Hex = (text: string) => '0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');
const TERMINAL = ['EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE'];
const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Waiting for you', CLAIMED: 'Loaded for your wallet', APPLIED: 'In your FloFi workflow', EXPIRED: 'Expired', SUPERSEDED: 'Replaced by a newer request',
  REVOKED: 'Withdrawn', STALE: 'No longer reproducible',
};
function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T { if (!result.ok) throw new Error(result.code); return result.value; }
/** The handoff secret travels only in the URL fragment; it is moved to this tab's session storage and removed from the address bar. */
function takeSecret(): string | null {
  const fromHash = typeof window === 'undefined' ? '' : decodeURIComponent(window.location.hash.slice(1));
  if (SECRET.test(fromHash)) {
    try { sessionStorage.setItem(STORAGE_KEY, fromHash); } catch { /* storage may be unavailable; the page still works until reload */ }
    window.history.replaceState(null, '', window.location.pathname);
    return fromHash;
  }
  try { const stored = sessionStorage.getItem(STORAGE_KEY); return stored && SECRET.test(stored) ? stored : null; } catch { return null; }
}

export function ApprovalHandoff() {
  const { state, pending, propose, applyProposal } = useWorkflow();
  const [secret, setSecret] = useState<string | null>(null);
  const [view, setView] = useState<ApprovalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<boolean | null>(null);
  const [proven, setProven] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [solanaNames, setSolanaNames] = useState<string[]>([]);
  const applying = useRef(false);
  const chain: SolanaWalletChain = view?.steps.some(s => s.network === 'solana') ? 'solana:mainnet' : 'solana:devnet';

  useEffect(() => {
    const found = takeSecret();
    setSecret(found);
    if (!found) return;
    void approvalHandoffView(found).then(result => { if (result.ok) { setView(result.value); setShare(s => s ?? result.value.sameAccount); } else setError(result.code); });
  }, []);
  useEffect(() => {
    if (!view) return;
    if (view.walletNamespace === 'solana') {
      void solanaSessionStatus().then(session => setProven(session?.account ?? null));
      const refresh = () => setSolanaNames(solanaWalletNames(chain));
      refresh(); const timer = setInterval(refresh, 1_000); return () => clearInterval(timer);
    }
    void walletSessionStatus().then(session => setProven(session?.account ?? null));
    return undefined;
  }, [view?.walletNamespace, chain]);
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
  const proveEvm = () => run(async () => {
    const provider = injectedProvider(); if (!provider) throw new Error('EVM_WALLET_NOT_FOUND');
    const accounts = await provider.request({ method: 'eth_requestAccounts' }), chainId = await provider.request({ method: 'eth_chainId' });
    const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0].toLowerCase() : null;
    if (!account || typeof chainId !== 'string') throw new Error('EVM_WALLET_NOT_FOUND');
    const { message } = unwrap(await walletSignInChallenge(account, Number.parseInt(chainId, 16)));
    const signature = await provider.request({ method: 'personal_sign', params: [utf8Hex(message), account] });
    if (typeof signature !== 'string') throw new Error('WALLET_SIGNATURE_INVALID');
    setProven(unwrap(await walletSignIn(account, Number.parseInt(chainId, 16), signature)).account);
  });
  const proveSolana = (name: string) => run(async () => {
    const session = await connectSolanaWallet(name, chain, 'APPROVAL');
    const { message } = unwrap(await solanaSignInChallenge(session.account.address));
    const signature = await signSolanaMessage(session, message, 'APPROVAL');
    setProven(unwrap(await solanaSignIn(session.account.address, signature)).account);
  });
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

  if (!secret) return <section className="panel approval-handoff" aria-label="External proposal"><p className="eyebrow">EXTERNAL PROPOSAL</p>
    <h2>This approval link is incomplete</h2><p className="muted">Open the link again from your chat. A FloFi approval link never asks for a key or a seed phrase.</p></section>;
  if (!view) return <section className="panel approval-handoff" aria-label="External proposal"><p className="eyebrow">EXTERNAL PROPOSAL</p>
    <p className="muted">{error ? `This proposal cannot be shown (${error}).` : 'Loading the proposal…'}</p></section>;
  const terminal = TERMINAL.includes(view.status), real = view.fundsClass === 'REAL_FUNDS', canClaim = !terminal && !view.refusal && !view.claimedByAnotherWallet;
  return <section className="panel approval-handoff" aria-label="External proposal">
    <div className="approval-head"><div><p className="eyebrow">EXTERNAL PROPOSAL · FROM {view.clientName.toUpperCase()}</p>
      <h2>A strategy proposed in your chat with {view.clientName}</h2></div>
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
    <p className="muted approval-ai">Proposed with an AI assistant from your conversation. It is not financial advice; you decide, and only your wallet can sign.</p>
    {terminal && <p className="approval-ended" role="status">This request is {STATUS_TEXT[view.status]?.toLowerCase()}. Ask your assistant to prepare it again.</p>}
    {view.refusal && !terminal && <p className="approval-ended" role="status">FloFi cannot hand this proposal to a wallet on this deployment now ({view.refusal}).</p>}
    {view.claimedByAnotherWallet && <p className="approval-ended" role="status">Another wallet already opened this proposal. Ask your assistant for a new request.</p>}
    {canClaim && !claimed && <div className="approval-steps">
      <h3>1. Prove which wallet you are</h3>
      {proven ? <p>Signed in as <code>{proven}</code> ({view.walletNamespace === 'solana' ? 'Solana' : 'Ethereum'}).</p>
        : view.walletNamespace === 'solana'
          ? solanaNames.length ? <div className="approval-actions">{solanaNames.map(name => <button key={name} type="button" className="primary" disabled={busy}
            onClick={() => void proveSolana(name)}>Prove ownership with {name}</button>)}</div>
            : <p className="muted">No Solana wallet with message signing is available in this browser. Open this page in your wallet&apos;s browser, or install a wallet.</p>
          : <div className="approval-actions"><button type="button" className="primary" disabled={busy} onClick={() => void proveEvm()}>Connect wallet and prove ownership</button></div>}
      <p className="muted">This signs a sign-in message only. It authorizes no transaction and moves no funds.</p>
      <h3>2. Load the proposal into FloFi</h3>
      <label className="approval-share"><input type="checkbox" checked={share === true} onChange={e => toggleShare(e.target.checked)}/>
        Share the status and evidence of runs started from this proposal with the FloFi account connected to {view.clientName}</label>
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
    {error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
}
