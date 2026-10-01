// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockedSolanaJupiter, createMockedSolanaWallet, type MockedJupiterOptions } from '@defi-workflow-engine/reference-compiler';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import { createJupiterService } from './jupiter-service';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

const workflow = (amount = '10', from: 'USDC' | 'SOL' = 'USDC', to: 'SOL' | 'USDC' = 'SOL'): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, resourceEdges: [],
  nodes: [createSolanaSwapNode('node-002', { network: 'Solana', from, to, amount, slippage: '50' })] });
async function setup(options: MockedJupiterOptions = {}, service: { provenance?: 'PUBLIC_MAINNET' | 'MOCKED'; executionEnabled?: boolean; dir?: string } = {}) {
  const env = createMockedSolanaJupiter(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, { USDC: 100_000_000n });
  const dir = service.dir ?? await mkdtemp(join(tmpdir(), 'gryloo-jupiter-'));
  let clock = Date.parse('2026-10-01T12:00:00.000Z');
  const make = () => createJupiterService({ rpc: env.rpc, http: env.http, journalDir: dir, provenance: service.provenance ?? 'MOCKED', executionEnabled: service.executionEnabled ?? true, now: () => clock });
  return { env, wallet, dir, service: make(), make, tick: (ms: number) => { clock += ms; } };
}
async function reviewed(s: Awaited<ReturnType<typeof setup>>, wf = workflow()) {
  const simulated = await s.service.simulate(wf, s.wallet.owner);
  return s.service.review(simulated.id, simulated.review.commitment, wf);
}
describe('Jupiter service lifecycle (MOCKED loopback, no public submission)', () => {
  it('simulates read-only, binds Review, persists before signing, broadcasts once and reconciles with MOCKED evidence', async () => {
    const s = await setup();
    const simulated = await s.service.simulate(workflow(), s.wallet.owner);
    expect(simulated).toMatchObject({ authorization: null, attempt: null, evidenceClass: 'MOCKED' });
    expect(s.env.state.sent).toEqual([]);
    await expect(s.service.begin(simulated.id, s.wallet.owner, workflow())).rejects.toThrow('JUPITER_REVIEW_REQUIRED');
    const record = await s.service.review(simulated.id, simulated.review.commitment, workflow());
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    expect((await s.service.load(record.id)).attempt?.state).toBe('PREPARED');
    expect(s.env.state.sent).toEqual([]);
    const submitted = await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(submitted.attempt).toMatchObject({ state: 'PENDING' });
    expect(s.env.state.sent).toHaveLength(1);
    const observed = await s.service.observe(record.id);
    expect(observed).toMatchObject({ verdict: 'RECONCILED', evidenceClass: 'MOCKED', attempt: { state: 'CONFIRMED', reconciled: true } });
    expect(observed.evidence?.bundle.environment).toBe('MOCKED');
    expect(observed.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState)).toEqual(['PREPARED', 'SUBMITTING', 'PENDING', 'CONFIRMED']);
  });
  it('keeps public runs PUBLIC_READ_ONLY and refuses mainnet execution unless the owner enabled it', async () => {
    const s = await setup({}, { provenance: 'PUBLIC_MAINNET', executionEnabled: false });
    const record = await reviewed(s);
    expect(record.evidenceClass).toBe('PUBLIC_READ_ONLY');
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('JUPITER_MAINNET_EXECUTION_NOT_ENABLED');
    expect((await s.service.load(record.id)).attempt).toBeNull();
  });
  it('invalidates authorization for stale quotes, a wrong owner and semantic changes before any attempt', async () => {
    const s = await setup();
    const record = await reviewed(s);
    await expect(s.service.begin(record.id, createMockedSolanaWallet().owner, workflow())).rejects.toThrow('JUPITER_WRONG_OWNER');
    await expect(s.service.begin(record.id, s.wallet.owner, workflow('11'))).rejects.toThrow('JUPITER_SEMANTIC_REVISION_CHANGED');
    s.tick(61_000);
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('JUPITER_QUOTE_STALE');
    expect((await s.service.load(record.id)).attempt).toBeNull();
    const invalidated = await s.service.invalidate(record.id);
    expect(invalidated.authorization).toBeNull();
  });
  it('records wallet rejection as not submitted and releases the owner lease', async () => {
    const s = await setup();
    const record = await reviewed(s);
    await s.service.begin(record.id, s.wallet.owner, workflow());
    const rejected = await s.service.walletFailure(record.id, { stage: 'SIGN', code: 'JUPITER_WALLET_REJECTED', error: { code: 4001 } });
    expect(rejected).toMatchObject({ notSubmitted: true, authorization: null, attempt: { state: 'CANCELLED', signature: null } });
    expect(s.env.state.sent).toEqual([]);
    const next = await reviewed(s);
    await expect(s.service.begin(next.id, s.wallet.owner, workflow())).resolves.toBeTruthy();
  });
  it('never broadcasts a transaction the wallet modified after Review', async () => {
    const s = await setup();
    const record = await reviewed(s);
    await s.service.begin(record.id, s.wallet.owner, workflow());
    const other = (await reviewed(await setup())).review.unsignedTransaction;
    const result = await s.service.submit(record.id, s.wallet.sign(other));
    expect(result).toMatchObject({ error: 'JUPITER_TRANSACTION_CHANGED', notSubmitted: true, attempt: { state: 'CANCELLED' } });
    expect(s.env.state.sent).toEqual([]);
  });
  it('prevents duplicate economic attempts across runs for the same owner', async () => {
    const s = await setup();
    const first = await reviewed(s), second = await reviewed(s);
    await s.service.begin(first.id, s.wallet.owner, workflow());
    await expect(s.service.begin(first.id, s.wallet.owner, workflow())).rejects.toThrow('JUPITER_EXISTING_ATTEMPT_OBSERVE_ONLY');
    await expect(s.service.begin(second.id, s.wallet.owner, workflow())).rejects.toThrow('JUPITER_OWNER_ATTEMPT_IN_PROGRESS');
  });
  it('recovers an uncertain submission by observing the persisted signature, never resubmitting', async () => {
    const s = await setup({ send: 'RPC_ERROR_AFTER_LANDING' });
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    const uncertain = await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(uncertain).toMatchObject({ error: 'JUPITER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', attempt: { state: 'SUBMISSION_RESULT_UNKNOWN' } });
    expect(uncertain.attempt?.signature).toBeTruthy();
    const restarted = s.make();
    expect((await restarted.observe(record.id)).verdict).toBe('RECONCILED');
    expect(s.env.state.sent).toHaveLength(1);
  });
  it('proves a dropped transaction expired before allowing a new attempt', async () => {
    const s = await setup({ send: 'RPC_ERROR_DROPPED' });
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect((await s.service.observe(record.id))).toMatchObject({ error: 'JUPITER_TRANSACTION_NOT_OBSERVED', verdict: 'PENDING' });
    const blocked = await reviewed(s);
    await expect(s.service.begin(blocked.id, s.wallet.owner, workflow())).rejects.toThrow('JUPITER_OWNER_ATTEMPT_IN_PROGRESS');
    s.env.advance(200);
    expect(await s.service.observe(record.id)).toMatchObject({ verdict: 'NOT_EXECUTED', attempt: { state: 'NOT_FOUND' }, error: 'JUPITER_TRANSACTION_EXPIRED_NOT_EXECUTED' });
    const fresh = await reviewed(s);
    await expect(s.service.begin(fresh.id, s.wallet.owner, workflow())).resolves.toBeTruthy();
  });
  it('marks a pending broadcast that never landed as EXPIRED after validity', async () => {
    const s = await setup({ send: 'DROPPED' });
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    expect((await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction))).attempt?.state).toBe('PENDING');
    s.env.advance(200);
    expect(await s.service.observe(record.id)).toMatchObject({ verdict: 'NOT_EXECUTED', attempt: { state: 'EXPIRED' } });
  });
  it('cancels a prepared attempt found on restart because no signature was ever returned', async () => {
    const s = await setup();
    const record = await reviewed(s);
    await s.service.begin(record.id, s.wallet.owner, workflow());
    expect(await s.make().observe(record.id)).toMatchObject({ notSubmitted: true, error: 'JUPITER_WALLET_NOT_SUBMITTED', attempt: { state: 'CANCELLED' } });
  });
  it('records an on-chain failure as REVERTED / DIVERGENT', async () => {
    const options: MockedJupiterOptions = {};
    const s = await setup(options);
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    options.failSwap = true;
    await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(await s.service.observe(record.id)).toMatchObject({ verdict: 'DIVERGENT', error: 'JUPITER_SWAP_FAILED', attempt: { state: 'REVERTED' }, evidence: null });
  });
  it('rejects a tampered durable journal', async () => {
    const s = await setup();
    const record = await reviewed(s);
    const file = join(s.dir, record.id + '.jsonl');
    await writeFile(file, (await readFile(file, 'utf8')).replace(record.review.amount, '1'));
    await expect(s.service.load(record.id)).rejects.toThrow();
  });
});
