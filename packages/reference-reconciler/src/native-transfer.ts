// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001 runtime reconciliation of one native self-transfer from public chain reads only. It never
 * trusts the wallet's reported result: inclusion, sender, recipient, value, calldata, nonce, fee bounds and
 * the exact owner balance and nonce deltas are re-derived from the chain.
 */
import { rpcRecord, rpcHash, supplyHex, supplyHash, supplyArtifactHash, nativeTransferProfile,
  type NativeTransferReview, type TransferRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

export type TransferChainAttempt = { nonce: string; transactionHash: string | null; preparedAtBlock: number };
export type TransferObservation = { verdict: 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE'; reason: string;
  transaction: Record<string, unknown> | null; receipt: Record<string, unknown> | null;
  facts: { blockNumber: number; blockHash: string; gasUsed: string; effectiveGasPrice: string; fee: string; balanceBefore: string; balanceAfter: string;
    nonceBefore: string; nonceAfter: string; transactionType: string } | null };
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const strict = (value: unknown): bigint => { if (typeof value !== 'string' || !QUANTITY.test(value.toLowerCase())) throw new Error('TRANSFER_RPC_INVALID'); return BigInt(value); };

export async function reconcileNativeTransfer(review: NativeTransferReview, attempt: TransferChainAttempt, rpc: TransferRpc): Promise<TransferObservation> {
  const base: TransferObservation = { verdict: 'INCONCLUSIVE', reason: 'TRANSACTION_NOT_OBSERVED', transaction: null, receipt: null, facts: null };
  if (!attempt.transactionHash) return base;
  try {
    // The reviewed chain selects the profile; the RPC must report that same chain.
    const profile = nativeTransferProfile(review.chain);
    if (review.chainId !== profile.chainId || strict(await rpc('eth_chainId', [])) !== BigInt(profile.chainId)) throw new Error('TRANSFER_WRONG_CHAIN');
    const [txValue, receiptValue] = await Promise.all([rpc('eth_getTransactionByHash', [attempt.transactionHash]), rpc('eth_getTransactionReceipt', [attempt.transactionHash])]);
    if (!txValue || !receiptValue) return base;
    const tx = rpcRecord(txValue), receipt = rpcRecord(receiptValue);
    base.transaction = tx; base.receipt = receipt;
    const owner = review.account, type = typeof tx.type === 'string' ? tx.type.toLowerCase() : '';
    // Exact reviewed transaction: owner to owner, exact value, empty calldata, reviewed nonce, this chain.
    if (rpcHash(tx.hash) !== attempt.transactionHash || rpcHash(receipt.transactionHash) !== attempt.transactionHash ||
        typeof tx.from !== 'string' || tx.from.toLowerCase() !== owner || typeof tx.to !== 'string' || tx.to.toLowerCase() !== review.recipient ||
        strict(tx.value) !== BigInt(review.value) || tx.input !== '0x' || strict(tx.nonce) !== BigInt(attempt.nonce) || attempt.nonce !== review.nonce ||
        strict(tx.chainId) !== BigInt(profile.chainId) || !['0x0', '0x2'].includes(type) ||
        typeof receipt.from !== 'string' || receipt.from.toLowerCase() !== owner || typeof receipt.to !== 'string' || receipt.to.toLowerCase() !== review.recipient ||
        rpcHash(tx.blockHash) !== rpcHash(receipt.blockHash) || strict(tx.blockNumber) !== strict(receipt.blockNumber)) throw new Error('TRANSFER_TRANSACTION_MISMATCH');
    // The reviewed fee bounds: the wallet may lower but never raise them.
    const gasLimit = strict(tx.gas), offeredPrice = type === '0x2' ? strict(tx.maxFeePerGas) : strict(tx.gasPrice);
    if (gasLimit > BigInt(review.gasLimit) || offeredPrice > BigInt(review.maxFeePerGas)) throw new Error('TRANSFER_FEE_BOUND_MISMATCH');
    const blockNumber = Number(strict(receipt.blockNumber));
    if (!Number.isSafeInteger(blockNumber) || blockNumber <= attempt.preparedAtBlock || blockNumber <= review.state.block) throw new Error('TRANSFER_BLOCK_MISMATCH');
    const canonical = rpcRecord(await rpc('eth_getBlockByNumber', [supplyHex(blockNumber), false]));
    if (rpcHash(canonical.hash) !== rpcHash(receipt.blockHash) || !Array.isArray(canonical.transactions) ||
        !canonical.transactions.some(h => typeof h === 'string' && h.toLowerCase() === attempt.transactionHash)) throw new Error('TRANSFER_REORG');
    const latest = Number(strict(await rpc('eth_blockNumber', [])));
    if (latest < blockNumber + profile.minimumConfirmations) return { ...base, reason: 'AWAITING_CONFIRMATIONS' };
    if (strict(receipt.status) !== 1n) return { ...base, verdict: 'DIVERGENT', reason: 'TRANSFER_REVERTED' };
    // A transfer between externally owned accounts emits no logs; anything else is unexplained.
    if (!Array.isArray(receipt.logs) || receipt.logs.length) throw new Error('TRANSFER_LOGS_MISMATCH');
    const gasUsed = strict(receipt.gasUsed), effectiveGasPrice = strict(receipt.effectiveGasPrice);
    if (gasUsed > gasLimit || effectiveGasPrice > offeredPrice) throw new Error('TRANSFER_FEE_BOUND_MISMATCH');
    // Ethereum L1 charges gasUsed × effectiveGasPrice; Arbitrum Nitro also folds L1 data into gasUsed. No separate L1 fee.
    const fee = gasUsed * effectiveGasPrice;
    if (fee > BigInt(review.feeBudget)) throw new Error('TRANSFER_FEE_BOUND_MISMATCH');
    const before = supplyHex(blockNumber - 1), after = supplyHex(blockNumber);
    const [balanceBefore, balanceAfter, nonceBefore, nonceAfter, code] = await Promise.all([
      rpc('eth_getBalance', [owner, before]).then(strict), rpc('eth_getBalance', [owner, after]).then(strict),
      rpc('eth_getTransactionCount', [owner, before]).then(strict), rpc('eth_getTransactionCount', [owner, after]).then(strict),
      rpc('eth_getCode', [owner, after])]);
    // Exactly one owner transaction in the inclusion block, and it consumed the reviewed nonce.
    if (nonceBefore !== BigInt(review.nonce) || nonceAfter !== nonceBefore + 1n) throw new Error('TRANSFER_NONCE_MISMATCH');
    if (code !== '0x') throw new Error('TRANSFER_OWNER_NOT_EOA');
    // Self-transfer: the value leg nets to zero, so the only movement is the exact network fee.
    if (balanceBefore - balanceAfter !== fee || balanceBefore < BigInt(review.value) + fee) throw new Error('TRANSFER_BALANCE_MISMATCH');
    const final = rpcRecord(await rpc('eth_getBlockByNumber', [after, false]));
    if (rpcHash(final.hash) !== rpcHash(receipt.blockHash)) throw new Error('TRANSFER_REORG');
    return { ...base, verdict: 'RECONCILED', reason: 'NATIVE_TRANSFER_VERIFIED', facts: { blockNumber, blockHash: rpcHash(receipt.blockHash),
      gasUsed: gasUsed.toString(), effectiveGasPrice: effectiveGasPrice.toString(), fee: fee.toString(), balanceBefore: balanceBefore.toString(),
      balanceAfter: balanceAfter.toString(), nonceBefore: nonceBefore.toString(), nonceAfter: nonceAfter.toString(), transactionType: type } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'TRANSFER_OBSERVATION_FAILED';
    // Provider failures stay ambiguous; any mismatch never reconciles.
    return { ...base, verdict: /MISMATCH|WRONG_CHAIN|REORG|NOT_EOA/.test(message) ? 'DIVERGENT' : 'INCONCLUSIVE', reason: message };
  }
}
export type NativeTransferEvidence = { bundle: EvidenceBundle; bundleHash: string; publicExecution: Record<string, unknown>;
  artifacts: { workflow: unknown; artifactSet: unknown; simulation: unknown; policy: unknown; manifest: unknown; plan: unknown; journal: ExecutionJournal; review: NativeTransferReview } };
export function buildNativeTransferEvidence(input: { id: string; review: NativeTransferReview; journal: ExecutionJournal; provenance: 'PUBLIC_TESTNET' | 'MOCKED';
  ownerInitiated: boolean; observation: TransferObservation; observedAt?: string }): NativeTransferEvidence {
  const { review, observation: o } = input;
  if (o.verdict !== 'RECONCILED' || !o.facts || !o.receipt || !o.transaction || !input.ownerInitiated) throw new Error('TRANSFER_EVIDENCE_NOT_RECONCILED');
  const head = hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1);
  if (!head) throw new Error('TRANSFER_JOURNAL_EMPTY');
  const profile = nativeTransferProfile(review.chain);
  const nativeAsset = { chainId: profile.chain, nativeId: 'ETH', decimals: 18 };
  const publicExecution = { network: profile.network, chainId: profile.chainId, explorer: profile.explorer, officialSource: profile.officialSource,
    account: review.account, recipient: review.recipient, value: review.value, nonce: review.nonce, transactionHash: o.receipt.transactionHash,
    explorerUrl: `${profile.explorer}/tx/${String(o.receipt.transactionHash)}`, ...o.facts, provenance: input.provenance, ownerInitiated: input.ownerInitiated,
    submissions: 1, verdict: o.verdict };
  const bundle: EvidenceBundle = { schemaVersion: '1.0.0', evidenceBundleId: input.id, version: 1, supersedes: null,
    semanticWorkflowHash: review.manifest.semanticWorkflowHash, artifactSetHash: review.manifest.artifactSetHash, simulationHash: review.manifest.simulationHash,
    policyHash: review.manifest.policyHash, manifestHash: supplyArtifactHash('strategy-manifest', review.manifest),
    executionPlanHash: supplyArtifactHash('execution-plan', review.plan), journalHeadHash: head, observedAt: input.observedAt ?? new Date().toISOString(),
    environment: input.provenance === 'PUBLIC_TESTNET' ? 'TESTNET_EXECUTED' : 'MOCKED', outcome: 'RECONCILED',
    receipts: [{ receiptId: 'native-transfer-receipt', contentHash: supplyHash(o.receipt) }], differences: [],
    reconciliation: { balances: [{ asset: nativeAsset, amount: o.facts.balanceAfter }], allowances: [], debt: [], positions: [],
      fees: [{ asset: nativeAsset, amount: o.facts.fee }], residualAssets: [], ownership: [{ chainId: profile.chain, address: review.account }],
      limitations: profile.settlement === 'L2' ? ['Inclusion is verified at Robinhood Chain (L2) sequencer level after confirmations; L1 finality is reported by the independent verifier.',
        'Self-transfer: the value leg nets to zero; the fee is gasUsed × effectiveGasPrice, which includes Arbitrum Nitro L1 data gas.',
        'This is a chain execution proof, not a DeFi capability.'] :
        [`Inclusion is verified at ${profile.network} block level after ${profile.minimumConfirmations} confirmations; finalized-checkpoint status is not claimed.`,
          'Self-transfer: the value leg nets to zero; the fee is gasUsed × effectiveGasPrice.',
          'This is a chain execution proof, not a DeFi capability.'] },
    evidence: [{ evidenceId: 'native-transfer-public-observations', kind: 'EXTERNAL_REFERENCE', contentHash: supplyHash(publicExecution) }] };
  return { bundle, bundleHash: supplyArtifactHash('evidence-bundle', bundle), publicExecution,
    artifacts: { workflow: review.workflow, artifactSet: review.artifactSet, simulation: review.simulation, policy: review.policy,
      manifest: review.manifest, plan: review.plan, journal: input.journal, review } };
}
