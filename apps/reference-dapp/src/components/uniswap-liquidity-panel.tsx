// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState, type FormEvent } from 'react';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY, uniswapLiquidityProfile, type UniswapLiquidityProfile } from '@defi-workflow-engine/action-registry';
import { createUniswapLiquidityNode, uniswapBandInput, uniswapLiquidityDetails, uniswapLiquidityInputOf, uniswapLiquidityProfileFor, UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE,
  UNISWAP_LIQUIDITY_NETWORKS, type UniswapLiquidityInput, type UniswapLiquidityNetwork } from '../domain/uniswap-liquidity-authoring';
import { poolPriceBounds, usePoolPriceRange } from './pool-price-range';
import { usePoolContributionInputs } from './canvas-card-inputs';
import { TokenAmountInput } from './token-amount-input';
import { formatTokenAmount } from '../domain/jupiter-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import type { UniswapLiquidityStep } from '../server/uniswap-liquidity-service';

/** Canvas form for the canonical concentrated-liquidity node: Uniswap v3 USDC / WETH on Base Sepolia (0.05%) or Ethereum Sepolia (0.3%). */
/** Copy is written for Base Sepolia; another network's name is substituted. Display text only. */
const networkCopy = (text: string, network: UniswapLiquidityNetwork) => network === 'Base Sepolia' ? text : text.replaceAll('Base Sepolia', network);
export function UniswapLiquidityForm({ nodeId, onDone, reviewFormId }: { nodeId?: string; onDone?: () => void; reviewFormId?: string }) {
  const { t: tr } = useLocale();
  const { state, propose, actionSetup, editPoolSetup, reviewCanvasAmount } = useWorkflow(), liquidity = useUniswapLiquidity();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const range = usePoolPriceRange(nodeId);
  const contributions = usePoolContributionInputs(nodeId);

  const setup = actionSetup && actionSetup.id === nodeId && actionSetup.action === 'pool' ? actionSetup : null;
  const existing = node ? uniswapLiquidityDetails(node) : null;
  const [input, setInput] = useState<UniswapLiquidityInput>(existing ? uniswapLiquidityInputOf(existing)
    : { network: 'Base Sepolia', maxUsdc: '', maxWeth: '', rangeUnit: 'PRICE', lower: '', upper: '', slippage: UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE });
  const [band, setBand] = useState<string | null>(null), [error, setError] = useState('');
  const formInput = setup?.input ?? input;
  const contributionInput = contributions.values ? { ...formInput, maxUsdc: contributions.values[0]!.amount, maxWeth: contributions.values[1]!.amount } : formInput;
  const set = (patch: Partial<UniswapLiquidityInput>) => {
    if (patch.maxUsdc !== undefined) contributions.edit(0, patch.maxUsdc);
    if (patch.maxWeth !== undefined) contributions.edit(1, patch.maxWeth);
    const editsRange = patch.lower !== undefined || patch.upper !== undefined || patch.rangeUnit !== undefined;
    if (editsRange) range.reset();
    const next = { ...(editsRange ? effectiveInput : contributionInput), ...patch };
    if (setup) editPoolSetup(setup.id, next);
    else setInput(next);
    if (editsRange) setBand(null);
  };
  async function aroundCurrent() {
    const price = await liquidity.fetchPrice(uniswapLiquidityProfileFor(contributionInput.network).chain);
    if (!price) return;
    const derived = uniswapBandInput(price.sqrtPriceX96, 1_000, contributionInput.network);
    range.reset();
    set({ rangeUnit: derived.rangeUnit, lower: derived.lower, upper: derived.upper });
    setBand(`±10% around ${price.price} USDC per WETH (block ${price.blockNumber}) → ticks ${derived.lower} to ${derived.upper} = ${derived.lowerPrice}–${derived.upperPrice} USDC per WETH.`);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const reviewedInput = range.edited ? { ...contributionInput, ...poolPriceBounds(range.reference, range.percent, range.preset) } : contributionInput;
      createUniswapLiquidityNode(nodeId ?? 'node-preview', reviewedInput); setError('');
      if (setup) {
        // The setup snapshot includes every field; stale acceptance is checked by the history reducer.
        const failure = reviewCanvasAmount(setup.id, reviewedInput);
        if (failure) throw new Error(failure);
      } else propose(nodeId ? { type: 'SET_UNISWAP_LIQUIDITY', nodeId, input: reviewedInput, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_UNISWAP_LIQUIDITY', input: reviewedInput, source: 'CANVAS', baseRevision: state.workflow.revision });
      if (range.edited) range.markReviewed();
      onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNISWAP_LIQUIDITY_INPUT_INVALID'); }
  }
  let effectiveInput = contributionInput;
  if (range.edited && range.reference) {
    try { effectiveInput = { ...contributionInput, ...poolPriceBounds(range.reference, range.percent, range.preset) }; } catch { /* submit reports the existing validation failure */ }
  }
  const unit = effectiveInput.rangeUnit === 'PRICE' ? 'price (USDC per WETH)' : 'tick', selected = uniswapLiquidityProfileFor(contributionInput.network);
  return <form id={reviewFormId} className="inspector-fields" aria-label={tr(networkCopy(nodeId ? 'Edit Base Sepolia liquidity position' : 'Create Base Sepolia liquidity position', contributionInput.network))} onSubmit={submit}>
    <label>{tr("Liquidity network")}<select aria-label={tr("Liquidity network")} value={contributionInput.network} onChange={e => set({ network: e.target.value as UniswapLiquidityNetwork, rangeUnit: 'PRICE', lower: '', upper: '' })}>
      {UNISWAP_LIQUIDITY_NETWORKS.map(network => <option key={network}>{network}</option>)}</select></label>
    <p className="muted">{tr("Uniswap v3 · ")}{tr(contributionInput.network)}{tr(" test USDC / WETH · fee ")}{tr(selected.feeTier / 10_000)}{tr("% · tick spacing ")}{tr(selected.tickSpacing)}{tr(". Maxima are limits, not amounts to spend.")}</p>
    <label>{tr("Maximum USDC (test)")}<TokenAmountInput aria-label={tr("Maximum USDC")} maxLength={40} value={contributionInput.maxUsdc} onValueChange={maxUsdc => set({ maxUsdc })}/></label>
    <label>{tr("Maximum WETH (test)")}<TokenAmountInput aria-label={tr("Maximum WETH")} maxLength={40} value={contributionInput.maxWeth} onValueChange={maxWeth => set({ maxWeth })}/></label>
    <label>{tr("Range unit")}<select aria-label={tr("Range unit")} value={effectiveInput.rangeUnit} onChange={e => set({ rangeUnit: e.target.value as 'PRICE' | 'TICK' })}>
      <option value="PRICE">{tr("Price (USDC per WETH)")}</option><option value="TICK">{tr("Tick")}</option></select></label>
    <label>{tr("Lower ")}{tr(unit)}<input aria-label={tr("Lower bound")} inputMode="decimal" autoComplete="off" maxLength={40} value={effectiveInput.lower} onChange={e => set({ lower: e.target.value })}/></label>
    <label>{tr("Upper ")}{tr(unit)}<input aria-label={tr("Upper bound")} inputMode="decimal" autoComplete="off" maxLength={40} value={effectiveInput.upper} onChange={e => set({ upper: e.target.value })}/></label>
    <button type="button" className="quiet" disabled={liquidity.busy || !liquidity.available} onClick={() => void aroundCurrent()}>{tr(networkCopy('Use ±10% around the current Base Sepolia price', contributionInput.network))}</button>
    {band && <small role="status">{tr(band)}</small>}
    <small>{tr("Prices are aligned outward to usable ticks; the exact ticks are stored and shown again at Review.")}</small>
    <label>{tr("Slippage (bps)")}<input aria-label={tr("Liquidity slippage (bps)")} inputMode="numeric" autoComplete="off" maxLength={4} value={contributionInput.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    <p className="muted">{tr("Test tokens only. The position NFT is minted to your connected wallet.")}</p>
    {error && <p role="alert">{tr(error)}</p>}
    {!reviewFormId && <button type="submit">{tr(nodeId ? 'Review position change' : 'Review position proposal')}</button>}
    {onDone && <button type="button" className="quiet" onClick={onDone}>{tr("Cancel")}</button>}
  </form>;
}

const messages: Record<string, string> = {
  UNISWAP_LIQUIDITY_PUBLIC_TESTNET_NOT_ENABLED: 'Base Sepolia liquidity is not enabled on this server.',
  UNISWAP_LIQUIDITY_STORAGE_NOT_CONFIGURED: 'Execution storage is not configured on this server.',
  UNISWAP_WALLET_REQUIRED: 'Connect a wallet first.', UNISWAP_WRONG_CHAIN: 'Switch your wallet to Base Sepolia.',
  UNISWAP_WRONG_OWNER: 'Select the wallet account shown in Review.', UNISWAP_REVIEW_REQUIRED: 'Accept the current Review first.',
  UNISWAP_REVIEW_EXPIRED: 'This Review expired. Refresh the simulation and review again.',
  UNISWAP_STATE_CHANGED_REVIEW_REQUIRED: 'The pool or your balances changed materially. Refresh the simulation and review again; nothing was sent.',
  UNISWAP_SEMANTIC_REVISION_CHANGED: 'The workflow changed. Simulate the current position again.',
  UNISWAP_INSUFFICIENT_USDC: 'Your wallet needs more test USDC for this position.', UNISWAP_INSUFFICIENT_WETH: 'Your wallet needs more WETH for this position.',
  UNISWAP_INSUFFICIENT_GAS_ETH: 'Your wallet needs more Base Sepolia ETH for network fees.',
  UNISWAP_LIQUIDITY_ZERO: 'These maxima and this range give zero liquidity. Increase a maximum or move the range.',
  UNISWAP_SIMULATION_MINT_REVERTED: 'The Base Sepolia simulation of the mint failed. Nothing was signed.',
  UNISWAP_SIMULATION_UNAVAILABLE: 'The network provider cannot simulate this transaction sequence. Nothing was signed.',
  UNISWAP_SIMULATION_DIVERGENT: 'The public simulation disagreed with the independent estimate. Nothing was signed.',
  UNISWAP_UNEXPECTED_CONTRACT: 'A Uniswap contract does not match the verified deployment. Nothing was simulated or sent.',
  UNISWAP_PENDING_TRANSACTION: 'Your wallet has a queued transaction on Base Sepolia. Let it confirm first.',
  UNISWAP_WALLET_NONCE_MISMATCH: 'Your wallet would use a different transaction number. Let pending transactions confirm first.',
  UNISWAP_ATTEMPT_ACTIVE_OBSERVE_EXISTING: 'A transaction is still being observed. Check it before continuing.',
  UNISWAP_SUBMISSION_UNKNOWN_OBSERVE_EXISTING: 'The wallet result is unknown. Flofi is observing the network and will not send another request.',
  UNISWAP_REJECTED: 'You declined the request in your wallet. Nothing was sent.',
  UNISWAP_TRANSACTION_PENDING: 'The transaction is pending on Base Sepolia.', UNISWAP_TRANSACTION_NOT_OBSERVED: 'No transaction is visible yet. Observe again; nothing will be resent.',
  UNISWAP_TRANSACTION_REVERTED: 'The transaction reverted on chain; only the network fee was charged. Refresh and review before trying again.',
  UNISWAP_SUBMISSION_EXPIRED_NOT_EXECUTED: 'The request was not executed and can no longer execute. Refresh and review to try again.',
  UNISWAP_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION: 'Your wallet sent a different transaction instead (for example a cancellation). Refresh and review to try again.',
  UNISWAP_POSITION_MAY_EXIST_OBSERVE: 'A position may already exist from an earlier attempt. Inspect your wallet before creating another.',
  UNISWAP_TRANSACTION_MISMATCH: 'The reported transaction is not the reviewed call. The run needs your attention; nothing will be resent.',
};
const message = (code: string | null | undefined) => !code ? null : messages[code] ?? null;
const usdc = (units: string | null | undefined) => units ? `${formatTokenAmount(units, 6)} USDC` : '--';
const weth = (units: string | null | undefined) => units ? `${formatTokenAmount(units, 18)} WETH` : '--';
const eth = (wei: string | null | undefined) => wei ? `${formatTokenAmount(wei, 18)} ETH` : 'not available';
const stepLabel: Record<UniswapLiquidityStep, string> = { APPROVE_TOKEN0: 'Approve USDC (exact amount)', APPROVE_TOKEN1: 'Approve WETH (exact amount)', MINT: 'Mint the position NFT' };
const explorer = (hash: string, profile: UniswapLiquidityProfile) => profile.explorer + 'tx/' + hash;

export function UniswapLiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const { state } = useWorkflow(), wallet = useBuild009Wallet(), lp = useUniswapLiquidity();
  const node = state.workflow.nodes.find(n => uniswapLiquidityDetails(n)), fields = node ? uniswapLiquidityDetails(node) : null;
  const record = lp.record, r = record?.review, last = record?.attempts.at(-1);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const fresh = r ? Math.max(0, Math.round((Date.parse(r.expiresAt) - clock) / 1000)) : 0;
  const pending = Boolean(last && record?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state));
  const confirmedSteps = new Set(record?.attempts.filter(a => a.state === 'CONFIRMED').map(a => a.step));
  const nextStep = r?.calls.find(c => !confirmedSteps.has(c.step))?.step ?? null;
  const authorized = Boolean(record?.authorization && record.authorization === r?.commitment);
  const canExecute = Boolean(authorized && !lp.retired && !pending && record?.verdict === 'PENDING' && fresh > 0 && lp.executionEnabled && nextStep);
  const needsRefresh = Boolean(record && record.verdict === 'PENDING' && !pending && (!authorized && record.attempts.length > 0 || fresh === 0));
  const info = lp.error ?? record?.error;
  // The reviewed chain (else the authored one) names the network; Base Sepolia before anything is authored, as before.
  const profile = uniswapLiquidityProfile(r?.chainId ?? node?.chainId) ?? UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY, network = profile.network;
  return <section className="panel" aria-label={tr(`${network} liquidity`)}><h2>{tr(view === 'simulate' ? 'Simulate liquidity position' : 'Review liquidity position')}</h2>
    {fields && <p>{tr("Concentrated liquidity on ")}{network}{tr(" via Uniswap v3: up to ")}{tr(fields.maxUsdc)}{tr(" USDC and ")}{tr(fields.maxWeth)}{tr(" WETH between ")}{tr(fields.lowerPrice)}{tr(" and ")}{tr(fields.upperPrice)}{tr(" USDC per WETH.")}</p>}
    <p role="note">{network}{tr(" test tokens only. They have no value, and no real funds are used.")}</p>
    {!lp.available && <p role="status">{tr(message('UNISWAP_LIQUIDITY_PUBLIC_TESTNET_NOT_ENABLED'))}</p>}
    {lp.retired && <p role="alert">{tr("The workflow changed. Prior authorization is invalid. Simulate the current position again.")}</p>}
    {lp.recovered && record && <p role="status">{tr("Recovered run ")}{record.id}{tr(". Its state comes from the server; nothing is resent automatically.")}</p>}
    {!wallet.account ? <button type="button" disabled={wallet.busy} onClick={() => void wallet.connect()}>{tr("Connect wallet")}</button>
      : <p>{tr("Wallet connected: ")}<span>{wallet.account}</span>{wallet.chainId !== profile.chainHex && <> · <button type="button" disabled={lp.busy} onClick={() => void lp.switchNetwork()}>{tr("Switch to ")}{network}</button></>}</p>}
    {view === 'simulate' && <button type="button" disabled={lp.busy || pending || !lp.available || !fields} onClick={() => void lp.simulate()}>{tr("Simulate position")}</button>}
    {r && !lp.retired && <dl className="swap-summary" aria-label={tr(view === 'simulate' ? 'Liquidity simulation' : 'Liquidity review')}>
      <dt>{tr("Network")}</dt><dd>{network}{tr(" (chain ")}{tr(r.chainId)}{tr(") · block ")}{tr(r.block.number)}</dd>
      <dt>{tr("Pool")}</dt><dd>{tr("Uniswap v3 USDC/WETH ")}<code>{tr(r.contracts.pool)}</code>{tr(" · fee ")}{tr(r.pool.fee / 10_000)}{tr("% · tick spacing ")}{tr(r.pool.tickSpacing)}</dd>
      <dt>{tr("Token order")}</dt><dd>{tr("token0 ")}{tr(r.token0.symbol)} <code>{r.token0.address}</code>{tr(" · token1 ")}{tr(r.token1.symbol)} <code>{r.token1.address}</code></dd>
      <dt>{tr("Current price")}</dt><dd>{tr(r.pool.price)}{tr(" USDC per WETH · tick ")}{tr(r.pool.tick)}</dd>
      <dt>{tr("Range")}</dt><dd>{tr(r.range.lowerPrice)}–{tr(r.range.upperPrice)}{tr(" USDC per WETH · exact ticks ")}{tr(r.range.tickLower)}{tr(" to ")}{tr(r.range.tickUpper)} · {tr(r.range.state.toLowerCase().replace('_', ' '))}</dd>
      <dd>{tr(r.range.description)}</dd>
      <dt>{tr("Maximum inputs")}</dt><dd>{tr(usdc(r.intent.amount0Max))} · {tr(weth(r.intent.amount1Max))}</dd>
      <dt>{tr("Expected deposit")}</dt><dd>{tr(usdc(r.expected.amount0))} + {tr(weth(r.expected.amount1))}{tr(" · liquidity ")}{tr(r.expected.liquidity)}{tr(" (public simulation, not executed)")}</dd>
      <dt>{tr("Minimum deposit")}</dt><dd>{tr(usdc(r.minimums.amount0Min))} + {tr(weth(r.minimums.amount1Min))} ({tr(r.intent.slippageBps)}{tr(" bps); otherwise the mint reverts")}</dd>
      <dt>{tr("Approvals")}</dt><dd>{r.approvals.length ? r.approvals.map(a => <span key={a.step}>{tr(a.symbol)}: {tr(a.required ? `exactly ${a.symbol === 'USDC' ? usdc(a.amount) : weth(a.amount)} to the Position Manager` : 'existing allowance is sufficient')}. </span>) : 'none'}</dd>
      <dt>{tr("Position Manager")}</dt><dd><code>{tr(r.contracts.positionManager)}</code></dd>
      <dt>{tr("Position NFT recipient")}</dt><dd>{tr(r.recipient)}{tr(" (your wallet)")}</dd>
      <dt>{tr("Deadline")}</dt><dd>{tr(new Date(Number(r.deadline) * 1000).toISOString())}{tr(" · Review valid ")}{tr(fresh > 0 ? `for ${fresh}s` : 'no longer — refresh')}</dd>
      <dt>{tr("Estimated network fees")}</dt><dd>{tr("at most ")}{tr(eth(r.fees.totalUpperBoundWei ?? r.fees.executionFeeUpperBoundWei))}{tr(" for ")}{tr(r.calls.length)}{tr(" transaction")}{tr(r.calls.length > 1 ? 's' : '')}{tr(r.fees.l1FeeUpperBoundWei === null ? ' (L1 data fee not estimated)' : '')}</dd>
      <dt>{tr("Wallet requests")}</dt><dd>{tr(r.calls.map(c => stepLabel[c.step]).join(' → '))}{tr(" — each needs its own Execute click and wallet signature")}</dd>
      <dt>{tr("Simulation")}</dt><dd>{tr(r.simulation.method)}{tr(" of the exact sequence at block ")}{tr(r.simulation.block)}{tr("; independent estimate ")}{tr(r.simulation.localEstimate.liquidity)}{tr(" liquidity")}</dd>
    </dl>}
    {view === 'execute' && record && <>
      {!authorized && !pending && record.verdict === 'PENDING' && !lp.retired && fresh > 0 && <button type="button" disabled={lp.busy} onClick={() => void lp.review()}>{tr("Accept liquidity review")}</button>}
      {authorized && !lp.executionEnabled && <p role="status">{tr("Execution is not enabled on this server. Simulation and Review remain read-only.")}</p>}
      {canExecute && nextStep && <button type="button" className="primary" disabled={lp.busy} onClick={() => void lp.execute()}>{tr("Execute: ")}{tr(stepLabel[nextStep])}</button>}
      {needsRefresh && <button type="button" disabled={lp.busy} onClick={() => void lp.refresh()}>{tr("Refresh simulation for the next step")}</button>}
      {pending && <button type="button" disabled={lp.busy} onClick={() => void lp.observe()}>{tr("Observe existing transaction")}</button>}
      {record.attempts.length > 0 && <ol aria-label={tr("Liquidity transactions")}>{record.attempts.map(a => <li key={a.attemptId}>{tr(stepLabel[a.step])}: {tr(a.state.toLowerCase().replaceAll('_', ' '))}
        {a.transactionHash && <> · <a href={explorer(a.replacementHash ?? a.transactionHash, profile)} target="_blank" rel="noreferrer">{tr("view transaction")}</a></>}{tr(a.note ? ` · ${message(a.note) ?? a.note}` : '')}</li>)}</ol>}
      {record.evidence && record.position && <section aria-label={tr("Liquidity result")} className="swap-result"><h3>{tr("Position created")}</h3>
        <p>{tr("Position NFT #")}{tr(record.position.tokenId)}{tr(" is owned by your wallet ")}{tr(record.position.owner)}{tr(". Deposited ")}{tr(usdc(record.position.amount0))}{tr(" and ")}{tr(weth(record.position.amount1))}{tr("; liquidity ")}{tr(record.position.liquidity)}{tr("; ticks ")}{tr(record.position.tickLower)}{tr(" to ")}{tr(record.position.tickUpper)}{tr(". Independently reconciled.")}</p>
        <p>{tr("Remaining allowances to the Position Manager: ")}{tr(usdc(record.evidence.residualAllowances.token0))} · {tr(weth(record.evidence.residualAllowances.token1))}.</p>
        <p>{tr("Evidence: ")}{tr(record.evidence.evidenceClass)}{tr(" · bundle ")}{record.evidence.bundleHash}</p>
        <a download="flofi-base-sepolia-liquidity-evidence.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>{tr("Download Evidence Bundle")}</a></section>}
      {record.attempts.length > 0 && !record.evidence && <a download="flofi-base-sepolia-liquidity-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>{tr("Download execution record")}</a>}
    </>}
    {info && <p role="status">{tr(networkCopy(message(info) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.', network))}</p>}
    {lp.busy && <p role="status">{tr("Working…")}</p>}
    <details><summary>{tr("Show technical details")}</summary><pre>{JSON.stringify({ error: info, run: record?.id, commitment: r?.commitment, calls: r?.calls, attempts: record?.attempts, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
