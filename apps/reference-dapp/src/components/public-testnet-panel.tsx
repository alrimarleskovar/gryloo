// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { usePublicTestnet } from '../state/public-testnet-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useWorkflow } from '../state/workflow-store';
import { BASE_SEPOLIA, publicSwapProfile } from '../domain/public-testnet-swap';

function units(value: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return '--';
  const padded = value.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}
const amount = (value: string, symbol: 'USDC' | 'WETH') => `${units(value, symbol === 'USDC' ? 6 : 18)} ${symbol}`;
export function PublicTestnetPanel({ view }: { view: 'simulate' | 'execute' }) {
  const flow = usePublicTestnet();
  const wallet = useBuild009Wallet();
  const { run, busy, error } = flow;
  const quote = run?.quote;
  // The quoted chain (else the authored swap's chain) names the network; Base Sepolia before anything is authored, as before.
  const authored = useWorkflow().state.workflow.nodes.find(node => node.actionType === 'asset.swap.exact-input')?.chainId;
  const profile = publicSwapProfile(quote?.chainId ?? authored) ?? BASE_SEPOLIA, network = profile.network;
  const last = run?.attempts.at(-1);
  const receipt = last?.receipt;
  const needReview = quote && run?.reviewedManifestHash !== quote.manifestHash;
  const expired = quote ? Date.now() >= Date.parse(quote.expiresAt) : false;
  if (view === 'simulate') return <section className="simulate-panel panel" aria-label={`${network} swap simulation`}>
    <div className="simulate-head"><div><p className="eyebrow">SIMULATE</p><h2>Uniswap swap · {network}</h2>
      <p className="muted">Get a current quote from the public pool before reviewing the swap.</p></div>
      <button type="button" onClick={flow.simulate} disabled={Boolean(busy) || !flow.available || Boolean(last && ['PREPARED','HASH','PENDING','UNKNOWN'].includes(last.state))}>Simulate</button></div>
    {!flow.available && <p role="status">Public testnet recording is not enabled on this app instance.</p>}
    {busy && <p role="status">{busy}…</p>}{error && <p role="alert">{error}</p>}
    {quote && !flow.retired && <div className="step-card" aria-label="Live swap quote"><h3>Current quote</h3>
      <dl className="step-facts"><div><dt>You pay</dt><dd className="numeric">{amount(quote.amountIn, quote.inputSymbol)}</dd></div>
        <div><dt>Expected</dt><dd className="numeric">{amount(quote.expectedOut, quote.outputSymbol)}</dd></div>
        <div><dt>Minimum received</dt><dd className="numeric">{amount(quote.minimumOut, quote.outputSymbol)}</dd></div>
        <div><dt>Slippage</dt><dd className="numeric">{quote.slippageBps / 100}%</dd></div>
        <div><dt>Network</dt><dd>{network}</dd></div></dl>
      {expired && <p role="status">Quote expired. Simulate again.</p>}
    </div>}
    {flow.retired && <p role="status">The swap changed. Simulate again to review the new amount.</p>}
  </section>;
  if (!quote || !run) return <section className="panel" aria-label="Swap review"><h2>Simulate your swap first</h2>
    <p>Get a current {network} quote before reviewing a transaction.</p></section>;
  if (run.outcome) return <section className="execution-panel panel" aria-label="Swap result">
    <p className="eyebrow">RESULT</p><h2>Executed ✓</h2><p>{network}</p>
    <dl className="step-facts"><div><dt>Swapped</dt><dd className="numeric">{amount(run.outcome.inputSpent, quote.inputSymbol)}</dd></div>
      <div><dt>Received</dt><dd className="numeric">{amount(run.outcome.outputReceived, quote.outputSymbol)}</dd></div>
      <div><dt>{last?.receipt?.gasPayer !== last?.account ? 'Sponsored network fee' : 'Network fee'}</dt>
        <dd className="numeric">{units(run.outcome.gasCostWei, 18)} ETH</dd></div>
      <div><dt>Transaction</dt><dd className="numeric">{last?.txHash}</dd></div></dl>
    <a href={run.outcome.explorer} target="_blank" rel="noopener noreferrer">View transaction</a>
    <details><summary>Technical evidence</summary><pre>{JSON.stringify({ evidenceBundleHash: run.outcome.evidenceBundleHash,
      bundle: run.outcome.evidence, receipt, attempts: run.attempts }, null, 2)}</pre></details>
  </section>;
  return <section className="execution-panel panel" aria-label="Swap review and execution">
    <p className="eyebrow">REVIEW</p><h2>Swap on {network}</h2>
    <dl className="step-facts"><div><dt>You pay</dt><dd className="numeric">{amount(quote.amountIn, quote.inputSymbol)}</dd></div>
      <div><dt>Expected</dt><dd className="numeric">{amount(quote.expectedOut, quote.outputSymbol)}</dd></div>
      <div><dt>Minimum received</dt><dd className="numeric">{amount(quote.minimumOut, quote.outputSymbol)}</dd></div>
      <div><dt>Slippage</dt><dd className="numeric">{quote.slippageBps / 100}%</dd></div>
      <div><dt>Network</dt><dd>{network}</dd></div>
      <div><dt>Network cost</dt><dd>Shown in your wallet before confirmation</dd></div>
      <div><dt>Token approval</dt><dd>Requested only if your current allowance is insufficient</dd></div></dl>
    {flow.retired && <p role="alert">This swap changed. Simulate it again.</p>}
    {expired && <p role="status">Quote expired. Simulate again.</p>}
    {error && <p role="alert">{error}</p>}{busy && <p role="status">{busy}…</p>}
    {wallet.account && wallet.chainId !== profile.chainHex && <div><p role="status">Switch your wallet to {network} to continue.</p>
      <button type="button" onClick={flow.switchNetwork} disabled={Boolean(busy)}>Switch to {network}</button></div>}
    {last?.state === 'REVERTED' && <p role="alert">{last.step === 'approval' ? 'Token approval reverted.' : 'The swap reverted.'} <a href={`${profile.explorer}${last.txHash}`} target="_blank" rel="noopener noreferrer">View transaction</a></p>}
    {last?.state === 'REJECTED' && <p role="status">Wallet authorization was rejected. You can try again.</p>}
    {last?.state === 'UNKNOWN' && <p role="alert">The wallet result is uncertain. Flofi will not submit this transaction again.</p>}
    {last && ['HASH','PENDING','CONFIRMED'].includes(last.state) && !run.outcome && <div><p role="status">{last.step === 'approval' && last.state === 'CONFIRMED' ? 'Token approval confirmed. Continue to the swap.' :
      last.state === 'CONFIRMED' ? 'Transaction confirmed. Checking token balances.' : 'Transaction submitted. Waiting for a public receipt.'}</p>
      {last.txHash && <a href={`${profile.explorer}${last.txHash}`} target="_blank" rel="noopener noreferrer">View transaction</a>}
      {last.state !== 'CONFIRMED' || last.step === 'swap' ? <button type="button" onClick={flow.observe} disabled={Boolean(busy)}>Check result</button> : null}</div>}
    <div className="simulate-controls">
      {needReview && !flow.retired && !expired && last?.step !== 'swap' && last?.state !== 'UNKNOWN' &&
        <button type="button" onClick={flow.review} disabled={Boolean(busy)}>Confirm review</button>}
      {!needReview && !flow.retired && !expired && last?.state !== 'UNKNOWN' &&
        !['PREPARED','HASH','PENDING'].includes(last?.state ?? '') && last?.step !== 'swap' &&
        <button type="button" className="primary" onClick={flow.execute} disabled={Boolean(busy) || (wallet.account !== null && wallet.chainId !== profile.chainHex)}>
          {last?.step === 'approval' ? 'Continue to swap' : 'Execute'}</button>}
    </div>
    <details><summary>Transaction details</summary><p>Uniswap v3 pool {quote.pool} · fee tier {quote.fee} · quote block {quote.blockNumber}.</p>
      <p>Reviewed manifest: <code>{quote.manifestHash}</code>.</p></details>
  </section>;
}
