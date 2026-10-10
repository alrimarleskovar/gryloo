// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002 compatibility with what FloFi already reconciles:
 *
 * the delegated executor's redemptions are exactly the canonical shape the existing public-flow verifier (`verifyOwnerSubmission`, shared by
 * the Base Sepolia swap, Uniswap liquidity and Router flows) accepts as a DELEGATED_SINGLE submission of the owner (the real-chain codec
 * vector is `erc7710-vector.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { createTestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { verifyOwnerSubmission } from '../server/public-testnet-service.ts';
import { delegationHarness } from './delegation.test-harness.ts';

const D = erc7710;
describe('BUILD-AUTOMATION-002 executor redemptions are what FloFi\'s public flows already reconcile (PostgreSQL, MOCKED chain)', () => {
  it('verifyOwnerSubmission accepts both delegated calls (approval and swap) as the owner\'s DELEGATED_SINGLE submissions', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      await h.enrollEvm(passkeyId);
      const { created } = await h.authorize(h.multichainInput({}, false));
      await h.trigger(created.ruleId); await h.drain();
      const [execution] = await h.store.executions(h.owner, { limit: 1 });
      expect(execution!.state).toBe('SETTLED');
      const [step] = await h.store.steps(execution!.executionId);
      const prepared = (step!.plan!.prepared as { calls: { target: string; data: string }[] }).calls;
      const txs = (step!.submission!.txs as { hash: string }[]);
      for (const [i, tx] of txs.entries()) {
        const raw = await h.evm.rpc('eth_getTransactionReceipt', [tx.hash]) as Record<string, unknown>;
        const object = await h.evm.rpc('eth_getTransactionByHash', [tx.hash]);
        const verified = await verifyOwnerSubmission(h.evm.rpc, { txHash: tx.hash, account: h.evmOwner.address, target: prepared[i]!.target, data: prepared[i]!.data,
          preBlock: Number(BigInt(String(raw.blockNumber))) - 1 }, object, raw, 84532, true);
        expect(verified).toMatchObject({ direct: false, delegated: true, delegationDepth: 1, status: 1, txTo: D.DELEGATION_FRAMEWORK_V1_3.delegationManager });
      }
    } finally { await t.drop(); }
  });
});
