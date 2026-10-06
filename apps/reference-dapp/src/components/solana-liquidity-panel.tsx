// SPDX-License-Identifier: AGPL-3.0-only
'use client';
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
  return <form id={reviewFormId} className="inspector-fields" aria-label={nodeId ? 'Edit Solana Devnet liquidity position' : 'Create Solana Devnet liquidity position'} onSubmit={submit}>
    <p className="muted">Orca Whirlpools · Devnet SOL / devUSDC (test) · fee 0.20% · tick spacing 64. Maxima are limits, not amounts to spend.</p>
    <label>Maximum Devnet SOL<TokenAmountInput aria-label="Maximum SOL" maxLength={40} value={contributionInput.maxSol} onValueChange={maxSol => set({ maxSol })}/></label>
    <label>Maximum devUSDC (test)<TokenAmountInput aria-label="Maximum devUSDC" maxLength={40} value={contributionInput.maxDevUsdc} onValueChange={maxDevUsdc => set({ maxDevUsdc })}/></label>
    <label>Lower {unit}<input aria-label="Lower bound" inputMode="decimal" autoComplete="off" maxLength={40} value={effectiveInput.lower} onChange={e => set({ lower: e.target.value })}/></label>
    <label>Upper {unit}<input aria-label="Upper bound" inputMode="decimal" autoComplete="off" maxLength={40} value={effectiveInput.upper} onChange={e => set({ upper: e.target.value })}/></label>
    <button type="button" className="quiet" disabled={liquidity.busy} onClick={() => void band()}>Use ±10% around the current Devnet price</button>
    {liquidity.price && <small>Current pool price {liquidity.price.price} devUSDC per SOL (tick {liquidity.price.tickCurrentIndex}, slot {liquidity.price.slot}). The range is aligned outward to usable ticks.</small>}
    <label>Slippage (bps)<input aria-label="Liquidity slippage (bps)" inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    <p className="muted">Devnet test tokens have no value. The position belongs to your connected wallet.</p>
    {error && <p role="alert">{error}</p>}
    {!reviewFormId && <button type="submit">{nodeId ? 'Review position change' : 'Review position proposal'}</button>}
    {onDone && <button type="button" className="quiet" onClick={onDone}>Cancel</button>}
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
  return <section className="panel" aria-label="Solana Devnet liquidity"><h2>{view === 'simulate' ? 'Simulate liquidity position' : 'Review liquidity position'}</h2>
    {fields && <p>Concentrated liquidity on Solana Devnet via Orca Whirlpools: up to {fields.maxSol} Devnet SOL and {fields.maxDevUsdc} devUSDC between {fields.lowerPrice} and {fields.upperPrice} devUSDC per SOL.</p>}
    <p role="note">Solana Devnet test tokens only. They have no value, and no real funds are used.</p>
    {liquidity.retired && <p role="alert">The workflow changed. Prior authorization is invalid. Simulate the current position again.</p>}
    {!liquidity.owner && !jupiter.walletChoices && <button type="button" disabled={jupiter.busy} onClick={() => void jupiter.connect('solana:devnet')}>Connect Solana wallet</button>}
    {!liquidity.owner && jupiter.walletChoices && <div role="group" aria-label="Choose a Solana wallet"><p>Choose a Solana wallet for Solana Devnet:</p>
      {jupiter.walletChoices.map((name, i) => <button key={name + i} type="button" disabled={jupiter.busy} onClick={() => void jupiter.chooseWallet(name)}>{name}</button>)}
      <button type="button" className="quiet" disabled={jupiter.busy} onClick={jupiter.cancelWalletChoice}>Cancel</button></div>}
    {liquidity.owner && <p>Wallet connected · Solana Devnet: <span>{liquidity.owner}</span></p>}
    {jupiter.error && !liquidity.owner && <p role="status">{jupiter.error}</p>}
    {liquidity.positions && <section aria-label="Your Flofi positions"><h3>Your Flofi positions on this pool</h3>
      {liquidity.positions.length === 0 ? <p className="muted">None yet.</p> : <ul>{liquidity.positions.map(p => <li key={p.positionMint}>
        <code>{p.positionMint}</code> · {p.status.toLowerCase().replaceAll('_', ' ')}{p.liquidity !== null ? ` · liquidity ${p.liquidity}` : ''}
        {p.feeOwedA !== null ? ` · recorded fees owed ${sol(p.feeOwedA)} / ${usdc(p.feeOwedB)}` : ''}
        {' · '}{p.runs.map(r => `${r.operation.toLowerCase().replaceAll('_', ' ')}: ${(r.state ?? 'not started').toLowerCase().replaceAll('_', ' ')}`).join(' → ')}
      </li>)}</ul>}
      <p className="muted">Recorded fees owed update only when the position is modified; collection may include more. Principal returned by a removal is never counted as fees.</p>
      <button type="button" className="quiet" disabled={liquidity.busy || !liquidity.owner} onClick={() => void liquidity.refreshPositions()}>Inspect positions</button></section>}
    {view === 'simulate' ? <>
      <div role="group" aria-label="Liquidity operation">
        <label htmlFor="orca-operation">Operation</label>
        <select id="orca-operation" value={operation} onChange={e => setOperation(e.target.value as LiquidityOperation)}>
          {(['OPEN', 'DECREASE_PARTIAL', 'EXIT'] as const).filter(op => op === 'OPEN' ? !active : Boolean(active && active.status !== 'OPEN_PENDING'))
            .map(op => <option key={op} value={op}>{labels[op]}</option>)}
        </select>
        {operation === 'DECREASE_PARTIAL' && <label>Portion to remove (basis points, 1–9999)<input aria-label="Portion to remove (bps)" inputMode="numeric" maxLength={4} value={part} onChange={e => setPart(e.target.value)}/></label>}
      </div>
      <button type="button" disabled={liquidity.busy || pending || !liquidity.owner} onClick={() => void liquidity.simulate(operation, operation === 'OPEN' ? undefined : active?.positionMint,
        operation === 'DECREASE_PARTIAL' ? Number(part) : undefined)}>Simulate {operation === 'OPEN' ? 'position' : 'removal'}</button>
      {review && sim && !liquidity.retired && <dl className="swap-summary" aria-label="Liquidity simulation">
        <dt>Operation</dt><dd>{labels[review.operation]} (1 transaction; the full lifecycle is open, partial removal, then exit)</dd>
        <dt>Network</dt><dd>Solana Devnet (genesis {review.genesisHash})</dd><dt>Provider</dt><dd>Orca Whirlpools · program <code>{review.program}</code></dd>
        <dt>Pool</dt><dd><code>{review.pool.address}</code> · config <code>{review.whirlpoolsConfig}</code></dd>
        <dt>Token mints</dt><dd>Devnet SOL <code>{review.token0.mint}</code> / devUSDC (test) <code>{review.token1.mint}</code></dd>
        <dt>Pool price</dt><dd>{review.pool.price} devUSDC per SOL · current tick {review.pool.tickCurrentIndex} · tick spacing {review.pool.tickSpacing} · fee {review.pool.feeRate / 10_000}% · slot {review.pool.slot}</dd>
        <dt>Range</dt><dd>{review.range.lowerPrice}–{review.range.upperPrice} devUSDC per SOL · aligned ticks {review.range.tickLower} to {review.range.tickUpper} · {review.range.state.toLowerCase().replace('_', ' ')}</dd>
        <dt>Maximum inputs</dt><dd>{sol(review.intent.amount0Max)} · {usdc(review.intent.amount1Max)}</dd>
        {review.operation === 'OPEN' ? <>
          <dt>Expected contribution</dt><dd>{sol(review.expected.amountA)} + {usdc(review.expected.amountB)} (simulated, not executed)</dd>
          <dt>Expected liquidity</dt><dd>{review.expected.liquidity}</dd>
          <dt>Slippage bounds</dt><dd>{review.intent.slippageBps} bps → at most {sol(review.operationPlan.tokenA)} and {usdc(review.operationPlan.tokenB)}, never above your maxima</dd>
          <dt>Expected residual</dt><dd>{sol(sim.residualTokenA)} not deposited (stays in your wallet) · devUSDC balance after {usdc(sim.residualTokenB)}</dd>
        </> : <>
          <dt>Liquidity removed</dt><dd>{review.expected.liquidity} of the position (remaining {review.expected.positionLiquidityAfter})</dd>
          <dt>Expected principal returned</dt><dd>{sol(review.expected.amountA)} + {usdc(review.expected.amountB)}; minimum {sol(review.operationPlan.tokenA)} + {usdc(review.operationPlan.tokenB)} ({review.intent.slippageBps} bps)</dd>
          <dt>Fees collected (simulated)</dt><dd>{sol(sim.collectedFeesA)} + {usdc(sim.collectedFeesB)} (separate from principal)</dd>
        </>}
        <dt>Owner balances</dt><dd>{sol(review.ownerBalances.lamports)} · {usdc(review.ownerBalances.tokenB ?? '0')}</dd>
        <dt>Token accounts</dt><dd>wrapped SOL (temporary, closed in the same transaction) <code>{review.accounts.ownerTokenA}</code> · devUSDC <code>{review.accounts.ownerTokenB}</code> · position token (Token-2022) <code>{review.accounts.positionTokenAccount}</code></dd>
        <dt>Position</dt><dd>{review.operation === 'OPEN' ? 'new' : 'existing'} position mint <code>{review.accounts.positionMint}</code> · position account <code>{review.accounts.position}</code> · owner: your wallet</dd>
        <dt>Accounts that may be created</dt><dd>{created.length ? created.map(a => <code key={a}>{a} </code>) : 'none'}</dd>
        <dt>Estimated network fee</dt><dd>{sol(review.estimatedFeeLamports)} ({review.signers.length} signature{review.signers.length > 1 ? 's' : ''})</dd>
        <dt>Account deposits</dt><dd>{review.operation === 'OPEN' ? `${sol(sim.rentPaidLamports)} refundable when the position is closed` : sim.rentRefundedLamports !== '0' ? `${sol(sim.rentRefundedLamports)} refunded on close` : 'none'}</dd>
        <dt>Programs</dt><dd>{review.programs.map(p => <code key={p}>{p} </code>)}</dd>
        <dt>Review freshness</dt><dd>{fresh > 0 ? `Valid for ${fresh}s` : 'Expired — simulate again'}</dd>
      </dl>}
    </> : <>
      {review && <dl className="swap-summary" aria-label="Liquidity review">
        <dt>Owner and position authority</dt><dd>{review.owner}</dd><dt>Operation</dt><dd>{labels[review.operation]}</dd>
        <dt>Range</dt><dd>ticks {review.range.tickLower} to {review.range.tickUpper} ({review.range.lowerPrice}–{review.range.upperPrice} devUSDC per SOL)</dd>
        <dt>{review.operation === 'OPEN' ? 'Deposit at most' : 'Receive at least'}</dt><dd>{sol(review.operationPlan.tokenA)} + {usdc(review.operationPlan.tokenB)} · liquidity {review.operationPlan.liquidityDelta}</dd>
        <dt>Signers</dt><dd>{review.signers.length === 2 ? <>your wallet, then a one-time position-mint key created in this browser (<code>{review.signers[1]}</code>; no authority after creation)</> : 'your wallet only'}</dd>
        <dt>Exact message</dt><dd><code>{review.messageHash}</code> · blockhash <code>{review.blockhash}</code> · valid to block height {review.lastValidBlockHeight}</dd>
        {!attempt && <><dt>Review freshness</dt><dd>{fresh > 0 ? `Valid for ${fresh}s` : 'Expired'}</dd></>}
      </dl>}
      {review && !attempt && <p role="note">Your wallet will ask you to sign one exact Solana Devnet transaction; Flofi never signs for you.</p>}
      {record && !record.authorization && !attempt && !liquidity.retired && <button type="button" disabled={liquidity.busy || fresh === 0} onClick={() => void liquidity.review()}>Accept liquidity review</button>}
      {record?.authorization && !attempt && !liquidity.executionEnabled && <p role="status">{message('ORCA_LIQUIDITY_EXECUTION_NOT_ENABLED')}</p>}
      {canExecute && <button type="button" className="primary" disabled={liquidity.busy} onClick={() => void liquidity.execute()}>Execute {review?.operation === 'OPEN' ? 'position' : 'removal'}</button>}
      {attempt && !record?.evidence && <p>Transaction: {record?.notSubmitted ? 'not submitted' : attempt.state.toLowerCase().replaceAll('_', ' ')} {observation?.explorer && <a href={observation.explorer} target="_blank" rel="noreferrer">View transaction</a>}</p>}
      {pending && <button type="button" disabled={liquidity.busy} onClick={() => void liquidity.observe()}>Observe existing transaction</button>}
      {record?.evidence && observation && effects && <section aria-label="Liquidity result" className="swap-result">
        <h3>Success</h3>
        <p>{review?.operation === 'OPEN' ? `Position opened and independently reconciled. Deposited ${sol(effects.depositedA)} and ${usdc(effects.depositedB)}; refundable deposits ${sol(effects.rentPaidLamports)}.`
          : `Liquidity removed and independently reconciled. Principal returned ${sol(effects.withdrawnPrincipalA)} and ${usdc(effects.withdrawnPrincipalB)}; fees collected ${sol(effects.collectedFeesA)} and ${usdc(effects.collectedFeesB)}${review?.operation === 'EXIT' ? `; position closed, ${sol(effects.rentRefundedLamports)} deposits refunded` : ''}.`} Network fee {sol(observation.feeLamports)}.</p>
        <dl className="swap-summary"><dt>Transaction</dt><dd><code>{observation.signature}</code></dd>
          {observation.explorer && <><dt>Explorer</dt><dd><a href={observation.explorer} target="_blank" rel="noreferrer">View on Solana Explorer (Devnet)</a></dd></>}
          <dt>Position</dt><dd><code>{review?.accounts.positionMint}</code></dd><dt>Slot</dt><dd>{observation.slot ?? '--'}</dd></dl>
        <p>Evidence: {record.evidenceClass}</p>
        <a download={`flofi-solana-devnet-liquidity-${review?.operation.toLowerCase()}-evidence.json`} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>Download Evidence Bundle</a></section>}
      {record && attempt && !record.evidence && <a download="flofi-solana-devnet-liquidity-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>Download execution record</a>}
    </>}
    {info && <p role="status">{message(info) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.'}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({ error: info, evidenceClass: record?.evidenceClass, submissionError: record?.submissionError, walletDiagnostic: record?.walletDiagnostic,
      operation: review?.operation, plan: review?.operationPlan, instructions: review?.instructionSummary, accounts: review?.accounts, messageHash: review?.messageHash,
      blockhash: review?.blockhash, lastValidBlockHeight: review?.lastValidBlockHeight, simulation: sim && { ...sim, pre: undefined, post: undefined }, attempt,
      observations: record?.observations, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
