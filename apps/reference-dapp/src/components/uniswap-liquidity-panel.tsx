// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import { createUniswapLiquidityNode, uniswapBandInput, uniswapLiquidityDetails, uniswapLiquidityInputOf, UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE,
  type UniswapLiquidityInput } from '../domain/uniswap-liquidity-authoring';
import { formatTokenAmount } from '../domain/jupiter-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import { BASE_SEPOLIA_HEX, useBuild009Wallet } from '../state/build009-wallet-store';
import type { UniswapLiquidityStep } from '../server/uniswap-liquidity-service';

/** Canvas form for the canonical concentrated-liquidity node on Base Sepolia (Uniswap v3, USDC / WETH 0.05%). */
export function UniswapLiquidityForm({ nodeId, onDone }: { nodeId?: string; onDone?: () => void }) {
  const { state, propose } = useWorkflow(), liquidity = useUniswapLiquidity();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const existing = node ? uniswapLiquidityDetails(node) : null;
  const [input, setInput] = useState<UniswapLiquidityInput>(existing ? uniswapLiquidityInputOf(existing)
    : { network: 'Base Sepolia', maxUsdc: '', maxWeth: '', rangeUnit: 'PRICE', lower: '', upper: '', slippage: UNISWAP_LIQUIDITY_DEFAULT_SLIPPAGE });
  const [band, setBand] = useState<string | null>(null), [error, setError] = useState('');
  const set = (patch: Partial<UniswapLiquidityInput>) => { setInput(value => ({ ...value, ...patch })); if (patch.lower !== undefined || patch.upper !== undefined || patch.rangeUnit !== undefined) setBand(null); };
  async function aroundCurrent() {
    const price = await liquidity.fetchPrice();
    if (!price) return;
    const derived = uniswapBandInput(price.sqrtPriceX96, 1_000);
    setInput(value => ({ ...value, rangeUnit: derived.rangeUnit, lower: derived.lower, upper: derived.upper }));
    setBand(`±10% around ${price.price} USDC per WETH (block ${price.blockNumber}) → ticks ${derived.lower} to ${derived.upper} = ${derived.lowerPrice}–${derived.upperPrice} USDC per WETH.`);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      createUniswapLiquidityNode(nodeId ?? 'node-preview', input); setError('');
      propose(nodeId ? { type: 'SET_UNISWAP_LIQUIDITY', nodeId, input, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_UNISWAP_LIQUIDITY', input, source: 'CANVAS', baseRevision: state.workflow.revision });
      onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNISWAP_LIQUIDITY_INPUT_INVALID'); }
  }
  const unit = input.rangeUnit === 'PRICE' ? 'price (USDC per WETH)' : 'tick';
  return <form className="inspector-fields" aria-label={nodeId ? 'Edit Base Sepolia liquidity position' : 'Create Base Sepolia liquidity position'} onSubmit={submit}>
    <p className="muted">Uniswap v3 · Base Sepolia test USDC / WETH · fee 0.05% · tick spacing 10. Maxima are limits, not amounts to spend.</p>
    <label>Maximum USDC (test)<input aria-label="Maximum USDC" inputMode="decimal" autoComplete="off" maxLength={40} value={input.maxUsdc} onChange={e => set({ maxUsdc: e.target.value })}/></label>
    <label>Maximum WETH (test)<input aria-label="Maximum WETH" inputMode="decimal" autoComplete="off" maxLength={40} value={input.maxWeth} onChange={e => set({ maxWeth: e.target.value })}/></label>
    <label>Range unit<select aria-label="Range unit" value={input.rangeUnit} onChange={e => set({ rangeUnit: e.target.value as 'PRICE' | 'TICK' })}>
      <option value="PRICE">Price (USDC per WETH)</option><option value="TICK">Tick</option></select></label>
    <label>Lower {unit}<input aria-label="Lower bound" inputMode="decimal" autoComplete="off" maxLength={40} value={input.lower} onChange={e => set({ lower: e.target.value })}/></label>
    <label>Upper {unit}<input aria-label="Upper bound" inputMode="decimal" autoComplete="off" maxLength={40} value={input.upper} onChange={e => set({ upper: e.target.value })}/></label>
    <button type="button" className="quiet" disabled={liquidity.busy || !liquidity.available} onClick={() => void aroundCurrent()}>Use ±10% around the current Base Sepolia price</button>
    {band && <small role="status">{band}</small>}
    <small>Prices are aligned outward to usable ticks; the exact ticks are stored and shown again at Review.</small>
    <label>Slippage (bps)<input aria-label="Liquidity slippage (bps)" inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    <p className="muted">Test tokens only. The position NFT is minted to your connected wallet.</p>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{nodeId ? 'Review position change' : 'Review position proposal'}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>Cancel</button>}
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
const explorer = (hash: string) => profile.explorer + 'tx/' + hash;

export function UniswapLiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
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
  return <section className="panel" aria-label="Base Sepolia liquidity"><h2>{view === 'simulate' ? 'Simulate liquidity position' : 'Review liquidity position'}</h2>
    {fields && <p>Concentrated liquidity on Base Sepolia via Uniswap v3: up to {fields.maxUsdc} USDC and {fields.maxWeth} WETH between {fields.lowerPrice} and {fields.upperPrice} USDC per WETH.</p>}
    <p role="note">Base Sepolia test tokens only. They have no value, and no real funds are used.</p>
    {!lp.available && <p role="status">{message('UNISWAP_LIQUIDITY_PUBLIC_TESTNET_NOT_ENABLED')}</p>}
    {lp.retired && <p role="alert">The workflow changed. Prior authorization is invalid. Simulate the current position again.</p>}
    {lp.recovered && record && <p role="status">Recovered run {record.id}. Its state comes from the server; nothing is resent automatically.</p>}
    {!wallet.account ? <button type="button" disabled={wallet.busy} onClick={() => void wallet.connect()}>Connect wallet</button>
      : <p>Wallet connected: <span>{wallet.account}</span>{wallet.chainId !== BASE_SEPOLIA_HEX && <> · <button type="button" disabled={lp.busy} onClick={() => void lp.switchNetwork()}>Switch to Base Sepolia</button></>}</p>}
    {view === 'simulate' && <button type="button" disabled={lp.busy || pending || !lp.available || !fields} onClick={() => void lp.simulate()}>Simulate position</button>}
    {r && !lp.retired && <dl className="swap-summary" aria-label={view === 'simulate' ? 'Liquidity simulation' : 'Liquidity review'}>
      <dt>Network</dt><dd>Base Sepolia (chain 84532) · block {r.block.number}</dd>
      <dt>Pool</dt><dd>Uniswap v3 USDC/WETH <code>{r.contracts.pool}</code> · fee {r.pool.fee / 10_000}% · tick spacing {r.pool.tickSpacing}</dd>
      <dt>Token order</dt><dd>token0 {r.token0.symbol} <code>{r.token0.address}</code> · token1 {r.token1.symbol} <code>{r.token1.address}</code></dd>
      <dt>Current price</dt><dd>{r.pool.price} USDC per WETH · tick {r.pool.tick}</dd>
      <dt>Range</dt><dd>{r.range.lowerPrice}–{r.range.upperPrice} USDC per WETH · exact ticks {r.range.tickLower} to {r.range.tickUpper} · {r.range.state.toLowerCase().replace('_', ' ')}</dd>
      <dd>{r.range.description}</dd>
      <dt>Maximum inputs</dt><dd>{usdc(r.intent.amount0Max)} · {weth(r.intent.amount1Max)}</dd>
      <dt>Expected deposit</dt><dd>{usdc(r.expected.amount0)} + {weth(r.expected.amount1)} · liquidity {r.expected.liquidity} (public simulation, not executed)</dd>
      <dt>Minimum deposit</dt><dd>{usdc(r.minimums.amount0Min)} + {weth(r.minimums.amount1Min)} ({r.intent.slippageBps} bps); otherwise the mint reverts</dd>
      <dt>Approvals</dt><dd>{r.approvals.length ? r.approvals.map(a => <span key={a.step}>{a.symbol}: {a.required ? `exactly ${a.symbol === 'USDC' ? usdc(a.amount) : weth(a.amount)} to the Position Manager` : 'existing allowance is sufficient'}. </span>) : 'none'}</dd>
      <dt>Position Manager</dt><dd><code>{r.contracts.positionManager}</code></dd>
      <dt>Position NFT recipient</dt><dd>{r.recipient} (your wallet)</dd>
      <dt>Deadline</dt><dd>{new Date(Number(r.deadline) * 1000).toISOString()} · Review valid {fresh > 0 ? `for ${fresh}s` : 'no longer — refresh'}</dd>
      <dt>Estimated network fees</dt><dd>at most {eth(r.fees.totalUpperBoundWei ?? r.fees.executionFeeUpperBoundWei)} for {r.calls.length} transaction{r.calls.length > 1 ? 's' : ''}{r.fees.l1FeeUpperBoundWei === null ? ' (L1 data fee not estimated)' : ''}</dd>
      <dt>Wallet requests</dt><dd>{r.calls.map(c => stepLabel[c.step]).join(' → ')} — each needs its own Execute click and wallet signature</dd>
      <dt>Simulation</dt><dd>{r.simulation.method} of the exact sequence at block {r.simulation.block}; independent estimate {r.simulation.localEstimate.liquidity} liquidity</dd>
    </dl>}
    {view === 'execute' && record && <>
      {!authorized && !pending && record.verdict === 'PENDING' && !lp.retired && fresh > 0 && <button type="button" disabled={lp.busy} onClick={() => void lp.review()}>Accept liquidity review</button>}
      {authorized && !lp.executionEnabled && <p role="status">Execution is not enabled on this server. Simulation and Review remain read-only.</p>}
      {canExecute && nextStep && <button type="button" className="primary" disabled={lp.busy} onClick={() => void lp.execute()}>Execute: {stepLabel[nextStep]}</button>}
      {needsRefresh && <button type="button" disabled={lp.busy} onClick={() => void lp.refresh()}>Refresh simulation for the next step</button>}
      {pending && <button type="button" disabled={lp.busy} onClick={() => void lp.observe()}>Observe existing transaction</button>}
      {record.attempts.length > 0 && <ol aria-label="Liquidity transactions">{record.attempts.map(a => <li key={a.attemptId}>{stepLabel[a.step]}: {a.state.toLowerCase().replaceAll('_', ' ')}
        {a.transactionHash && <> · <a href={explorer(a.replacementHash ?? a.transactionHash)} target="_blank" rel="noreferrer">view transaction</a></>}{a.note ? ` · ${message(a.note) ?? a.note}` : ''}</li>)}</ol>}
      {record.evidence && record.position && <section aria-label="Liquidity result" className="swap-result"><h3>Position created</h3>
        <p>Position NFT #{record.position.tokenId} is owned by your wallet {record.position.owner}. Deposited {usdc(record.position.amount0)} and {weth(record.position.amount1)};
          liquidity {record.position.liquidity}; ticks {record.position.tickLower} to {record.position.tickUpper}. Independently reconciled.</p>
        <p>Remaining allowances to the Position Manager: {usdc(record.evidence.residualAllowances.token0)} · {weth(record.evidence.residualAllowances.token1)}.</p>
        <p>Evidence: {record.evidence.evidenceClass} · bundle {record.evidence.bundleHash}</p>
        <a download="flofi-base-sepolia-liquidity-evidence.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>Download Evidence Bundle</a></section>}
      {record.attempts.length > 0 && !record.evidence && <a download="flofi-base-sepolia-liquidity-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>Download execution record</a>}
    </>}
    {info && <p role="status">{message(info) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.'}</p>}
    {lp.busy && <p role="status">Working…</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({ error: info, run: record?.id, commitment: r?.commitment, calls: r?.calls, attempts: record?.attempts, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
