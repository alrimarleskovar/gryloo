// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { ROBINHOOD_TESTNET_TRANSFER as profile } from '@defi-workflow-engine/action-registry';
import { createAuthoredTransfer, formatEth, transferDetails, type RobinhoodTransferInput } from '../domain/robinhood-transfer-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import { useBuild009Wallet, ROBINHOOD_TESTNET_HEX } from '../state/build009-wallet-store';

export function RobinhoodTransferAuthoringForm({ nodeId, onDone, direct = false }: { nodeId?: string; onDone?: () => void; direct?: boolean }) {
  const { state, propose, dispatch } = useWorkflow(), node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const existing = node ? transferDetails(node as Parameters<typeof transferDetails>[0]) : null;
  const [amount, setAmount] = useState(existing?.amount ?? '0.000001'), [error, setError] = useState('');
  function submit(event: FormEvent) { event.preventDefault(); try {
    const input: RobinhoodTransferInput = { network: 'Robinhood Chain Testnet', asset: 'ETH', amount, recipient: 'CONNECTED_OWNER' };
    createAuthoredTransfer(nodeId ?? 'node-preview', input);
    const command = nodeId ? { type: 'SET_RH_TRANSFER' as const, nodeId, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision }
      : { type: 'ADD_RH_TRANSFER' as const, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision };
    if (direct) dispatch(command); else propose(command); onDone?.();
  } catch { setError('Enter an exact positive test-ETH amount up to 0.001 with at most 18 decimal places.'); } }
  return <form className="inspector-fields" aria-label={nodeId ? 'Edit Robinhood transfer' : 'Create Robinhood transfer'} onSubmit={submit}>
    <strong>Robinhood Testnet test-ETH self-transfer</strong>
    <label>Transfer network<select aria-label="Transfer network" value="Robinhood Chain Testnet" onChange={() => undefined}><option>Robinhood Chain Testnet</option></select></label>
    <label>Transfer amount (test ETH)<input aria-label="Transfer amount (test ETH)" inputMode="decimal" value={amount} maxLength={40} onChange={e => setAmount(e.target.value)}/></label>
    <p>Recipient: your connected owner wallet (a self-transfer), bound at Review. Only the network fee is spent. A chain execution proof, not a DeFi action.</p>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{nodeId ? 'Review transfer change' : direct ? 'Add transfer' : 'Review transfer proposal'}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}
const messages: Record<string, string> = {
  TRANSFER_PUBLIC_TESTNET_NOT_ENABLED: 'Robinhood Testnet execution is not enabled on this app instance.',
  TRANSFER_WRONG_CHAIN: 'Switch your wallet to Robinhood Chain Testnet.', TRANSFER_WRONG_ACCOUNT: 'Select the owner wallet shown in Review.',
  TRANSFER_INSUFFICIENT_TEST_ETH: 'The owner wallet needs Robinhood Testnet ETH from the faucet.', TRANSFER_OWNER_NOT_EOA: 'The owner account has code (for example a smart-account delegation). Use a plain EOA account.',
  TRANSFER_PENDING_TRANSACTION: 'The wallet has a pending transaction. Wait for it to settle, then simulate again.',
  TRANSFER_REVIEW_EXPIRED: 'Review expired. Simulate and review again.', TRANSFER_AUTHORIZATION_STALE: 'Wallet state changed since Review. Simulate and review again.',
  TRANSFER_WALLET_NONCE_MISMATCH: 'The wallet would use a different nonce than the Review. Simulate and review again.',
  TRANSFER_REJECTED: 'The transfer request was declined in the wallet. Nothing was submitted.', AWAITING_CONFIRMATIONS: 'Waiting for network confirmations.',
  TRANSFER_TRANSACTION_NOT_OBSERVED: 'No transaction for the reviewed nonce is visible yet. Flofi will not submit again; observe later.',
  TRANSFER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING: 'The wallet result is uncertain. Flofi will not submit again; observe the existing request.',
  TRANSFER_SUBMISSION_UNKNOWN: 'The wallet result is uncertain. Flofi will not submit again; observe the existing request.',
  TRANSFER_RPC_RATE_LIMITED: 'The public Robinhood Testnet provider is busy. Try again.',
};
export function RobinhoodTransferPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { state } = useWorkflow(), run = useRobinhoodTransfer(), wallet = useBuild009Wallet(), record = run.record, review = record?.review;
  const node = state.workflow.nodes.find(n => n.actionType === 'asset.transfer'), fields = node ? transferDetails(node as Parameters<typeof transferDetails>[0]) : null;
  const attempt = record?.attempt, info = run.error ?? record?.error, observation = record?.observations.at(-1);
  const observing = Boolean(attempt && !attempt.reconciled && !record?.notSubmitted && record?.verdict === 'PENDING');
  const evidenceLevel = record?.evidence ? `${record.evidence.bundle.environment} / RECONCILED` : record?.verdict === 'DIVERGENT' ? 'DIVERGENT' : record?.authorization ? 'READY_FOR_OWNER_EXECUTION' : null;
  return <section className="panel" aria-label="Robinhood Testnet transfer"><h2>{view === 'simulate' ? 'Simulate Robinhood transfer' : record?.evidence ? 'Robinhood transfer result' : 'Review Robinhood transfer'}</h2>
    <p>Self-transfer {fields?.amount ?? (review ? formatEth(review.value) : '')} test ETH on Robinhood Chain Testnet. A chain execution proof, not a DeFi action.</p>
    {run.retired && record && <p role="alert">The workflow changed. Authorization is invalid. Observe any existing transaction before starting again.</p>}
    {review && <dl className="step-facts">
      <div><dt>Network</dt><dd>Robinhood Chain Testnet · chain ID {review.chainId} ({review.chain})</dd></div>
      <div><dt>Owner</dt><dd className="numeric">{review.account}</dd></div><div><dt>Recipient</dt><dd className="numeric">{review.recipient} (owner, self-transfer)</dd></div>
      <div><dt>Exact value</dt><dd className="numeric">{formatEth(review.value)} ETH ({review.value} wei)</dd></div>
      <div><dt>Calldata</dt><dd><code>{review.transaction.data}</code> (none: native transfer)</dd></div>
      <div><dt>Current balance</dt><dd className="numeric">{formatEth(review.balanceBefore)} ETH</dd></div>
      <div><dt>Expected balance after</dt><dd className="numeric">{formatEth(review.expectedBalanceAfter)} ETH (value returns to the owner; only the fee is spent)</dd></div>
      <div><dt>Gas estimate</dt><dd className="numeric">{review.gasEstimate} gas (limit {review.gasLimit})</dd></div>
      <div><dt>Expected network cost</dt><dd className="numeric">{formatEth(review.expectedFee)} ETH</dd></div>
      <div><dt>Maximum fee budget</dt><dd className="numeric">{formatEth(review.feeBudget)} ETH ({review.gasLimit} gas × {review.maxFeePerGas} wei)</dd></div>
      <div><dt>Worst-case balance after</dt><dd className="numeric">{formatEth(review.minimumBalanceAfter)} ETH</dd></div>
      <div><dt>Nonce</dt><dd className="numeric">{review.nonce}</dd></div>
      <div><dt>Reviewed state</dt><dd className="numeric">block {review.state.block} · {review.state.blockHash}</dd></div>
      <div><dt>Review expires</dt><dd>{review.expiresAt}</dd></div>
      <div><dt>Exact transaction</dt><dd className="numeric">{JSON.stringify(review.transaction)}</dd></div>
    </dl>}
    {evidenceLevel && <p role="status">Evidence state: {evidenceLevel}</p>}
    {view === 'simulate' ? <button type="button" disabled={run.busy || observing} onClick={() => void run.simulate()}>Simulate transfer</button> : <>
      {record && wallet.account && wallet.chainId !== ROBINHOOD_TESTNET_HEX && !record.evidence && <div><p role="status">Switch your wallet to Robinhood Chain Testnet to continue.</p>
        <button type="button" disabled={run.busy} onClick={() => void run.switchNetwork()}>Switch to Robinhood Chain Testnet</button></div>}
      {record && !record.authorization && !attempt && !run.retired && record.verdict === 'PENDING' && <button type="button" disabled={run.busy} onClick={() => void run.review()}>Accept transfer review</button>}
      {record?.authorization && !run.retired && !attempt && record.verdict === 'PENDING' && <button type="button" className="primary" disabled={run.busy} onClick={() => void run.execute()}>Execute</button>}
      {attempt && <p>Transfer: {attempt.reconciled ? 'Reconciled from public chain state' : record?.notSubmitted ? 'not submitted' : attempt.state.toLowerCase().replaceAll('_', ' ')}
        {attempt.transactionHash && <> <a href={`${profile.explorer}/tx/${attempt.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a></>}</p>}
      {observing && <button type="button" disabled={run.busy} onClick={() => void run.observe()}>Observe existing transaction</button>}
      {record?.notSubmitted && record.verdict === 'PENDING' && !run.retired && <><p>The wallet request was not submitted. Prepare a fresh explicit owner Review.</p>
        <button type="button" disabled={run.busy} onClick={() => void run.recoverReview()}>Prepare fresh review</button></>}
      {attempt && !record?.evidence && <a download="flofi-rh-demo-001-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>Download execution record</a>}
      {record?.evidence && observation?.facts && <><p>Transfer reconciled. Exactly one owner-signed transaction, nonce {observation.facts.nonceBefore} → {observation.facts.nonceAfter},
        block {observation.facts.blockNumber}; network cost {formatEth(observation.facts.fee)} ETH; balance {formatEth(observation.facts.balanceBefore)} → {formatEth(observation.facts.balanceAfter)} ETH.</p>
        <a download="flofi-rh-demo-001-evidence.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>Download Evidence Bundle</a></>}
    </>}
    {info && <p role="status">{messages[info] ?? 'The transfer needs attention. Inspect technical details and observe any existing transaction.'}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({ error: info, attempt, observations: record?.observations, walletDiagnostic: record?.walletDiagnostic,
      environment: record?.evidence?.bundle.environment, journal: record?.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState) }, null, 2)}</pre></details>
  </section>;
}
