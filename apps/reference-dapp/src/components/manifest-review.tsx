// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { formatHumanAmount } from '../domain/swap-authoring';
import type { PreparedExecution } from '../server/mode-a-service';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import type { BrowserDecoded } from '../wallet/eip1193';
import { forkTime } from './fork-simulation-panel';
import { StatusBadge } from './status-badge';

const SYMBOLS: Readonly<Record<string, 'USDC' | 'WETH'>> = { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC', '0x4200000000000000000000000000000000000006': 'WETH' };

export function PayloadFields({ decoded, prepared, label }: { decoded: BrowserDecoded; prepared: PreparedExecution; label: string }) {
  const { t: tr } = useLocale();
  const { context } = useWorkflow();
  const token = (address: string, units: string) => {
    const symbol = SYMBOLS[address];
    return symbol ? `${formatHumanAmount(units, symbol, context)} ${symbol} · ${units} native units` : `${units} native units of ${address}`;
  };
  return <table className="payload-table" aria-label={tr(label)}><tbody>
    <tr><th scope="row">{tr("Chain")}</th><td>{tr(decoded.chainId)}{tr(" (local fork; not Base 8453)")}</td></tr>
    <tr><th scope="row">{tr("Nonce")}</th><td className="numeric">{tr(decoded.nonce)}</td></tr>
    <tr><th scope="row">{tr("Target · function")}</th><td><code>{tr(decoded.to)}</code> · <code>{tr(decoded.functionSelector)}</code> {tr(decoded.approve ? 'approve' : 'multicall(exactInputSingle)')}</td></tr>
    {decoded.approve && <>
      <tr><th scope="row">{tr("Spender")}</th><td><code>{tr(decoded.approve.spender)}</code>{tr(" (SwapRouter02)")}</td></tr>
      <tr><th scope="row">{tr("Allowance")}</th><td className="numeric">{tr(token(decoded.to, decoded.approve.amount))}</td></tr>
    </>}
    {decoded.swap && <>
      <tr><th scope="row">{tr("Input")}</th><td className="numeric">{tr(token(decoded.swap.tokenIn, decoded.swap.amountIn))}</td></tr>
      <tr><th scope="row">{tr("Minimum output")}</th><td className="numeric">{tr(token(decoded.swap.tokenOut, decoded.swap.amountOutMinimum))}</td></tr>
      <tr><th scope="row">{tr("Recipient")}</th><td><code>{tr(decoded.swap.recipient)}</code>{tr(decoded.swap.recipient === prepared.owner ? ' (the reviewed local owner)' : '')}</td></tr>
      <tr><th scope="row">{tr("Fee tier · deadline")}</th><td>{tr(decoded.swap.fee)} · {tr(forkTime(decoded.swap.deadline))}</td></tr>
    </>}
    <tr><th scope="row">{tr("Value")}</th><td className="numeric">{tr(decoded.value)}{tr(" ETH")}</td></tr>
    <tr><th scope="row">{tr("Gas limit · fee caps")}</th><td className="numeric">{tr(decoded.gasLimit)}{tr(" gas · max ")}{tr(decoded.maxFeePerGas)}{tr(" wei · priority ")}{tr(decoded.maxPriorityFeePerGas)}{tr(" wei")}</td></tr>
  </tbody></table>;
}

export function ManifestReview() {
  const { t: tr } = useLocale();
  const { prepared, verified, verifyError, reviewAccepted, retired, recoveryOnly, acceptReview, info } = useModeA();
  if (!prepared || !info?.available) return null;
  const matrix = prepared.artifacts.matrix;
  const steps = [['step-approve', 'Wallet authorization 1 of 2 · approve'], ['step-swap', 'Wallet authorization 2 of 2 · swap']] as const;
  return <section className="manifest-review panel" aria-label={tr("Mode A Manifest review")}>
    <div className="simulate-head">
      <div><p className="eyebrow">{tr("EXECUTE / MODE A MANIFEST REVIEW")}</p><h2>{tr("Review two exact wallet authorizations")}</h2>
        <p className="muted">{tr("Mode A binds exactly the bytes below. Your wallet signs each payload separately; Flofi never signs, never broadcasts and never receives a key. Local fork only: chain 31337, source ")}{tr(prepared.environment === 'MOCKED' ? 'synthetic chain-8453' : 'recorded Base')}{tr(" block ")}{tr(prepared.source.blockNumber)}.</p></div>
      <div className="simulate-controls"><StatusBadge label={prepared.environment} tone={prepared.environment === 'MOCKED' ? 'info' : 'warning'}/><StatusBadge label="MODE_A"/><StatusBadge label="EXACT_SIGNED_PAYLOAD" tone="info"/></div>
    </div>
    <ol className="chain-strip" aria-label={tr("Mode A artifact hashes")}>
      <li><span>{tr("Execution ID")}</span><code>{prepared.executionId}</code></li>
      <li><span>{tr("Authorization Policy")}</span><code>{tr(prepared.hashes.policyHash)}</code></li>
      <li><span>{tr("Strategy Manifest")}</span><code>{prepared.hashes.manifestHash}</code></li>
      <li><span>{tr("Execution Plan")}</span><code>{tr(prepared.hashes.executionPlanHash)}</code></li>
      <li><span>{tr("Enforcement matrix")}</span><code>{tr(prepared.hashes.enforcementMatrixHash)}</code></li>
      <li><span>{tr("Source state identity")}</span><code>{tr(prepared.source.stateSourceHash)}</code></li>
    </ol>
    <div className="payload-grid">
      {steps.map(([stepId, label]) => {
        const view = prepared.payloads.find(item => item.stepId === stepId)!;
        const decoded = verified[stepId]?.decoded;
        return <article key={stepId} className="payload-card" aria-label={tr(label)}>
          <h3>{tr(label)}</h3>
          <p className="payload-hash">{tr("Payload hash ")}<code>{tr(view.payloadHash)}</code>{tr(" · browser recomputation ")}{tr(verified[stepId]?.payloadHash === view.payloadHash ? 'EXACT' : 'NOT VERIFIED')}</p>
          {decoded ? <PayloadFields decoded={decoded} prepared={prepared} label={`Decoded fields · ${stepId}`}/> : <p className="simulate-alert">{tr("Not verified in this browser.")}</p>}
        </article>;
      })}
    </div>
    <table className="enforcement-table" aria-label={tr("Mode A enforcement locations")}><thead><tr><th scope="col">{tr("Limit")}</th><th scope="col">{tr("Value")}</th><th scope="col">{tr("Enforcement")}</th></tr></thead><tbody>
      {matrix.limits.map(limit => <tr key={limit.limitId}><td>{tr(limit.description)}</td><td className="numeric">{tr(limit.value)}</td><td>{tr(limit.locations.join(', '))}</td></tr>)}
    </tbody></table>
    <ul className="fork-limitations" aria-label={tr("Mode A limitations")}>
      <li>{tr("Residual allowance risk: if the swap fails after approval, the router keeps a finite allowance until you revoke it in a separate Mode A authorization. Local pause does not revoke.")}</li>
      <li>{tr("Policy, Manifest and Execution Plan are review artifacts; their v1 fields are NOT_ENFORCED on chain. Only the signed payload fields are enforced by the chain.")}</li>
      <li>{tr("Limitations: ")}{tr(matrix.limitations.join(', '))}.</li>
      <li>{tr("FORK_REPRODUCED ceiling: no mainnet or public testnet effect; not production certified. USD values: not modeled.")}</li>
    </ul>
    {verifyError && <p className="simulate-alert" role="alert">{tr("Browser verification blocked review: ")}{tr(verifyError)}.</p>}
    {recoveryOnly && <p className="simulate-note" role="status">{tr("Recovered from the journal after a restart. Only observation, reconciliation and revocation are available for this execution.")}</p>}
    <div className="simulate-controls">
      <button type="button" onClick={acceptReview} disabled={reviewAccepted || retired || Boolean(verifyError) || !verified['step-approve'] || !verified['step-swap']}>
        {tr(reviewAccepted ? 'Manifest reviewed' : 'I reviewed both exact payloads')}</button>
    </div>
  </section>;
}
