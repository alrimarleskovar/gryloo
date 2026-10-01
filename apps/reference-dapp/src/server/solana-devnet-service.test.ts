// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockedSolanaDevnetOrca, createMockedSolanaJupiter, createMockedSolanaWallet, type MockedOrcaOptions } from '@defi-workflow-engine/reference-compiler';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import { createJupiterService, createSolanaDevnetService } from './jupiter-service';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

const workflow = (amount = '0.1', from: 'SOL' | 'devUSDC' = 'SOL'): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'devnet-demo', revision: 1, resourceEdges: [],
  nodes: [createSolanaSwapNode('node-002', { network: 'Solana Devnet', from, to: from === 'SOL' ? 'devUSDC' : 'SOL', amount, slippage: '50' })] });
async function setup(options: MockedOrcaOptions = {}, service: { provenance?: 'PUBLIC_DEVNET' | 'MOCKED'; executionEnabled?: boolean; dir?: string } = {}) {
  const env = createMockedSolanaDevnetOrca(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
  const dir = service.dir ?? await mkdtemp(join(tmpdir(), 'gryloo-devnet-'));
  let clock = Date.parse('2026-10-01T12:00:00.000Z');
  const make = () => createSolanaDevnetService({ rpc: env.rpc, journalDir: dir, provenance: service.provenance ?? 'MOCKED', executionEnabled: service.executionEnabled ?? true, now: () => clock });
  return { env, wallet, dir, service: make(), make, tick: (ms: number) => { clock += ms; } };
}
async function reviewed(s: Awaited<ReturnType<typeof setup>>, wf = workflow()) {
  const simulated = await s.service.simulate(wf, s.wallet.owner);
  return s.service.review(simulated.id, simulated.review.commitment, wf);
}
describe('Solana Devnet service lifecycle (MOCKED Devnet loopback, no public submission)', () => {
  it('Build → Simulate → Review → Execute → one owner-signed broadcast → reconciliation → MOCKED evidence', async () => {
    const s = await setup();
    const simulated = await s.service.simulate(workflow(), s.wallet.owner);
    expect(simulated).toMatchObject({ id: expect.stringMatching(/^orca-[a-f0-9]{32}$/), format: 'gryloo.orca-devnet-run.v1', authorization: null, attempt: null, evidenceClass: 'MOCKED',
      review: { cluster: 'devnet', provider: 'Orca Whirlpools' } });
    expect(s.env.state.sent).toEqual([]);
    await expect(s.service.begin(simulated.id, s.wallet.owner, workflow())).rejects.toThrow('DEVNET_SWAP_REVIEW_REQUIRED');
    const record = await s.service.review(simulated.id, simulated.review.commitment, workflow());
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    expect(begin.walletChain).toBe('solana:devnet');
    expect((await s.service.load(record.id)).attempt?.state).toBe('PREPARED');
    expect(s.env.state.sent).toEqual([]);
    const submitted = await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(submitted.attempt).toMatchObject({ state: 'PENDING' });
    expect(s.env.state.sent).toHaveLength(1);
    const observed = await s.service.observe(record.id);
    expect(observed).toMatchObject({ verdict: 'RECONCILED', evidenceClass: 'MOCKED', attempt: { state: 'CONFIRMED', reconciled: true } });
    expect(observed.evidence?.bundle.environment).toBe('MOCKED');
    expect(observed.observations.at(-1)?.explorer).toMatch(/^https:\/\/explorer\.solana\.com\/tx\/.+\?cluster=devnet$/);
    expect(observed.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState)).toEqual(['PREPARED', 'SUBMITTING', 'PENDING', 'CONFIRMED']);
    expect((await readdir(s.dir)).some(name => name.endsWith('.orca-lease'))).toBe(true);
  });
  it('a public Devnet run without owner execution stays PUBLIC_READ_ONLY; execution can be disabled by the server', async () => {
    const s = await setup({}, { provenance: 'PUBLIC_DEVNET', executionEnabled: false });
    const record = await reviewed(s);
    expect(record.evidenceClass).toBe('PUBLIC_READ_ONLY');
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('DEVNET_SWAP_EXECUTION_NOT_ENABLED');
    expect((await s.service.load(record.id)).attempt).toBeNull();
  });
  it('refuses a mainnet provenance, a mainnet RPC and mismatched run identifiers', async () => {
    const env = createMockedSolanaDevnetOrca();
    expect(() => createSolanaDevnetService({ rpc: env.rpc, journalDir: '/tmp/gryloo-devnet-x', provenance: 'PUBLIC_MAINNET' as 'PUBLIC_DEVNET', executionEnabled: true }))
      .toThrow('DEVNET_SWAP_PROVENANCE_INVALID');
    const s = await setup({ cluster: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' });
    await expect(s.service.simulate(workflow(), s.wallet.owner)).rejects.toThrow('SOLANA_WRONG_CLUSTER');
    await expect(s.service.load('jupiter-' + 'a'.repeat(32))).rejects.toThrow('DEVNET_SWAP_ID_INVALID');
    // The mainnet service cannot load or simulate a Devnet swap.
    const jupiterEnv = createMockedSolanaJupiter();
    const mainnet = createJupiterService({ rpc: jupiterEnv.rpc, http: jupiterEnv.http, journalDir: s.dir, provenance: 'MOCKED', executionEnabled: true });
    await expect(mainnet.simulate(workflow(), s.wallet.owner)).rejects.toThrow('SOLANA_CLUSTER_UNSUPPORTED');
  });
  it('invalidates for stale Review, a wrong owner and semantic changes before any attempt', async () => {
    const s = await setup();
    const record = await reviewed(s);
    await expect(s.service.begin(record.id, createMockedSolanaWallet().owner, workflow())).rejects.toThrow('DEVNET_SWAP_WRONG_OWNER');
    await expect(s.service.begin(record.id, s.wallet.owner, workflow('0.2'))).rejects.toThrow('DEVNET_SWAP_SEMANTIC_REVISION_CHANGED');
    s.tick(61_000);
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('DEVNET_SWAP_QUOTE_STALE');
    expect((await s.service.load(record.id)).attempt).toBeNull();
    expect((await s.service.invalidate(record.id)).authorization).toBeNull();
  });
  it('records wallet rejection as a pre-submission failure and releases the owner lease', async () => {
    const s = await setup();
    const record = await reviewed(s);
    await s.service.begin(record.id, s.wallet.owner, workflow());
    await expect(s.service.walletFailure(record.id, { stage: 'SIGN', code: 'JUPITER_WALLET_REJECTED', error: {} })).rejects.toThrow('DEVNET_SWAP_DIAGNOSTIC_INVALID');
    const rejected = await s.service.walletFailure(record.id, { stage: 'SIGN', code: 'DEVNET_SWAP_WALLET_REJECTED', error: { code: 4001 } });
    expect(rejected).toMatchObject({ notSubmitted: true, authorization: null, attempt: { state: 'CANCELLED', signature: null } });
    expect(s.env.state.sent).toEqual([]);
    await expect(s.service.begin((await reviewed(s)).id, s.wallet.owner, workflow())).resolves.toBeTruthy();
  });
  it('never broadcasts a changed transaction (pre-submission failure) and prevents duplicate attempts', async () => {
    const s = await setup();
    const first = await reviewed(s), second = await reviewed(s);
    await s.service.begin(first.id, s.wallet.owner, workflow());
    await expect(s.service.begin(first.id, s.wallet.owner, workflow())).rejects.toThrow('DEVNET_SWAP_EXISTING_ATTEMPT_OBSERVE_ONLY');
    await expect(s.service.begin(second.id, s.wallet.owner, workflow())).rejects.toThrow('DEVNET_SWAP_OWNER_ATTEMPT_IN_PROGRESS');
    const changed = second.review.unsignedTransaction === first.review.unsignedTransaction ? null : second.review.unsignedTransaction;
    const other = changed ?? (await reviewed(await setup(), workflow('0.2'))).review.unsignedTransaction;
    expect(await s.service.submit(first.id, s.wallet.sign(other))).toMatchObject({ error: 'DEVNET_SWAP_TRANSACTION_CHANGED', notSubmitted: true, attempt: { state: 'CANCELLED' } });
    expect(s.env.state.sent).toEqual([]);
  });
  it('resolves an uncertain submission by observing the persisted signature, never resubmitting', async () => {
    const s = await setup({ send: 'RPC_ERROR_AFTER_LANDING' });
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    const uncertain = await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(uncertain).toMatchObject({ error: 'DEVNET_SWAP_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', attempt: { state: 'SUBMISSION_RESULT_UNKNOWN' } });
    expect(uncertain.attempt?.signature).toBeTruthy();
    expect((await s.make().observe(record.id)).verdict).toBe('RECONCILED');
    expect(s.env.state.sent).toHaveLength(1);
  });
  it('proves a dropped Devnet transaction expired before allowing a new attempt, and cancels an unsigned attempt on restart', async () => {
    const s = await setup({ send: 'RPC_ERROR_DROPPED' });
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(await s.service.observe(record.id)).toMatchObject({ error: 'DEVNET_SWAP_TRANSACTION_NOT_OBSERVED', verdict: 'PENDING' });
    await expect(s.service.begin((await reviewed(s)).id, s.wallet.owner, workflow())).rejects.toThrow('DEVNET_SWAP_OWNER_ATTEMPT_IN_PROGRESS');
    s.env.advance(200);
    expect(await s.service.observe(record.id)).toMatchObject({ verdict: 'NOT_EXECUTED', attempt: { state: 'NOT_FOUND' }, error: 'DEVNET_SWAP_TRANSACTION_EXPIRED_NOT_EXECUTED' });
    const unsigned = await reviewed(s);
    await s.service.begin(unsigned.id, s.wallet.owner, workflow());
    expect(await s.make().observe(unsigned.id)).toMatchObject({ notSubmitted: true, error: 'DEVNET_SWAP_WALLET_NOT_SUBMITTED', attempt: { state: 'CANCELLED' } });
  });
  it('records a failed Devnet transaction as REVERTED / DIVERGENT without evidence, and rejects a tampered journal', async () => {
    const options: MockedOrcaOptions = {};
    const s = await setup(options);
    const record = await reviewed(s);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    options.failSwap = true;
    await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(await s.service.observe(record.id)).toMatchObject({ verdict: 'DIVERGENT', error: 'DEVNET_SWAP_SWAP_FAILED', attempt: { state: 'REVERTED' }, evidence: null });
    options.failSwap = false;
    const other = await reviewed(s), file = join(s.dir, other.id + '.jsonl');
    await writeFile(file, (await readFile(file, 'utf8')).replace(other.review.amount, '1'));
    await expect(s.service.load(other.id)).rejects.toThrow();
  });
});
