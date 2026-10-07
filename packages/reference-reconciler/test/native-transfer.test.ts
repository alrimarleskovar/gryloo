// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createNativeTransferNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { simulateNativeTransfer, assertNativeTransferReview, readTransferState, ROBINHOOD_TESTNET_TRANSFER, type NativeTransferReview } from '@defi-workflow-engine/reference-compiler';
import { createTransferRun, prepareTransferAttempt, transferTransition, discoverTransferByNonce, validateTransferRun } from '../../reference-executor/src/native-transfer.js';
// @ts-expect-error The MOCKED loopback harness is plain JavaScript shared with the browser suite.
import { createRobinhoodTransferChain, TRANSFER_OWNER as owner } from '../../../apps/reference-dapp/e2e/robinhood-transfer-harness.mjs';
import { reconcileNativeTransfer, buildNativeTransferEvidence, type TransferObservation } from '../src/native-transfer.js';
import { verifyArchivedNativeTransfer, recoverTransferSigner, assertTransferVerifierMethod, type ArchivedTransfer } from '../src/robinhood-transfer-verifier.js';

type Rpc = (method: string, params?: readonly unknown[]) => Promise<unknown>;
type Chain = { state: Record<string, unknown> & { block: number; nonce: number }; rpc: Rpc; transactions: Record<string, unknown>[] };
const workflow = (amount = '1000000000000'): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'rh-demo', revision: 1, resourceEdges: [],
  nodes: [createNativeTransferNode('node-002', { chain: 'eip155:46630', amount, recipient: 'CONNECTED_OWNER' })] });
/** One reviewed, owner-signed transfer included on the MOCKED chain. */
async function executed(options: Record<string, unknown> = {}) {
  const chain = createRobinhoodTransferChain(options) as Chain, w = workflow();
  const review = await simulateNativeTransfer(w, owner, chain.rpc);
  const hash = await chain.rpc('MOCK_submit', [review.transaction]) as string;
  const attempt = { nonce: review.nonce, transactionHash: hash, preparedAtBlock: review.state.block };
  return { chain, w, review, hash, attempt };
}
/** Returns a transport that rewrites one method's response; everything else reads the real MOCKED chain. */
function tamper(rpc: Rpc, method: string, change: (value: Record<string, unknown>, params: readonly unknown[]) => unknown): Rpc {
  return async (m, params = []) => { const value = await rpc(m, params); return m === method && value ? change({ ...(value as Record<string, unknown>) }, params) : value; };
}
async function verdict(review: NativeTransferReview, attempt: { nonce: string; transactionHash: string; preparedAtBlock: number }, rpc: Rpc): Promise<TransferObservation> {
  return reconcileNativeTransfer(review, attempt, rpc as never);
}
async function archive(options: Record<string, unknown> = {}) {
  const run = await executed(options);
  let r = createTransferRun('rhx-' + 'a'.repeat(32), run.review, 'MOCKED');
  r = { ...r, authorization: run.review.commitment };
  r = prepareTransferAttempt(r, run.review.state.block, run.review.nonce);
  r = transferTransition(r, 'SUBMITTING');
  r = { ...r, attempt: { ...r.attempt!, transactionHash: run.hash } };
  r = transferTransition(r, 'PENDING');
  const observation = await verdict(run.review, run.attempt, run.chain.rpc);
  r = transferTransition(r, 'CONFIRMED');
  const evidence = buildNativeTransferEvidence({ id: r.id, review: run.review, journal: r.journal, provenance: 'MOCKED', ownerInitiated: true, observation });
  return { ...run, run: r, observation, evidence: evidence as unknown as ArchivedTransfer };
}

describe('RH-DEMO-001 runtime reconciliation', () => {
  it('reconciles the exact self-transfer from chain state', async () => {
    const { chain, review, attempt } = await executed();
    const o = await verdict(review, attempt, chain.rpc);
    expect(o).toMatchObject({ verdict: 'RECONCILED', reason: 'NATIVE_TRANSFER_VERIFIED' });
    expect(o.facts).toMatchObject({ fee: '238680000000', nonceBefore: '7', nonceAfter: '8', transactionType: '0x2' });
    expect(BigInt(o.facts!.balanceBefore) - BigInt(o.facts!.balanceAfter)).toBe(238680000000n);
  });
  const adversarial: [string, string, (v: Record<string, unknown>) => unknown, string][] = [
    ['wrong sender', 'eth_getTransactionByHash', v => ({ ...v, from: '0x' + '3'.repeat(40) }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['wrong destination', 'eth_getTransactionByHash', v => ({ ...v, to: '0x' + '4'.repeat(40) }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['wrong chain in transaction', 'eth_getTransactionByHash', v => ({ ...v, chainId: '0x1237' }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['wrong amount', 'eth_getTransactionByHash', v => ({ ...v, value: '0x1' }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['non-empty calldata', 'eth_getTransactionByHash', v => ({ ...v, input: '0xa9059cbb' }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['wrong nonce', 'eth_getTransactionByHash', v => ({ ...v, nonce: '0x9' }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['unsupported transaction type', 'eth_getTransactionByHash', v => ({ ...v, type: '0x4' }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['gas limit above Review', 'eth_getTransactionByHash', v => ({ ...v, gas: '0xffffff' }), 'TRANSFER_FEE_BOUND_MISMATCH'],
    ['receipt for another sender', 'eth_getTransactionReceipt', v => ({ ...v, from: '0x' + '5'.repeat(40) }), 'TRANSFER_TRANSACTION_MISMATCH'],
    ['receipt with unexplained logs', 'eth_getTransactionReceipt', v => ({ ...v, logs: [{ address: owner, topics: [], data: '0x' }] }), 'TRANSFER_LOGS_MISMATCH'],
    ['effective gas price above offer', 'eth_getTransactionReceipt', v => ({ ...v, effectiveGasPrice: '0xffffffff' }), 'TRANSFER_FEE_BOUND_MISMATCH'],
    ['receipt in a non-canonical block', 'eth_getTransactionReceipt', v => ({ ...v, blockHash: '0x' + 'e'.repeat(64) }), 'TRANSFER_TRANSACTION_MISMATCH'],
  ];
  for (const [name, method, change, reason] of adversarial) it(`DIVERGENT: ${name}`, async () => {
    const { chain, review, attempt } = await executed();
    expect(await verdict(review, attempt, tamper(chain.rpc, method, change))).toMatchObject({ verdict: 'DIVERGENT', reason });
  });
  it('DIVERGENT: wrong chain at the provider', async () => {
    const { chain, review, attempt } = await executed();
    const rpc: Rpc = async (m, p) => m === 'eth_chainId' ? '0x1237' : chain.rpc(m, p);
    expect(await verdict(review, attempt, rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'TRANSFER_WRONG_CHAIN' });
  });
  it('DIVERGENT: balance moved by more than the fee', async () => {
    const { chain, review, attempt } = await executed({ fault: 'extraDebit' });
    expect(await verdict(review, attempt, chain.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'TRANSFER_BALANCE_MISMATCH' });
  });
  it('DIVERGENT: a reverted transfer never reconciles', async () => {
    const { chain, review, attempt } = await executed({ fault: 'revert' });
    expect(await verdict(review, attempt, chain.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'TRANSFER_REVERTED' });
  });
  it('INCONCLUSIVE: malformed receipt fields stay ambiguous, never reconciled', async () => {
    const { chain, review, attempt } = await executed();
    expect(await verdict(review, attempt, tamper(chain.rpc, 'eth_getTransactionReceipt', v => ({ ...v, gasUsed: 'lots' }))))
      .toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'TRANSFER_RPC_INVALID' });
    expect(await verdict(review, attempt, tamper(chain.rpc, 'eth_getTransactionReceipt', () => 'not-an-object')))
      .toMatchObject({ verdict: 'INCONCLUSIVE' });
  });
  it('INCONCLUSIVE: awaiting confirmations and missing receipts', async () => {
    const { chain, review, attempt } = await executed();
    chain.state.block -= 2;
    expect(await verdict(review, attempt, chain.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'AWAITING_CONFIRMATIONS' });
    expect(await verdict(review, { ...attempt, transactionHash: '0x' + '1'.repeat(64) }, chain.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'TRANSACTION_NOT_OBSERVED' });
  });
});

describe('RH-DEMO-001 simulation and Review', () => {
  it('refuses a wrong chain, a code-bearing owner, a queued nonce, a stale head and insufficient test ETH', async () => {
    const run = (options: Record<string, unknown>) => simulateNativeTransfer(workflow(), owner, (createRobinhoodTransferChain(options) as Chain).rpc);
    await expect(run({ chain: '0x1237' })).rejects.toThrow('TRANSFER_WRONG_CHAIN');
    await expect(run({ code: '0xef0100' + '1'.repeat(40) })).rejects.toThrow('TRANSFER_OWNER_NOT_EOA');
    await expect(run({ queued: 1 })).rejects.toThrow('TRANSFER_PENDING_TRANSACTION');
    await expect(run({ staleSeconds: 600 })).rejects.toThrow('TRANSFER_STALE_CHAIN_HEAD');
    await expect(run({ balance: 1000n })).rejects.toThrow('TRANSFER_INSUFFICIENT_TEST_ETH');
    await expect(simulateNativeTransfer(workflow('1000000000000001'), owner, (createRobinhoodTransferChain() as Chain).rpc)).rejects.toThrow('TRANSFER_PROFILE_UNSUPPORTED');
  });
  it('rejects a tampered Review, a semantic edit, a different owner, expiry and stale nonce', async () => {
    const chain = createRobinhoodTransferChain() as Chain, w = workflow();
    const review = await simulateNativeTransfer(w, owner, chain.rpc), state = await readTransferState(chain.rpc, ROBINHOOD_TESTNET_TRANSFER, owner);
    expect(() => assertNativeTransferReview(review, w, owner, state)).not.toThrow();
    expect(() => assertNativeTransferReview({ ...review, value: '1' }, w, owner, state)).toThrow('TRANSFER_AUTHORIZATION_INVALID');
    expect(() => assertNativeTransferReview(review, workflow('2000000000000'), owner, state)).toThrow('TRANSFER_SEMANTIC_REVISION_CHANGED');
    expect(() => assertNativeTransferReview(review, w, '0x' + '6'.repeat(40), state)).toThrow('TRANSFER_AUTHORIZATION_INVALID');
    expect(() => assertNativeTransferReview(review, w, owner, state, Date.parse(review.expiresAt))).toThrow('TRANSFER_REVIEW_EXPIRED');
    expect(() => assertNativeTransferReview(review, w, owner, { ...state, nonce: '8', pendingNonce: '8' })).toThrow('TRANSFER_AUTHORIZATION_STALE');
    expect(() => assertNativeTransferReview(review, w, owner, { ...state, gasPrice: '999999999999' })).toThrow('TRANSFER_AUTHORIZATION_STALE');
  });
});

describe('RH-DEMO-001 durable run and read-only discovery', () => {
  it('one run holds at most one attempt and a corrupted run is refused', async () => {
    const { review } = await executed();
    let run = { ...createTransferRun('rhx-' + 'b'.repeat(32), review, 'MOCKED'), authorization: review.commitment };
    expect(() => prepareTransferAttempt({ ...run, authorization: null }, review.state.block, review.nonce)).toThrow('TRANSFER_REVIEW_REQUIRED');
    expect(() => prepareTransferAttempt(run, review.state.block, '8')).toThrow('TRANSFER_NONCE_CHANGED');
    run = prepareTransferAttempt(run, review.state.block, review.nonce);
    expect(() => prepareTransferAttempt(run, review.state.block, review.nonce)).toThrow('TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY');
    expect(() => validateTransferRun(run)).not.toThrow();
    expect(() => validateTransferRun({ ...run, attempt: { ...run.attempt!, nonce: '9' } })).toThrow('TRANSFER_STORE_CORRUPT');
    expect(() => validateTransferRun({ ...run, attempt: { ...run.attempt!, state: 'SUBMITTING' } })).toThrow('TRANSFER_STORE_CORRUPT');
    expect(() => validateTransferRun({ ...run, review: { ...run.review, value: '2' } })).toThrow('TRANSFER_STORE_CORRUPT');
  });
  it('discovers the transaction that consumed the reviewed nonce by binary search; reports nothing when unconsumed', async () => {
    const chain = createRobinhoodTransferChain() as Chain, review = await simulateNativeTransfer(workflow(), owner, chain.rpc);
    const attempt = { nonce: review.nonce, transaction: review.transaction, preparedAtBlock: review.state.block, transactionHash: null };
    expect(await discoverTransferByNonce(attempt, chain.rpc as never)).toEqual({ hash: null, mismatch: false, consumed: false });
    const hash = await chain.rpc('MOCK_submit', [review.transaction]);
    chain.state.block += 500;
    expect(await discoverTransferByNonce(attempt, chain.rpc as never)).toEqual({ hash, mismatch: false, consumed: true });
  });
  it('discovery reports a mismatch when another transaction consumed the nonce', async () => {
    const chain = createRobinhoodTransferChain({ fault: 'wrongValue' }) as Chain, review = await simulateNativeTransfer(workflow(), owner, chain.rpc);
    await chain.rpc('MOCK_submit', [review.transaction]);
    const found = await discoverTransferByNonce({ nonce: review.nonce, transaction: review.transaction, preparedAtBlock: review.state.block, transactionHash: null }, chain.rpc as never);
    expect(found).toMatchObject({ mismatch: true, consumed: true });
  });
});

describe('RH-DEMO-001 independent read-only verifier', () => {
  it('independently reconciles an archived record and recovers the owner from the raw signature', async () => {
    const { chain, evidence, hash } = await archive();
    const result = await verifyArchivedNativeTransfer(evidence, chain.rpc as never, { expectedEnvironment: 'MOCKED' });
    expect(result).toMatchObject({ status: 'INDEPENDENTLY_RECONCILED', evidence: 'MOCKED', signer: owner, transactionHash: hash, economicSubmissions: 1, finality: 'L2_INCLUDED' });
    expect(result.checks.length).toBeGreaterThan(10);
    const tx = await chain.rpc('eth_getTransactionByHash', [hash]) as Record<string, unknown>;
    expect(recoverTransferSigner(tx, 46630)).toBe(owner);
    expect(() => recoverTransferSigner({ ...tx, value: '0x1' }, 46630)).toThrow('VERIFIER_TRANSACTION_HASH_MISMATCH');
    expect(() => recoverTransferSigner(tx, 4663)).toThrow();
  });
  it('reports L1 finality from the safe and finalized tags', async () => {
    const { chain, evidence } = await archive({ finalizedLag: 0 });
    expect((await verifyArchivedNativeTransfer(evidence, chain.rpc as never, { expectedEnvironment: 'MOCKED' })).finality).toBe('L1_FINALIZED');
  });
  it('refuses MOCKED evidence when TESTNET_EXECUTED is required, and tampered archives', async () => {
    const { chain, evidence } = await archive(), rpc = chain.rpc as never;
    await expect(verifyArchivedNativeTransfer(evidence, rpc)).rejects.toThrow('VERIFIER_EVIDENCE_LEVEL_MISMATCH');
    const claim = (key: string, value: unknown) => ({ ...evidence, publicExecution: { ...evidence.publicExecution, [key]: value } });
    await expect(verifyArchivedNativeTransfer(claim('fee', '1'), rpc, { expectedEnvironment: 'MOCKED' })).rejects.toThrow('VERIFIER_CLAIM_MISMATCH_FEE');
    await expect(verifyArchivedNativeTransfer(claim('balanceAfter', '1'), rpc, { expectedEnvironment: 'MOCKED' })).rejects.toThrow('VERIFIER_CLAIM_MISMATCH_BALANCE_AFTER');
    await expect(verifyArchivedNativeTransfer({ ...evidence, bundleHash: '0x' + '0'.repeat(64) }, rpc, { expectedEnvironment: 'MOCKED' })).rejects.toThrow('VERIFIER_BUNDLE_HASH_MISMATCH');
    const review = { ...evidence.artifacts.review, value: '2' };
    await expect(verifyArchivedNativeTransfer({ ...evidence, artifacts: { ...evidence.artifacts, review } }, rpc, { expectedEnvironment: 'MOCKED' })).rejects.toThrow('VERIFIER_REVIEW_COMMITMENT_MISMATCH');
  });
  it('refuses a journal with a second economic submission', async () => {
    const { chain, evidence } = await archive();
    const journal = evidence.artifacts.journal, entry = journal.entries.find(e => e.toState === 'SUBMITTING')!;
    const doubled = { ...journal, entries: [...journal.entries, { ...entry, entryId: 'entry-99', sequence: journal.entries.length }] };
    await expect(verifyArchivedNativeTransfer({ ...evidence, artifacts: { ...evidence.artifacts, journal: doubled } }, chain.rpc as never, { expectedEnvironment: 'MOCKED' })).rejects.toThrow();
  });
  it('refuses a different signer, wrong chain, missing confirmations and a balance mismatch on chain', async () => {
    const { chain, evidence, hash } = await archive(), rpc = chain.rpc;
    const opts = { expectedEnvironment: 'MOCKED' as const };
    await expect(verifyArchivedNativeTransfer(evidence, (async (m: string, p: readonly unknown[]) => m === 'eth_chainId' ? '0x1237' : rpc(m, p)) as never, opts)).rejects.toThrow('VERIFIER_WRONG_CHAIN');
    await expect(verifyArchivedNativeTransfer(evidence, tamper(rpc, 'eth_getTransactionByHash', v => ({ ...v, s: '0x1234' })) as never, opts)).rejects.toThrow();
    await expect(verifyArchivedNativeTransfer(evidence, tamper(rpc, 'eth_getTransactionReceipt', v => ({ ...v, logs: [{}] })) as never, opts)).rejects.toThrow('VERIFIER_RECEIPT_MISMATCH');
    await expect(verifyArchivedNativeTransfer(evidence, (async (m: string, p: readonly unknown[]) => m === 'eth_getBalance' && p[1] !== 'latest' && BigInt(p[1] as string) > 1000n ? '0x1' : rpc(m, p)) as never, opts)).rejects.toThrow('VERIFIER_BALANCE_MISMATCH');
    chain.state.block -= 3;
    await expect(verifyArchivedNativeTransfer(evidence, rpc as never, opts)).rejects.toThrow('VERIFIER_AWAITING_CONFIRMATIONS');
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('has no signing or submission method in its allowlist', () => {
    for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'eth_call'])
      expect(() => assertTransferVerifierMethod(method)).toThrow('READ_ONLY_METHOD_REQUIRED');
  });
});
