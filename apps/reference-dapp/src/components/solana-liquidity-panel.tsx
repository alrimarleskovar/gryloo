// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState, type FormEvent } from 'react';
import { createSolanaLiquidityNode, solanaLiquidityDetails, solanaLiquidityInputOf, SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE, type SolanaLiquidityInput } from '../domain/solana-liquidity-authoring';
import { poolPriceBounds, usePoolPriceRange } from './pool-price-range';
import { usePoolContributionInputs } from './canvas-card-inputs';
import { TokenAmountInput } from './token-amount-input';
import { formatTokenAmount } from '../domain/jupiter-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useJupiter } from '../state/jupiter-store';
import { useSolanaLiquidity, type LiquidityOperation } from '../state/solana-liquidity-store';

/** Canvas form for the canonical concentrated-liquidity node on Solana Devnet (Orca Whirlpools, SOL / devUSDC test pool). */
export function SolanaLiquidityForm({ nodeId, onDone, reviewFormId }: { nodeId?: string; onDone?: () => void; reviewFormId?: string }) {
  const { t: tr } = useLocale();
  const { state, propose } = useWorkflow(), liquidity = useSolanaLiquidity();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const range = usePoolPriceRange(nodeId);
  const contributions = usePoolContributionInputs(nodeId);

  const existing = node ? solanaLiquidityDetails(node) : null;
  const [input, setInput] = useState<SolanaLiquidityInput>(existing ? solanaLiquidityInputOf(existing)
    : { network: 'Solana Devnet', maxSol: '', maxDevUsdc: '', rangeUnit: 'PRICE', lower: '', upper: '', slippage: SOLANA_LIQUIDITY_DEFAULT_SLIPPAGE });
  const [error, setError] = useState('');
  const contributionInput = contributions.values ? { ...input, maxSol: contributions.values[0]!.amount, maxDevUsdc: contributions.values[1]!.amount } : input;
  const set = (patch: Partial<SolanaLiquidityInput>) => {
    if (patch.maxSol !== undefined) contributions.edit(0, patch.maxSol);
    if (patch.maxDevUsdc !== undefined) contributions.edit(1, patch.maxDevUsdc);
    const editsRange = patch.lower !== undefined || patch.upper !== undefined || patch.rangeUnit !== undefined;
    if (editsRange) range.reset();
    setInput({ ...(editsRange ? effectiveInput : contributionInput), ...patch });
  };
  async function band() {
    const price = await liquidity.fetchPrice();
    if (price) set({ rangeUnit: 'PRICE', lower: price.lowerPrice, upper: price.upperPrice });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const reviewedInput = range.edited ? { ...contributionInput, ...poolPriceBounds(range.reference, range.percent, range.preset) } : contributionInput;
      createSolanaLiquidityNode(nodeId ?? 'node-preview', reviewedInput); setError('');
      propose(nodeId ? { type: 'SET_SOLANA_LIQUIDITY', nodeId, input: reviewedInput, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_SOLANA_LIQUIDITY', input: reviewedInput, source: 'CANVAS', baseRevision: state.workflow.revision });
      if (range.edited) range.markReviewed();
      onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'SOLANA_LIQUIDITY_INPUT_INVALID'); }
  }
  let effectiveInput = contributionInput;
  if (range.edited && range.reference) {
    try { effectiveInput = { ...contributionInput, ...poolPriceBounds(range.reference, range.percent, range.preset) }; } catch { /* submit reports the existing validation failure */ }
  }
  const unit = effectiveInput.rangeUnit === 'PRICE' ? 'price (devUSDC per SOL)' : 'tick';
  return <form id={reviewFormId} className="inspector-fields" aria-label={tr(nodeId ? 'Edit Solana Devnet liquidity position' : 'Create Solana Devnet liquidity position')} onSubmit={submit}>
    <p className="muted">{tr("Orca Whirlpools · Devnet SOL / devUSDC (test) · fee 0.20% · tick spacing 64. Maxima are limits, not amounts to spend.")}</p>
    <label>{tr("Maximum Devnet SOL")}<TokenAmountInput aria-label={tr("Maximum SOL")} maxLength={40} value={contributionInput.maxSol} onValueChange={maxSol => set({ maxSol })}/></label>
    <label>{tr("Maximum devUSDC (test)")}<TokenAmountInput aria-label={tr("Maximum devUSDC")} maxLength={40} value={contributionInput.maxDevUsdc} onValueChange={maxDevUsdc => set({ maxDevUsdc })}/></label>
    <label>{tr("Lower ")}{tr(unit)}<input aria-label={tr("Lower bound")} inputMode="decimal" autoComplete="off" maxLength={40} value={effectiveInput.lower} onChange={e => set({ lower: e.target.value })}/></label>
    <label>{tr("Upper ")}{tr(unit)}<input aria-label={tr("Upper bound")} inputMode="decimal" autoComplete="off" maxLength={40} value={effectiveInput.upper} onChange={e => set({ upper: e.target.value })}/></label>
    <button type="button" className="quiet" disabled={liquidity.busy} onClick={() => void band()}>{tr("Use ±10% around the current Devnet price")}</button>
    {liquidity.price && <small>{tr("Current pool price ")}{tr(liquidity.price.price)}{tr(" devUSDC per SOL (tick ")}{tr(liquidity.price.tickCurrentIndex)}{tr(", slot ")}{tr(liquidity.price.slot)}{tr("). The range is aligned outward to usable ticks.")}</small>}
    <label>{tr("Slippage (bps)")}<input aria-label={tr("Liquidity slippage (bps)")} inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    <p className="muted">{tr("Devnet test tokens have no value. The position belongs to your connected wallet.")}</p>
    {error && <p role="alert">{tr(error)}</p>}
    {!reviewFormId && <button type="submit">{tr(nodeId ? 'Review position change' : 'Review position proposal')}</button>}
    {onDone && <button type="button" className="quiet" onClick={onDone}>{tr("Cancel")}</button>}
  </form>;
}

const messages: Record<string, string> = {
  SOLANA_WALLET_SELECTION_REQUIRED: 'Connect a Solana wallet for Solana Devnet first.',
  WALLET_REJECTED: 'You declined the signature request. No transaction was sent.',
  WALLET_SIGN_FAILED: 'The wallet did not return a signed transaction. Nothing was sent.',
  WALLET_NOT_SUBMITTED: 'No signed transaction was returned. Nothing was sent; simulate again to retry.',
  TRANSACTION_CHANGED: 'The wallet returned a different transaction than the one you reviewed. Flofi did not send it.',
  SIGNATURE_INVALID: 'The returned signature does not belong to the reviewed owner. Flofi did not send it.',
  POSITION_SIGNATURE_INVALID: 'The position-mint signature is invalid. Flofi did not send it.',
  POSITION_KEY_UNAVAILABLE: 'This browser tab no longer holds the one-time position key for this review (for example after a reload). Simulate again; nothing was sent.',
  REVIEW_STALE: 'This review has expired. Simulate again for fresh pool state.',
  WRONG_OWNER: 'Select the wallet account shown in Review.',
  SEMANTIC_REVISION_CHANGED: 'The workflow changed. Simulate and review the current position again.',
  EXECUTION_NOT_ENABLED: 'Execution is not enabled on this server. Simulation and Review remain read-only.',
  OWNER_ATTEMPT_IN_PROGRESS: 'Another position transaction from this wallet is still being observed. Wait for it to resolve.',
  POSITION_ALREADY_OPEN: 'You already have a Flofi position on this pool. Manage it below instead of opening another.',
  OPEN_UNRESOLVED: 'The position-opening transaction is still being observed. Observe it first.',
  SUBMISSION_UNKNOWN_OBSERVE_EXISTING: 'The network did not confirm receipt. Flofi is observing the signed transaction and will not send another.',
  TRANSACTION_NOT_OBSERVED: 'The transaction is not visible yet. Observe again; Flofi will not send another.',
  TRANSACTION_EXPIRED_NOT_EXECUTED: 'The transaction expired without landing. Nothing changed; simulate again to retry.',
  TRANSACTION_FAILED: 'The transaction failed on chain. Only the network fee was charged.',
  INSUFFICIENT_DEVUSDC: 'Your wallet needs more devUSDC (test). Swap Devnet SOL to devUSDC first.',
  WRAPPED_SOL_ACCOUNT_PRESENT: 'Your wallet holds a wrapped SOL account. Unwrap it in your wallet first.',
  STORAGE_NOT_CONFIGURED: 'Solana Devnet execution storage is not configured on this server (GRYLOO_SOLANA_DEVNET_JOURNAL).',
  ORCA_LIQUIDITY_ZERO: 'These maxima and this range give zero liquidity. Increase a maximum or move the range.',
  ORCA_LIQUIDITY_SIMULATION_FAILED: 'The Devnet simulation of this exact transaction failed. Nothing was signed.',
  ORCA_POSITION_AUTHORITY_MISMATCH: 'The connected wallet is not the position authority. Nothing was simulated.',
  ORCA_POSITION_RANGE_MISMATCH: 'This position has a different range than the workflow. Edit the workflow to match it.',
  ORCA_POOL_MISMATCH: 'The Orca Devnet pool does not match the verified profile. Nothing was simulated.',
  ORCA_TICK_ARRAY_UNINITIALIZED: 'This range needs tick arrays that are not initialized on the pool. Choose a range closer to the price.',
  SOLANA_WRONG_CLUSTER: 'The Solana network provider is not on Solana Devnet. Nothing was simulated or sent.',
  SOLANA_RPC_RATE_LIMITED: 'The Solana network provider is busy. Try again shortly.',
};
const message = (code: string | null | undefined) => !code ? null : messages[code.replace(/^ORCA_LIQUIDITY_/, '')] ?? messages[code] ?? null;
const sol = (lamports: string | null | undefined) => lamports ? `${formatTokenAmount(lamports, 9)} Devnet SOL` : '--';
const usdc = (units: string | null | undefined) => units ? `${formatTokenAmount(units, 6)} devUSDC` : '--';
const labels: Record<LiquidityOperation, string> = { OPEN: 'Open position and add liquidity', DECREASE_PARTIAL: 'Partially remove liquidity and collect fees',
  EXIT: 'Remove all liquidity, collect fees and close the position' };

export function SolanaLiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const { state } = useWorkflow(), jupiter = useJupiter(), liquidity = useSolanaLiquidity();
  const node = state.workflow.nodes.find(n => solanaLiquidityDetails(n)), fields = node ? solanaLiquidityDetails(node) : null;
  const record = liquidity.record, review = record?.review, attempt = record?.attempt, sim = review?.simulationResult;
  const active = liquidity.positions?.find(p => ['ACTIVE', 'EMPTY', 'OPEN_PENDING'].includes(p.status)) ?? null;
  const [operation, setOperation] = useState<LiquidityOperation>('OPEN'), [part, setPart] = useState('5000'), [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setOperation(active && active.status !== 'OPEN_PENDING' ? 'DECREASE_PARTIAL' : 'OPEN'); }, [active?.positionMint, active?.status]);
  const fresh = review ? Math.max(0, Math.round((Date.parse(review.expiresAt) - clock) / 1000)) : 0;
  const pending = Boolean(attempt && record?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(attempt.state));
  const canExecute = Boolean(record?.authorization && !liquidity.retired && !attempt && record.verdict === 'PENDING' && fresh > 0 && liquidity.executionEnabled);
  const observation = record?.observations.at(-1), info = liquidity.error ?? record?.error, effects = observation?.effects;
  const created = review?.accounts.mayBeCreated ?? [];
  return <section className="panel" aria-label={tr("Solana Devnet liquidity")}><h2>{tr(view === 'simulate' ? 'Simulate liquidity position' : 'Review liquidity position')}</h2>
    {fields && <p>{tr("Concentrated liquidity on Solana Devnet via Orca Whirlpools: up to ")}{tr(fields.maxSol)}{tr(" Devnet SOL and ")}{tr(fields.maxDevUsdc)}{tr(" devUSDC between ")}{tr(fields.lowerPrice)}{tr(" and ")}{tr(fields.upperPrice)}{tr(" devUSDC per SOL.")}</p>}
    <p role="note">{tr("Solana Devnet test tokens only. They have no value, and no real funds are used.")}</p>
    {liquidity.retired && <p role="alert">{tr("The workflow changed. Prior authorization is invalid. Simulate the current position again.")}</p>}
    {!liquidity.owner && <button type="button" disabled={jupiter.busy} onClick={() => void jupiter.connect('solana:devnet')}>{tr("Connect Solana wallet")}</button>}
    {liquidity.owner && <p>{tr("Wallet connected · Solana Devnet: ")}<span>{tr(liquidity.owner)}</span></p>}
    {jupiter.error && !liquidity.owner && <p role="status">{tr(jupiter.error)}</p>}
    {liquidity.positions && <section aria-label={tr("Your Flofi positions")}><h3>{tr("Your Flofi positions on this pool")}</h3>
      {liquidity.positions.length === 0 ? <p className="muted">{tr("None yet.")}</p> : <ul>{liquidity.positions.map(p => <li key={p.positionMint}>
        <code>{tr(p.positionMint)}</code> · {tr(p.status.toLowerCase().replaceAll('_', ' '))}{tr(p.liquidity !== null ? ` · liquidity ${p.liquidity}` : '')}
        {tr(p.feeOwedA !== null ? ` · recorded fees owed ${sol(p.feeOwedA)} / ${usdc(p.feeOwedB)}` : '')}
        {tr(' · ')}{tr(p.runs.map(r => `${r.operation.toLowerCase().replaceAll('_', ' ')}: ${(r.state ?? 'not started').toLowerCase().replaceAll('_', ' ')}`).join(' → '))}
      </li>)}</ul>}
      <p className="muted">{tr("Recorded fees owed update only when the position is modified; collection may include more. Principal returned by a removal is never counted as fees.")}</p>
      <button type="button" className="quiet" disabled={liquidity.busy || !liquidity.owner} onClick={() => void liquidity.refreshPositions()}>{tr("Inspect positions")}</button></section>}
    {view === 'simulate' ? <>
      <div role="group" aria-label={tr("Liquidity operation")}>
        <label htmlFor="orca-operation">{tr("Operation")}</label>
        <select id="orca-operation" value={operation} onChange={e => setOperation(e.target.value as LiquidityOperation)}>
          {(['OPEN', 'DECREASE_PARTIAL', 'EXIT'] as const).filter(op => op === 'OPEN' ? !active : Boolean(active && active.status !== 'OPEN_PENDING'))
            .map(op => <option key={op} value={op}>{tr(labels[op])}</option>)}
        </select>
        {operation === 'DECREASE_PARTIAL' && <label>{tr("Portion to remove (basis points, 1–9999)")}<input aria-label={tr("Portion to remove (bps)")} inputMode="numeric" maxLength={4} value={part} onChange={e => setPart(e.target.value)}/></label>}
      </div>
      <button type="button" disabled={liquidity.busy || pending || !liquidity.owner} onClick={() => void liquidity.simulate(operation, operation === 'OPEN' ? undefined : active?.positionMint,
        operation === 'DECREASE_PARTIAL' ? Number(part) : undefined)}>{tr("Simulate ")}{tr(operation === 'OPEN' ? 'position' : 'removal')}</button>
      {review && sim && !liquidity.retired && <dl className="swap-summary" aria-label={tr("Liquidity simulation")}>
        <dt>{tr("Operation")}</dt><dd>{tr(labels[review.operation])}{tr(" (1 transaction; the full lifecycle is open, partial removal, then exit)")}</dd>
        <dt>{tr("Network")}</dt><dd>{tr("Solana Devnet (genesis ")}{tr(review.genesisHash)})</dd><dt>{tr("Provider")}</dt><dd>{tr("Orca Whirlpools · program ")}<code>{tr(review.program)}</code></dd>
        <dt>{tr("Pool")}</dt><dd><code>{review.pool.address}</code>{tr(" · config ")}<code>{tr(review.whirlpoolsConfig)}</code></dd>
        <dt>{tr("Token mints")}</dt><dd>{tr("Devnet SOL ")}<code>{tr(review.token0.mint)}</code>{tr(" / devUSDC (test) ")}<code>{tr(review.token1.mint)}</code></dd>
        <dt>{tr("Pool price")}</dt><dd>{tr(review.pool.price)}{tr(" devUSDC per SOL · current tick ")}{tr(review.pool.tickCurrentIndex)}{tr(" · tick spacing ")}{tr(review.pool.tickSpacing)}{tr(" · fee ")}{tr(review.pool.feeRate / 10_000)}{tr("% · slot ")}{tr(review.pool.slot)}</dd>
        <dt>{tr("Range")}</dt><dd>{tr(review.range.lowerPrice)}–{tr(review.range.upperPrice)}{tr(" devUSDC per SOL · aligned ticks ")}{tr(review.range.tickLower)}{tr(" to ")}{tr(review.range.tickUpper)} · {tr(review.range.state.toLowerCase().replace('_', ' '))}</dd>
        <dt>{tr("Maximum inputs")}</dt><dd>{tr(sol(review.intent.amount0Max))} · {tr(usdc(review.intent.amount1Max))}</dd>
        {review.operation === 'OPEN' ? <>
          <dt>{tr("Expected contribution")}</dt><dd>{tr(sol(review.expected.amountA))} + {tr(usdc(review.expected.amountB))}{tr(" (simulated, not executed)")}</dd>
          <dt>{tr("Expected liquidity")}</dt><dd>{tr(review.expected.liquidity)}</dd>
          <dt>{tr("Slippage bounds")}</dt><dd>{tr(review.intent.slippageBps)}{tr(" bps → at most ")}{tr(sol(review.operationPlan.tokenA))}{tr(" and ")}{tr(usdc(review.operationPlan.tokenB))}{tr(", never above your maxima")}</dd>
          <dt>{tr("Expected residual")}</dt><dd>{tr(sol(sim.residualTokenA))}{tr(" not deposited (stays in your wallet) · devUSDC balance after ")}{tr(usdc(sim.residualTokenB))}</dd>
        </> : <>
          <dt>{tr("Liquidity removed")}</dt><dd>{tr(review.expected.liquidity)}{tr(" of the position (remaining ")}{tr(review.expected.positionLiquidityAfter)})</dd>
          <dt>{tr("Expected principal returned")}</dt><dd>{tr(sol(review.expected.amountA))} + {tr(usdc(review.expected.amountB))}{tr("; minimum ")}{tr(sol(review.operationPlan.tokenA))} + {tr(usdc(review.operationPlan.tokenB))} ({tr(review.intent.slippageBps)}{tr(" bps)")}</dd>
          <dt>{tr("Fees collected (simulated)")}</dt><dd>{tr(sol(sim.collectedFeesA))} + {tr(usdc(sim.collectedFeesB))}{tr(" (separate from principal)")}</dd>
        </>}
        <dt>{tr("Owner balances")}</dt><dd>{tr(sol(review.ownerBalances.lamports))} · {tr(usdc(review.ownerBalances.tokenB ?? '0'))}</dd>
        <dt>{tr("Token accounts")}</dt><dd>{tr("wrapped SOL (temporary, closed in the same transaction) ")}<code>{tr(review.accounts.ownerTokenA)}</code>{tr(" · devUSDC ")}<code>{tr(review.accounts.ownerTokenB)}</code>{tr(" · position token (Token-2022) ")}<code>{tr(review.accounts.positionTokenAccount)}</code></dd>
        <dt>{tr("Position")}</dt><dd>{tr(review.operation === 'OPEN' ? 'new' : 'existing')}{tr(" position mint ")}<code>{tr(review.accounts.positionMint)}</code>{tr(" · position account ")}<code>{tr(review.accounts.position)}</code>{tr(" · owner: your wallet")}</dd>
        <dt>{tr("Accounts that may be created")}</dt><dd>{created.length ? created.map(a => <code key={a}>{tr(a)} </code>) : 'none'}</dd>
        <dt>{tr("Estimated network fee")}</dt><dd>{tr(sol(review.estimatedFeeLamports))} ({tr(review.signers.length)}{tr(" signature")}{tr(review.signers.length > 1 ? 's' : '')})</dd>
        <dt>{tr("Account deposits")}</dt><dd>{tr(review.operation === 'OPEN' ? `${sol(sim.rentPaidLamports)} refundable when the position is closed` : sim.rentRefundedLamports !== '0' ? `${sol(sim.rentRefundedLamports)} refunded on close` : 'none')}</dd>
        <dt>{tr("Programs")}</dt><dd>{review.programs.map(p => <code key={p}>{tr(p)} </code>)}</dd>
        <dt>{tr("Review freshness")}</dt><dd>{tr(fresh > 0 ? `Valid for ${fresh}s` : 'Expired — simulate again')}</dd>
      </dl>}
    </> : <>
      {review && <dl className="swap-summary" aria-label={tr("Liquidity review")}>
        <dt>{tr("Owner and position authority")}</dt><dd>{tr(review.owner)}</dd><dt>{tr("Operation")}</dt><dd>{tr(labels[review.operation])}</dd>
        <dt>{tr("Range")}</dt><dd>{tr("ticks ")}{tr(review.range.tickLower)}{tr(" to ")}{tr(review.range.tickUpper)} ({tr(review.range.lowerPrice)}–{tr(review.range.upperPrice)}{tr(" devUSDC per SOL)")}</dd>
        <dt>{tr(review.operation === 'OPEN' ? 'Deposit at most' : 'Receive at least')}</dt><dd>{tr(sol(review.operationPlan.tokenA))} + {tr(usdc(review.operationPlan.tokenB))}{tr(" · liquidity ")}{tr(review.operationPlan.liquidityDelta)}</dd>
        <dt>{tr("Signers")}</dt><dd>{review.signers.length === 2 ? <>{tr("your wallet, then a one-time position-mint key created in this browser (")}<code>{tr(review.signers[1])}</code>{tr("; no authority after creation)")}</> : 'your wallet only'}</dd>
        <dt>{tr("Exact message")}</dt><dd><code>{tr(review.messageHash)}</code>{tr(" · blockhash ")}<code>{tr(review.blockhash)}</code>{tr(" · valid to block height ")}{tr(review.lastValidBlockHeight)}</dd>
        {!attempt && <><dt>{tr("Review freshness")}</dt><dd>{tr(fresh > 0 ? `Valid for ${fresh}s` : 'Expired')}</dd></>}
      </dl>}
      {review && !attempt && <p role="note">{tr("Your wallet will ask you to sign one exact Solana Devnet transaction; Flofi never signs for you.")}</p>}
      {record && !record.authorization && !attempt && !liquidity.retired && <button type="button" disabled={liquidity.busy || fresh === 0} onClick={() => void liquidity.review()}>{tr("Accept liquidity review")}</button>}
      {record?.authorization && !attempt && !liquidity.executionEnabled && <p role="status">{tr(message('ORCA_LIQUIDITY_EXECUTION_NOT_ENABLED'))}</p>}
      {canExecute && <button type="button" className="primary" disabled={liquidity.busy} onClick={() => void liquidity.execute()}>{tr("Execute ")}{tr(review?.operation === 'OPEN' ? 'position' : 'removal')}</button>}
      {attempt && !record?.evidence && <p>{tr("Transaction: ")}{tr(record?.notSubmitted ? 'not submitted' : attempt.state.toLowerCase().replaceAll('_', ' '))} {observation?.explorer && <a href={observation.explorer} target="_blank" rel="noreferrer">{tr("View transaction")}</a>}</p>}
      {pending && <button type="button" disabled={liquidity.busy} onClick={() => void liquidity.observe()}>{tr("Observe existing transaction")}</button>}
      {record?.evidence && observation && effects && <section aria-label={tr("Liquidity result")} className="swap-result">
        <h3>{tr("Success")}</h3>
        <p>{tr(review?.operation === 'OPEN' ? `Position opened and independently reconciled. Deposited ${sol(effects.depositedA)} and ${usdc(effects.depositedB)}; refundable deposits ${sol(effects.rentPaidLamports)}.`
          : `Liquidity removed and independently reconciled. Principal returned ${sol(effects.withdrawnPrincipalA)} and ${usdc(effects.withdrawnPrincipalB)}; fees collected ${sol(effects.collectedFeesA)} and ${usdc(effects.collectedFeesB)}${review?.operation === 'EXIT' ? `; position closed, ${sol(effects.rentRefundedLamports)} deposits refunded` : ''}.`)}{tr(" Network fee ")}{tr(sol(observation.feeLamports))}.</p>
        <dl className="swap-summary"><dt>{tr("Transaction")}</dt><dd><code>{tr(observation.signature)}</code></dd>
          {observation.explorer && <><dt>{tr("Explorer")}</dt><dd><a href={observation.explorer} target="_blank" rel="noreferrer">{tr("View on Solana Explorer (Devnet)")}</a></dd></>}
          <dt>{tr("Position")}</dt><dd><code>{tr(review?.accounts.positionMint)}</code></dd><dt>{tr("Slot")}</dt><dd>{tr(observation.slot ?? '--')}</dd></dl>
        <p>{tr("Evidence: ")}{tr(record.evidenceClass)}</p>
        <a download={`flofi-solana-devnet-liquidity-${review?.operation.toLowerCase()}-evidence.json`} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>{tr("Download Evidence Bundle")}</a></section>}
      {record && attempt && !record.evidence && <a download="flofi-solana-devnet-liquidity-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>{tr("Download execution record")}</a>}
    </>}
    {info && <p role="status">{tr(message(info) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.')}</p>}
    <details><summary>{tr("Show technical details")}</summary><pre>{JSON.stringify({ error: info, evidenceClass: record?.evidenceClass, submissionError: record?.submissionError, walletDiagnostic: record?.walletDiagnostic,
      operation: review?.operation, plan: review?.operationPlan, instructions: review?.instructionSummary, accounts: review?.accounts, messageHash: review?.messageHash,
      blockhash: review?.blockhash, lastValidBlockHeight: review?.lastValidBlockHeight, simulation: sim && { ...sim, pre: undefined, post: undefined }, attempt,
      observations: record?.observations, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
