// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef, useState } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { advancePrivacyDemo, simulatePrivacyDemo } from '../app/privacy-demo-action';
import type { PrivacyDemoSnapshot } from '../privacy/local-demo';
import { formatTokenAmount } from '../domain/jupiter-authoring';
import styles from './privacy-demo-panel.module.css';

const label = 'LOCAL DEMO / MOCKED EXECUTION — NO MAINNET TRANSACTION';
export default function PrivacyDemoPanel({ workflow, close }: { workflow: SemanticWorkflow; close(): void }) {
  const [snapshot, setSnapshot] = useState<PrivacyDemoSnapshot | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [ack, setAck] = useState(false), [attempted, setAttempted] = useState(false);
  const [now, setNow] = useState(Date.now()), latest = useRef(workflow), inFlight = useRef(false);
  latest.current = workflow;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const current = snapshot && JSON.stringify(snapshot.review.workflow) === JSON.stringify(workflow);
  const expired = !!snapshot && now >= Date.parse(snapshot.review.route.expiresAt);
  const act = async (action: 'simulate' | 'review' | 'manifest' | 'authorize' | 'execute' | 'recover') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    if (action === 'execute') setAttempted(true);
    const requestedWorkflow = structuredClone(latest.current);
    try {
      const next = action === 'simulate' ? await simulatePrivacyDemo(requestedWorkflow)
        : await advancePrivacyDemo(snapshot!.runId, action, requestedWorkflow, action === 'authorize' && ack ? snapshot!.reviewDigest : null);
      if (JSON.stringify(requestedWorkflow) !== JSON.stringify(latest.current)) throw new Error('CLOAK_LOCAL_REVIEW_INVALIDATED');
      setSnapshot(next); if (action === 'simulate') { setAck(false); setAttempted(false); }
    } catch (e) { setError(e instanceof Error ? e.message : 'CLOAK_DEMO_RECOVERY_REQUIRED'); }
    finally { inFlight.current = false; setBusy(false); setNow(Date.now()); }
  };
  const exportEvidence = () => {
    if (!snapshot || snapshot.phase !== 'RECOVERED' || snapshot.outcome?.state !== 'RECONCILED' || error) return;
    const report = { format: 'flofi.cloak-local-demo-evidence.v1', ...snapshot };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'BUILD-PRIVACY-001-LOCAL-DEMO-evidence.json'; link.click(); URL.revokeObjectURL(url);
  };
  const phase = snapshot?.phase;
  const stopped = busy || !current || expired || !!error;
  return <section className={`panel ${styles.demo}`} aria-label="Privacy local demo">
    <p className={styles.banner}>{label}</p>
    <h2>Private swap · local product demo</h2>
    <p>PRIVACY REQUIRED / CLOAK · SOL → public USDC, with private SOL change.</p>
    <p>Synthetic notes only. No funds, wallet connection, signature, relay or mainnet call. Prices and fees are local fixtures, not market quotes.</p>
    <ol aria-label="Privacy demo sequence">
      <li>Simulate</li><li>Review privacy and amounts</li><li>Manifest</li><li>Explicit local authorization</li><li>Execute and checkpoint</li><li>Restart, recover and reconcile</li>
    </ol>
    {!snapshot && <button disabled={busy} onClick={() => void act('simulate')}>Simulate local privacy swap</button>}
    {snapshot && <>
      <p role="status">Demo state: {phase} · Ledger submissions: {snapshot.submissions} · Wallet signatures: {snapshot.signatureRequests}</p>
      <h3>Privacy policy and simulated amounts</h3>
      <dl>
        {Object.entries({ Input: `${formatTokenAmount(snapshot.review.route.amountIn, 9)} SOL`, Output: 'USDC (public)',
          'Synthetic shielded balance': `${formatTokenAmount(snapshot.review.route.inputTotal, 9)} SOL`,
          'Expected public output': `${formatTokenAmount(snapshot.review.expectedOutput, 6)} USDC`,
          'Minimum public output': `${formatTokenAmount(snapshot.review.minimumOutput, 6)} USDC`,
          'Private SOL change': `${formatTokenAmount(snapshot.review.privateChange, 9)} SOL`,
          Slippage: `${snapshot.review.manifest.maximumSlippageBps} bps`,
          'Included fixture fee': `${formatTokenAmount(snapshot.review.route.feeLamports, 9)} SOL`,
          'Fixture fee ceiling': `${formatTokenAmount(snapshot.review.route.maximumFeeLamports, 9)} SOL`,
          'Privacy provider': snapshot.review.privacy.provider,
          'Encrypted preparation': snapshot.checkpoints.prepared ? 'Saved and authenticated' : 'Missing — execution blocked' }).map(([name, value]) =>
          <div key={name}><dt>{name}</dt><dd style={{ overflowWrap: 'anywhere' }}>{value}</dd></div>)}
      </dl>
      <p>Routing: Cloak local fixture ({snapshot.review.route.routeId}). Live routing: Jupiter via Cloak; exact DEX route is provider-managed and not authorization-bound.</p>
      {!attempted && <p>Review freshness: {expired ? 'Expired. Simulate again before authorization.' : `${Math.max(0, Math.ceil((Date.parse(snapshot.review.route.expiresAt) - now) / 1000))} seconds remaining.`}</p>}
      {phase === 'SIMULATED' && <button disabled={stopped} onClick={() => void act('review')}>Review privacy and simulated amounts</button>}
      {phase === 'REVIEWED' && <><h3>Review complete</h3><p>Required privacy, public output, private change, fee ceiling and slippage are bound to this simulation.</p>
        <button disabled={stopped} onClick={() => void act('manifest')}>Show bound Manifest</button></>}
      {['MANIFEST', 'AUTHORIZED', 'EXECUTED', 'RECOVERED', 'RECOVERY_REQUIRED'].includes(phase!) && <>
        <h3>Manifest authorization</h3>
        <p style={{ overflowWrap: 'anywhere' }}>Manifest hash: {snapshot.reference.manifestHash}</p>
        <p style={{ overflowWrap: 'anywhere' }}>Review digest: {snapshot.reviewDigest}</p>
        <details><summary>Inspect bound artifacts and public recipient</summary>
          <p style={{ overflowWrap: 'anywhere' }}>Simulation hash: {snapshot.review.manifest.simulationHash}</p>
          <p>Public recipient (synthetic): {snapshot.review.route.recipientAta}</p>
          <pre>{JSON.stringify({ simulation: snapshot.review.simulation, policy: snapshot.review.policy, manifest: snapshot.review.manifest }, null, 2)}</pre>
        </details>
        <p>Mode A · fixed Cloak provider · maximum spend {formatTokenAmount(snapshot.review.manifest.spendLimits[0]!.maximumAmount, 9)} SOL · one attempt · pause for approval on uncertainty. This Manifest authorizes only the LOCAL demo; production authorization remains disabled.</p>
        {phase === 'MANIFEST' && <><label><input type="checkbox" checked={ack} disabled={stopped} onChange={e => setAck(e.target.checked)}/>I approve this LOCAL simulation, privacy policy and Manifest.</label>
          <button disabled={stopped || !ack} onClick={() => void act('authorize')}>Authorize LOCAL demo</button></>}
      </>}
      {phase === 'AUTHORIZED' && <><p>Explicit authorization is bound to the reviewed digest. No wallet signature was requested.</p>
        <button disabled={stopped || attempted} onClick={() => void act('execute')}>Execute in LOCAL DEMO</button></>}
      {attempted && <>
        <h3>Encrypted checkpoint and recovery</h3>
        <p>Encrypted intent and input/nonce reservations: {snapshot.checkpoints.intent ? 'committed' : 'not yet verified'}.</p>
        <p>Encrypted result checkpoint: {snapshot.checkpoints.submitted ? 'saved and authenticated' : 'requires inspection'}. Blind retry is forbidden.</p>
        <button disabled={busy || !current} onClick={() => void act('recover')}>Simulate restart &amp; recover</button>
      </>}
      {phase === 'RECOVERED' && snapshot.outcome?.state === 'RECONCILED' && !error && <>
        <h3>RECONCILED — LOCAL / MOCKED</h3>
        <p>Recovery reloaded the encrypted notes and evidence. The existing reconciler verified mocked public USDC output, spent inputs and exact unspent private SOL change. Ledger submissions: {snapshot.submissions}.</p>
        <p>Controller restarts: {snapshot.restarts}. No second execution, new signature or mainnet transaction.</p>
        <button disabled={busy || !current} onClick={exportEvidence}>Export LOCAL demo evidence</button>
      </>}
      {!attempted && expired && <button disabled={busy} onClick={() => void act('simulate')}>Simulate again for a fresh review</button>}
      {!current && <p role="alert">Workflow changed. The previous authorization cannot execute this edit.</p>}
    </>}
    {busy && <p role="status">Checking the LOCAL lifecycle and encrypted checkpoints…</p>}
    {error && <p role="alert">{error}. Execution stays blocked; use recovery after an uncertain attempt.</p>}
    <p>This isolated session keeps encrypted checkpoints and a mocked ledger in server memory. Simulated restart recreates the controller; restarting the server loses the session and cannot trigger resubmission.</p>
    <p>{label}. Production financial execution remains disabled.</p>
    <button className="quiet" disabled={busy} onClick={close}>Close local demo</button>
  </section>;
}
