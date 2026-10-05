// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef, useState } from 'react';
import { PrivateStateVault, openPrivateVault, type PrivateStateIdentity } from '../privacy/vault';
import { prepareOwnerDeposit, recoverOwnerDeposit, submitOwnerDeposit, type OwnerDepositPreparation } from '../privacy/owner-proof-deposit';
import { authorizeOwnerDeposit, ownerProofAdmitted, OWNER_PROOF_LABEL, type OwnerProofConfiguration } from '../privacy/owner-proof-gate';
import { OWNER_PROOF_RESIDUAL_LABEL } from '../privacy/owner-proof-residuals';
import { connectProofPhantom, detectProofPhantom, type OwnerProofWalletCheck } from '../privacy/owner-proof-wallet';
const pointerKey = 'flofi.cloak.owner-deposit.reference.v1';
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export default function CloakOwnerDepositPanel({ configuration }: { configuration: OwnerProofConfiguration }) {
  const [secret, setSecret] = useState(''), [vault, setVault] = useState<PrivateStateVault | null>(null);
  const [prepared, setPrepared] = useState<OwnerDepositPreparation | null>(null), [identity, setIdentity] = useState<PrivateStateIdentity | null>(null);
  const [backup, setBackup] = useState(false), [reviewed, setReviewed] = useState(false), [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [latched, setLatched] = useState(false);
  const [residualAccepted, setResidualAccepted] = useState(false), acceptance = configuration.acceptance;
  const [detected, setDetected] = useState<ReturnType<typeof detectProofPhantom> | null>(null);
  const [connected, setConnected] = useState<OwnerProofWalletCheck | null>(null);
  const walletCheck = useRef<OwnerProofWalletCheck | null>(null);
  const invalidateWallet = () => {
    walletCheck.current?.close(); walletCheck.current = null; setConnected(null);
    setPrepared(null); setReviewed(false); setEnabled(false); setBackup(false); setResidualAccepted(false);
  };
  useEffect(() => {
    const detect = () => setDetected(detectProofPhantom());
    const registration = () => queueMicrotask(detect);
    detect(); window.addEventListener('wallet-standard:register-wallet', registration);
    return () => { window.removeEventListener('wallet-standard:register-wallet', registration); walletCheck.current?.close(); };
  }, []);
  const [evidence, setEvidence] = useState<Awaited<ReturnType<typeof recoverOwnerDeposit>> | null>(null);
  const operation = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) {
    if (e instanceof Error && e.message === 'CLOAK_OWNER_CHANGED') invalidateWallet();
    setError(typeof e === 'object' && e !== null && 'code' in e && e.code === 4001 ? 'CLOAK_WALLET_REQUEST_REJECTED — no submission or automatic retry' :
      e instanceof Error && /^CLOAK_|^PRIVACY_|^RESERVATION_/.test(e.message) ? e.message :
      e instanceof Error && e.message === 'Buffer is not defined' ? 'CLOAK_DEPOSIT_BROWSER_BUFFER_UNAVAILABLE' :
      e instanceof Error && /Failed to fetch|fetch failed|NetworkError/.test(e.message) ? 'CLOAK_DEPOSIT_PUBLIC_RPC_UNAVAILABLE' : 'CLOAK_DEPOSIT_INSPECTION_REQUIRED');
  } finally { setBusy(false); } };
  const admitted = ownerProofAdmitted(configuration);
  return <main style={{ maxWidth: 900, margin: '32px auto', padding: 24 }} aria-label="Cloak owner mainnet deposit proof">
    <p style={{ position: 'sticky', top: 0, padding: 12, background: '#532900', color: 'white', fontWeight: 700 }}>{OWNER_PROOF_LABEL}</p>
    <h1>Minimum Cloak shield deposit</h1>
    <p>This distinct proof deposits exactly 0.01 SOL into Cloak. It does not execute a swap or enable production trading. No mainnet proof exists until a real transaction is finalized and its shielded output note is saved and reloaded.</p>
    <p>Expected owner: <code>{configuration.owner}</code></p>
    {acceptance && <section aria-label="Owner-accepted residual risk" style={{ border: '3px solid #532900', padding: 12 }}>
      <h2>{OWNER_PROOF_RESIDUAL_LABEL}</h2>
      <p>Dependency status for this ONE deposit: <strong>{OWNER_PROOF_RESIDUAL_LABEL}</strong>. You accepted the exact reviewed findings below in the launcher terminal. This is not release admission: CI and the normal dependency/SBOM gate still fail, the Elliptic advisory is unresolved, and production financial execution remains disabled.</p>
      <dl>{Object.entries({ Scope: 'ONE Cloak shield deposit of exactly 0.01 SOL (10,000,000 lamports) — no swap, no public fallback',
        Owner: acceptance.scope.owner, Network: `Solana MAINNET, genesis ${acceptance.scope.genesisHash}`, Program: acceptance.scope.programId,
        Lockfile: acceptance.scope.lockHash, 'Wallet signature requests': 'At most 1', 'Application submissions': 'At most 1 — no automatic or blind retry',
        'Accepted findings': `${acceptance.findings.length}: 1 low Elliptic advisory (GHSA-848j-6mx2-7j84) + 21 inventory/license verifier findings`,
        'Residual register': acceptance.registerHash, 'Accepted at': new Date(acceptance.acceptedAt).toISOString(),
        'Acceptance expires': `${acceptance.validUntil}, or at the first wallet signature request`, 'Production financial gate': 'DISABLED' })
        .map(([k, v]) => <div key={k}><dt>{k}</dt><dd style={{ overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>
      <details><summary>Exact accepted findings</summary><ul>{acceptance.findings.map(f => <li key={f}><code style={{ overflowWrap: 'anywhere' }}>{f}</code></li>)}</ul></details>
    </section>}
    <section aria-label="Phantom connection check">
      <h2>Phantom connection — no signing</h2>
      <p>Wallet Standard Phantom: {detected?.walletStandard === 1 ? 'Detected' : detected?.walletStandard ? 'Ambiguous — blocked' : 'Not detected'}. Injected Phantom provider: {detected?.injected ? 'Detected' : 'Not detected'}.</p>
      <button disabled={busy} onClick={() => setDetected(detectProofPhantom())}>Detect Phantom</button>
      <button disabled={busy || detected?.walletStandard !== 1} onClick={() => void operation(async () => {
        invalidateWallet();
        const check = await connectProofPhantom(configuration.owner, () => { invalidateWallet(); setError('CLOAK_OWNER_CHANGED — new connection and Review required'); });
        walletCheck.current = check; setConnected(check);
      })}>Connect Phantom — public key only</button>
      {connected ? <><p>PHANTOM CONNECTION: PASS — connected owner matches exactly.</p>
        <p>Connected public key: <code>{connected.owner}</code></p>
        <p>FloFi execution network: Solana MAINNET ({connected.network}); public RPC genesis verified: <code>{connected.genesisHash}</code>.</p>
        <p>Phantom advertises mainnet support. Its internal testnet toggle is not exposed by Wallet Standard; the transaction request explicitly specifies solana:mainnet.</p>
        <button disabled={busy} onClick={() => void operation(async () => {
          const session = walletCheck.current?.session; invalidateWallet();
          const disconnect = session?.wallet.features['standard:disconnect'] as { disconnect(): Promise<void> } | undefined;
          if (disconnect) await disconnect.disconnect();
        })}>Disconnect Phantom and invalidate Review</button></> : <p>PHANTOM CONNECTION: NOT VERIFIED. Reload requires an explicit fresh connection and exact owner check.</p>}
      <p>Connection requests permission to share a public key only. FloFi never asks for a seed phrase or wallet private key. No message or transaction signature is requested here. Connecting or changing accounts invalidates the previous Review.</p>
    </section>
    <p>The deposit amount, owner wallet, pool, time, fee and output commitment are public. Note spending secrets and viewing material remain inside your encrypted local vault and encrypted backup. A deposit cannot be rolled back; uncertain submission allows inspection only.</p>
    {!admitted && <p role="status">Financial actions disabled. Owner opt-in and audit/SBOM/inventory/license admission are required. Read-only preparation is available.</p>}
    {!vault && <><label>Local vault passphrase <input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)}/></label>
      <button disabled={busy || secret.length < 16} onClick={() => void operation(async () => {
        await navigator.storage.persist(); const v = new PrivateStateVault(await openPrivateVault(), secret);
        const remembered = localStorage.getItem(pointerKey);
        if (remembered) { const ref = JSON.parse(remembered) as PrivateStateIdentity;
          if (ref.owner !== configuration.owner || !await v.loadExecution(ref, 'execution.prepared')) throw new Error('CLOAK_DEPOSIT_CHECKPOINT_INVALID');
          setIdentity(ref); setLatched(await v.loadExecution(ref, 'execution.intent') !== null || await v.loadExecution(ref, 'execution.restore') !== null); }
        setVault(v); setSecret('');
      })}>Unlock durable local vault</button></>}
    {vault && <><label>Import encrypted deposit recovery backup <input type="file" accept="application/json" disabled={busy} onChange={e => {
      const file = e.target.files?.[0]; if (!file) return;
      void operation(async () => { if (file.size > 8_000_000) throw new Error('PRIVACY_STATE_TOO_LARGE');
        const restored = await vault.restoreInitialDepositBackup(await file.text());
        if (restored.owner !== configuration.owner) throw new Error('CLOAK_DEPOSIT_OWNER_CHANGED');
        setIdentity(restored); setPrepared(null); setLatched(true); localStorage.setItem(pointerKey, JSON.stringify(restored)); });
    }}/></label>
    <button disabled={busy || latched} onClick={() => void operation(async () => {
      setPrepared(null); setReviewed(false); setBackup(false); setEnabled(false); setResidualAccepted(false); setEvidence(null);
      const originalWallet = walletCheck.current; originalWallet?.assertCurrent();
      const p = await prepareOwnerDeposit(vault, configuration.owner);
      if (originalWallet !== walletCheck.current) throw new Error('CLOAK_OWNER_CHANGED');
      originalWallet?.assertCurrent(); setPrepared(p); setIdentity(p.identity);
      localStorage.setItem(pointerKey, JSON.stringify(p.identity));
    })}>Prepare 0.01 SOL deposit — no signature</button>
    {prepared && <><h2>Preflight → Review → bound Manifest</h2>
      <dl>{Object.entries({ Amount: '0.01 SOL (10,000,000 lamports)', Provider: 'Cloak', Routing: 'No swap / no Jupiter route',
        Program: prepared.manifest.programId, Pool: prepared.manifest.pool, 'Network genesis': prepared.manifest.genesisHash,
        'Protocol deposit fee': '0 SOL', 'Estimated network fee': `${prepared.networkFeeLamports} lamports`,
        'Simulated total wallet debit': prepared.simulatedWalletDebitLamports === null ? 'Unavailable — insufficient funds' : `${prepared.simulatedWalletDebitLamports} lamports (includes deposit, network fee and account rent)`,
        Preflight: prepared.simulation, 'Expected transaction count': '1', Manifest: prepared.manifestHash,
        'Review digest': prepared.reviewDigest, 'Transaction message digest': prepared.messageDigest,
        'Review expires': new Date(prepared.expiresAt).toISOString(), 'Private note': 'Generated by actual Cloak SDK; encrypted checkpoint saved before signing' }).map(([k, v]) => <div key={k}><dt>{k}</dt><dd style={{ overflowWrap: 'anywhere' }}>{v}</dd></div>)}</dl>
      <button onClick={() => download('BUILD-PRIVACY-001-deposit-review.json', JSON.stringify({ manifest: prepared.manifest,
        manifestHash: prepared.manifestHash, reviewDigest: prepared.reviewDigest, simulation: prepared.simulation,
        dependencyStatus: acceptance ? OWNER_PROOF_RESIDUAL_LABEL : 'ALL UNCHANGED GATES ADMITTED', dependencyAdmission: acceptance }, null, 2))}>Export public Review and Manifest</button>
      <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>I reviewed this exact deposit, transaction, fees and Manifest.</label>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>I explicitly enable ONE owner-controlled MAINNET PROOF deposit.</label>
      {acceptance && <label><input type="checkbox" checked={residualAccepted} onChange={e => setResidualAccepted(e.target.checked)}/>I accept the {OWNER_PROOF_RESIDUAL_LABEL} shown above for this one deposit only.</label>}
      <p>The next button opens your wallet for this exact Solana transaction. Only you can approve its signature. FloFi submits the verified signed bytes once; it never signs automatically or retries after uncertainty.</p>
      <button disabled={!admitted || busy || latched || !reviewed || !enabled || (acceptance !== null && !residualAccepted) || !backup || !connected || prepared.simulation !== 'PASSED'} onClick={() => void operation(async () => {
        const check = walletCheck.current; if (!check) throw new Error('CLOAK_OWNER_CHANGED'); check.assertCurrent();
        const permit = authorizeOwnerDeposit(configuration, prepared, prepared.reviewDigest, enabled, residualAccepted);
        setLatched(true);
        const result = await submitOwnerDeposit(vault, prepared, permit, check.session, prepared.reviewDigest);
        setError(`CLOAK_DEPOSIT_INSPECT_FINALIZED_CHAIN: ${result.signature}`);
      })}>Sign and submit ONE reviewed 0.01 SOL Cloak deposit</button></>}
    {identity && <><button disabled={busy} onClick={() => void operation(async () => {
      download('BUILD-PRIVACY-001-encrypted-deposit-recovery.json', await vault.initialDepositBackup(identity)); setBackup(true);
    })}>Export encrypted deposit recovery backup</button>
    <button disabled={busy} onClick={() => void operation(async () => { setLatched(true); setEvidence(await recoverOwnerDeposit(vault, identity)); })}>Inspect finalized mainnet and reconcile saved note</button></>}
    <p>Download an updated encrypted backup after signing and again after reconciliation. Reload returns to inspection; it never signs or resubmits.</p>
    <button disabled={busy} onClick={() => { setVault(null); setPrepared(null); setIdentity(null); setBackup(false); setReviewed(false); setEnabled(false); }}>Lock vault</button></>}
    {busy && <p role="status">Preparing or inspecting Cloak; persisting encrypted recovery state…</p>}
    {evidence && <><p role="status">{evidence.state}</p>{evidence.state === 'RECONCILED' && <><p>Finalized signature: <a href={evidence.explorer} target="_blank" rel="noreferrer">{evidence.signature}</a>. Shielded outputUtxos encrypted and reload verified.</p>
      <p>Dependency status recorded in evidence: <strong>{evidence.dependencyStatus}</strong></p>
      <button onClick={() => download('BUILD-PRIVACY-001-mainnet-deposit-evidence.json', JSON.stringify(evidence, null, 2))}>Export real public mainnet evidence</button></>}</>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
