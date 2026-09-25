// SPDX-License-Identifier: AGPL-3.0-only
/** Pure unknown-result classifier. A null lookup is deliberately non-authoritative. */
export type RecoveryEvidence = {
  readonly payloadNonce: bigint; readonly latestNonce: bigint;
  readonly scannedBlocks: number; readonly scanComplete: boolean;
  readonly matchingNonceTransactions: readonly { readonly hash: string; readonly exactPayload: boolean; readonly confirmed: boolean }[];
  readonly txpoolChecked: boolean; readonly txpoolContainsNonce: boolean;
  readonly waitedMs: number; readonly observedBlocks: number;
  readonly receiptLookup: null | { readonly status: 0 | 1 };
  readonly transactionLookup: null | { readonly hash: string };
  readonly deadlineNear: boolean;
};
export type RecoveryDecision = { readonly outcome: 'CONFIRMED' | 'PENDING' | 'NOT_FOUND' | 'REVERTED' | 'DIVERGENT' | 'INCONCLUSIVE'; readonly retryAllowed: boolean; readonly reason: string };
export function classifyUnknownResult(e: RecoveryEvidence): RecoveryDecision {
  const result = (outcome: RecoveryDecision['outcome'], retryAllowed: boolean, reason: string): RecoveryDecision => ({ outcome, retryAllowed, reason });
  if (e.scannedBlocks < 0 || e.scannedBlocks > 256 || e.waitedMs < 0 || e.observedBlocks < 0) return result('INCONCLUSIVE', false, 'invalid observation window');
  if (e.matchingNonceTransactions.length > 1) return result('DIVERGENT', false, 'multiple nonce matches');
  const match = e.matchingNonceTransactions[0];
  if (match) {
    if (match.confirmed && e.latestNonce <= e.payloadNonce) return result('INCONCLUSIVE', false, 'confirmed transaction with unconsumed nonce');
    if (e.transactionLookup && e.transactionLookup.hash !== match.hash) return result('INCONCLUSIVE', false, 'transaction lookup disagrees with block scan');
    if (!match.exactPayload) return result('DIVERGENT', false, 'nonce consumed by different payload');
    if (e.receiptLookup?.status === 0) return result('REVERTED', false, 'exact transaction reverted');
    return result(match.confirmed && e.receiptLookup?.status === 1 ? 'CONFIRMED' : 'PENDING', false, 'exact broadcast transaction found');
  }
  if (e.latestNonce < e.payloadNonce) return result('INCONCLUSIVE', false, 'nonce state inconsistent');
  if (e.latestNonce > e.payloadNonce) {
    return result(e.scanComplete ? 'DIVERGENT' : 'INCONCLUSIVE', false, 'nonce consumed without exact transaction');
  }
  if (e.txpoolContainsNonce || e.transactionLookup) return result('PENDING', false, 'transaction may be in flight');
  if (!e.scanComplete || e.scannedBlocks === 0 || !e.txpoolChecked || e.waitedMs < 30_000 || e.observedBlocks < 2) {
    return result('INCONCLUSIVE', false, 'nonce, block, txpool and wait evidence incomplete');
  }
  if (e.deadlineNear) return result('INCONCLUSIVE', false, 'deadline too near for retry');
  return result('NOT_FOUND', true, 'nonce unconsumed after complete block, txpool and wait checks');
}
export function decideRetry(outcome: RecoveryDecision, attempts: number): boolean {
  return outcome.outcome === 'NOT_FOUND' && outcome.retryAllowed && Number.isInteger(attempts) && attempts >= 1 && attempts < 2;
}
