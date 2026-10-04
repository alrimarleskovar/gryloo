// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef, useState } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { PrivateStateVault, openPrivateVault, type VaultReference } from '../privacy/vault';
import { prepareCloakBrowserReview } from '../privacy/browser-lifecycle';
import { executeCloakLive, recoverCloakLive, registerCloakRecoveryViewingKey, type CloakLiveOutcome } from '../privacy/live-execution';
import { assertCloakFinancialExecutionAvailable } from '../privacy/cloak-adapter';
import { connectSolanaWallet, solanaWalletNames } from '../wallet/solana-wallet';
const requireRelease: () => void = assertCloakFinancialExecutionAvailable;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
const referenceKey = 'flofi.cloak.live.reference.v1';
/** Loaded only by an explicit owner action. No wallet connection, signing or financial request occurs on mount. */
export default function CloakLivePanel({ workflow }: { workflow: SemanticWorkflow }) {
  const [secret, setSecret] = useState(''), [vault, setVault] = useState<PrivateStateVault | null>(null);
  const [reference, setReference] = useState<VaultReference | null>(null), [minimum, setMinimum] = useState(''), [ata, setAta] = useState('');
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareCloakBrowserReview>> | null>(null);
  const [ack, setAck] = useState(false), [backedUp, setBackedUp] = useState(false), [wallet, setWallet] = useState('');
  const [outcome, setOutcome] = useState<CloakLiveOutcome | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const current = prepared?.workflow.revision === workflow.revision && JSON.stringify(prepared.workflow) === JSON.stringify(workflow) ? prepared : null;
  const latest = useRef({ workflow, current });
  useEffect(() => { latest.current = { workflow, current }; }, [workflow, current]);
  const operation = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'CLOAK_RECOVERY_REQUIRED'); } finally { setBusy(false); } };
  let released = false; try { requireRelease(); released = true; } catch { /* Preserve mandatory acceptance gate. */ }
  return <div aria-label="Cloak encrypted vault and live preparation">
    <h3>Encrypted vault and recovery</h3>
    <p>Unlock stays in this browser. Mainnet preparation checks existing shielded notes and creates a real proof. It does not deposit funds or request a signature. Restored attempts allow inspection only.</p>
    {!vault && <><label>Local vault passphrase <input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)}/></label>
      <button disabled={busy || secret.length < 16} onClick={() => void operation(async () => {
        if (navigator.storage?.persist) await navigator.storage.persist();
        const unlocked = new PrivateStateVault(await openPrivateVault(), secret), remembered = localStorage.getItem(referenceKey);
        if (remembered) { const pointer = JSON.parse(remembered) as VaultReference; await unlocked.load(pointer); setReference(pointer); }
        setVault(unlocked); setSecret('');
      })}>Unlock durable local vault</button></>}
    {vault && <><label>Import encrypted recovery bundle <input type="file" accept="application/json" disabled={busy} onChange={e => {
      const file = e.target.files?.[0]; if (!file) return;
      void operation(async () => {
        if (file.size > 24_000_000) throw new Error('PRIVACY_STATE_TOO_LARGE');
        const text = await file.text(), parsed = JSON.parse(text) as { format?: string; reference: VaultReference; encryptedBackup: string };
        let restored: VaultReference;
        try { await vault.load(parsed.reference); restored = parsed.reference; }
        catch (e) {
          if (!(e instanceof Error) || e.message !== 'PRIVACY_RECOVERY_DATA_MISSING') throw e;
          restored = parsed.format === 'flofi.cloak-live-backup.v1' ? await vault.restoreExecutionBackup(text)
            : (await vault.restore(parsed.reference, parsed.encryptedBackup), parsed.reference);
        }
        localStorage.setItem(referenceKey, JSON.stringify(restored));
        setReference(restored); setPrepared(null); setAck(false); setBackedUp(false);
      });
    }}/></label>
    {reference && <><p>Run: {reference.runId}. Owner: {reference.owner}</p>
      <label>Exact recipient USDC ATA <input value={ata} disabled={busy} onChange={e => { setAta(e.target.value); setPrepared(null); setAck(false); }}/></label>
      <label>Minimum public USDC output (base units; 1 USDC = 1,000,000) <input value={minimum} disabled={busy} onChange={e => { setMinimum(e.target.value); setPrepared(null); setAck(false); }}/></label>
      <button disabled={busy || !minimum || !ata} onClick={() => void operation(async () => {
        const next = await prepareCloakBrowserReview(vault, reference, workflow, minimum, ata);
        localStorage.setItem(referenceKey, JSON.stringify(next.reference));
        setPrepared(next); setReference(next.reference); setAck(false); setBackedUp(false);
      })}>Prepare proof and property review</button>
      <button disabled={busy} onClick={() => void operation(async () => { setOutcome(await recoverCloakLive(vault, reference)); })}>Inspect finalized chain and resume reconciliation</button>
      <button disabled={busy} onClick={() => void operation(async () => {
        download('BUILD-PRIVACY-001-encrypted-live-recovery.json', await vault.executionBackup(reference)); setBackedUp(true);
      })}>Export complete encrypted recovery backup</button></>}
    {current && <><h3>Review → Manifest → Authorization</h3>
      <p>Groth16 proof verified locally; input state checked at a finalized mainnet slot. Source and settlement transactions were not RPC-simulated. Review expires {new Date(current.review.properties.expiresAt).toISOString()}; acceptance does not guarantee a settlement deadline.</p>
      <dl>{Object.entries({ Provider: 'Cloak', 'Shielded input': `SOL ${current.review.properties.grossInputLamports} lamports`,
        'Minimum public output': `${current.review.properties.minimumOutput} USDC base units`, 'Recipient ATA': current.review.properties.recipientAta,
        'Maximum protocol fee': `${current.review.properties.maximumProtocolFeeLamports} lamports`,
        'Private SOL change': `${current.review.properties.privateChange.amount} lamports`, Program: current.review.properties.programId,
        Network: current.review.properties.genesisHash, Manifest: current.review.manifestHash,
        'Routing provider': 'Jupiter via Cloak', 'Exact DEX route': 'provider-managed and not authorization-bound' }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      <button disabled={busy} onClick={() => download('BUILD-PRIVACY-001-live-review.json', JSON.stringify(current.review, null, 2))}>Export public property review and Manifest</button>
      <label><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)}/>I reviewed these properties and the Manifest. Routing is provider-managed.</label>
      <label>Owner wallet <select value={wallet} onChange={e => setWallet(e.target.value)}><option value="">Choose wallet</option>{solanaWalletNames().map(n => <option key={n}>{n}</option>)}</select></label>
      <p>Cloak requires viewing-key registration. This shares viewing authority with Cloak for note recovery; spending keys stay in your encrypted browser vault. Registration is a separate owner signature and does not authorize this swap.</p>
      <button disabled={!released || busy || !wallet} onClick={() => void operation(async () => {
        if (!vault || !current) throw new Error('CLOAK_LIVE_REVIEW_CHANGED'); requireRelease();
        const session = await connectSolanaWallet(wallet, 'solana:mainnet', 'CLOAK');
        await registerCloakRecoveryViewingKey(vault, current.reference, session);
      })}>Register recovery viewing key with Cloak</button>
      <button disabled={!released || busy || !ack || !backedUp || !wallet || Date.now() >= current.review.properties.expiresAt} onClick={() => void operation(async () => {
        if (!vault || !current) throw new Error('CLOAK_LIVE_REVIEW_CHANGED');
        requireRelease();
        const session = await connectSolanaWallet(wallet, 'solana:mainnet', 'CLOAK');
        const selected = current, unlocked = vault;
        setOutcome(await executeCloakLive(unlocked, selected.reference, selected.review, selected.proof, selected.auth, workflow, selected.review.reviewDigest, session, () => {
          if (latest.current.current !== selected) throw new Error('CLOAK_LIVE_REVIEW_CHANGED');
          return latest.current.workflow;
        }));
      })}>Authorize reviewed Cloak request</button>
      {!released && <p>Owner authorization remains disabled by the existing acceptance gate. This is not READY_FOR_OWNER_EXECUTION.</p>}</>}
    <p>After any submission or reconciliation, export an updated encrypted backup. A timeout or unknown result requires inspection; it never permits a blind retry or automatic refund withdrawal.</p>
    <button disabled={busy} onClick={() => { setVault(null); setReference(null); setPrepared(null); setAck(false); setBackedUp(false); }}>Lock vault</button></>}
    {busy && <p role="status">Checking and persisting encrypted recovery state…</p>}
    {outcome && <p role="status">{outcome.state}: {outcome.reason}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
