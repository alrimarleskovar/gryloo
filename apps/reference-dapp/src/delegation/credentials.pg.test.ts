// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the Credential enrollment lifecycle through both adapters (PostgreSQL + MOCKED loopback chains): what the wallet is
 * asked to sign, signature and chain-state verification, insufficient/foreign signatures, an account that is not a smart account yet,
 * external revocation, expiry and the owner's own on-chain revocation.
 */
import { describe, expect, it } from 'vitest';
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { createTestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { delegationHarness } from './delegation.test-harness.ts';
import { sweepDelegation } from './executor-runtime.ts';

const D = erc7710;

describe('BUILD-AUTOMATION-002 EVM Credential (ERC-7710, MetaMask Delegation Framework v1.3.0 model)', () => {
  it('asks the wallet for one EIP-712 Delegation bound to the chain, the manager and the passkey anchor, and verifies it against chain state', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const pending = await h.service.credentialPrepare(h.owner, h.proven, { mechanism: 'EVM_ERC7710_METAMASK_V1_3', walletAddress: h.evmOwner.address, network: 'base-sepolia',
        pairs: [{ input: 'USDC', output: 'WETH', perCallCap: '100' }], maxCalls: 40, expiresAt: '2026-12-31T00:00:00Z', passkeyId, label: 'MetaMask' });
      const e = pending.enrollment as { typedData: ReturnType<typeof D.delegationTypedData>; digest: string; requires: Record<string, string> };
      expect(e.typedData.domain).toEqual({ name: 'DelegationManager', version: '1', chainId: 84532, verifyingContract: D.DELEGATION_FRAMEWORK_V1_3.delegationManager });
      expect(e.typedData.message).toMatchObject({ delegator: h.evmOwner.address, delegate: pending.sessionAddress, authority: D.ROOT_AUTHORITY });
      expect(e.typedData.message.caveats.map(c => c.enforcer)).toEqual([D.DELEGATION_FRAMEWORK_V1_3.enforcers.redeemer, D.DELEGATION_FRAMEWORK_V1_3.enforcers.timestamp,
        D.DELEGATION_FRAMEWORK_V1_3.enforcers.limitedCalls, D.DELEGATION_FRAMEWORK_V1_3.enforcers.valueLte, D.DELEGATION_FRAMEWORK_V1_3.enforcers.logicalOrWrapper]);
      expect(e.requires).toMatchObject({ account: 'METAMASK_EIP7702_SMART_ACCOUNT', implementation: D.DELEGATION_FRAMEWORK_V1_3.eip7702StatelessDeleGator });
      expect(pending).toMatchObject({ state: 'PENDING_SIGNATURE', scope: { kind: 'EVM', pairs: [{ input: 'USDC', output: 'WETH', perCallCap: '100' }], maxCalls: 40 } });
      // A signature by another key is refused and the enrollment fails (the session key reference is destroyed).
      const stranger = await (await import('./delegation.test-harness.ts')).evmWallet();
      await expect(h.service.credentialComplete(h.owner, pending.grantId, { signature: await stranger.signDigest(e.digest) })).rejects.toThrow('ENROLLMENT_SIGNER_MISMATCH');
      expect((await h.store.grantById(pending.grantId))!.state).toBe('FAILED');
      await expect(h.signer.address((await h.store.grantById(pending.grantId))!.sessionKeyRef)).rejects.toThrow('SIGNER_KEY_NOT_FOUND');
    } finally { await t.drop(); }
  });

  it('an EOA that is not yet a MetaMask smart account stays pending (retryable) until the wallet upgrades it', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      h.evm.control.downgrade(h.evmOwner.address);
      const passkeyId = await h.registerPasskey();
      const pending = await h.service.credentialPrepare(h.owner, h.proven, { mechanism: 'EVM_ERC7710_METAMASK_V1_3', walletAddress: h.evmOwner.address, network: 'base-sepolia',
        pairs: [{ input: 'USDC', output: 'WETH', perCallCap: '100' }], maxCalls: 40, expiresAt: '2026-12-31T00:00:00Z', passkeyId, label: 'MetaMask' });
      const signature = await h.evmOwner.signDigest(String(pending.enrollment!.digest));
      await expect(h.service.credentialComplete(h.owner, pending.grantId, { signature })).rejects.toThrow('EVM_ACCOUNT_NOT_UPGRADED');
      expect((await h.store.grantById(pending.grantId))!.state).toBe('PENDING_SIGNATURE');
      h.evm.control.upgrade(h.evmOwner.address);
      expect((await h.service.credentialComplete(h.owner, pending.grantId, { signature })).state).toBe('ACTIVE');
    } finally { await t.drop(); }
  });

  it('revoke credential: unusable by FloFi at once, session key destroyed, then the owner\'s self-call is verified on-chain', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const grant = await h.enrollEvm(passkeyId);
      const requested = await h.service.credentialRevoke(h.owner, grant.grantId);
      expect(requested.state).toBe('REVOCATION_REQUESTED');
      const revocation = requested.revocation as { to: string; from: string; data: string };
      expect([revocation.from, revocation.to]).toEqual([h.evmOwner.address, h.evmOwner.address]);
      await expect(h.signer.address((await h.store.grantById(grant.grantId))!.sessionKeyRef)).rejects.toThrow('SIGNER_KEY_NOT_FOUND');
      // Before the owner's transaction, readback cannot confirm it: UNCERTAIN, never REVOKED.
      expect((await h.service.credentialRevocationComplete(h.owner, grant.grantId, {})).state).toBe('UNCERTAIN');
      h.evm.control.ownerSend(revocation.from, revocation.to, revocation.data);
      expect((await h.service.credentialRevocationComplete(h.owner, grant.grantId, {})).state).toBe('REVOKED');
      // A revoked credential can never back a new workflow.
      const preview = await h.service.automationPreview(h.owner, h.multichainInput({}, false));
      expect(preview.requiredEnrollments[0]!.reason).toBe('CREDENTIAL_REVOKED');
    } finally { await t.drop(); }
  });

  it('expired grants are lapsed by the sweep and fail the authority graph', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const grant = await h.enrollEvm(passkeyId, { expiresAt: '2026-10-13T00:00:00Z' });
      h.set('2026-10-13T00:00:01Z');
      await sweepDelegation(h.rt);
      expect((await h.store.grantById(grant.grantId))!.state).toBe('EXPIRED');
      expect((await h.service.automationPreview(h.owner, h.multichainInput({ expiresAt: '2026-12-01T00:00:00Z' }, false))).requiredEnrollments[0]!.reason).toBe('CREDENTIAL_EXPIRED');
    } finally { await t.drop(); }
  });
});

describe('BUILD-AUTOMATION-002 Solana Credential (SPL Token delegation)', () => {
  it('one owner-signed transaction anchors the passkey (Memo) and approves the session key; a different message is refused', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      const pending = await h.service.credentialPrepare(h.owner, h.proven, { mechanism: 'SOLANA_SPL_DELEGATE_V1', walletAddress: h.solOwner.address, network: 'solana-devnet',
        tokens: [{ symbol: 'devUSDC', amount: '20' }], expiresAt: '2026-12-31T00:00:00Z', passkeyId, label: 'Phantom' });
      expect(pending.enrollment).toMatchObject({ kind: 'SOLANA_DELEGATION_TRANSACTION', delegate: pending.sessionAddress, memo: expect.stringMatching(/^flofi:grant:v1:[0-9a-f]{64}$/) });
      // Signing another message (here: the revocation-like empty memo) does not enroll anything.
      const { splDelegation, compileMessageV0, serializeMessageV0, toBase64 } = await import('@defi-workflow-engine/reference-compiler');
      const other = serializeMessageV0(compileMessageV0(h.solOwner.address, [splDelegation.memo('something else', h.solOwner.address)], h.sol.control.blockhash, {}));
      await expect(h.service.credentialComplete(h.owner, pending.grantId, { signedTransaction: await h.solOwner.signTransaction(toBase64(other)) })).rejects.toThrow('ENROLLMENT_MESSAGE_MISMATCH');
      expect(h.sol.control.account(h.solTokenAccount)!.delegate).toBeNull();
      const active = await h.service.credentialComplete(h.owner, pending.grantId, { signedTransaction: await h.solOwner.signTransaction(pending.enrollment!.message) });
      expect(active.state).toBe('ACTIVE');
      expect(h.sol.control.account(h.solTokenAccount)).toMatchObject({ delegate: pending.sessionAddress, delegatedAmount: 20_000_000n });
    } finally { await t.drop(); }
  });

  it('an external revoke clears the delegate: re-verification makes the grant UNCERTAIN and the graph refuses it; the owner\'s FloFi revocation is verified', async () => {
    const t = await createTestDatabase();
    try {
      const h = await delegationHarness(t.db);
      const passkeyId = await h.registerPasskey();
      await h.enrollEvm(passkeyId);
      const grant = await h.enrollSolana(passkeyId);
      h.sol.control.revokeExternally(h.solTokenAccount);
      expect((await h.service.credentialReverify(h.owner, grant.grantId)).state).toBe('UNCERTAIN');
      expect((await h.service.automationPreview(h.owner, h.multichainInput())).requiredEnrollments).toEqual([expect.objectContaining({ stepIndex: 1, reason: 'CREDENTIAL_UNCERTAIN' })]);
      const second = await h.enrollSolana(passkeyId);
      const requested = await h.service.credentialRevoke(h.owner, second.grantId);
      const revoked = await h.service.credentialRevocationComplete(h.owner, second.grantId, { signedTransaction: await h.solOwner.signTransaction(requested.revocation!.message) });
      expect(revoked.state).toBe('REVOKED');
      expect(h.sol.control.account(h.solTokenAccount)!.delegate).toBeNull();
    } finally { await t.drop(); }
  });
});
