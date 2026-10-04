// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { simulateTempoPayment, assertTempoReview, tempoFee, readTempoState, supplyArtifactHash } from '../src/index.js';
import { verifyTempoSignedEnvelope } from '../src/tempo-envelope.js';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '../../reference-linter/src/index.js';
import { resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { tempoFixture, tempoOwner, tempoRecipient, tempoWorkflow, signMockTempo } from './tempo-fixture.js';
describe('Tempo payment adapter', () => {
  it('uses canonical schemas and registry without inheriting native EVM fees or evidence', async () => {
    const f = tempoFixture(), w = tempoWorkflow(); validateAuthoringWorkflow(w, createBaseSepoliaReviewContext());
    const r = await simulateTempoPayment(w, tempoOwner, f.rpc, f.now);
    expect(r.transaction).toMatchObject({ type: '0x76', nonceKey: '0x0', chainId: '0xa5bf', feeToken: r.fields.token });
    for (const [kind, artifact] of [['artifact-set', r.artifactSet], ['simulation-bundle', r.simulation], ['authorization-policy', r.policy], ['strategy-manifest', r.manifest], ['execution-plan', r.plan]] as const)
      expect(supplyArtifactHash(kind, artifact)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(resolveWorkflowCapability(w, { environment: 'PUBLIC_TESTNET' })).toMatchObject({ executionSupported: true, evidenceCeiling: null });
    expect(resolveWorkflowCapability(w, { environment: 'MAINNET' }).executionSupported).toBe(false);
    expect(f.calls).not.toContain('eth_getBalance');
    expect(f.calls.some(c => /send|sign|fund/i.test(c))).toBe(false);
    expect(tempoFee(1n, 1n)).toBe(1n); expect(tempoFee(60000n, 1_000_000_000n)).toBe(60n);
  });
  it.each(['wrongChain','stale','paused','policy','code','hold','balance','pending'] as const)('fails closed on %s', async key => {
    const f = tempoFixture();
    if (key === 'wrongChain' || key === 'stale' || key === 'hold') f.config[key] = true;
    else if (key === 'code') f.config.code = '0x01'; else f.config[key] = key === 'balance' ? 0n : 2n;
    await expect(simulateTempoPayment(tempoWorkflow(), tempoOwner, f.rpc, f.now)).rejects.toThrow();
  });
  it('binds intent, expiry, owner, nonce and fee state after Review', async () => {
    const f = tempoFixture(), w = tempoWorkflow(), r = await simulateTempoPayment(w, tempoOwner, f.rpc, f.now);
    const state = await readTempoState(f.rpc, tempoOwner, tempoRecipient, f.now);
    expect(() => assertTempoReview(r, w, tempoOwner, state, f.now)).not.toThrow();
    expect(() => assertTempoReview(r, { ...w, revision: 2 }, tempoOwner, state, f.now)).toThrow();
    expect(() => assertTempoReview(r, w, tempoRecipient, state, f.now)).toThrow();
    expect(() => assertTempoReview(r, w, tempoOwner, state, f.now + 120000)).toThrow();
    expect(() => assertTempoReview(r, w, tempoOwner, { ...state, nonce: '1' }, f.now)).toThrow();
    expect(() => assertTempoReview(r, w, tempoOwner, { ...state, gasPrice: '999999999999' }, f.now)).toThrow();
  });
  it('verifies real secp256k1 signatures and exact type-0x76 bytes, rejecting changed payloads', async () => {
    const f = tempoFixture(), r = await simulateTempoPayment(tempoWorkflow(), tempoOwner, f.rpc, f.now), signed = signMockTempo(r.transaction);
    expect(verifyTempoSignedEnvelope(signed.raw, r.transaction)).toEqual({ hash: signed.hash, signer: tempoOwner });
    for (const patch of [{ chainId: '0x1079' }, { feeToken: tempoRecipient }, { nonce: '0x1' }, { gas: '0xfffff' }, { validBefore: '0xffffffff' }])
      expect(() => verifyTempoSignedEnvelope(signMockTempo({ ...r.transaction, ...patch }).raw, r.transaction)).toThrow();
    expect(() => verifyTempoSignedEnvelope('0x02' + signed.raw.slice(4), r.transaction)).toThrow();
  });
});
