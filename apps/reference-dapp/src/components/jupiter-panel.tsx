// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState, type FormEvent } from 'react';
import { createSolanaSwapNode, formatTokenAmount, solanaSwapDetails, solanaSwapLabels, solanaTokenLabel, solanaTokensFor, type SolanaNetwork, type SolanaSwapInput,
  type SolanaSwapSymbol } from '../domain/jupiter-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useJupiter } from '../state/jupiter-store';

export function SolanaSwapForm({ nodeId, onDone, direct = false, network: initialNetwork = 'Solana' }: { nodeId?: string; onDone?: () => void; direct?: boolean; network?: SolanaNetwork }) {
  const { t: tr } = useLocale();
  const { state, propose, dispatch } = useWorkflow();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const existing = node ? solanaSwapDetails(node) : null;
  const devnet = (existing?.network ?? initialNetwork) === 'Solana Devnet';
  const [input, setInput] = useState<SolanaSwapInput>(existing ?? (devnet ? { network: 'Solana Devnet', from: 'devUSDC', to: 'SOL', amount: '', slippage: '50' }
    : { network: 'Solana', from: 'USDC', to: 'SOL', amount: '', slippage: '50' }));
  const [error, setError] = useState('');
  const set = (patch: Partial<SolanaSwapInput>) => setInput(value => ({ ...value, ...patch }));
  const tokens = solanaTokensFor(input.network), label = devnet ? 'Solana Devnet' : 'Solana';
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      createSolanaSwapNode(nodeId ?? 'node-preview', input); setError('');
      const command = nodeId ? { type: 'SET_SOLANA_SWAP' as const, nodeId, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision }
        : { type: 'ADD_SOLANA_SWAP' as const, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision };
      if (direct) dispatch(command); else propose(command); onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'SOLANA_SWAP_INPUT_INVALID'); }
  }
  return <form className="inspector-fields" aria-label={tr(nodeId ? `Edit ${label} swap` : `Create ${label} swap`)} onSubmit={submit}>
    <label>{tr(label)}{tr(" from token")}<select aria-label={tr("From token")} value={input.from} onChange={e => set({ from: e.target.value as SolanaSwapSymbol })}>{tokens.map(t => <option key={t} value={t}>{tr(solanaTokenLabel(input.network, t))}</option>)}</select></label>
    <label>{tr(label)}{tr(" to token")}<select aria-label={tr("To token")} value={input.to} onChange={e => set({ to: e.target.value as SolanaSwapSymbol })}>{tokens.map(t => <option key={t} value={t}>{tr(solanaTokenLabel(input.network, t))}</option>)}</select></label>
    <label>{tr(label)}{tr(" amount")}<input aria-label={tr("Amount")} inputMode="decimal" autoComplete="off" maxLength={40} value={input.amount} onChange={e => set({ amount: e.target.value })}/></label>
    <label>{tr(label)}{tr(" slippage (bps)")}<input aria-label={tr("Slippage (bps)")} inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    {devnet && <p className="muted">{tr("Devnet test tokens have no value.")}</p>}
    {error && <p role="alert">{tr(error)}</p>}
    <button type="submit">{tr(nodeId ? 'Review swap change' : direct ? 'Add swap' : 'Review swap proposal')}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>{tr("Cancel")}</button>}
  </form>;
}

/** Messages are keyed by the shared suffix; the runtime prefix (JUPITER_ or DEVNET_SWAP_) only names the runtime. */
const shared: Record<string, string> = {
  SOLANA_WALLET_REQUIRED: 'Install or unlock a Solana wallet that supports Wallet Standard, then connect it.',
  SOLANA_WALLET_SELECTION_REQUIRED: 'Connect a Solana wallet first and choose which wallet to use.',
  SOLANA_WALLET_AMBIGUOUS: 'More than one installed wallet uses that name. Disable the duplicate wallet extension, then choose again.',
  WALLET_REJECTED: 'You declined the signature request. No transaction was sent.',
  WALLET_SIGN_FAILED: 'The wallet did not return a signed transaction. Nothing was sent.',
  WALLET_NOT_SUBMITTED: 'No signed transaction was returned. Nothing was sent; simulate again to retry.',
  TRANSACTION_CHANGED: 'The wallet returned a different transaction than the one you reviewed. Flofi did not send it.',
  SIGNATURE_INVALID: 'The returned signature does not belong to the reviewed owner. Flofi did not send it.',
  QUOTE_STALE: 'This quote has expired. Simulate again for a fresh quote.',
  WRONG_OWNER: 'Select the wallet account shown in Review.',
  WRONG_CLUSTER: 'The wallet and the swap are on different Solana clusters. Nothing was signed.',
  SEMANTIC_REVISION_CHANGED: 'The workflow changed. Simulate and review the current swap again.',
  MAINNET_EXECUTION_NOT_ENABLED: 'Mainnet execution is not enabled on this server. Simulation and Review remain read-only.',
  EXECUTION_NOT_ENABLED: 'Execution is not enabled on this server. Simulation and Review remain read-only.',
  OWNER_ATTEMPT_IN_PROGRESS: 'Another swap from this wallet is still being observed. Wait for it to resolve.',
  SUBMISSION_UNKNOWN_OBSERVE_EXISTING: 'The network did not confirm receipt. Flofi is observing the signed transaction and will not send another.',
  TRANSACTION_NOT_OBSERVED: 'The transaction is not visible yet. Observe again; Flofi will not send another.',
  AWAITING_FINALITY: 'Waiting for Solana finality.',
  TRANSACTION_EXPIRED_NOT_EXECUTED: 'The transaction expired without landing. No swap happened; simulate again to retry.',
  SWAP_FAILED: 'The swap failed on chain. Only the network fee was charged.',
  NO_ROUTE: 'Jupiter found no route for this pair and amount.',
  RATE_LIMITED: 'Jupiter is rate limiting requests. Try again shortly.',
  SOLANA_RPC_RATE_LIMITED: 'The Solana network provider is busy. Try again shortly.',
  WRAPPED_SOL_ACCOUNT_PRESENT: 'Your wallet holds a wrapped SOL account. Unwrap it in your wallet before swapping SOL.',
  SOLANA_WRONG_CLUSTER: 'The Solana network provider is not on the expected cluster. Nothing was simulated or sent.',
};
const devnetMessages: Record<string, string> = {
  INSUFFICIENT_SOL: 'Your wallet needs more Devnet SOL for this swap and its network fee. Get free Devnet SOL at faucet.solana.com.',
  INSUFFICIENT_DEVUSDC: 'Your wallet needs more devUSDC (test). Swap Devnet SOL to devUSDC first.',
  STORAGE_NOT_CONFIGURED: 'Solana Devnet execution storage is not configured on this server (GRYLOO_SOLANA_DEVNET_JOURNAL).',
  AMOUNT_TOO_SMALL: 'This amount is too small for the Devnet pool to return a positive minimum.',
  ORCA_POOL_MISMATCH: 'The Orca Devnet pool does not match the verified profile. Nothing was simulated.',
  ORCA_POOL_NO_LIQUIDITY: 'The Orca Devnet pool has no liquidity right now.',
};
const mainnetMessages: Record<string, string> = { INSUFFICIENT_SOL: 'Your wallet needs more SOL for this swap and its network fee.' };
function message(code: string | null | undefined, devnet: boolean): string | null {
  if (!code) return null;
  const suffix = code.replace(/^(JUPITER|DEVNET_SWAP)_/, '');
  return (devnet ? devnetMessages : mainnetMessages)[suffix] ?? (devnet ? devnetMessages[code] : undefined) ?? shared[suffix] ?? shared[code] ?? null;
}
export function JupiterPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const { state } = useWorkflow(), jupiter = useJupiter();
  const node = state.workflow.nodes.find(n => solanaSwapDetails(n)), fields = node ? solanaSwapDetails(node) : null;
  const record = jupiter.record, review = record?.review, attempt = record?.attempt;
  const devnet = jupiter.network === 'Solana Devnet', labels = solanaSwapLabels(jupiter.network);
  const [acknowledged, setAcknowledged] = useState(false), [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const fresh = review ? Math.max(0, Math.round((Date.parse(review.expiresAt) - clock) / 1000)) : 0;
  const symbol = (side: 'input' | 'output') => review ? devnet ? solanaTokenLabel('Solana Devnet', review[side].symbol) : review[side].symbol : '';
  const amount = (units: string | null | undefined, side: 'input' | 'output') => review && units ? `${formatTokenAmount(units, review[side].decimals)} ${symbol(side)}` : '--';
  const sol = (lamports: string | null | undefined) => lamports ? `${formatTokenAmount(lamports, 9)} ${devnet ? 'Devnet SOL' : 'SOL'}` : '--';
  const mainnet = record?.provenance === 'PUBLIC_MAINNET';
  const canExecute = Boolean(record?.authorization && !jupiter.retired && !attempt && record.verdict === 'PENDING' && fresh > 0 && jupiter.executionEnabled && (!mainnet || acknowledged));
  const observation = record?.observations.at(-1), info = jupiter.error ?? record?.error;
  const pending = Boolean(attempt && record?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(attempt.state));
  const notEnabled = devnet ? 'DEVNET_SWAP_EXECUTION_NOT_ENABLED' : 'JUPITER_MAINNET_EXECUTION_NOT_ENABLED';
  const fromLabel = fields ? devnet ? solanaTokenLabel('Solana Devnet', fields.from) : fields.from : null, toLabel = fields ? devnet ? solanaTokenLabel('Solana Devnet', fields.to) : fields.to : null;
  return <section className="panel" aria-label={tr(devnet ? 'Solana Devnet swap' : 'Jupiter swap')}><h2>{tr(view === 'simulate' ? 'Simulate swap' : 'Review swap')}</h2>
    <p>{tr("Swap ")}{tr(fields ? `${fields.amount} ${fromLabel}` : amount(review?.amount, 'input'))}{tr(" to ")}{tr(toLabel ?? symbol('output'))}{tr(" on ")}{tr(labels.network)}{tr(" via ")}{tr(labels.provider)}.</p>
    {devnet && <p role="note">{tr("Solana Devnet test tokens only. They have no value, and no real funds are used.")}</p>}
    {jupiter.retired && <p role="alert">{tr("The workflow changed. Prior authorization is invalid. Simulate the current swap again.")}</p>}
    {!jupiter.owner && <button type="button" disabled={jupiter.busy} onClick={() => void jupiter.connect()}>{tr("Connect Solana wallet")}</button>}
    {jupiter.owner && <p>{tr("Wallet connected")}{tr(devnet ? ' · Solana Devnet' : '')}: <span>{tr(jupiter.owner)}</span></p>}
    {view === 'simulate' ? <>
      <button type="button" disabled={jupiter.busy || pending} onClick={() => void jupiter.simulate()}>{tr("Simulate swap")}</button>
      {review && !jupiter.retired && <dl className="swap-summary" aria-label={tr("Swap simulation")}>
        <dt>{tr("Swap")}</dt><dd>{tr(amount(review.amount, 'input'))}{tr(" → expected ")}{tr(amount(review.quote.outAmount, 'output'))}</dd>
        <dt>{tr("Network")}</dt><dd>{tr(labels.network)}</dd><dt>{tr("Provider")}</dt><dd>{tr(labels.provider)}</dd>
        <dt>{tr(devnet ? 'Expected output' : 'Quoted output')}</dt><dd>{tr(amount(review.quote.outAmount, 'output'))}</dd>
        <dt>{tr("Minimum received")}</dt><dd>{tr(amount(review.quote.otherAmountThreshold, 'output'))}</dd>
        <dt>{tr("Slippage")}</dt><dd>{tr((review.slippageBps / 100).toFixed(2))}%</dd>
        <dt>{tr("Estimated network fee")}</dt><dd>{tr(sol(review.estimatedFeeLamports))}</dd>
        {review.simulationResult.accountCreationLamports !== '0' && <><dt>{tr("Token account deposit")}</dt><dd>{tr(sol(review.simulationResult.accountCreationLamports))}{tr(" (refundable)")}</dd></>}
        <dt>{tr("Quote freshness")}</dt><dd>{tr(fresh > 0 ? `Valid for ${fresh}s` : 'Expired — simulate again')}</dd>
      </dl>}
    </> : <>
      {review && <dl className="swap-summary" aria-label={tr("Swap review")}>
        <dt>{tr("Owner")}</dt><dd>{tr(review.owner)}</dd><dt>{tr("Network")}</dt><dd>{tr(labels.network)}</dd><dt>{tr("Pay")}</dt><dd>{tr(amount(review.amount, 'input'))}</dd>
        <dt>{tr("Receive at least")}</dt><dd>{tr(amount(review.quote.otherAmountThreshold, 'output'))}</dd>
        <dt>{tr("Route")}</dt><dd>{tr([...new Set(review.quote.routePlan.map(step => step.label))].join(' → '))}</dd>
        {!attempt && <><dt>{tr("Quote freshness")}</dt><dd>{tr(fresh > 0 ? `Valid for ${fresh}s` : 'Expired')}</dd></>}
      </dl>}
      {mainnet && !attempt && review && <p role="note">{tr("This swap uses real funds on Solana mainnet. Your wallet will ask you to sign one exact transaction; Flofi never signs for you.")}</p>}
      {devnet && !attempt && review && <p role="note">{tr("Your wallet will ask you to sign one exact Solana Devnet transaction; Flofi never signs for you.")}</p>}
      {record && !record.authorization && !attempt && !jupiter.retired && <button type="button" disabled={jupiter.busy || fresh === 0} onClick={() => void jupiter.review()}>{tr("Accept swap review")}</button>}
      {mainnet && record?.authorization && !attempt && <label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>{tr(" I understand this executes on Solana mainnet with real funds")}</label>}
      {record?.authorization && !attempt && !jupiter.executionEnabled && <p role="status">{tr(message(notEnabled, devnet))}</p>}
      {canExecute && <button type="button" className="primary" disabled={jupiter.busy} onClick={() => void jupiter.execute()}>{tr("Execute swap")}</button>}
      {attempt && !record?.evidence && <p>{tr("Swap: ")}{tr(record?.notSubmitted ? 'not submitted' : attempt.state.toLowerCase().replaceAll('_', ' '))} {observation?.explorer && <a href={observation.explorer} target="_blank" rel="noreferrer">{tr("View transaction")}</a>}</p>}
      {pending && <button type="button" disabled={jupiter.busy} onClick={() => void jupiter.observe()}>{tr("Observe existing transaction")}</button>}
      {record?.evidence && observation && <section aria-label={tr("Swap result")} className="swap-result">
        <h3>{tr("Success")}</h3>
        <p>{tr("Swap independently reconciled. Paid ")}{tr(amount(observation.inputSpent, 'input'))}{tr("; received ")}{tr(amount(observation.outputReceived, 'output'))}{tr("; fee ")}{tr(sol(observation.feeLamports))}.</p>
        <dl className="swap-summary"><dt>{tr("Transaction")}</dt><dd><code>{tr(observation.signature)}</code></dd>
          {observation.explorer && <><dt>{tr("Explorer")}</dt><dd><a href={observation.explorer} target="_blank" rel="noreferrer">{tr(devnet ? 'View on Solana Explorer (Devnet)' : 'View transaction')}</a></dd></>}
          <dt>{tr("Network")}</dt><dd>{tr(labels.network)}</dd><dt>{tr("Slot")}</dt><dd>{tr(observation.slot ?? '--')}</dd></dl>
        <p>{tr("Evidence: ")}{tr(record.evidenceClass)}</p>
        <a download={devnet ? 'flofi-solana-devnet-swap-evidence.json' : 'flofi-jupiter-swap-evidence.json'} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>{tr("Download Evidence Bundle")}</a></section>}
      {record && attempt && !record.evidence && <a download={devnet ? 'flofi-solana-devnet-execution-record.json' : 'flofi-jupiter-execution-record.json'} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>{tr("Download execution record")}</a>}
    </>}
    {info && <p role="status">{tr(message(info, devnet) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.')}</p>}
    <details><summary>{tr("Show technical details")}</summary><pre>{JSON.stringify({ error: info, evidenceClass: record?.evidenceClass, submissionError: record?.submissionError, walletDiagnostic: record?.walletDiagnostic,
      cluster: review?.cluster, provider: labels.provider, inputMint: review?.input.mint, outputMint: review?.output.mint, routeCommitment: review?.routeCommitment, messageHash: review?.messageHash,
      blockhash: review?.blockhash, lastValidBlockHeight: review?.lastValidBlockHeight, inspection: review?.inspection, quote: review?.quote,
      simulation: review?.simulationResult, attempt, observations: record?.observations, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
