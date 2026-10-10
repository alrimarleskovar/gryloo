// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: delegated execution end to end on PostgreSQL with the MOCKED loopback chain doubles (evidence MOCKED).
 */
import { describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { delegationHarness } from './delegation.test-harness.ts';

describe('BUILD-AUTOMATION-002 delegated execution (PostgreSQL, MOCKED chains)', () => {
  it('one passkey signature authorizes an EVM + Solana workflow; the trigger executes both domains with no owner signature', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const evmGrant = await h.enrollEvm(passkeyId), solGrant = await h.enrollSolana(passkeyId);
      expect([evmGrant.state, solGrant.state]).toEqual(['ACTIVE', 'ACTIVE']);
      const { created, review, signed } = await h.authorize(h.multichainInput());
      expect(review.manifest.steps.map(s => [s.stepIndex, s.grantId])).toEqual([[0, evmGrant.grantId], [1, solGrant.grantId]]);
      expect(signed.state).toBe('ACTIVE');
      const walletSignatures = h.evmOwner.signatures + h.solOwner.signatures;
      expect(walletSignatures).toBe(2); // the two Credential enrollments, never the workflow
      const usdcBefore = h.evm.control.balance('USDC', h.evmOwner.address), lamportsBefore = h.sol.control.lamports(h.solOwner.address);

      const evaluated = await h.trigger(created.ruleId);
      expect(evaluated).toMatchObject({ kind: 'COMMITTED', occurrence: { state: 'DELEGATED' } });
      expect(await h.drain()).toBeGreaterThan(0);
      const [execution] = await h.store.executions(h.owner, { limit: 5 });
      expect(execution).toMatchObject({ state: 'SETTLED', stepCount: 2, attention: false });
      expect(h.evm.control.balance('USDC', h.evmOwner.address)).toBe(usdcBefore - 50_000_000n);
      expect(h.evm.control.balance('WETH', h.evmOwner.address)).toBeGreaterThan(0n);
      expect(h.sol.control.lamports(h.solOwner.address)).toBe(lamportsBefore + 10_000_000n);
      expect(h.evmOwner.signatures + h.solOwner.signatures).toBe(walletSignatures); // no new owner signature
      const steps = await h.store.steps(execution!.executionId);
      expect(steps.map(s => [s.stepIndex, s.state, s.grantId, s.mechanism])).toEqual([[0, 'RECONCILED', evmGrant.grantId, 'EVM_ERC7710_METAMASK_V1_3'],
        [1, 'RECONCILED', solGrant.grantId, 'SOLANA_SPL_DELEGATE_V1']]);
      const budget = await h.store.budget(created.authorizationId);
      expect(budget.map(b => [b.stepIndex, b.state, b.spent])).toEqual([[0, 'SPENT', 50_000_000n], [1, 'SPENT', 5_000_000n]]);
      expect(execution!.evidence).toMatchObject({ evidenceLevel: 'MOCKED', steps: [{ credentialId: evmGrant.credentialId, grantId: evmGrant.grantId, grantCommitment: evmGrant.commitment },
        { credentialId: solGrant.credentialId, grantId: solGrant.grantId, grantCommitment: solGrant.commitment }] });
    } finally { await t.drop(); }
  });
});
