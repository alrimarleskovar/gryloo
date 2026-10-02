// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createNativeTransferNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { verifyArchivedNativeTransfer, type ArchivedTransfer } from '@defi-workflow-engine/reference-reconciler';
import { createRobinhoodTransferChain, TRANSFER_OWNER as owner, type TransferChainOptions } from '../../e2e/robinhood-transfer-harness.mjs';
import { createRobinhoodTransferService, type TransferWalletDiagnostic } from './robinhood-transfer-service';

const workflow = (amount = '1000000000000', revision = 1): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'rh-demo', revision, resourceEdges: [],
  nodes: [createNativeTransferNode('node-002', { chain: 'eip155:46630', amount, recipient: 'CONNECTED_OWNER' })] });
async function setup(options: TransferChainOptions = {}) {
  const chain = createRobinhoodTransferChain(options), journalDir = await mkdtemp(join(tmpdir(), 'gryloo-rh-demo-'));
  const service = createRobinhoodTransferService({ rpc: chain.rpc, journalDir, provenance: 'MOCKED' });
  return { chain, journalDir, service };
}
/** The wallet: only this helper "broadcasts", into the in-process MOCKED chain. */
const walletSend = (chain: Awaited<ReturnType<typeof setup>>['chain'], tx: object) => chain.rpc('MOCK_submit', [tx]) as Promise<string>;
async function reviewed(options: TransferChainOptions = {}) {
  const s = await setup(options), w = workflow();
  const simulated = await s.service.simulate(w, owner);
  const record = await s.service.review(simulated.id, simulated.review.commitment, w);
  return { ...s, w, record };
}

describe('RH-DEMO-001 Robinhood Testnet transfer service (MOCKED loopback chain)', () => {
  it('Simulate binds every Review field without any submission', async () => {
    const { chain, service } = await setup(), w = workflow();
    const record = await service.simulate(w, owner);
    expect(record.review).toMatchObject({ chain: 'eip155:46630', chainId: 46630, account: owner, recipient: owner, value: '1000000000000', nonce: '7',
      gasEstimate: '23868', gasLimit: '35802', gasPrice: '10000000', maxFeePerGas: '20000000', expectedFee: '238680000000', feeBudget: '716040000000',
      balanceBefore: '10000000000000000', expectedBalanceAfter: '9999761320000000', minimumBalanceAfter: '9999283960000000', simulationResult: '0x' });
    expect(record.review.transaction).toEqual({ from: owner, to: owner, value: '0xe8d4a51000', data: '0x', chainId: '0xb626', gas: '0x8bda',
      maxFeePerGas: '0x1312d00', maxPriorityFeePerGas: '0x0' });
    expect(record.attempt).toBeNull();
    expect(chain.transactions).toHaveLength(0);
  });
  it('Build → Simulate → Review → PREPARED → SUBMITTING → one owner submission → RECONCILED evidence', async () => {
    const { chain, service, w, record } = await reviewed();
    const begin = await service.begin(record.id, owner, w);
    expect(begin.record.attempt).toMatchObject({ state: 'PREPARED', nonce: '7', transactionHash: null });
    expect(chain.transactions).toHaveLength(0);
    const handed = await service.handoff(record.id);
    expect(handed.attempt?.state).toBe('SUBMITTING');
    const hash = await walletSend(chain, begin.transaction);
    const pending = await service.report(record.id, { kind: 'HASH', hash });
    expect(pending.attempt?.state).toBe('PENDING');
    const result = await service.observe(record.id);
    expect(result).toMatchObject({ verdict: 'RECONCILED', error: null });
    expect(result.attempt).toMatchObject({ state: 'CONFIRMED', reconciled: true, transactionHash: hash });
    expect(result.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
    expect(result.evidence?.publicExecution).toMatchObject({ fee: '238680000000', balanceBefore: '10000000000000000', balanceAfter: '9999761320000000',
      nonceBefore: '7', nonceAfter: '8', submissions: 1 });
    expect(result.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState)).toEqual(['PREPARED', 'SUBMITTING', 'PENDING', 'CONFIRMED']);
    expect(chain.transactions).toHaveLength(1);
    // The archived record passes the independent verifier against the same (MOCKED) chain.
    const verification = await verifyArchivedNativeTransfer(result.evidence as unknown as ArchivedTransfer, chain.rpc as never, { expectedEnvironment: 'MOCKED' });
    expect(verification).toMatchObject({ status: 'INDEPENDENTLY_RECONCILED', signer: owner, economicSubmissions: 1, fee: '238680000000' });
  });
  it('a lost wallet response is recovered by nonce discovery, never resubmitted', async () => {
    const { chain, service, w, record } = await reviewed();
    const begin = await service.begin(record.id, owner, w); await service.handoff(record.id);
    await walletSend(chain, begin.transaction);
    expect((await service.report(record.id, { kind: 'UNKNOWN' })).attempt?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    chain.state.block += 40;
    const result = await service.observe(record.id);
    expect(result.verdict).toBe('RECONCILED');
    expect(result.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState)).toEqual(['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING', 'CONFIRMED']);
    await expect(service.begin(record.id, owner, w)).rejects.toThrow('TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY');
    expect(chain.transactions).toHaveLength(1);
  });
  it('an unknown result that never reached the chain stays observation-only across restarts', async () => {
    const { chain, journalDir, service, w, record } = await reviewed();
    await service.begin(record.id, owner, w); await service.handoff(record.id);
    await service.report(record.id, { kind: 'UNKNOWN' });
    // A restarted process sees the same durable record and can only observe.
    const restarted = createRobinhoodTransferService({ rpc: chain.rpc, journalDir, provenance: 'MOCKED' });
    const observed = await restarted.observe(record.id);
    expect(observed).toMatchObject({ verdict: 'PENDING', error: 'TRANSFER_TRANSACTION_NOT_OBSERVED' });
    expect(observed.attempt?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    await expect(restarted.recoverReview(record.id)).rejects.toThrow('TRANSFER_RECOVERY_OBSERVE_ONLY');
    await expect(restarted.begin(record.id, owner, w)).rejects.toThrow();
    // A brand-new Review for the same owner and nonce cannot reserve the nonce again.
    const second = await restarted.simulate(w, owner); await restarted.review(second.id, second.review.commitment, w);
    await expect(restarted.begin(second.id, owner, w)).rejects.toThrow('TRANSFER_NONCE_ALREADY_RESERVED');
    expect(chain.transactions).toHaveLength(0);
  });
  it('a restart after PREPARED but before the durable handoff cancels without any wallet request', async () => {
    const { chain, service, w, record } = await reviewed();
    await service.begin(record.id, owner, w);
    const observed = await service.observe(record.id);
    expect(observed).toMatchObject({ notSubmitted: true, authorization: null });
    expect(observed.attempt?.state).toBe('CANCELLED');
    await expect(service.handoff(record.id)).rejects.toThrow('TRANSFER_WALLET_HANDOFF_NOT_AUTHORIZED');
    expect(chain.transactions).toHaveLength(0);
  });
  it('a proven wallet refusal allows only a fresh explicit Review for the same nonce', async () => {
    const { chain, service, w, record } = await reviewed();
    await service.begin(record.id, owner, w); await service.handoff(record.id);
    const diagnostic: TransferWalletDiagnostic = { invoked: true, rejectionCode: 4001, code: 'TRANSFER_REJECTED',
      calls: [{ method: 'eth_sendTransaction', submission: true, error: { code: 4001 } }] };
    const refused = await service.walletFailure(record.id, diagnostic);
    expect(refused).toMatchObject({ notSubmitted: true, authorization: null });
    expect(refused.attempt?.state).toBe('NOT_FOUND');
    const recovered = await service.recoverReview(record.id);
    expect(recovered).toMatchObject({ recoveryOf: record.id, authorization: null, attempt: null });
    expect(recovered.review.nonce).toBe('7');
    await service.review(recovered.id, recovered.review.commitment, w);
    const begin = await service.begin(recovered.id, owner, w); await service.handoff(recovered.id);
    await service.report(recovered.id, { kind: 'HASH', hash: await walletSend(chain, begin.transaction) });
    expect((await service.observe(recovered.id)).verdict).toBe('RECONCILED');
    // The refused run never gains a second attempt.
    await expect(service.recoverReview(record.id)).rejects.toThrow();
    expect(chain.transactions).toHaveLength(1);
  });
  it('a send that may have reached the network cannot be recorded as a refusal', async () => {
    const { service, w, record } = await reviewed();
    await service.begin(record.id, owner, w); await service.handoff(record.id);
    await expect(service.walletFailure(record.id, { invoked: true, code: 'TRANSFER_SUBMISSION_UNKNOWN',
      calls: [{ method: 'eth_sendTransaction', submission: true, error: { message: 'timeout' } }] })).rejects.toThrow('TRANSFER_DIAGNOSTIC_NOT_PRE_SUBMISSION');
  });
  it('duplicate begin and duplicate handoff are refused', async () => {
    const { service, w, record } = await reviewed();
    await service.begin(record.id, owner, w);
    await expect(service.begin(record.id, owner, w)).rejects.toThrow('TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY');
    await service.handoff(record.id);
    await expect(service.handoff(record.id)).rejects.toThrow('TRANSFER_WALLET_HANDOFF_NOT_AUTHORIZED');
  });
  it('a semantic edit invalidates Review and Execute', async () => {
    const { service, w, record } = await reviewed();
    await expect(service.begin(record.id, owner, workflow('2000000000000', 2))).rejects.toThrow('TRANSFER_SEMANTIC_REVISION_CHANGED');
    const invalidated = await service.invalidate(record.id);
    expect(invalidated.authorization).toBeNull();
    await expect(service.begin(record.id, owner, w)).rejects.toThrow('TRANSFER_REVIEW_REQUIRED');
  });
  it('a stale Review (expired) cannot be executed', async () => {
    const chain = createRobinhoodTransferChain(), journalDir = await mkdtemp(join(tmpdir(), 'gryloo-rh-demo-'));
    let clock = Date.now();
    const service = createRobinhoodTransferService({ rpc: chain.rpc, journalDir, provenance: 'MOCKED', now: () => clock });
    const w = workflow(), simulated = await service.simulate(w, owner);
    await service.review(simulated.id, simulated.review.commitment, w);
    clock += 121_000;
    await expect(service.begin(simulated.id, owner, w)).rejects.toThrow('TRANSFER_REVIEW_EXPIRED');
  });
  it('a nonce change after Review blocks Execute (stale state)', async () => {
    const { chain, service, w, record } = await reviewed();
    chain.state.nonce += 1;
    await expect(service.begin(record.id, owner, w)).rejects.toThrow('TRANSFER_AUTHORIZATION_STALE');
  });
  it('wrong wallet account cannot begin', async () => {
    const { service, w, record } = await reviewed();
    await expect(service.begin(record.id, '0x2222222222222222222222222222222222222222', w)).rejects.toThrow();
  });
  it('a different transaction consuming the reviewed nonce is DIVERGENT and never reconciled', async () => {
    const { chain, service, w, record } = await reviewed({ fault: 'wrongRecipient' });
    const begin = await service.begin(record.id, owner, w); await service.handoff(record.id);
    await walletSend(chain, begin.transaction);
    await service.report(record.id, { kind: 'UNKNOWN' });
    const result = await service.observe(record.id);
    expect(result).toMatchObject({ verdict: 'DIVERGENT', error: 'TRANSFER_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION', evidence: null });
  });
  it('a wallet that raises the fee above the Review is DIVERGENT', async () => {
    const { chain, service, w, record } = await reviewed({ fault: 'highFee' });
    const begin = await service.begin(record.id, owner, w); await service.handoff(record.id);
    await service.report(record.id, { kind: 'HASH', hash: await walletSend(chain, begin.transaction) });
    expect(await service.observe(record.id)).toMatchObject({ verdict: 'DIVERGENT', error: 'TRANSFER_FEE_BOUND_MISMATCH', evidence: null });
  });
  it('the journal file is append-only and validated on every read', async () => {
    const { journalDir, service, w, record } = await reviewed();
    await service.begin(record.id, owner, w);
    const files = await readdir(journalDir);
    expect(files.filter(f => f.endsWith('.intent'))).toEqual([`${owner}-7.intent`]);
    const lines = (await readFile(join(journalDir, record.id + '.jsonl'), 'utf8')).trimEnd().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(lines.at(-1)!).attempt.state).toBe('PREPARED');
  });
});
