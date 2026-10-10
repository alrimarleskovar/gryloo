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

describe('BUILD-AUTOMATION-002 delegated execution: limits, revocation, recovery (PostgreSQL, MOCKED chains)', () => {
  const setup = async (db: Parameters<typeof delegationHarness>[0], input?: (h: Awaited<ReturnType<typeof delegationHarness>>) => unknown, solana = false) => {
    const h = await delegationHarness(db);
    const passkeyId = await h.registerPasskey();
    const evmGrant = await h.enrollEvm(passkeyId), solGrant = solana ? await h.enrollSolana(passkeyId) : null;
    const auth = await h.authorize(input ? input(h) : h.multichainInput({}, solana));
    return { h, passkeyId, evmGrant, solGrant, ...auth };
  };
  const daily = (h: Awaited<ReturnType<typeof delegationHarness>>, budget = '100') => h.multichainInput({ trigger: { kind: 'SCHEDULE', schedule: { frequency: 'DAILY', weekday: null, time: '09:00',
    timezone: 'Europe/Lisbon' } }, limits: { assets: [{ asset: h.USDC_KEY, maxPerExecution: '50', budgets: [{ period: 'WEEK', amount: budget }] }], maxExecutionsPerPeriod: null,
    cooldownMinutes: 0, maxSlippageBps: 50 } }, false);
  const last = async (h: Awaited<ReturnType<typeof delegationHarness>>) => (await h.store.executions(h.owner, { limit: 1 }))[0]!;

  it('the cumulative weekly budget stops the third daily execution before anything is signed', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db, h => daily(h));
      for (let day = 0; day < 2; day++) { await h.trigger(created.ruleId); await h.drain(); expect((await last(h)).state).toBe('SETTLED'); }
      const sends = h.evm.control.sends();
      await h.trigger(created.ruleId); await h.drain();
      expect(await last(h)).toMatchObject({ state: 'BLOCKED', code: 'LIMIT_PERIOD_AMOUNT' });
      expect(h.evm.control.sends()).toBe(sends);
      expect((await h.store.budget(created.authorizationId)).filter(b => b.state === 'SPENT').map(b => b.spent)).toEqual([50_000_000n, 50_000_000n]);
    } finally { await t.drop(); }
  });

  it('revoking the authorization pauses the rule and a queued stale occurrence never executes', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      await h.trigger(created.ruleId);
      await h.service.authorizationRevoke(h.owner, created.authorizationId);
      await h.drain();
      expect(await last(h)).toMatchObject({ state: 'BLOCKED', code: 'AUTHORIZATION_NOT_ACTIVE' });
      expect(h.evm.control.sends()).toBe(0);
      expect((await h.automations.ruleById(created.ruleId))!.state).toBe('PAUSED');
      // A later trigger cannot even evaluate; resuming the rule by hand is refused without an active authorization.
      h.advance(7 * 86_400_000);
      expect(await h.trigger(created.ruleId)).toMatchObject({ kind: 'SKIPPED' });
      expect(await h.service.resumeGuard((await h.automations.ruleById(created.ruleId))!)).toBe('DELEGATED_AUTHORIZATION_REQUIRED');
    } finally { await t.drop(); }
  });

  it('a revocation between simulation and submission blocks the step: nothing is prepared or broadcast, the budget is released', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      await h.trigger(created.ruleId);
      let revoked = false;
      h.intercept.evm = (method) => {
        if (method === 'eth_getTransactionCount' && !revoked) { revoked = true; return h.service.authorizationRevoke(h.owner, created.authorizationId).then(() => h.evm.rpc(method, [h.evmOwner.address, 'pending'])); }
        return undefined;
      };
      await h.drain();
      const e = await last(h);
      expect(e).toMatchObject({ state: 'BLOCKED', code: 'AUTHORIZATION_REVOKED' });
      expect(revoked).toBe(true);
      expect(h.evm.control.sends()).toBe(0);
      expect((await h.store.steps(e.executionId))[0]).toMatchObject({ state: 'BLOCKED', submission: null });
      expect((await h.store.budget(created.authorizationId)).map(b => b.state)).toEqual(['RELEASED']);
    } finally { await t.drop(); }
  });

  it('an on-chain revocation made outside FloFi is detected before reservation (grant REVOKED)', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created, evmGrant } = await setup(t.db);
      const grant = (await h.store.grantById(evmGrant.grantId))!;
      const { delegationOf } = await import('./adapters.ts'), { erc7710 } = await import('@defi-workflow-engine/reference-compiler');
      h.evm.control.ownerSend(h.evmOwner.address, h.evmOwner.address, erc7710.disableDelegationCalldata(delegationOf(grant.grantPayload!.delegation)));
      await h.trigger(created.ruleId); await h.drain();
      expect(await last(h)).toMatchObject({ state: 'BLOCKED', code: 'CREDENTIAL_REVOKED' });
      expect((await h.store.grantById(evmGrant.grantId))!.state).toBe('REVOKED');
      expect(h.evm.control.sends()).toBe(0);
    } finally { await t.drop(); }
  });

  it('a crash after the submission is prepared re-broadcasts the same bytes: one spend, no second signature', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      await h.trigger(created.ruleId);
      let failed = false;
      h.intercept.evm = (method) => method === 'eth_sendRawTransaction' && !failed ? (failed = true, Promise.reject(new Error('socket hang up'))) : undefined;
      await h.drain();
      let e = await last(h);
      expect(e.state).toBe('UNCERTAIN');
      const prepared = (await h.store.steps(e.executionId))[0]!;
      expect(prepared.state).toBe('UNCERTAIN');
      const { executeOccurrence } = await import('./executor.ts');
      // The retried delivery: same persisted bytes, re-broadcast; reconciliation settles.
      await executeOccurrence(h.deps, e.occurrenceId, e.authorizationId);
      await executeOccurrence(h.deps, e.occurrenceId, e.authorizationId);
      e = await last(h);
      expect(e.state).toBe('SETTLED');
      const after = (await h.store.steps(e.executionId))[0]!;
      expect(after.submission).toEqual(prepared.submission);
      expect(h.evm.control.sends()).toBe(2);
      expect(h.evm.control.balance('USDC', h.evmOwner.address)).toBe(950_000_000n);
    } finally { await t.drop(); }
  });

  it('a submission the node accepted and lost is recovered by re-broadcasting the persisted bytes, never a new transaction', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      await h.trigger(created.ruleId);
      h.evm.control.dropNextSubmission();
      await h.drain();
      const { executeOccurrence } = await import('./executor.ts');
      let e = await last(h);
      for (let i = 0; i < 4 && e.state !== 'SETTLED'; i++) { await executeOccurrence(h.deps, e.occurrenceId, e.authorizationId); e = await last(h); }
      expect(e.state).toBe('SETTLED');
      expect(h.evm.control.sends()).toBe(2);
      expect((await h.store.budget(created.authorizationId)).map(b => [b.state, b.spent])).toEqual([['SPENT', 50_000_000n]]);
    } finally { await t.drop(); }
  });

  it('a price move after simulation makes the swap revert on-chain: FAILED, nothing spent, budget released (not before reconciliation)', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      await h.trigger(created.ruleId);
      h.intercept.evm = (method) => { if (method === 'eth_getTransactionCount') h.evm.control.setPrice(390_000_000_000_000n); return undefined; };
      await h.drain();
      const e = await last(h);
      expect(e).toMatchObject({ state: 'FAILED', code: 'SUBMISSION_REVERTED' });
      expect(h.evm.control.balance('USDC', h.evmOwner.address)).toBe(1_000_000_000n);
      expect((await h.store.budget(created.authorizationId)).map(b => b.state)).toEqual(['RELEASED']);
    } finally { await t.drop(); }
  });

  it('a changed workflow (rebind) invalidates eligibility until a new revision is signed', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      const rule = (await h.automations.ruleById(created.ruleId))!;
      const { bindStrategy } = await import('../automations/binding.ts');
      const bound = bindStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '40', slippageBps: 50 });
      if (!bound.ok) throw new Error(bound.code);
      await h.automations.rebind(h.owner, created.ruleId, rule.version, bound.binding, h.now());
      await h.trigger(created.ruleId); await h.drain();
      expect(await last(h)).toMatchObject({ state: 'BLOCKED', code: 'AUTHORIZATION_WORKFLOW_MISMATCH' });
      // Re-authorization: a new revision for the new workflow, signed once more; it narrows (40 ≤ 50) and widens nothing.
      const review = await h.service.authorizationReauthorize(h.owner, created.authorizationId);
      expect(review.revision).toBe(2);
      expect(review.widening).toEqual(['WORKFLOW_CHANGED']);
      expect((await h.automations.ruleById(created.ruleId))!.state).toBe('PAUSED');
      await h.service.authorizationSign(h.owner, created.authorizationId, 2, h.passkey.assert((await import('../passkeys/webauthn.ts')).fromB64url(review.challenge), 'http://localhost:3999', 'localhost'));
      h.advance(7 * 86_400_000);
      await h.trigger(created.ruleId); await h.drain();
      expect(await last(h)).toMatchObject({ state: 'SETTLED', revision: 2 });
    } finally { await t.drop(); }
  });

  it('two workers delivering the same occurrence produce one execution and one spend', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db);
      const evaluated = await h.trigger(created.ruleId);
      const occurrenceId = (evaluated as { occurrence: { occurrenceId: string } }).occurrence.occurrenceId;
      const { executeOccurrence } = await import('./executor.ts');
      const other = { ...h.deps, store: (await import('./pg-store.ts')).createPgDelegationStore(t.open(4), h.tenantId) };
      await Promise.all([executeOccurrence(h.deps, occurrenceId, created.authorizationId), executeOccurrence(other, occurrenceId, created.authorizationId)]);
      for (let i = 0; i < 3; i++) await executeOccurrence(h.deps, occurrenceId, created.authorizationId);
      const all = await h.store.executions(h.owner, { limit: 10 });
      expect(all).toHaveLength(1);
      expect(all[0]!.state).toBe('SETTLED');
      expect(h.evm.control.sends()).toBe(2);
      expect(h.evm.control.balance('USDC', h.evmOwner.address)).toBe(950_000_000n);
    } finally { await t.drop(); }
  });

  it('an authorization that expires between the trigger and execution cannot execute', async () => {
    const t = await createTestDatabase();
    try {
      const { h, created } = await setup(t.db, h => h.multichainInput({ expiresAt: '2026-10-12T08:01:00Z' }, false));
      await h.trigger(created.ruleId);
      h.set('2026-10-12T08:02:00Z');
      await h.drain();
      expect((await last(h)).state).toBe('BLOCKED');
      expect(['AUTHORIZATION_EXPIRED', 'CREDENTIAL_EXPIRED', 'AUTHORIZATION_NOT_ACTIVE']).toContain((await last(h)).code);
      expect(h.evm.control.sends()).toBe(0);
    } finally { await t.drop(); }
  });
});

describe('BUILD-AUTOMATION-002 authority graph before authorization (PostgreSQL)', () => {
  it('a missing Solana Credential fails the workflow before authorization with the precise requirement', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      await h.enrollEvm(passkeyId);
      const preview = await h.service.automationPreview(h.owner, h.multichainInput());
      expect(preview).toMatchObject({ ok: false, problem: 'DELEGATED_AUTHORITY_UNAVAILABLE', manifest: null,
        requiredEnrollments: [{ stepIndex: 1, namespace: 'solana', network: 'Solana Devnet', mechanism: 'SOLANA_SPL_DELEGATE_V1', reason: 'DELEGATED_AUTHORITY_UNAVAILABLE' }] });
      expect(preview.steps[0]!.binding).not.toBeNull();
      await expect(h.service.automationCreate(h.owner, h.multichainInput())).rejects.toThrow('DELEGATED_AUTHORITY_UNAVAILABLE');
      expect(await t.db.query('SELECT count(*)::int AS n FROM delegated_authorizations')).toMatchObject({ rows: [{ n: 0 }] });
    } finally { await t.drop(); }
  });

  it('an under-scoped Credential is named per step; another owner can neither see nor use the authorization', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      await h.enrollEvm(passkeyId, { pairs: [{ input: 'USDC', output: 'WETH', perCallCap: '49' }] });
      const preview = await h.service.automationPreview(h.owner, h.multichainInput({}, false));
      expect(preview.requiredEnrollments).toEqual([{ stepIndex: 0, namespace: 'eip155', network: 'Base Sepolia', mechanism: 'EVM_ERC7710_METAMASK_V1_3', reason: 'CREDENTIAL_SCOPE_AMOUNT' }]);
      await h.enrollEvm(passkeyId);
      const { created } = await h.authorize(h.multichainInput({}, false));
      const other = { namespace: 'eip155' as const, address: '0x' + 'b2'.repeat(20) };
      await expect(h.service.authorizationReview(other, created.authorizationId)).rejects.toThrow('AUTHORIZATION_NOT_FOUND');
      await expect(h.service.authorizationRevoke(other, created.authorizationId)).rejects.toThrow('AUTHORIZATION_NOT_FOUND');
      await expect(h.service.credentialPrepare(other, [other], { mechanism: 'EVM_ERC7710_METAMASK_V1_3', walletAddress: h.evmOwner.address, network: 'base-sepolia',
        pairs: [{ input: 'USDC', output: 'WETH', perCallCap: '1' }], maxCalls: 2, expiresAt: '2026-12-31T00:00:00Z', passkeyId, label: 'x' })).rejects.toThrow('WALLET_SESSION_REQUIRED');
      expect((await h.service.overview(other)).authorizations).toEqual([]);
    } finally { await t.drop(); }
  });
});
