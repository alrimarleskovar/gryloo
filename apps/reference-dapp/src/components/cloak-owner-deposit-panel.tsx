// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { PrivateStateVault, openPrivateVault, type PrivateStateIdentity } from '../privacy/vault';
import { prepareOwnerDeposit, recoverOwnerDeposit, submitOwnerDeposit, type OwnerDepositPreparation } from '../privacy/owner-proof-deposit';
import { authorizeOwnerDeposit, OWNER_PROOF_LABEL, type OwnerProofConfiguration } from '../privacy/owner-proof-gate';
import { connectSolanaWallet, solanaWalletNames } from '../wallet/solana-wallet';
const pointerKey = 'flofi.cloak.owner-deposit.reference.v1';
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export default function CloakOwnerDepositPanel({ configuration }: { configuration: OwnerProofConfiguration }) {
  const [secret, setSecret] = useState(''), [vault, setVault] = useState<PrivateStateVault | null>(null);
  const [prepared, setPrepared] = useState<OwnerDepositPreparation | null>(null), [identity, setIdentity] = useState<PrivateStateIdentity | null>(null);
  const [backup, setBackup] = useState(false), [reviewed, setReviewed] = useState(false), [enabled, setEnabled] = useState(false);
  const [wallet, setWallet] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [latched, setLatched] = useState(false);
  const [evidence, setEvidence] = useState<Awaited<ReturnType<typeof recoverOwnerDeposit>> | null>(null);
  const operation = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) {
    setError(e instanceof Error && /^CLOAK_|^PRIVACY_|^RESERVATION_/.test(e.message) ? e.message :
      e instanceof Error && e.message === 'Buffer is not defined' ? 'CLOAK_DEPOSIT_BROWSER_BUFFER_UNAVAILABLE' :
      e instanceof Error && /Failed to fetch|fetch failed|NetworkError/.test(e.message) ? 'CLOAK_DEPOSIT_PUBLIC_RPC_UNAVAILABLE' : 'CLOAK_DEPOSIT_INSPECTION_REQUIRED');
  } finally { setBusy(false); } };
  const admitted = configuration.enabled && Object.values(configuration.admission).every(v => v === true);
  return <main style={{ maxWidth: 900, margin: '32px auto', padding: 24 }} aria-label="Cloak owner mainnet deposit proof">
    <p style={{ position: 'sticky', top: 0, padding: 12, background: '#532900', color: 'white', fontWeight: 700 }}>{OWNER_PROOF_LABEL}</p>
    <h1>Minimum Cloak shield deposit</h1>
    <p>This distinct proof deposits exactly 0.01 SOL into Cloak. It does not execute a swap or enable production trading. No mainnet proof exists until a real transaction is finalized and its shielded output note is saved and reloaded.</p>
    <p>Expected owner: <code>{configuration.owner}</code></p>
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
      setPrepared(null); setReviewed(false); setBackup(false); setEnabled(false); setEvidence(null);
      const p = await prepareOwnerDeposit(vault, configuration.owner); setPrepared(p); setIdentity(p.identity);
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
        manifestHash: prepared.manifestHash, reviewDigest: prepared.reviewDigest, simulation: prepared.simulation }, null, 2))}>Export public Review and Manifest</button>
      <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)}/>I reviewed this exact deposit, transaction, fees and Manifest.</label>
      <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>I explicitly enable ONE owner-controlled MAINNET PROOF deposit.</label>
      <label>Owner wallet <select value={wallet} onChange={e => setWallet(e.target.value)}><option value="">Choose wallet</option>{solanaWalletNames().map(n => <option key={n}>{n}</option>)}</select></label>
      <p>The next button opens your wallet for this exact Solana transaction. Only you can approve its signature. FloFi submits the verified signed bytes once; it never signs automatically or retries after uncertainty.</p>
      <button disabled={!admitted || busy || latched || !reviewed || !enabled || !backup || !wallet || prepared.simulation !== 'PASSED'} onClick={() => void operation(async () => {
        const permit = authorizeOwnerDeposit(configuration, prepared, prepared.reviewDigest, enabled);
        setLatched(true); const session = await connectSolanaWallet(wallet, 'solana:mainnet', 'CLOAK_DEPOSIT');
        const result = await submitOwnerDeposit(vault, prepared, permit, session, prepared.reviewDigest);
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
      <button onClick={() => download('BUILD-PRIVACY-001-mainnet-deposit-evidence.json', JSON.stringify(evidence, null, 2))}>Export real public mainnet evidence</button></>}</>}
    {error && <p role="alert">{error}</p>}
  </main>;
}
