// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { useWorkflow } from '../state/workflow-store';
import { useTempo } from '../state/tempo-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { createAuthoredTempo } from '../domain/tempo-authoring';
export function TempoAuthoringForm() {
  const { state, propose } = useWorkflow();
  const [amount, setAmount] = useState('1'), [recipient, setRecipient] = useState(''), [memo, setMemo] = useState('0x' + '00'.repeat(32));
  const [maximumFee, setFee] = useState('0.01'), [error, setError] = useState('');
  function submit(e: FormEvent) { e.preventDefault(); try { const input = { amount, recipient, memo, maximumFee }; createAuthoredTempo('node-preview', input);
    propose({ type: 'AUTHOR_TEMPO_PAYMENT', input, source: 'CANVAS', baseRevision: state.workflow.revision }); setError('');
  } catch { setError('Enter up to 10 test pathUSD, an explicit recipient, a 32-byte hex memo, and a fee ceiling up to 0.1 pathUSD.'); } }
  return <form className="inspector-fields" aria-label="Tempo payment" onSubmit={submit}>
    <strong>Stablecoin payment · Tempo Moderato</strong><p>Test pathUSD with an invoice memo. Uses the same workflow, Review and cloud runtime.</p>
    <label>Payment amount (pathUSD)<input value={amount} onChange={e => setAmount(e.target.value)} maxLength={12}/></label>
    <label>Payment recipient<input value={recipient} onChange={e => setRecipient(e.target.value)} maxLength={42}/></label>
    <label>Payment memo (bytes32)<input value={memo} onChange={e => setMemo(e.target.value)} maxLength={66}/></label>
    <label>Maximum fee (pathUSD)<input value={maximumFee} onChange={e => setFee(e.target.value)} maxLength={12}/></label>
    <button type="submit">Review payment proposal</button>{error && <p role="alert">{error}</p>}
  </form>;
}
export function TempoPanel({ view }: { view: 'simulate' | 'execute' }) {
  const run = useTempo(), wallet = useBuild009Wallet(), r = run.record, review = r?.review;
  const [recovery, setRecovery] = useState('');
  return <section className="panel" aria-label="Tempo payment execution">
    <h2>Stablecoin payment · Tempo Moderato</h2><p>One owner-signed TIP-20 payment. Workers observe and reconcile; they cannot spend.</p>
    <p>Wallet must support Tempo type 0x76 through eth_signTransaction and eth_sendRawTransaction. Generic EVM network support alone is insufficient. Unsupported wallets stop before broadcast.</p>
    <button disabled={run.busy} onClick={() => void wallet.connect()}>Connect owner wallet</button>
    <button disabled={run.busy} onClick={() => void wallet.switchTo('0xa5bf')}>Switch to Tempo Moderato</button>
    {view === 'simulate' && <button disabled={run.busy || !!r?.attempt && r.verdict === 'PENDING'} onClick={() => void run.simulate()}>Simulate payment</button>}
    {review && <><dl className="step-facts">
      <div><dt>Run ID</dt><dd>{r.id}</dd></div><div><dt>Network</dt><dd>Tempo Moderato · 42431</dd></div>
      <div><dt>Owner</dt><dd>{review.account}</dd></div><div><dt>Recipient</dt><dd>{review.fields.recipient}</dd></div>
      <div><dt>Token / fee token</dt><dd>pathUSD · {review.fields.token}</dd></div>
      <div><dt>Amount</dt><dd>{review.fields.amount} micro-pathUSD (6 decimals)</dd></div><div><dt>Memo</dt><dd>{review.fields.memo}</dd></div>
      <div><dt>Fee ceiling</dt><dd>{review.feeBudget} micro-pathUSD</dd></div><div><dt>Gas ceiling</dt><dd>{review.gasLimit}</dd></div>
      <div><dt>Fee rate ceiling</dt><dd>{review.maxFeePerGas} attodollars/gas</dd></div><div><dt>Expires on chain</dt><dd>{review.expiresAt}</dd></div>
      <div><dt>Review commitment</dt><dd>{review.commitment}</dd></div></dl>
      <p>Evidence: {r.evidence?.publicExecution.evidenceLevel ?? (r.provenance === 'MOCKED' ? 'MOCKED' : 'PUBLIC_READ_ONLY — no reconciled owner execution')}</p>
      {run.retired && <p role="alert">Workflow or wallet changed. Fresh simulation and Review are required. Existing attempts remain observation-only.</p>}
      {view === 'execute' && <>
        <button disabled={run.busy || run.retired || !!r.attempt || !!r.error} onClick={() => void run.review()}>Accept payment Review</button>
        <button disabled={run.busy || run.retired || !r.authorization || !!r.attempt} onClick={() => void run.execute()}>Authorize payment in owner wallet</button>
        <button disabled={run.busy || !r.attempt || r.verdict !== 'PENDING'} onClick={() => void run.recoverReview()}>Prepare fresh Review after on-chain expiry</button>
        <button disabled={run.busy || !r.attempt} onClick={() => void run.observe()}>Observe existing payment</button>
      </>}
      {r.attempt && <p role="status">{r.verdict} · {r.attempt.state} · {r.attempt.transactionHash ?? 'No broadcast hash recorded'}</p>}
      {r.evidence && <a download="flofi-tempo-evidence.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(r.evidence, null, 2))}>Download Evidence Bundle</a>}
      <details><summary>Manifest and technical details</summary><pre>{JSON.stringify(r, null, 2)}</pre></details>
    </>}
    <label>Resume durable run ID<input value={recovery} onChange={e => setRecovery(e.target.value)} maxLength={38}/></label>
    <button disabled={run.busy || !/^tempo-[0-9a-f]{32}$/.test(recovery)} onClick={() => void run.restore(recovery)}>Load cloud run</button>
    {(run.error || r?.error) && <p role="alert">{run.error || r?.error}</p>}
  </section>;
}
