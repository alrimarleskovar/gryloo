// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 Solana flows on durable cloud state: the UNCHANGED Orca Devnet swap, Orca Devnet liquidity and
 * Jupiter services behind the cloud API and workers, against the in-process MOCKED Solana environments. The owner's
 * wallet (and, for OPEN, the client-side position-mint key) signs in the "browser"; the API relays only those
 * owner-signed bytes on the explicit submit call; workers can only observe.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesystemEvidenceStore, createLogger, createPostgresWorkQueue, createWorker, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createMockedSolanaDevnetOrca, createMockedSolanaJupiter, createMockedSolanaWallet, fromBase64, parseTransaction, serializeSignedTransaction,
  toBase64 } from '@defi-workflow-engine/reference-compiler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { createSolanaSwapNode } from '../src/domain/jupiter-authoring.ts';
import { createSolanaLiquidityNode, type SolanaLiquidityInput } from '../src/domain/solana-liquidity-authoring.ts';
import { createPositionMintSigner } from '../src/wallet/position-mint-signer.ts';
import type { JupiterBegin, JupiterRecord } from '../src/server/jupiter-service.ts';
import type { OrcaLiquidityRecord } from '../src/server/orca-liquidity-service.ts';
import { createBackend, observeOnly, type FlowResult } from './app.ts';
import type { FlowName, Rpc } from './flows.ts';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const env = { GRYLOO_SOLANA_DEVNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_JUPITER_HARNESS: 'MOCKED_LOOPBACK_ONLY' } as const;
function ok<T>(result: FlowResult): T { if (!result.ok) throw new Error(result.code); return result.value as T; }
const swapWorkflow = (network: 'Solana Devnet' | 'Solana', from: string, to: string, amount: string): SemanticWorkflow => ({ schemaVersion: '1.0.0',
  workflowId: network === 'Solana' ? 'jupiter-cloud' : 'devnet-cloud', revision: 1, resourceEdges: [],
  nodes: [createSolanaSwapNode('node-002', { network, from, to, amount, slippage: '50' } as Parameters<typeof createSolanaSwapNode>[1])] });
const liquidityInput: SolanaLiquidityInput = { network: 'Solana Devnet', maxSol: '0.01', maxDevUsdc: '0.3', rangeUnit: 'TICK', lower: '-39104', upper: '-36992', slippage: '100' };
const liquidityWorkflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'orca-liquidity', revision: 1, resourceEdges: [],
  nodes: [createSolanaLiquidityNode('node-002', liquidityInput)] };

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const due = (db: Database) => db.query(`UPDATE work_items SET available_at = now() WHERE state = 'READY'`);
async function deployment(rpc: Partial<Record<FlowName, Rpc>>, extra: { http?: Parameters<typeof createBackend>[0]['http']; evidenceDir?: string } = {}) {
  const db = t.open(6), workerId = `worker-${Math.random().toString(16).slice(2, 8)}`;
  const evidenceDir = extra.evidenceDir ?? await mkdtemp(join(tmpdir(), 'flofi-solana-evidence-'));
  const backend = createBackend({ db, env, logger: quiet, tenantId: 'default', holderId: workerId, evidenceStore: createFilesystemEvidenceStore(evidenceDir),
    rpc, ...extra.http ? { http: extra.http } : {}, busyRetries: 3 });
  const worker = createWorker({ queue: createPostgresWorkQueue({ db, ownerId: workerId }), handlers: backend.handlers, logger: quiet, workerId, concurrency: 8 });
  return { db, backend, worker, evidenceDir, call: (flow: FlowName, method: string, ...args: unknown[]) => backend.callFlow(flow, method, args) };
}

describe('BUILD-CLOUD-001 Solana flows on durable cloud state (MOCKED Solana environments)', () => {
  it('worker transports cannot submit anything', async () => {
    const calls: string[] = [];
    const rpc = observeOnly(async method => { calls.push(method); return 'ok'; });
    for (const method of ['sendTransaction', 'eth_sendRawTransaction', 'eth_sendTransaction'])
      await expect(rpc(method, [])).rejects.toThrow('WORKER_SUBMISSION_FORBIDDEN');
    expect(await rpc('getSignatureStatuses', [])).toBe('ok');
    expect(calls).toEqual(['getSignatureStatuses']);
  });

  it('Orca Devnet swap: owner-signed submit with a lost response is reconciled by a worker after browser loss and restarts', async () => {
    const chain = createMockedSolanaDevnetOrca(), wallet = createMockedSolanaWallet();
    chain.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
    // The relay reaches the network but its response is lost: the run must become observation-only, never resent.
    let dropResponse = true;
    const rpc: Rpc = async (method, params) => {
      const result = await chain.rpc(method, params);
      if (method === 'sendTransaction' && dropResponse) { dropResponse = false; throw new Error('SOLANA_RPC_UNAVAILABLE'); }
      return result;
    };
    const api = await deployment({ 'solana-devnet-swap': rpc }), w = swapWorkflow('Solana Devnet', 'SOL', 'devUSDC', '0.1');
    expect(ok<{ executionEnabled: boolean }>(await api.call('solana-devnet-swap', 'info'))).toEqual({ executionEnabled: true });
    let record = ok<JupiterRecord>(await api.call('solana-devnet-swap', 'simulate', w, wallet.owner));
    record = ok<JupiterRecord>(await api.call('solana-devnet-swap', 'review', record.id, record.review.commitment, w));
    const begin = ok<JupiterBegin>(await api.call('solana-devnet-swap', 'begin', record.id, wallet.owner, w));
    expect(chain.state.sent).toHaveLength(0);
    // The browser signs, then a DIFFERENT API instance receives the signed bytes (any instance serves any request).
    const api2 = await deployment({ 'solana-devnet-swap': rpc }, { evidenceDir: api.evidenceDir });
    const submitted = ok<JupiterRecord>(await api2.call('solana-devnet-swap', 'submit', record.id, wallet.sign(begin.unsignedTransaction)));
    expect(submitted.attempt?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    expect(await api2.call('solana-devnet-swap', 'begin', record.id, wallet.owner, w)).toEqual({ ok: false, code: 'DEVNET_SWAP_EXISTING_ATTEMPT_OBSERVE_ONLY' });
    const worker = await deployment({ 'solana-devnet-swap': rpc }, { evidenceDir: api.evidenceDir });
    await due(worker.db); await worker.worker.drainOnce(); await worker.worker.drainOnce();
    const final = ok<JupiterRecord>(await (await deployment({ 'solana-devnet-swap': rpc })).call('solana-devnet-swap', 'status', record.id));
    expect(final).toMatchObject({ verdict: 'RECONCILED', attempt: { state: 'CONFIRMED', reconciled: true } });
    expect(chain.state.sent).toHaveLength(1);
    const run = await t.db.query(`SELECT flow, status, provenance, owner_account, has_evidence FROM execution_runs WHERE run_id = $1`, [record.id]);
    expect(run.rows[0]).toEqual({ flow: 'solana-devnet-swap', status: 'RECONCILED', provenance: 'MOCKED', owner_account: wallet.owner, has_evidence: true });
    const attempt = await t.db.query(`SELECT step, state, transaction_hash FROM execution_attempts WHERE run_id = $1`, [record.id]);
    expect(attempt.rows).toEqual([{ step: 'SWAP', state: 'CONFIRMED', transaction_hash: final.attempt!.signature }]);
    const evidence = await t.db.query(`SELECT environment, outcome FROM evidence_objects WHERE run_id = $1`, [record.id]);
    expect(evidence.rows).toEqual([{ environment: 'MOCKED', outcome: 'RECONCILED' }]);
  });

  it('Orca Devnet liquidity OPEN: owner and client-side position-mint signatures, durable registry, worker reconciliation', async () => {
    const chain = createMockedSolanaDevnetOrca(), wallet = createMockedSolanaWallet();
    chain.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
    const api = await deployment({ 'orca-liquidity': chain.rpc }), key = await createPositionMintSigner();
    let record = ok<OrcaLiquidityRecord>(await api.call('orca-liquidity', 'simulate', liquidityWorkflow, wallet.owner, { operation: 'OPEN', positionMint: key.address }));
    record = ok<OrcaLiquidityRecord>(await api.call('orca-liquidity', 'review', record.id, record.review.commitment, liquidityWorkflow));
    const begin = ok<{ unsignedTransaction: string; signers: string[] }>(await api.call('orca-liquidity', 'begin', record.id, wallet.owner, liquidityWorkflow));
    const walletSigned = wallet.sign(begin.unsignedTransaction), { signatures, message } = parseTransaction(fromBase64(walletSigned, 2048));
    const signed = toBase64(serializeSignedTransaction([signatures[0]!, await key.sign(message)], message));
    ok(await api.call('orca-liquidity', 'submit', record.id, signed));
    const worker = await deployment({ 'orca-liquidity': chain.rpc }, { evidenceDir: api.evidenceDir });
    await due(worker.db); await worker.worker.drainOnce(); await worker.worker.drainOnce();
    const final = ok<OrcaLiquidityRecord>(await worker.call('orca-liquidity', 'status', record.id));
    expect(final).toMatchObject({ verdict: 'RECONCILED', operation: 'OPEN', attempt: { reconciled: true } });
    const positions = ok<{ positionMint: string; status: string }[]>(await (await deployment({ 'orca-liquidity': chain.rpc })).call('orca-liquidity', 'positions', wallet.owner));
    expect(positions).toEqual([expect.objectContaining({ positionMint: key.address, status: 'ACTIVE' })]);
    expect(chain.state.sent).toHaveLength(1);
    const attempt = await t.db.query(`SELECT step, state FROM execution_attempts WHERE run_id = $1`, [record.id]);
    expect(attempt.rows).toEqual([{ step: 'OPEN', state: 'CONFIRMED' }]);
  });

  it('Jupiter mainnet-beta flow is cloud-durable but real-funds execution needs the separate owner opt-in', async () => {
    const chain = createMockedSolanaJupiter(), wallet = createMockedSolanaWallet();
    chain.fund(wallet.owner, 3_000_000_000n, { USDC: 100_000_000n });
    const harness = await deployment({ 'jupiter-swap': chain.rpc }, { http: chain.http }), w = swapWorkflow('Solana', 'USDC', 'SOL', '10');
    let record = ok<JupiterRecord>(await harness.call('jupiter-swap', 'simulate', w, wallet.owner));
    record = ok<JupiterRecord>(await harness.call('jupiter-swap', 'review', record.id, record.review.commitment, w));
    const begin = ok<JupiterBegin>(await harness.call('jupiter-swap', 'begin', record.id, wallet.owner, w));
    ok(await harness.call('jupiter-swap', 'submit', record.id, wallet.sign(begin.unsignedTransaction)));
    await due(harness.db); await harness.worker.drainOnce();
    expect(ok<JupiterRecord>(await harness.call('jupiter-swap', 'status', record.id))).toMatchObject({ verdict: 'RECONCILED' });
    expect(chain.state.sent).toHaveLength(1);
    // A live (non-harness) backend without GRYLOO_JUPITER_OWNER_EXECUTION refuses to prepare any real-funds attempt.
    const live = createBackend({ db: t.db, env: { GRYLOO_JUPITER: 'live' }, logger: quiet, tenantId: 'default', holderId: 'live', evidenceStore: null,
      rpc: { 'jupiter-swap': chain.rpc }, http: chain.http });
    expect(await live.callFlow('jupiter-swap', 'info', [])).toEqual({ ok: true, value: { executionEnabled: false } });
    expect(await live.callFlow('jupiter-swap', 'mode', [])).toEqual({ ok: true, value: 'live' });
  });
});
