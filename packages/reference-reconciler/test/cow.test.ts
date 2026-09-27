// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { reconcileCowSettlement, type CowSettlementObservation } from '../src/cow.js';
import type { CowOrder } from '@defi-workflow-engine/reference-compiler';

const owner = '0x1234567890123456789012345678901234567890';
const uid = '0x' + '1'.repeat(112), tx = '0x' + '2'.repeat(64);
const order: CowOrder = { sellToken: '0x' + '3'.repeat(40), buyToken: '0x' + '4'.repeat(40), receiver: owner,
  sellAmount: '1000', buyAmount: '900', feeAmount: '0', validTo: 1790467800, appData: '0x' + '5'.repeat(64),
  kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20' };
const observation: CowSettlementObservation = { environment: 'MOCKED', uid, owner, receiver: owner,
  receipt: { transactionHash: tx, status: 1, blockHash: '0x' + '6'.repeat(64) },
  trade: { uid, txHash: tx, sellAmount: '1000', buyAmount: '900', feeAmount: '0' },
  before: { sell: '2000', buy: '0', allowance: '1000' }, after: { sell: '1000', buy: '900', allowance: '0' } };

describe('CoW scripted settlement reconciliation', () => {
  it('reconciles exact receipt, trade, balances, fee and allowance with MOCKED provenance', () => {
    expect(reconcileCowSettlement(order, uid, owner, observation)).toMatchObject({ outcome: 'RECONCILED', observedSell: '1000', observedBuy: '900' });
  });
  it('keeps missing receipt or trade inconclusive', () => {
    expect(reconcileCowSettlement(order, uid, owner, { ...observation, receipt: null }).outcome).toBe('INCONCLUSIVE');
    expect(reconcileCowSettlement(order, uid, owner, { ...observation, trade: null }).outcome).toBe('INCONCLUSIVE');
  });
  it('flags a wrong receiver, receipt, balance, fee, minimum output or allowance', () => {
    const variants: CowSettlementObservation[] = [
      { ...observation, receiver: '0x' + '9'.repeat(40) },
      { ...observation, receipt: { ...observation.receipt!, status: 0 } },
      { ...observation, after: { ...observation.after, sell: '1001' } },
      { ...observation, trade: { ...observation.trade!, feeAmount: '1' } },
      { ...observation, trade: { ...observation.trade!, buyAmount: '899' }, after: { ...observation.after, buy: '899' } },
      { ...observation, after: { ...observation.after, allowance: '1001' } },
    ];
    for (const variant of variants) expect(reconcileCowSettlement(order, uid, owner, variant).outcome).toBe('DIVERGENT');
  });
});
