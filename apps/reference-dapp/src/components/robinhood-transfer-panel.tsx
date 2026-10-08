// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useState, type FormEvent } from 'react';
import { createAuthoredTransfer, formatEth, transferDetails, transferProfileFor, TRANSFER_NETWORKS, type RobinhoodTransferInput, type TransferNetwork } from '../domain/robinhood-transfer-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';

/** Copy is written for Robinhood Testnet; another transfer network's name is substituted. Display text only. */
const short = (network: TransferNetwork) => network === 'Robinhood Chain Testnet' ? 'Robinhood' : network;
function transferCopy(text: string, network: TransferNetwork): string {
  return network === 'Robinhood Chain Testnet' ? text : text.replaceAll('Robinhood Chain Testnet', network).replaceAll('Robinhood Testnet', network).replaceAll('Robinhood', network);
}

export function RobinhoodTransferAuthoringForm({ nodeId, onDone, direct = false }: { nodeId?: string; onDone?: () => void; direct?: boolean }) {
  const { t: tr } = useLocale();
  const { state, propose, dispatch } = useWorkflow(), node = state.workflow.nodes.find(n => n.nodeId === nodeId);
  const existing = node ? transferDetails(node as Parameters<typeof transferDetails>[0]) : null;
  const [amount, setAmount] = useState(existing?.amount ?? '0.000001'), [error, setError] = useState('');
  const [network, setNetwork] = useState<TransferNetwork>(existing?.network ?? 'Robinhood Chain Testnet');
  function submit(event: FormEvent) { event.preventDefault(); try {
    const input: RobinhoodTransferInput = { network, asset: 'ETH', amount, recipient: 'CONNECTED_OWNER' };
    createAuthoredTransfer(nodeId ?? 'node-preview', input);
    const command = nodeId ? { type: 'SET_RH_TRANSFER' as const, nodeId, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision }
      : { type: 'ADD_RH_TRANSFER' as const, input, source: 'CANVAS' as const, baseRevision: state.workflow.revision };
    if (direct) dispatch(command); else propose(command); onDone?.();
  } catch { setError('Enter an exact positive test-ETH amount up to 0.001 with at most 18 decimal places.'); } }
  return <form className="inspector-fields" aria-label={tr(nodeId ? 'Edit Robinhood transfer' : 'Create Robinhood transfer')} onSubmit={submit}>
    <strong>{tr(transferCopy('Robinhood Testnet test-ETH self-transfer', network))}</strong>
    <label>{tr("Transfer network")}<select aria-label={tr("Transfer network")} value={network} onChange={e => setNetwork(e.target.value as TransferNetwork)}>
      {(Object.keys(TRANSFER_NETWORKS) as TransferNetwork[]).map(name => <option key={name}>{name}</option>)}</select></label>
    <label>{tr("Transfer amount (test ETH)")}<input aria-label={tr("Transfer amount (test ETH)")} inputMode="decimal" value={amount} maxLength={40} onChange={e => setAmount(e.target.value)}/></label>
    <p>{tr("Recipient: your connected owner wallet (a self-transfer), bound at Review. Only the network fee is spent. A chain execution proof, not a DeFi action.")}</p>
    {error && <p role="alert">{tr(error)}</p>}
    <button type="submit">{tr(nodeId ? 'Review transfer change' : direct ? 'Add transfer' : 'Review transfer proposal')}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>{tr("Cancel")}</button>}
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
  const { t: tr } = useLocale();
  const { state } = useWorkflow(), run = useRobinhoodTransfer(), wallet = useBuild009Wallet(), record = run.record, review = record?.review;
  const node = state.workflow.nodes.find(n => n.actionType === 'asset.transfer'), fields = node ? transferDetails(node as Parameters<typeof transferDetails>[0]) : null;
  // The reviewed chain (else the authored one) names the network; Robinhood Testnet before anything is authored, as before.
  const network: TransferNetwork = (Object.keys(TRANSFER_NETWORKS) as TransferNetwork[]).find(name => TRANSFER_NETWORKS[name].chain === (review?.chain ?? node?.chainId)) ?? 'Robinhood Chain Testnet';
  const profile = transferProfileFor(network);
  const attempt = record?.attempt, info = run.error ?? record?.error, observation = record?.observations.at(-1);
  const observing = Boolean(attempt && !attempt.reconciled && !record?.notSubmitted && record?.verdict === 'PENDING');
  const evidenceLevel = record?.evidence ? `${record.evidence.bundle.environment} / RECONCILED` : record?.verdict === 'DIVERGENT' ? 'DIVERGENT' : record?.authorization ? 'READY_FOR_OWNER_EXECUTION' : null;
  return <section className="panel" aria-label={tr(transferCopy('Robinhood Testnet transfer', network))}><h2>{tr(view === 'simulate' ? `Simulate ${short(network)} transfer` : record?.evidence ? `${short(network)} transfer result` : `Review ${short(network)} transfer`)}</h2>
    <p>{tr("Self-transfer ")}{tr(fields?.amount ?? (review ? formatEth(review.value) : ''))}{tr(" test ETH on ")}{network}{tr(". A chain execution proof, not a DeFi action.")}</p>
    {run.retired && record && <p role="alert">{tr("The workflow changed. Authorization is invalid. Observe any existing transaction before starting again.")}</p>}
    {review && <dl className="step-facts">
      <div><dt>{tr("Network")}</dt><dd>{network}{tr(" · chain ID ")}{tr(review.chainId)} ({tr(review.chain)})</dd></div>
      <div><dt>{tr("Owner")}</dt><dd className="numeric">{review.account}</dd></div><div><dt>{tr("Recipient")}</dt><dd className="numeric">{tr(review.recipient)}{tr(" (owner, self-transfer)")}</dd></div>
      <div><dt>{tr("Exact value")}</dt><dd className="numeric">{tr(formatEth(review.value))}{tr(" ETH (")}{tr(review.value)}{tr(" wei)")}</dd></div>
      <div><dt>{tr("Calldata")}</dt><dd><code>{tr(review.transaction.data)}</code>{tr(" (none: native transfer)")}</dd></div>
      <div><dt>{tr("Current balance")}</dt><dd className="numeric">{tr(formatEth(review.balanceBefore))}{tr(" ETH")}</dd></div>
      <div><dt>{tr("Expected balance after")}</dt><dd className="numeric">{tr(formatEth(review.expectedBalanceAfter))}{tr(" ETH (value returns to the owner; only the fee is spent)")}</dd></div>
      <div><dt>{tr("Gas estimate")}</dt><dd className="numeric">{tr(review.gasEstimate)}{tr(" gas (limit ")}{tr(review.gasLimit)})</dd></div>
      <div><dt>{tr("Expected network cost")}</dt><dd className="numeric">{tr(formatEth(review.expectedFee))}{tr(" ETH")}</dd></div>
      <div><dt>{tr("Maximum fee budget")}</dt><dd className="numeric">{tr(formatEth(review.feeBudget))}{tr(" ETH (")}{tr(review.gasLimit)}{tr(" gas × ")}{tr(review.maxFeePerGas)}{tr(" wei)")}</dd></div>
      <div><dt>{tr("Worst-case balance after")}</dt><dd className="numeric">{tr(formatEth(review.minimumBalanceAfter))}{tr(" ETH")}</dd></div>
      <div><dt>{tr("Nonce")}</dt><dd className="numeric">{tr(review.nonce)}</dd></div>
      <div><dt>{tr("Reviewed state")}</dt><dd className="numeric">{tr("block ")}{tr(review.state.block)} · {tr(review.state.blockHash)}</dd></div>
      <div><dt>{tr("Review expires")}</dt><dd>{tr(review.expiresAt)}</dd></div>
      <div><dt>{tr("Exact transaction")}</dt><dd className="numeric">{JSON.stringify(review.transaction)}</dd></div>
    </dl>}
    {evidenceLevel && <p role="status">{tr("Evidence state: ")}{tr(evidenceLevel)}</p>}
    {view === 'simulate' ? <button type="button" disabled={run.busy || observing} onClick={() => void run.simulate()}>{tr("Simulate transfer")}</button> : <>
      {record && wallet.account && wallet.chainId !== profile.chainHex && !record.evidence && <div><p role="status">{tr("Switch your wallet to ")}{network}{tr(" to continue.")}</p>
        <button type="button" disabled={run.busy} onClick={() => void run.switchNetwork()}>{tr("Switch to ")}{network}</button></div>}
      {record && !record.authorization && !attempt && !run.retired && record.verdict === 'PENDING' && <button type="button" disabled={run.busy} onClick={() => void run.review()}>{tr("Accept transfer review")}</button>}
      {record?.authorization && !run.retired && !attempt && record.verdict === 'PENDING' && <button type="button" className="primary" disabled={run.busy} onClick={() => void run.execute()}>{tr("Execute")}</button>}
      {attempt && <p>{tr("Transfer: ")}{tr(attempt.reconciled ? 'Reconciled from public chain state' : record?.notSubmitted ? 'not submitted' : attempt.state.toLowerCase().replaceAll('_', ' '))}
        {attempt.transactionHash && <> <a href={`${profile.explorer}/tx/${attempt.transactionHash}`} target="_blank" rel="noreferrer">{tr("View transaction")}</a></>}</p>}
      {observing && <button type="button" disabled={run.busy} onClick={() => void run.observe()}>{tr("Observe existing transaction")}</button>}
      {record?.notSubmitted && record.verdict === 'PENDING' && !run.retired && <><p>{tr("The wallet request was not submitted. Prepare a fresh explicit owner Review.")}</p>
        <button type="button" disabled={run.busy} onClick={() => void run.recoverReview()}>{tr("Prepare fresh review")}</button></>}
      {attempt && !record?.evidence && <a download="flofi-rh-demo-001-execution-record.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>{tr("Download execution record")}</a>}
      {record?.evidence && observation?.facts && <><p>{tr("Transfer reconciled. Exactly one owner-signed transaction, nonce ")}{tr(observation.facts.nonceBefore)} → {tr(observation.facts.nonceAfter)}{tr(", block ")}{tr(observation.facts.blockNumber)}{tr("; network cost ")}{tr(formatEth(observation.facts.fee))}{tr(" ETH; balance ")}{tr(formatEth(observation.facts.balanceBefore))} → {tr(formatEth(observation.facts.balanceAfter))}{tr(" ETH.")}</p>
        <a download="flofi-rh-demo-001-evidence.json" href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>{tr("Download Evidence Bundle")}</a></>}
    </>}
    {info && <p role="status">{tr(transferCopy(messages[info] ?? 'The transfer needs attention. Inspect technical details and observe any existing transaction.', network))}</p>}
    <details><summary>{tr("Show technical details")}</summary><pre>{JSON.stringify({ error: info, attempt, observations: record?.observations, walletDiagnostic: record?.walletDiagnostic,
      environment: record?.evidence?.bundle.environment, journal: record?.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState) }, null, 2)}</pre></details>
  </section>;
}
