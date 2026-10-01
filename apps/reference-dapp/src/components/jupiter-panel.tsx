// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { createSolanaSwapNode, formatTokenAmount, solanaSwapDetails, solanaTokens, type SolanaSwapInput } from '../domain/jupiter-authoring';
import type { SolanaTokenSymbol } from '@defi-workflow-engine/action-registry';
import { useWorkflow } from '../state/workflow-store';
import { useJupiter } from '../state/jupiter-store';

export function SolanaSwapForm({ nodeId, onDone, direct = false }: { nodeId?: string; onDone?: () => void; direct?: boolean }) {
  const { state, propose, dispatch } = useWorkflow();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const existing = node ? solanaSwapDetails(node) : null;
  const [input, setInput] = useState<SolanaSwapInput>(existing ?? { network: 'Solana', from: 'USDC', to: 'SOL', amount: '', slippage: '50' });
  const [error, setError] = useState('');
  const set = (patch: Partial<SolanaSwapInput>) => setInput(value => ({ ...value, ...patch }));
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      createSolanaSwapNode(nodeId ?? 'node-preview', input); setError('');
      const command = nodeId ? { type: 'SET_SOLANA_SWAP' as const, nodeId, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision }
        : { type: 'ADD_SOLANA_SWAP' as const, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision };
      if (direct) dispatch(command); else propose(command); onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'SOLANA_SWAP_INPUT_INVALID'); }
  }
  return <form className="inspector-fields" aria-label={nodeId ? 'Edit Solana swap' : 'Create Solana swap'} onSubmit={submit}>
    <label>Solana from token<select aria-label="From token" value={input.from} onChange={e => set({ from: e.target.value as SolanaTokenSymbol })}>{solanaTokens.map(t => <option key={t}>{t}</option>)}</select></label>
    <label>Solana to token<select aria-label="To token" value={input.to} onChange={e => set({ to: e.target.value as SolanaTokenSymbol })}>{solanaTokens.map(t => <option key={t}>{t}</option>)}</select></label>
    <label>Solana amount<input aria-label="Amount" inputMode="decimal" autoComplete="off" maxLength={40} value={input.amount} onChange={e => set({ amount: e.target.value })}/></label>
    <label>Solana slippage (bps)<input aria-label="Slippage (bps)" inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{nodeId ? 'Review swap change' : direct ? 'Add swap' : 'Review swap proposal'}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}

const messages: Record<string, string> = {
  JUPITER_SOLANA_WALLET_REQUIRED: 'Install or unlock a Solana wallet that supports Wallet Standard, then connect it.',
  JUPITER_WALLET_REJECTED: 'You declined the signature request. No transaction was sent.',
  JUPITER_WALLET_SIGN_FAILED: 'The wallet did not return a signed transaction. Nothing was sent.',
  JUPITER_WALLET_NOT_SUBMITTED: 'No signed transaction was returned. Nothing was sent; simulate again to retry.',
  JUPITER_TRANSACTION_CHANGED: 'The wallet returned a different transaction than the one you reviewed. Gryloo did not send it.',
  JUPITER_SIGNATURE_INVALID: 'The returned signature does not belong to the reviewed owner. Gryloo did not send it.',
  JUPITER_QUOTE_STALE: 'This quote has expired. Simulate again for a fresh quote.',
  JUPITER_WRONG_OWNER: 'Select the wallet account shown in Review.',
  JUPITER_SEMANTIC_REVISION_CHANGED: 'The workflow changed. Simulate and review the current swap again.',
  JUPITER_MAINNET_EXECUTION_NOT_ENABLED: 'Mainnet execution is not enabled on this server. Simulation and Review remain read-only.',
  JUPITER_OWNER_ATTEMPT_IN_PROGRESS: 'Another swap from this wallet is still being observed. Wait for it to resolve.',
  JUPITER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING: 'The network did not confirm receipt. Gryloo is observing the signed transaction and will not send another.',
  JUPITER_TRANSACTION_NOT_OBSERVED: 'The transaction is not visible yet. Observe again; Gryloo will not send another.',
  AWAITING_FINALITY: 'Waiting for Solana finality.',
  JUPITER_TRANSACTION_EXPIRED_NOT_EXECUTED: 'The transaction expired without landing. No swap happened; simulate again to retry.',
  JUPITER_SWAP_FAILED: 'The swap failed on chain. Only the network fee was charged.',
  JUPITER_NO_ROUTE: 'Jupiter found no route for this pair and amount.',
  JUPITER_RATE_LIMITED: 'Jupiter is rate limiting requests. Try again shortly.',
  SOLANA_RPC_RATE_LIMITED: 'The Solana network provider is busy. Try again shortly.',
  JUPITER_INSUFFICIENT_SOL: 'Your wallet needs more SOL for this swap and its network fee.',
  JUPITER_WRAPPED_SOL_ACCOUNT_PRESENT: 'Your wallet holds a wrapped SOL account. Unwrap it in your wallet before swapping SOL.',
};
export function JupiterPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { state } = useWorkflow(), jupiter = useJupiter();
  const node = state.workflow.nodes.find(n => solanaSwapDetails(n)), fields = node ? solanaSwapDetails(node) : null;
  const record = jupiter.record, review = record?.review, attempt = record?.attempt;
  const [acknowledged, setAcknowledged] = useState(false), [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const fresh = review ? Math.max(0, Math.round((Date.parse(review.expiresAt) - clock) / 1000)) : 0;
  const amount = (units: string | null | undefined, side: 'input' | 'output') => review && units ? `${formatTokenAmount(units, review[side].decimals)} ${review[side].symbol}` : '--';
  const sol = (lamports: string | null | undefined) => lamports ? `${formatTokenAmount(lamports, 9)} SOL` : '--';
  const mainnet = record?.provenance === 'PUBLIC_MAINNET';
  const canExecute = Boolean(record?.authorization && !jupiter.retired && !attempt && record.verdict === 'PENDING' && fresh > 0 && jupiter.executionEnabled && (!mainnet || acknowledged));
  const observation = record?.observations.at(-1), info = jupiter.error ?? record?.error;
  const pending = Boolean(attempt && record?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(attempt.state));
  return <section className="panel" aria-label="Jupiter swap"><h2>{view === 'simulate' ? 'Simulate swap' : 'Review swap'}</h2>
    <p>Swap {fields ? `${fields.amount} ${fields.from}` : amount(review?.amount, 'input')} to {fields?.to ?? review?.output.symbol} on Solana via Jupiter.</p>
    {jupiter.retired && <p role="alert">The workflow changed. Prior authorization is invalid. Simulate the current swap again.</p>}
    {!jupiter.owner && <button type="button" disabled={jupiter.busy} onClick={() => void jupiter.connect()}>Connect Solana wallet</button>}
    {jupiter.owner && <p>Wallet: <span>{jupiter.owner}</span></p>}
    {view === 'simulate' ? <>
      <button type="button" disabled={jupiter.busy || pending} onClick={() => void jupiter.simulate()}>Simulate swap</button>
      {review && !jupiter.retired && <dl className="swap-summary" aria-label="Swap simulation">
        <dt>Swap</dt><dd>{amount(review.amount, 'input')} → expected {amount(review.quote.outAmount, 'output')}</dd>
        <dt>Network</dt><dd>Solana</dd><dt>Provider</dt><dd>Jupiter</dd>
        <dt>Quoted output</dt><dd>{amount(review.quote.outAmount, 'output')}</dd>
        <dt>Minimum received</dt><dd>{amount(review.quote.otherAmountThreshold, 'output')}</dd>
        <dt>Slippage</dt><dd>{(review.slippageBps / 100).toFixed(2)}%</dd>
        <dt>Estimated network fee</dt><dd>{sol(review.estimatedFeeLamports)}</dd>
        {review.simulationResult.accountCreationLamports !== '0' && <><dt>Token account deposit</dt><dd>{sol(review.simulationResult.accountCreationLamports)} (refundable)</dd></>}
        <dt>Quote freshness</dt><dd>{fresh > 0 ? `Valid for ${fresh}s` : 'Expired — simulate again'}</dd>
      </dl>}
    </> : <>
      {review && <dl className="swap-summary" aria-label="Swap review">
        <dt>Owner</dt><dd>{review.owner}</dd><dt>Pay</dt><dd>{amount(review.amount, 'input')}</dd>
        <dt>Receive at least</dt><dd>{amount(review.quote.otherAmountThreshold, 'output')}</dd>
        <dt>Route</dt><dd>{[...new Set(review.quote.routePlan.map(step => step.label))].join(' → ')}</dd>
        {!attempt && <><dt>Quote freshness</dt><dd>{fresh > 0 ? `Valid for ${fresh}s` : 'Expired'}</dd></>}
      </dl>}
      {mainnet && !attempt && review && <p role="note">This swap uses real funds on Solana mainnet. Your wallet will ask you to sign one exact transaction; Gryloo never signs for you.</p>}
      {record && !record.authorization && !attempt && !jupiter.retired && <button type="button" disabled={jupiter.busy || fresh === 0} onClick={() => void jupiter.review()}>Accept swap review</button>}
      {mainnet && record?.authorization && !attempt && <label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/> I understand this executes on Solana mainnet with real funds</label>}
      {record?.authorization && !attempt && !jupiter.executionEnabled && <p role="status">{messages.JUPITER_MAINNET_EXECUTION_NOT_ENABLED}</p>}
      {canExecute && <button type="button" className="primary" disabled={jupiter.busy} onClick={() => void jupiter.execute()}>Execute swap</button>}
      {attempt && <p>Swap: {attempt.reconciled ? 'Independently verified' : record?.notSubmitted ? 'not submitted' : attempt.state.toLowerCase().replaceAll('_', ' ')} {observation?.explorer && <a href={observation.explorer} target="_blank" rel="noreferrer">View transaction</a>}</p>}
      {pending && <button type="button" disabled={jupiter.busy} onClick={() => void jupiter.observe()}>Observe existing transaction</button>}
      {record?.evidence && observation && <><p>Swap independently reconciled. Paid {amount(observation.inputSpent, 'input')}; received {amount(observation.outputReceived, 'output')}; fee {sol(observation.feeLamports)}.</p>
        <p>Evidence: {record.evidenceClass}</p>
        <a download="gryloo-jupiter-swap-evidence.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>Download Evidence Bundle</a></>}
      {record && attempt && !record.evidence && <a download="gryloo-jupiter-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>Download execution record</a>}
    </>}
    {info && <p role="status">{messages[info] ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.'}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({ error: info, evidenceClass: record?.evidenceClass, submissionError: record?.submissionError, walletDiagnostic: record?.walletDiagnostic,
      cluster: review?.cluster, inputMint: review?.input.mint, outputMint: review?.output.mint, routeCommitment: review?.routeCommitment, messageHash: review?.messageHash,
      blockhash: review?.blockhash, lastValidBlockHeight: review?.lastValidBlockHeight, inspection: review?.inspection, quote: review?.quote,
      simulation: review?.simulationResult, attempt, observations: record?.observations, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
