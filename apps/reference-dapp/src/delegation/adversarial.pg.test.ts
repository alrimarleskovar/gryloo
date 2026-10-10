// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002 adversarial suite (PostgreSQL + MOCKED loopback chains):
 *
 *   - a compromised executor holding the session key, bypassing every application check, is bounded by the grant's on-chain caveats
 *     (modelled by the loopback DelegationManager: MOCKED evidence of the enforcer semantics, not of the bytecode);
 *   - competing workers can never reserve more than the remaining budget;
 *   - the passkey anchor binds every grant to the one authorization passkey;
 *   - replayed passkey assertions and challenges are refused.
 */
import { describe, expect, it } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { createTestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { delegationOf, passkeyAnchor } from './adapters.ts';
import { delegationHarness } from './delegation.test-harness.ts';
import { createPgDelegationStore } from './pg-store.ts';
import { fromB64url } from '../passkeys/webauthn.ts';

const D = erc7710, F = D.DELEGATION_FRAMEWORK_V1_3;
const word = (v: bigint) => v.toString(16).padStart(64, '0');
const addr = (a: string) => a.slice(2).padStart(64, '0');

describe('BUILD-AUTOMATION-002 on-chain ceiling against a compromised executor (MOCKED enforcer model)', () => {
  it('the session key alone can only do what the grant scoped: other recipient, more input, other token, other target and post-revocation calls revert', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const evmGrant = await h.enrollEvm(passkeyId);
      const grant = (await h.store.grantById(evmGrant.grantId))!, delegation = delegationOf(grant.grantPayload!.delegation), p = h.evm.control.profile;
      let nonce = 0n;
      /** Signs and sends one redemption with the grant's own session key, as a compromised FloFi backend could. */
      async function attack(groupIndex: number, call: erc7710.Call) {
        const tx: erc7710.Eip1559 = { chainId: 84532n, nonce: nonce++, maxPriorityFeePerGas: 1n, maxFeePerGas: 2_000_000_000n, gasLimit: 600_000n, to: F.delegationManager, value: 0n,
          data: D.redeemCalldata(delegation, groupIndex, call) };
        const sig = await h.signer.signEvmDigest(grant.sessionKeyRef, D.bytesOf(D.eip1559SigningHash(tx)));
        const hash = await h.evm.rpc('eth_sendRawTransaction', [D.signedEip1559(tx, sig.yParity, sig.r, sig.s).raw]) as string;
        return h.evm.control.receipt(hash)!;
      }
      const swap = (amountIn: bigint, recipient: string, tokenOut = p.weth) => ({ target: p.router, value: 0n, data: D.EXACT_INPUT_SINGLE_METHOD + addr(p.usdc) + addr(tokenOut)
        + word(500n) + addr(recipient) + word(amountIn) + word(1n) + word(0n) });
      const attacker = '0x' + 'ee'.repeat(20);
      expect(await attack(0, { target: p.usdc, value: 0n, data: D.APPROVE_METHOD + addr(attacker) + word(10n ** 30n) })).toMatchObject({ status: 0, reason: 'AllowedCalldataEnforcer:invalid-calldata' });
      expect(await attack(0, { target: p.usdc, value: 0n, data: D.APPROVE_METHOD + addr(p.router) + word(500_000_000n) })).toMatchObject({ status: 1 });
      expect(await attack(1, swap(100_000_000n, attacker))).toMatchObject({ status: 0, reason: 'AllowedCalldataEnforcer:invalid-calldata' });
      expect(await attack(1, swap(100_000_001n, h.evmOwner.address))).toMatchObject({ status: 0, reason: 'ERC20BalanceChangeEnforcer:exceeded-balance-decrease' });
      expect(await attack(1, swap(100_000_000n, h.evmOwner.address, '0x' + '12'.repeat(20)))).toMatchObject({ status: 0, reason: 'AllowedCalldataEnforcer:invalid-calldata' });
      expect(await attack(1, { target: p.usdc, value: 0n, data: D.selectorOf('transfer(address,uint256)') + addr(attacker) + word(1n) })).toMatchObject({ status: 0,
        reason: 'AllowedTargetsEnforcer:target-address-not-allowed' });
      expect(await attack(0, { target: p.usdc, value: 0n, data: D.selectorOf('transfer(address,uint256)') + addr(attacker) + word(1n) })).toMatchObject({ status: 0,
        reason: 'AllowedMethodsEnforcer:method-not-allowed' });
      expect(h.evm.control.balance('USDC', attacker)).toBe(0n);
      // Within scope it works (recipient = owner, input ≤ cap); after the owner disables the delegation nothing does.
      expect(await attack(1, swap(100_000_000n, h.evmOwner.address))).toMatchObject({ status: 1 });
      h.evm.control.ownerSend(h.evmOwner.address, h.evmOwner.address, D.disableDelegationCalldata(delegation));
      expect(await attack(0, { target: p.usdc, value: 0n, data: D.APPROVE_METHOD + addr(p.router) + word(1n) })).toMatchObject({ status: 0, reason: 'CannotUseADisabledDelegation' });
      // Another key cannot redeem the owner's delegation at all.
      const other = await h.signer.create('eip155');
      const tx: erc7710.Eip1559 = { chainId: 84532n, nonce: 0n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2_000_000_000n, gasLimit: 600_000n, to: F.delegationManager, value: 0n,
        data: D.redeemCalldata(delegation, 0, { target: p.usdc, value: 0n, data: D.APPROVE_METHOD + addr(p.router) + word(1n) }) };
      const sig = await h.signer.signEvmDigest(other.ref, D.bytesOf(D.eip1559SigningHash(tx)));
      const hash = await h.evm.rpc('eth_sendRawTransaction', [D.signedEip1559(tx, sig.yParity, sig.r, sig.s).raw]) as string;
      expect(h.evm.control.receipt(hash)).toMatchObject({ status: 0, reason: 'InvalidDelegate' });
    } finally { await t.drop(); }
  });

  it('the call-count ceiling ends the grant on-chain even if FloFi\'s own counter were reset', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const evmGrant = await h.enrollEvm(passkeyId, { maxCalls: 2 });
      const grant = (await h.store.grantById(evmGrant.grantId))!, delegation = delegationOf(grant.grantPayload!.delegation), p = h.evm.control.profile;
      const send = async (n: bigint) => {
        const tx: erc7710.Eip1559 = { chainId: 84532n, nonce: n, maxPriorityFeePerGas: 1n, maxFeePerGas: 2_000_000_000n, gasLimit: 600_000n, to: F.delegationManager, value: 0n,
          data: D.redeemCalldata(delegation, 0, { target: p.usdc, value: 0n, data: D.APPROVE_METHOD + addr(p.router) + word(1n) }) };
        const sig = await h.signer.signEvmDigest(grant.sessionKeyRef, D.bytesOf(D.eip1559SigningHash(tx)));
        return h.evm.control.receipt(await h.evm.rpc('eth_sendRawTransaction', [D.signedEip1559(tx, sig.yParity, sig.r, sig.s).raw]) as string)!;
      };
      expect((await send(0n)).status).toBe(1);
      expect((await send(1n)).status).toBe(1);
      expect(await send(2n)).toMatchObject({ status: 0, reason: 'LimitedCallsEnforcer:limit-exceeded' });
    } finally { await t.drop(); }
  });
});

describe('BUILD-AUTOMATION-002 budget reservation under competing workers (PostgreSQL)', () => {
  it('ten concurrent reservations on separate connections never exceed the weekly budget (exactly four of 50 within 200)', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      await h.enrollEvm(passkeyId);
      const { created } = await h.authorize(h.multichainInput({ limits: { assets: [{ asset: h.USDC_KEY, maxPerExecution: '50', budgets: [{ period: 'WEEK', amount: '200' }] }],
        maxExecutionsPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: 50 } }, false));
      const rule = (await h.automations.ruleById(created.ruleId))!, authorization = (await h.store.authorizationById(created.authorizationId))!;
      const revision = (await h.store.revision(created.authorizationId, authorization.activeRevision!))!;
      const { manifest } = revision, { executionSpend } = await import('./manifest.ts'), { reservationViolation, periodStarts } = await import('./policy.ts');
      const { workflowRequirement } = await import('./steps.ts');
      const req = workflowRequirement(rule.binding!.strategy, rule.binding!.workflowHash);
      if (!req.ok) throw new Error(req.code);
      const executions = [];
      for (let i = 0; i < 10; i++) {
        const occurrenceId = `occ_${'abcdefghij'[i]!.repeat(26)}`;
        await t.db.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key, kind, state, strategy, workflow_hash,
          due_at, expires_at, decided_at) VALUES ('default', $1, $2, 'eip155', $3, $4, 'SCHEDULE', 'DELEGATED', $5::jsonb, $6, now(), now() + interval '1 day', now())`,
        [occurrenceId, rule.ruleId, h.owner.address, `slot:race-${i}`, JSON.stringify(rule.binding!.strategy), rule.binding!.workflowHash]);
        const e = await h.store.ensureExecution({ executionId: `dex_${'abcdefghij'[i]!.repeat(26)}`, authorizationId: created.authorizationId, revision: revision.revision,
          owner: h.owner, ruleId: rule.ruleId, occurrenceId, workflowHash: revision.workflowHash, manifestHash: revision.manifestHash, stepCount: 1 }, h.now());
        executions.push((await h.store.transition(e.executionId, { version: e.version, from: ['QUEUED'] }, 'AUTHORITY_VERIFIED', {}, h.now()))!);
      }
      const now = h.now(), starts = periodStarts(manifest, now.getTime()), spend = executionSpend(req.value);
      const results = await Promise.all(executions.map(e => createPgDelegationStore(t.open(2), 'default').reserve({ executionId: e.executionId, expectedVersion: e.version,
        revision: revision.revision, now, periods: { DAY: new Date(starts.DAY), WEEK: new Date(starts.WEEK), MONTH: new Date(starts.MONTH) },
        entries: [{ stepIndex: 0, asset: h.USDC_KEY, amount: 50_000_000n }],
        steps: [{ stepIndex: 0, credentialId: manifest.credentials[0]!.credentialId, grantId: manifest.credentials[0]!.grantId, mechanism: manifest.credentials[0]!.mechanism,
          chain: manifest.credentials[0]!.chain, grantCommitment: manifest.credentials[0]!.grantCommitment }],
        check: usage => reservationViolation(manifest, spend, usage, now.getTime()) })));
      expect(results.filter(r => r.ok)).toHaveLength(4);
      expect(results.filter(r => !r.ok).map(r => !r.ok && r.code)).toEqual(Array(6).fill('LIMIT_PERIOD_AMOUNT'));
      const reserved = await h.store.budget(created.authorizationId);
      expect(reserved.reduce((s, b) => s + b.reserved, 0n)).toBe(200_000_000n);
      // The ledger is append-only.
      await expect(t.db.query('DELETE FROM delegated_budget_entries')).rejects.toThrow(/DELEGATED_RECORD_APPEND_ONLY/);
    } finally { await t.drop(); }
  });
});

describe('BUILD-AUTOMATION-002 passkey binding and replay (PostgreSQL)', () => {
  it('each grant\'s owner-signed enrollment anchors the authorization passkey; a reused assertion or challenge is refused', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const evmGrant = await h.enrollEvm(passkeyId);
      const grant = (await h.store.grantById(evmGrant.grantId))!, passkey = (await h.store.passkey(h.owner, passkeyId))!;
      const anchor = passkeyAnchor({ owner: `eip155:${h.owner.address}`, grantId: grant.grantId, chain: grant.chain, walletAddress: grant.walletAddress, passkeyId,
        publicKeySpki: passkey.publicKeySpki });
      expect(delegationOf(grant.grantPayload!.delegation).salt).toBe(BigInt(anchor));
      // Another passkey (an attacker-controlled authenticator registered for the owner) yields another anchor: it cannot inherit the grant.
      const forged = Uint8Array.from(passkey.publicKeySpki); forged[90] ^= 1;
      expect(passkeyAnchor({ owner: `eip155:${h.owner.address}`, grantId: grant.grantId, chain: grant.chain, walletAddress: grant.walletAddress, passkeyId, publicKeySpki: forged })).not.toBe(anchor);
      const created = await h.service.automationCreate(h.owner, h.multichainInput({}, false));
      const review = await h.service.authorizationReview(h.owner, created.authorizationId);
      const assertion = h.passkey.assert(fromB64url(review.challenge), 'http://localhost:3999', 'localhost');
      await h.service.authorizationSign(h.owner, created.authorizationId, review.revision, assertion);
      await expect(h.service.authorizationSign(h.owner, created.authorizationId, review.revision, assertion)).rejects.toThrow();
      // A challenge for another subject, another purpose or another owner is not consumable.
      expect(await h.store.consumeChallenge(null, h.owner, 'AUTHORIZE', fromB64url(review.challenge), `${created.authorizationId}:1`, h.now())).toBe(false);
      // The executor re-verifies the stored assertion: the authorization stays verifiable without any new signature.
      await h.trigger(created.ruleId); await h.drain();
      expect((await h.store.executions(h.owner, { limit: 1 }))[0]!.state).toBe('SETTLED');
    } finally { await t.drop(); }
  });
});
