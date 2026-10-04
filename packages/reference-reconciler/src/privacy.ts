// SPDX-License-Identifier: AGPL-3.0-only
/** Pure verdict over authoritative observations. A transport must establish these facts independently. */
export type CloakPublicObservation = {
  runId: string; manifestHash: string; owner: string; genesisHash: string; programId: string;
  tx1: 'FINALIZED' | 'PENDING' | 'UNKNOWN' | 'REVERTED'; tx2: 'FINALIZED' | 'PENDING' | 'UNKNOWN' | 'REVERTED';
  settlement: 'SWAPPED' | 'REFUNDED' | 'PENDING' | 'UNKNOWN';
  recipientAta: string; outputMint: string; outputAmount: string;
  inputNullifiersSpent: boolean | null;
  privateOutputs: readonly { commitment: string; index: number; amount: string; mint: string; state: 'UNSPENT' | 'SPENT' | 'SKIPPED' }[];
};
export type CloakReconciliationRequirement = {
  runId: string; manifestHash: string; owner: string; genesisHash: string; programId: string;
  recipientAta: string; outputMint: string; minimumOutput: string;
  change: { commitment: string; amount: string; mint: string };
};
export type CloakPersistenceObservation = {
  runId: string; manifestHash: string; owner: string; genesisHash: string; programId: string;
  reloadVerified: boolean; refundRetained: boolean;
  outputs: readonly { commitment: string; index: number; amount: string; mint: string }[];
};
export type CloakReconciliation = { verdict: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT'; reason: string };
const uint = (text: string) => typeof text === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(text) && BigInt(text) < 1n << 64n;
const sameIdentity = (expected: CloakReconciliationRequirement, actual: CloakPublicObservation | CloakPersistenceObservation) =>
  ['runId', 'manifestHash', 'owner', 'genesisHash', 'programId'].every(key => expected[key as keyof typeof expected] === actual[key as keyof typeof actual]);

/** Public Tx1 confirmation, a relay success string or a restored byte array is never sufficient. */
export function reconcileCloakSwap(expected: CloakReconciliationRequirement, chain: CloakPublicObservation | null,
  persisted: CloakPersistenceObservation | null): CloakReconciliation {
  const unknown = (reason: string): CloakReconciliation => ({ verdict: 'INCONCLUSIVE', reason });
  const divergent = (reason: string): CloakReconciliation => ({ verdict: 'DIVERGENT', reason });
  if (!chain || !persisted) return unknown('CLOAK_RECOVERY_OR_CHAIN_DATA_MISSING');
  if (!sameIdentity(expected, chain) || !sameIdentity(expected, persisted)) return divergent('CLOAK_RUN_LINK_MISMATCH');
  if (!persisted.reloadVerified || !persisted.refundRetained) return unknown('CLOAK_PRIVATE_STATE_NOT_DURABLE');
  if (!uint(expected.minimumOutput) || BigInt(expected.minimumOutput) === 0n || !uint(expected.change.amount) ||
      BigInt(expected.change.amount) === 0n || !uint(chain.outputAmount)) return divergent('CLOAK_AMOUNT_INVALID');
  if (chain.tx1 === 'REVERTED' || chain.tx2 === 'REVERTED' || chain.settlement === 'REFUNDED') return divergent('CLOAK_SWAP_NOT_SETTLED');
  if (chain.tx1 !== 'FINALIZED' || chain.tx2 !== 'FINALIZED' || chain.settlement !== 'SWAPPED' || chain.inputNullifiersSpent !== true)
    return unknown('CLOAK_SETTLEMENT_UNPROVEN');
  if (chain.recipientAta !== expected.recipientAta || chain.outputMint !== expected.outputMint || BigInt(chain.outputAmount) < BigInt(expected.minimumOutput))
    return divergent('CLOAK_PUBLIC_OUTPUT_DIVERGENT');
  // One positive private change output is required for this vertical slice; padding has no economic value.
  const output = chain.privateOutputs.filter(n => n.amount !== '0');
  const stored = persisted.outputs.filter(n => n.amount !== '0');
  if (chain.privateOutputs.some(n => n.state === 'SKIPPED') || output.length !== 1 || stored.length !== 1) return unknown('CLOAK_PRIVATE_OUTPUT_UNVERIFIED');
  const a = output[0]!, b = stored[0]!;
  if (a.state !== 'UNSPENT') return divergent('CLOAK_PRIVATE_OUTPUT_SPENT');
  if (!Number.isSafeInteger(a.index) || a.index < 0 || a.index >= 2 ** 32 || a.index !== b.index ||
      a.commitment !== expected.change.commitment || b.commitment !== a.commitment || a.mint !== expected.change.mint || b.mint !== a.mint ||
      a.amount !== expected.change.amount || b.amount !== a.amount) return divergent('CLOAK_PRIVATE_OUTPUT_DIVERGENT');
  return { verdict: 'RECONCILED', reason: 'CLOAK_SETTLEMENT_AND_RELOAD_VERIFIED' };
}
