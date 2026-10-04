// SPDX-License-Identifier: AGPL-3.0-only
import { TEMPO_PAYMENT as p } from '@defi-workflow-engine/reference-compiler';
import { rpcRecord, rpcUint, rpcHash, supplyHex, supplyHash, supplyArtifactHash,
  tempoFee, tempoBalance, assertTempoPaymentLogs, tempoPaymentFeeLog, verifyTempoSignedEnvelope, type TempoReview, type TempoRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
export type TempoObservation = { verdict: 'INCONCLUSIVE' | 'DIVERGENT' | 'RECONCILED'; reason: string;
  rawTransaction: string | null; transaction: Record<string, unknown> | null; receipt: Record<string, unknown> | null;
  facts: { blockNumber: number; blockHash: string; fee: string; balanceBefore: string; balanceAfter: string; recipientBefore: string; recipientAfter: string } | null };
export async function reconcileTempoPayment(review: TempoReview, attempt: { nonce: string; transactionHash: string | null; preparedAtBlock: number }, rpc: TempoRpc): Promise<TempoObservation> {
  const base: TempoObservation = { verdict: 'INCONCLUSIVE', reason: 'TEMPO_NOT_OBSERVED', rawTransaction: null, transaction: null, receipt: null, facts: null };
  if (!attempt.transactionHash) return base;
  try {
    if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(p.chainId)) throw new Error('TEMPO_WRONG_CHAIN');
    const [raw, txValue, receiptValue] = await Promise.all([rpc('eth_getRawTransactionByHash', [attempt.transactionHash]),
      rpc('eth_getTransactionByHash', [attempt.transactionHash]), rpc('eth_getTransactionReceipt', [attempt.transactionHash])]);
    if (!raw || !txValue || !receiptValue) return base;
    base.rawTransaction = String(raw); // Already public on-chain bytes, never relayed from the browser.
    const verified = verifyTempoSignedEnvelope(String(raw), review.transaction);
    const tx = rpcRecord(txValue), receipt = rpcRecord(receiptValue); base.transaction = tx; base.receipt = receipt;
    if (verified.hash !== attempt.transactionHash || rpcHash(tx.hash) !== verified.hash || rpcHash(receipt.transactionHash) !== verified.hash ||
        attempt.nonce !== review.nonce || tx.from !== review.account || rpcHash(tx.blockHash) !== rpcHash(receipt.blockHash) ||
        rpcUint(tx.blockNumber) !== rpcUint(receipt.blockNumber)) throw new Error('TEMPO_TRANSACTION_MISMATCH');
    const number = Number(rpcUint(receipt.blockNumber)), tag = supplyHex(number), before = supplyHex(number - 1);
    if (!Number.isSafeInteger(number) || number <= attempt.preparedAtBlock) throw new Error('TEMPO_BLOCK_MISMATCH');
    const canonical = rpcRecord(await rpc('eth_getBlockByNumber', [tag, false]));
    if (rpcHash(canonical.hash) !== rpcHash(receipt.blockHash) || !Array.isArray(canonical.transactions) || !canonical.transactions.includes(verified.hash) ||
        rpcUint(canonical.timestamp) >= BigInt(review.transaction.validBefore)) throw new Error('TEMPO_INCLUSION_MISMATCH');
    const finalized = rpcRecord(await rpc('eth_getBlockByNumber', ['finalized', false]));
    if (rpcUint(finalized.number) < BigInt(number)) return { ...base, reason: 'TEMPO_AWAITING_FINALITY' };
    if (rpcUint(receipt.status) !== 1n) return { ...base, verdict: 'DIVERGENT', reason: 'TEMPO_REVERTED' };
    if (receipt.feeToken !== p.token || receipt.feePayer !== review.account) throw new Error('TEMPO_FEE_PAYER_MISMATCH');
    const gas = rpcUint(receipt.gasUsed), price = rpcUint(receipt.effectiveGasPrice), fee = tempoFee(gas, price);
    if (gas > BigInt(review.gasLimit) || price > BigInt(review.maxFeePerGas) || fee > BigInt(review.feeBudget)) throw new Error('TEMPO_FEE_MISMATCH');
    assertTempoPaymentLogs(receipt.logs, review.account, review.fields);
    // Net protocol fee event, not an invented native-ETH balance delta.
    if (tempoPaymentFeeLog(receipt.logs, review.account) !== fee) throw new Error('TEMPO_FEE_LOG_MISMATCH');
    const [balanceBefore, balanceAfter, recipientBefore, recipientAfter, nonceBefore, nonceAfter] = await Promise.all([
      tempoBalance(rpc, review.account, before), tempoBalance(rpc, review.account, tag), tempoBalance(rpc, review.fields.recipient, before), tempoBalance(rpc, review.fields.recipient, tag),
      rpc('eth_getTransactionCount', [review.account, before]), rpc('eth_getTransactionCount', [review.account, tag])]);
    if (rpcUint(nonceBefore) !== BigInt(review.nonce) || rpcUint(nonceAfter) !== BigInt(review.nonce) + 1n ||
        balanceBefore - balanceAfter !== BigInt(review.fields.amount) + fee || recipientAfter - recipientBefore !== BigInt(review.fields.amount))
      throw new Error('TEMPO_BALANCE_MISMATCH');
    if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [tag, false])).hash) !== rpcHash(receipt.blockHash)) throw new Error('TEMPO_REORG');
    return { ...base, verdict: 'RECONCILED', reason: 'TEMPO_PAYMENT_VERIFIED', facts: { blockNumber: number, blockHash: rpcHash(receipt.blockHash), fee: fee.toString(),
      balanceBefore: balanceBefore.toString(), balanceAfter: balanceAfter.toString(), recipientBefore: recipientBefore.toString(), recipientAfter: recipientAfter.toString() } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'TEMPO_OBSERVATION_UNAVAILABLE';
    return { ...base, verdict: /MISMATCH|WRONG_CHAIN|REORG|SIGNATURE|SIGNED_|SIGNER_|ENVELOPE/.test(reason) ? 'DIVERGENT' : 'INCONCLUSIVE', reason };
  }
}
export function buildTempoEvidence(input: { id: string; review: TempoReview; journal: ExecutionJournal; provenance: 'MOCKED' | 'PUBLIC_TESTNET';
  ownerInitiated: boolean; observation: TempoObservation; observedAt: string }) {
  const { review, observation: o } = input;
  if (!input.ownerInitiated || o.verdict !== 'RECONCILED' || !o.facts || !o.receipt) throw new Error('TEMPO_EVIDENCE_NOT_RECONCILED');
  const asset = { chainId: p.chain, address: p.token, decimals: 6 };
  const publicExecution = { chainId: p.chainId, token: p.token, recipient: review.fields.recipient, memo: review.fields.memo, amount: review.fields.amount,
    transactionHash: o.receipt.transactionHash, feeToken: p.token, feePayer: review.account, ...o.facts,
    evidenceLevel: input.provenance === 'MOCKED' ? 'MOCKED' : 'PUBLIC_TESTNET_EXECUTED' };
  const bundle: EvidenceBundle = { schemaVersion: '1.0.0', evidenceBundleId: input.id, version: 1, supersedes: null,
    semanticWorkflowHash: review.manifest.semanticWorkflowHash, artifactSetHash: review.manifest.artifactSetHash, simulationHash: review.manifest.simulationHash,
    policyHash: review.manifest.policyHash, manifestHash: supplyArtifactHash('strategy-manifest', review.manifest), executionPlanHash: supplyArtifactHash('execution-plan', review.plan),
    journalHeadHash: hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1)!, observedAt: input.observedAt,
    environment: input.provenance === 'MOCKED' ? 'MOCKED' : 'TESTNET_EXECUTED', outcome: 'RECONCILED',
    receipts: [{ receiptId: 'tempo-payment-receipt', contentHash: supplyHash(o.receipt) }], differences: [],
    reconciliation: { balances: [{ asset, amount: o.facts.balanceAfter }], allowances: [], debt: [], positions: [], fees: [{ asset, amount: o.facts.fee }],
      residualAssets: [], ownership: [{ chainId: p.chain, address: review.account }],
      limitations: ['Finalized canonical inclusion from the configured Tempo RPC; no independent consensus verification.',
        'Exact block balance deltas fail closed on unrelated same-block transfers. No mainnet, sponsorship, access keys or recurring authority.'] },
    evidence: [{ evidenceId: 'tempo-payment-observation', kind: 'EXTERNAL_REFERENCE', contentHash: supplyHash(publicExecution) }] };
  return { bundle, bundleHash: supplyArtifactHash('evidence-bundle', bundle), publicExecution,
    artifacts: { workflow: review.workflow, artifactSet: review.artifactSet, simulation: review.simulation, policy: review.policy, manifest: review.manifest,
      plan: review.plan, review, journal: input.journal, observation: o } };
}
export type TempoEvidence = ReturnType<typeof buildTempoEvidence>;
