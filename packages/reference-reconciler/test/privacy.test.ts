// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { reconcileCloakSwap, type CloakPublicObservation, type CloakPersistenceObservation, type CloakReconciliationRequirement } from '../src/privacy.js';
// Deliberately synthetic verdict fixtures. They are not transaction or challenge acceptance evidence.
const identity = { runId: 'run', manifestHash: 'manifest', owner: 'owner', genesisHash: 'mainnet', programId: 'cloak' };
const change = { commitment: 'commitment', amount: '10000000', mint: 'SOL' };
const expected: CloakReconciliationRequirement = { ...identity, recipientAta: 'ATA', outputMint: 'USDC', minimumOutput: '500000', change };
const chain: CloakPublicObservation = { ...identity, tx1: 'FINALIZED', tx2: 'FINALIZED', settlement: 'SWAPPED', recipientAta: 'ATA',
  outputMint: 'USDC', outputAmount: '600000', inputNullifiersSpent: true, privateOutputs: [{ ...change, index: 0, state: 'UNSPENT' }] };
const stored: CloakPersistenceObservation = { ...identity, reloadVerified: true, refundRetained: true, outputs: [{ ...change, index: 0 }] };
describe('Cloak requires public settlement AND durable private result', () => {
  it('accepts a fully reconciled fixture including leaf index zero', () => expect(reconcileCloakSwap(expected, chain, stored).verdict).toBe('RECONCILED'));
  it('never treats Tx1 confirmation, a missing result or missing recovery as success', () => {
    for (const observation of [null, { ...chain, tx2: 'UNKNOWN' as const }, { ...chain, settlement: 'PENDING' as const }, { ...chain, inputNullifiersSpent: null }])
      expect(reconcileCloakSwap(expected, observation, stored).verdict).toBe('INCONCLUSIVE');
    for (const persistence of [null, { ...stored, reloadVerified: false }, { ...stored, refundRetained: false }, { ...stored, outputs: [] }])
      expect(reconcileCloakSwap(expected, chain, persistence).verdict).toBe('INCONCLUSIVE');
  });
  it('rejects diverging public recipient, mint, minimum or run linkage', () => {
    for (const patch of [{ recipientAta: 'other' }, { outputMint: 'other' }, { outputAmount: '1' }, { runId: 'other' }, { owner: 'other' }, { manifestHash: 'other' }])
      expect(reconcileCloakSwap(expected, { ...chain, ...patch }, stored).verdict).toBe('DIVERGENT');
  });
  it('rejects spent, skipped, mismatched or absent private change', () => {
    for (const patch of [{ state: 'SPENT' as const }, { state: 'SKIPPED' as const }, { amount: '9999999' }, { commitment: 'other' }, { index: 1 }])
      expect(reconcileCloakSwap(expected, { ...chain, privateOutputs: [{ ...chain.privateOutputs[0]!, ...patch }] }, stored).verdict).not.toBe('RECONCILED');
    expect(reconcileCloakSwap(expected, { ...chain, privateOutputs: [] }, stored).verdict).toBe('INCONCLUSIVE');
  });
  it('never calls a timeout refund a successful swap', () => expect(reconcileCloakSwap(expected, { ...chain, settlement: 'REFUNDED' }, stored).verdict).toBe('DIVERGENT'));
});
