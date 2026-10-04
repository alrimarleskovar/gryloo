// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { createTempoService } from './tempo-service';
import { tempoFixture, tempoOwner, tempoWorkflow, signMockTempo } from '../../../../packages/reference-compiler/test/tempo-fixture';
import { requestTempoPayment } from '../wallet/tempo';
import { createTempoReadRpc } from './tempo-rpc';
async function setup() {
  const f = tempoFixture(), storage = createFileExecutionStorage(await mkdtemp(join(tmpdir(), 'tempo-test-')), 'TEMPO_BUSY');
  const open = () => createTempoService({ rpc: f.rpc, storage, provenance: 'MOCKED', now: () => f.now });
  const service = open(), w = tempoWorkflow(), r = await service.simulate(w, tempoOwner);
  await service.review(r.id, r.review.commitment, w); return { f, storage, open, service, w, r };
}
describe('Tempo shared durable service and browser boundary', () => {
  it('reconciles after lost browser response and restart, archives MOCKED evidence, never retries a spend', async () => {
    const { f, open, service, w, r } = await setup();
    const prepared = await service.begin(r.id, tempoOwner, w), signed = signMockTempo(prepared.transaction);
    await open().handoff(r.id, signed.hash, w);
    f.mine(prepared.transaction); // MOCKED owner submission, outside server/worker RPC.
    const restored = await open().observe(r.id);
    expect(restored).toMatchObject({ verdict: 'RECONCILED', attempt: { reconciled: true }, evidence: { bundle: { environment: 'MOCKED' } } });
    expect((await open().observe(r.id)).journal.entries.length).toBe(restored.journal.entries.length);
    await expect(open().begin(r.id, tempoOwner, w)).rejects.toThrow('TEMPO_EXISTING_ATTEMPT_OBSERVE_ONLY');
    expect(f.calls.some(c => /send|sign|fund/i.test(c))).toBe(false);
  });
  it('keeps an uncertain nonce reserved across runs until finalized on-chain expiry', async () => {
    const { service, w, r } = await setup(); await service.begin(r.id, tempoOwner, w);
    expect((await service.observe(r.id)).attempt?.state).toBe('PREPARED');
    const other = await service.simulate(w, tempoOwner); await service.review(other.id, other.review.commitment, w);
    await expect(service.begin(other.id, tempoOwner, w)).rejects.toThrow('TEMPO_NONCE_RESERVED');
    await expect(service.recoverReview(r.id)).rejects.toThrow('TEMPO_RECOVERY_OBSERVE_ONLY');
  });
  it.each(['PREPARED', 'SUBMITTING'] as const)('recovers %s only after finalized expiry with an unused nonce and requires fresh Review', async stage => {
    const { service, w, r, f } = await setup(); const prepared = await service.begin(r.id, tempoOwner, w);
    if (stage === 'SUBMITTING') await service.handoff(r.id, signMockTempo(prepared.transaction).hash, w);
    f.advance(121_000);
    const edited = { ...w, revision: 2 };
    const fresh = await service.recoverReview(r.id, edited);
    expect(fresh.authorization).toBeNull(); expect(fresh.recoveryOf).toBe(r.id);
    expect(fresh.review.commitment).not.toBe(r.review.commitment);
    expect((await service.load(r.id)).attempt?.state).toBe('CANCELLED');
    expect(fresh.review.workflow.revision).toBe(2);
    await expect(service.begin(fresh.id, tempoOwner, edited)).rejects.toThrow('TEMPO_REVIEW_REQUIRED');
    await service.review(fresh.id, fresh.review.commitment, edited);
    expect((await service.begin(fresh.id, tempoOwner, edited)).record.attempt?.state).toBe('PREPARED');
  });
  it('cannot recover expiry when the nonce was consumed or a pending transaction exists', async () => {
    const { service, w, r, f } = await setup(); const prepared = await service.begin(r.id, tempoOwner, w);
    await service.handoff(r.id, signMockTempo(prepared.transaction).hash, w); f.mine(prepared.transaction); f.advance(121_000);
    await expect(service.recoverReview(r.id)).rejects.toThrow('TEMPO_RECOVERY_OBSERVE_ONLY');
    expect((await service.load(r.id)).attempt?.state).toBe('SUBMITTING');
    const other = await setup(); await other.service.begin(other.r.id, tempoOwner, other.w); other.f.advance(121_000); other.f.config.pending = 1n;
    await expect(other.service.recoverReview(other.r.id)).rejects.toThrow('TEMPO_RECOVERY_OBSERVE_ONLY');
  });
  it('persists invalidation when fresh state or intent changes before handoff', async () => {
    const { service, w, r, f } = await setup(); const begun = await service.begin(r.id, tempoOwner, w);
    f.config.policy = 2n;
    await expect(service.handoff(r.id, signMockTempo(begun.transaction).hash, w)).rejects.toThrow('TEMPO_POLICY_UNSUPPORTED');
    expect((await service.load(r.id)).authorization).toBeNull();
    const other = await setup();
    await expect(other.service.begin(other.r.id, tempoOwner, { ...other.w, revision: 2 })).rejects.toThrow('TEMPO_REVIEW_CHANGED');
    expect((await other.service.load(other.r.id)).authorization).toBeNull();
  });
  it.each(['hold', 'badFee', 'reorg', 'extraLog'] as const)('never issues evidence on %s', async fault => {
    const { service, w, r, f } = await setup(); const prepared = await service.begin(r.id, tempoOwner, w), signed = signMockTempo(prepared.transaction);
    await service.handoff(r.id, signed.hash, w); f.mine(prepared.transaction); f.config[fault] = true;
    const result = await service.observe(r.id); expect(result.verdict).toBe('DIVERGENT'); expect(result.evidence).toBeNull();
  });
  it('wallet verifies bytes, durably hands off hash, then broadcasts exactly once', async () => {
    const { service, w, r, f } = await setup(); const prepared = await service.begin(r.id, tempoOwner, w), calls: string[] = [];
    const signed = signMockTempo(prepared.transaction);
    const provider = { async request({ method }: { method: string }) {
      calls.push(method); if (method === 'eth_chainId') return '0xa5bf'; if (method === 'eth_accounts') return [tempoOwner];
      if (method === 'eth_signTransaction') return signed.raw;
      if (method === 'eth_sendRawTransaction') { expect((await service.load(r.id)).attempt?.transactionHash).toBe(signed.hash); return f.mine(prepared.transaction).hash; }
      throw new Error('UNSUPPORTED');
    } };
    expect(await requestTempoPayment(provider, prepared.record.review, h => service.handoff(r.id, h, w).then(() => undefined), () => true, () => f.now)).toBe(signed.hash);
    expect(calls.filter(m => m === 'eth_sendRawTransaction')).toHaveLength(1);
  });
  it('unsupported envelope and edits while wallet prompt is open cannot broadcast', async () => {
    const { r, f } = await setup(); let current = true; const calls: string[] = [];
    const provider = { async request({ method }: { method: string }) {
      calls.push(method); if (method === 'eth_chainId') return '0xa5bf'; if (method === 'eth_accounts') return [tempoOwner];
      current = false; return signMockTempo(r.review.transaction).raw;
    } };
    await expect(requestTempoPayment(provider, r.review, async () => { throw new Error('HANDOFF_MUST_NOT_RUN'); }, () => current, () => f.now)).rejects.toThrow('TEMPO_REVIEW_STALE');
    expect(calls).not.toContain('eth_sendRawTransaction');
    await expect(requestTempoPayment({ request: async ({ method }) => method === 'eth_chainId' ? '0xa5bf' : method === 'eth_accounts' ? [tempoOwner] : '0x02c0' }, r.review,
      async () => { throw new Error('HANDOFF_MUST_NOT_RUN'); }, () => true, () => f.now)).rejects.toThrow('TEMPO_WALLET_ENVELOPE_UNSUPPORTED');
  });
  it('rechecks edits after asynchronous wallet account discovery and before signing', async () => {
    const { r, f } = await setup(); let current = true; const calls: string[] = [];
    const provider = { async request({ method }: { method: string }) {
      calls.push(method); if (method === 'eth_chainId') return '0xa5bf';
      if (method === 'eth_accounts') { current = false; return [tempoOwner]; }
      throw new Error('MUST_NOT_SIGN');
    } };
    await expect(requestTempoPayment(provider, r.review, async () => undefined, () => current, () => f.now)).rejects.toThrow('TEMPO_REVIEW_STALE');
    expect(calls).toEqual(['eth_chainId', 'eth_accounts']);
  });
  it('denies every server submission and funding method', async () => {
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_signTransaction', 'tempo_fundAddress', 'wallet_sendCalls'])
      await expect(createTempoReadRpc()(method, [])).rejects.toThrow('TEMPO_RPC_METHOD_DENIED');
  });
});
