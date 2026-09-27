// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatHumanAmount } from '../domain/swap-authoring';
import type { PreparedExecution } from '../server/mode-a-service';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import type { BrowserDecoded } from '../wallet/eip1193';
import { forkTime } from './fork-simulation-panel';
import { StatusBadge } from './status-badge';

const SYMBOLS: Readonly<Record<string, 'USDC' | 'WETH'>> = { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC', '0x4200000000000000000000000000000000000006': 'WETH' };

export function PayloadFields({ decoded, prepared, label }: { decoded: BrowserDecoded; prepared: PreparedExecution; label: string }) {
  const { context } = useWorkflow();
  const token = (address: string, units: string) => {
    const symbol = SYMBOLS[address];
    return symbol ? `${formatHumanAmount(units, symbol, context)} ${symbol} · ${units} native units` : `${units} native units of ${address}`;
  };
  return <table className="payload-table" aria-label={label}><tbody>
    <tr><th scope="row">Chain</th><td>{decoded.chainId} (local fork; not Base 8453)</td></tr>
    <tr><th scope="row">Nonce</th><td className="numeric">{decoded.nonce}</td></tr>
    <tr><th scope="row">Target · function</th><td><code>{decoded.to}</code> · <code>{decoded.functionSelector}</code> {decoded.approve ? 'approve' : 'multicall(exactInputSingle)'}</td></tr>
    {decoded.approve && <>
      <tr><th scope="row">Spender</th><td><code>{decoded.approve.spender}</code> (SwapRouter02)</td></tr>
      <tr><th scope="row">Allowance</th><td className="numeric">{token(decoded.to, decoded.approve.amount)}</td></tr>
    </>}
    {decoded.swap && <>
      <tr><th scope="row">Input</th><td className="numeric">{token(decoded.swap.tokenIn, decoded.swap.amountIn)}</td></tr>
      <tr><th scope="row">Minimum output</th><td className="numeric">{token(decoded.swap.tokenOut, decoded.swap.amountOutMinimum)}</td></tr>
      <tr><th scope="row">Recipient</th><td><code>{decoded.swap.recipient}</code>{decoded.swap.recipient === prepared.owner ? ' (the reviewed local owner)' : ''}</td></tr>
      <tr><th scope="row">Fee tier · deadline</th><td>{decoded.swap.fee} · {forkTime(decoded.swap.deadline)}</td></tr>
    </>}
    <tr><th scope="row">Value</th><td className="numeric">{decoded.value} ETH</td></tr>
    <tr><th scope="row">Gas limit · fee caps</th><td className="numeric">{decoded.gasLimit} gas · max {decoded.maxFeePerGas} wei · priority {decoded.maxPriorityFeePerGas} wei</td></tr>
  </tbody></table>;
}

export function ManifestReview() {
  const { prepared, verified, verifyError, reviewAccepted, retired, recoveryOnly, acceptReview, info } = useModeA();
  if (!prepared || !info?.available) return null;
  const matrix = prepared.artifacts.matrix;
  const steps = [['step-approve', 'Wallet authorization 1 of 2 · approve'], ['step-swap', 'Wallet authorization 2 of 2 · swap']] as const;
  return <section className="manifest-review panel" aria-label="Mode A Manifest review">
    <div className="simulate-head">
      <div><p className="eyebrow">EXECUTE / MODE A MANIFEST REVIEW</p><h2>Review two exact wallet authorizations</h2>
        <p className="muted">Mode A binds exactly the bytes below. Your wallet signs each payload separately; Gryloo never signs, never broadcasts and never receives a key. Local fork only: chain 31337, source {prepared.environment === 'MOCKED' ? 'synthetic chain-8453' : 'recorded Base'} block {prepared.source.blockNumber}.</p></div>
      <div className="simulate-controls"><StatusBadge label={prepared.environment} tone={prepared.environment === 'MOCKED' ? 'info' : 'warning'}/><StatusBadge label="MODE_A"/><StatusBadge label="EXACT_SIGNED_PAYLOAD" tone="info"/></div>
    </div>
    <ol className="chain-strip" aria-label="Mode A artifact hashes">
      <li><span>Execution ID</span><code>{prepared.executionId}</code></li>
      <li><span>Authorization Policy</span><code>{prepared.hashes.policyHash}</code></li>
      <li><span>Strategy Manifest</span><code>{prepared.hashes.manifestHash}</code></li>
      <li><span>Execution Plan</span><code>{prepared.hashes.executionPlanHash}</code></li>
      <li><span>Enforcement matrix</span><code>{prepared.hashes.enforcementMatrixHash}</code></li>
      <li><span>Source state identity</span><code>{prepared.source.stateSourceHash}</code></li>
    </ol>
    <div className="payload-grid">
      {steps.map(([stepId, label]) => {
        const view = prepared.payloads.find(item => item.stepId === stepId)!;
        const decoded = verified[stepId]?.decoded;
        return <article key={stepId} className="payload-card" aria-label={label}>
          <h3>{label}</h3>
          <p className="payload-hash">Payload hash <code>{view.payloadHash}</code> · browser recomputation {verified[stepId]?.payloadHash === view.payloadHash ? 'EXACT' : 'NOT VERIFIED'}</p>
          {decoded ? <PayloadFields decoded={decoded} prepared={prepared} label={`Decoded fields · ${stepId}`}/> : <p className="simulate-alert">Not verified in this browser.</p>}
        </article>;
      })}
    </div>
    <table className="enforcement-table" aria-label="Mode A enforcement locations"><thead><tr><th scope="col">Limit</th><th scope="col">Value</th><th scope="col">Enforcement</th></tr></thead><tbody>
      {matrix.limits.map(limit => <tr key={limit.limitId}><td>{limit.description}</td><td className="numeric">{limit.value}</td><td>{limit.locations.join(', ')}</td></tr>)}
    </tbody></table>
    <ul className="fork-limitations" aria-label="Mode A limitations">
      <li>Residual allowance risk: if the swap fails after approval, the router keeps a finite allowance until you revoke it in a separate Mode A authorization. Local pause does not revoke.</li>
      <li>Policy, Manifest and Execution Plan are review artifacts; their v1 fields are NOT_ENFORCED on chain. Only the signed payload fields are enforced by the chain.</li>
      <li>Limitations: {matrix.limitations.join(', ')}.</li>
      <li>FORK_REPRODUCED ceiling: no mainnet or public testnet effect; not production certified. USD values: not modeled.</li>
    </ul>
    {verifyError && <p className="simulate-alert" role="alert">Browser verification blocked review: {verifyError}.</p>}
    {recoveryOnly && <p className="simulate-note" role="status">Recovered from the journal after a restart. Only observation, reconciliation and revocation are available for this execution.</p>}
    <div className="simulate-controls">
      <button type="button" onClick={acceptReview} disabled={reviewAccepted || retired || Boolean(verifyError) || !verified['step-approve'] || !verified['step-swap']}>
        {reviewAccepted ? 'Manifest reviewed' : 'I reviewed both exact payloads'}</button>
    </div>
  </section>;
}
