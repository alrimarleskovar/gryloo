// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createUtxo, generateUtxoKeypair, getNkFromUtxoPrivateKey, NATIVE_SOL_MINT } from '@cloak.dev/sdk';
import { compileCloakLocalReview, verifyCloakLocalReview, type CloakLocalRoute } from '@defi-workflow-engine/reference-compiler';
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import type { SolanaSession } from '../wallet/solana-wallet';
import { buildCloakPrivateState, CLOAK_RUNTIME, assertCloakFinancialExecutionAvailable } from './cloak-adapter';
import { PrivateStateVault, type VaultBackend } from './vault';
import { authorizeCloakLocal, cloakLocalReviewDigest, CloakLocalLedger, executeCloakLocal, prepareCloakLocalExecution, recoverCloakLocal } from './local-execution';

const now = Date.parse('2026-10-04T12:00:00Z'), unlock = 'local test vault unlock secret';
function storage() {
  const records = new Map<string, string>();
  const backend: VaultBackend = {
    get: async key => records.get(key) ?? null,
    putNew: async (key, value) => { if (records.has(key)) throw new Error('DUPLICATE'); records.set(key, value); },
    putManyNew: async entries => {
      if (entries.some(e => records.has(e.key)) || new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('RESERVATION_CONFLICT');
      for (const e of entries) records.set(e.key, e.value);
    },
  };
  return { records, backend };
}
async function fixture() {
  const store = storage(), vault = new PrivateStateVault(store.backend, unlock);
  let change: (event: { accounts?: { address: string }[] }) => void = () => undefined;
  const owner = '11111111111111111111111111111111';
  const account = { address: owner, chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
  const session: SolanaSession = { chain: 'solana:mainnet', account, wallet: { name: 'local fixture wallet', accounts: [account], chains: account.chains,
    features: { 'solana:signMessage': { signMessage: vi.fn(() => { throw new Error('NO_SIGNING'); }) },
      'solana:signTransaction': { signTransaction: vi.fn(() => { throw new Error('NO_SIGNING'); }) },
      'standard:events': { on: (_: string, cb: typeof change) => { change = cb; return () => undefined; } } } } };
  const identity = { runId: 'cloak-' + 'a'.repeat(32), owner, genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '0'.repeat(64) };
  const keypair = await generateUtxoKeypair(), input = await createUtxo(30_000_000n, keypair, NATIVE_SOL_MINT); input.index = 0;
  const state = await buildCloakPrivateState({ identity, inputUtxos: [input], swapAmount: 20_000_000n, viewingKeyNk: getNkFromUtxoPrivateKey(keypair.privateKey) });
  const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'workflow-privacy', revision: 1, resourceEdges: [],
    nodes: [createSolanaSwapNode('node-privacy', { network: 'Solana', from: 'SOL', to: 'USDC', amount: '0.02', slippage: '50', privacy: 'cloak' })] };
  const route: CloakLocalRoute = { environment: 'LOCAL', provider: 'cloak', routeId: 'local-route-1', owner, recipientAta: owner,
    genesisHash: identity.genesisHash, programId: identity.programId, inputMint: CLOAK_RUNTIME.nativeMint, outputMint: CLOAK_RUNTIME.usdcMint,
    amountIn: '20000000', inputTotal: '30000000', changeCommitment: state.outputNotes[0]!.commitment,
    inputCommitments: state.inputNotes.map(n => n.commitment), priceNumerator: '150', priceDenominator: '1000',
    feeLamports: '100000', maximumFeeLamports: '200000', observedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60000).toISOString(), nonce: '1' };
  const review = compileCloakLocalReview(workflow, route, now);
  identity.manifestHash = hashArtifactBytes('strategy-manifest', new TextEncoder().encode(JSON.stringify(review.manifest)));
  state.manifestHash = identity.manifestHash;
  const notes = await vault.save(state);
  await prepareCloakLocalExecution(vault, notes, review, now);
  const digest = await cloakLocalReviewDigest(review), authorization = await authorizeCloakLocal(review, session, digest, now);
  const ledger = new CloakLocalLedger();
  const execute = () => executeCloakLocal(vault, identity, review, authorization, session, ledger, now);
  const reload = () => new PrivateStateVault(store.backend, unlock);
  return { ...store, vault, state, identity, notes, workflow, route, review, session, digest, authorization, ledger, execute, reload,
    change: () => change({ accounts: [{ address: 'other' }] }) };
}

describe('Cloak LOCAL simulation → reviewed authorization → encrypted execution → recovery', () => {
  it('deterministically simulates gross spend, included fee, USDC output and exact private change through v1 artifacts', async () => {
    const f = await fixture();
    expect(compileCloakLocalReview(f.workflow, f.route, now)).toEqual(f.review);
    expect(f.review).toMatchObject({ environment: 'LOCAL', evidence: 'MOCKED', expectedOutput: '2985000', minimumOutput: '2970075', privateChange: '10000000' });
    expect(f.review.manifest).toMatchObject({ providers: { kind: 'FIXED', providerId: 'cloak' }, executor: null, authorizationMode: 'MODE_A' });
    expect(() => assertCloakFinancialExecutionAvailable()).toThrow('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE');
  });
  it('executes only the acknowledged review, reloads actual note state and persists redacted mocked reconciliation evidence without signing', async () => {
    const f = await fixture(); expect(await f.execute()).toMatchObject({ state: 'RECONCILED', evidence: 'MOCKED' });
    expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'RECONCILED' });
    expect(f.ledger.submissions).toBe(1);
    expect(JSON.stringify([...f.records.values()])).not.toContain(f.state.viewingKeyNk);
    expect(JSON.stringify([...f.records.values()])).not.toContain(f.state.inputNotes[0]!.bytes);
    expect((f.session.wallet.features['solana:signTransaction'] as { signTransaction: unknown }).signTransaction).not.toHaveBeenCalled();
    expect((f.session.wallet.features['solana:signMessage'] as { signMessage: unknown }).signMessage).not.toHaveBeenCalled();
  });
  it('rejects a missing/forged authorization and an acknowledgment for another review', async () => {
    const f = await fixture();
    await expect(authorizeCloakLocal(f.review, f.session, 'wrong-digest', now)).rejects.toThrow('AUTHORIZATION_MISMATCH');
    await expect(executeCloakLocal(f.vault, f.identity, f.review, { ...f.authorization }, f.session, f.ledger, now)).rejects.toThrow('AUTHORIZATION_MISMATCH');
    expect(f.ledger.submissions).toBe(0);
  });
  it.each(['amountIn', 'recipientAta', 'priceNumerator', 'feeLamports', 'changeCommitment', 'routeId', 'nonce'] as const)('refuses altered %s after review', async field => {
    const f = await fixture(), review = structuredClone(f.review);
    review.route[field] = field === 'recipientAta' ? CLOAK_RUNTIME.programId : field === 'changeCommitment' ? 'b'.repeat(64) : field === 'routeId' ? 'route-changed' : '2';
    await expect(executeCloakLocal(f.vault, f.identity, review, f.authorization, f.session, f.ledger, now)).rejects.toThrow();
    expect(f.ledger.submissions).toBe(0);
  });
  it('rejects a coherent recompiled route with the previous authorization', async () => {
    const f = await fixture(), review = compileCloakLocalReview(f.workflow, { ...f.route, recipientAta: CLOAK_RUNTIME.programId }, now);
    const identity = { ...f.identity, manifestHash: hashArtifactBytes('strategy-manifest', new TextEncoder().encode(JSON.stringify(review.manifest))) };
    await expect(executeCloakLocal(f.vault, identity, review, f.authorization, f.session, f.ledger, now)).rejects.toThrow('AUTHORIZATION_MISMATCH');
  });
  it('rejects public fallback, removed privacy, modified Manifest or stale review', async () => {
    const f = await fixture();
    expect(() => compileCloakLocalReview(f.workflow, { ...f.route, provider: 'jupiter' } as unknown as CloakLocalRoute, now)).toThrow('FALLBACK_DENIED');
    const workflow = structuredClone(f.workflow); workflow.nodes[0]!.requiredCapabilities.pop();
    expect(() => compileCloakLocalReview(workflow, f.route, now)).toThrow('PRIVACY_REQUIREMENT_INVALID');
    const review = structuredClone(f.review); review.manifest.recovery.maximumAttemptsPerStep = 2;
    expect(() => verifyCloakLocalReview(review, now)).toThrow('REVIEW_INVALIDATED');
    await expect(executeCloakLocal(f.vault, f.identity, f.review, f.authorization, f.session, f.ledger, now + 60000)).rejects.toThrow();
  });
  it('reloads before submission as review-required, without submitting or using a stale persisted approval', async () => {
    const f = await fixture(); expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'READY_FOR_REVIEW' });
    expect(f.ledger.submissions).toBe(0); expect(await f.execute()).toMatchObject({ state: 'RECONCILED' });
  });
  it('keeps an intent with no observed submission uncertain and never retries', async () => {
    const f = await fixture(); vi.spyOn(f.ledger, 'submit').mockRejectedValueOnce(new Error('UNCERTAIN_SUBMIT'));
    await expect(f.execute()).rejects.toThrow('UNCERTAIN_SUBMIT');
    expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'RECOVERY_REQUIRED', reason: 'CLOAK_LOCAL_SUBMISSION_UNCERTAIN' });
    await expect(f.execute()).rejects.toThrow('REPLAY'); expect(f.ledger.submissions).toBe(0);
  });
  it('recovers a submitted attempt after its response was lost, even after review expiry', async () => {
    const f = await fixture(), submit = f.ledger.submit.bind(f.ledger);
    vi.spyOn(f.ledger, 'submit').mockImplementationOnce(async (...args) => { await submit(...args); throw new Error('RESPONSE_LOST'); });
    await expect(f.execute()).rejects.toThrow('RESPONSE_LOST');
    expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'RECONCILED' });
    await expect(executeCloakLocal(f.vault, f.identity, f.review, f.authorization, f.session, f.ledger, now + 60000)).rejects.toThrow();
    expect(f.ledger.submissions).toBe(1);
  });
  it('recovers a result saved just before submission evidence persistence failed', async () => {
    const f = await fixture(), put = f.backend.putNew;
    vi.spyOn(f.backend, 'putNew').mockImplementationOnce(put).mockImplementationOnce(put).mockImplementationOnce(async () => { throw new Error('QUOTA'); });
    await expect(f.execute()).rejects.toThrow('QUOTA');
    expect(await f.vault.existingResult(f.identity)).not.toBeNull();
    expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'RECONCILED' });
    expect(f.ledger.submissions).toBe(1);
  });
  it('rejects concurrent execution and duplicate replay across reloads', async () => {
    const f = await fixture(), runs = await Promise.allSettled([f.execute(), f.execute()]);
    expect(runs.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(f.ledger.submissions).toBe(1);
    await expect(executeCloakLocal(f.reload(), f.identity, f.review, f.authorization, f.session, f.ledger, now)).rejects.toThrow('REPLAY');
  });
  it('reserves input notes across distinct runs, not just per-run checkpoints', async () => {
    const f = await fixture(); await f.execute();
    const identity = { ...f.identity, runId: 'cloak-' + 'b'.repeat(32) }, state = { ...f.state, ...identity };
    const notes = await f.vault.save(state); await prepareCloakLocalExecution(f.vault, notes, f.review, now);
    await expect(executeCloakLocal(f.vault, identity, f.review, f.authorization, f.session, f.ledger, now)).rejects.toThrow('RESERVATION_CONFLICT');
    expect(f.ledger.submissions).toBe(1);
  });
  it('also rejects double spends in the independent local ledger if the reservation catalogue is lost', async () => {
    const f = await fixture(); await f.execute();
    const sink = storage(), vault = new PrivateStateVault(sink.backend, unlock);
    const review = compileCloakLocalReview(f.workflow, { ...f.route, nonce: '2' }, now);
    const identity = { ...f.identity, runId: 'cloak-' + 'b'.repeat(32),
      manifestHash: hashArtifactBytes('strategy-manifest', new TextEncoder().encode(JSON.stringify(review.manifest))) };
    const notes = await vault.save({ ...f.state, ...identity }); await prepareCloakLocalExecution(vault, notes, review, now);
    const authorization = await authorizeCloakLocal(review, f.session, await cloakLocalReviewDigest(review), now);
    await expect(executeCloakLocal(vault, identity, review, authorization, f.session, f.ledger, now)).rejects.toThrow('LEDGER_DOUBLE_SPEND');
    expect(await recoverCloakLocal(vault, identity, f.ledger)).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    expect(f.ledger.submissions).toBe(1);
  });
  it.each(['recipient', 'public-amount', 'change-amount', 'change-missing', 'change-spent', 'tx2-pending', 'inputs-unspent', 'index-mismatch'] as const)('fails closed on %s during recovery', async mismatch => {
    const f = await fixture(), inspect = f.ledger.inspect.bind(f.ledger);
    vi.spyOn(f.ledger, 'inspect').mockImplementation(async runId => {
      const s = await inspect(runId); if (!s) return null;
      if (mismatch === 'recipient') s.chain.recipientAta = CLOAK_RUNTIME.programId;
      if (mismatch === 'public-amount') s.chain.outputAmount = '1';
      if (mismatch === 'change-amount') s.chain.privateOutputs = [{ ...s.chain.privateOutputs[0]!, amount: '1' }];
      if (mismatch === 'change-missing') s.chain.privateOutputs = [];
      if (mismatch === 'change-spent') s.chain.privateOutputs = [{ ...s.chain.privateOutputs[0]!, state: 'SPENT' }];
      if (mismatch === 'index-mismatch') s.chain.privateOutputs = [{ ...s.chain.privateOutputs[0]!, index: 999 }];
      if (mismatch === 'tx2-pending') s.chain.tx2 = 'PENDING';
      if (mismatch === 'inputs-unspent') s.chain.inputNullifiersSpent = false;
      return s;
    });
    expect(await f.execute()).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    expect(await f.vault.loadExecution(f.identity, 'execution.reconciled')).toBeNull();
  });
  it('retains divergent actual SDK notes/refund authority and rejects missing private result data', async () => {
    const f = await fixture(), inspect = f.ledger.inspect.bind(f.ledger);
    vi.spyOn(f.ledger, 'inspect').mockImplementation(async runId => {
      const s = await inspect(runId); if (s) { s.result.refund.privateKey = 'f'.repeat(64); s.result.refund.derivedFromNk = false; } return s;
    });
    expect(await f.execute()).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    const ref = await f.vault.existingResult(f.identity); expect((await f.reload().load(ref!)).refund.privateKey).toBe('f'.repeat(64));
  });
  it.each(['execution.prepared', 'execution.intent', 'execution.handoff', 'execution.submitted', 'execution.reconciled', 'result'] as const)('fails closed on corrupted %s', async checkpoint => {
    const f = await fixture(); if (checkpoint !== 'execution.prepared') await f.execute();
    f.records.set(`${f.identity.owner}:${f.identity.runId}:${checkpoint}`, '{bad-ciphertext}');
    await expect(recoverCloakLocal(f.reload(), f.identity, f.ledger)).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
    expect(f.ledger.submissions).toBe(checkpoint === 'execution.prepared' ? 0 : 1);
  });
  it('refuses missing checkpoints, wrong unlock secret, unavailable storage or absent atomic storage before submission', async () => {
    const f = await fixture();
    await expect(recoverCloakLocal(new PrivateStateVault(f.backend, 'different local test unlock secret'), f.identity, f.ledger)).rejects.toThrow('UNREADABLE');
    delete f.backend.putManyNew; await expect(f.execute()).rejects.toThrow('ATOMIC_RESERVATION_UNAVAILABLE');
    vi.spyOn(f.backend, 'get').mockRejectedValueOnce(new Error('STORAGE_UNAVAILABLE')); await expect(f.execute()).rejects.toThrow('STORAGE_UNAVAILABLE');
    f.records.delete(`${f.identity.owner}:${f.identity.runId}:execution.prepared`); await expect(f.execute()).rejects.toThrow('CHECKPOINT_MISSING');
    expect(f.ledger.submissions).toBe(0);
  });
  it('latches wallet changes during the intent write and preserves an uncertain recovery record without submitting', async () => {
    const f = await fixture(), put = f.backend.putManyNew!;
    vi.spyOn(f.backend, 'putManyNew').mockImplementation(async entries => { await put(entries); f.change(); });
    await expect(f.execute()).rejects.toThrow('OWNER_CHANGED');
    expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    expect(f.ledger.submissions).toBe(0);
  });
  it('never treats a missing intent after submission as a fresh run', async () => {
    const f = await fixture(); await f.execute();
    f.records.delete(`${f.identity.owner}:${f.identity.runId}:execution.intent`);
    await expect(recoverCloakLocal(f.reload(), f.identity, f.ledger)).rejects.toThrow('INTENT_MISSING');
    expect(f.ledger.submissions).toBe(1);
  });
  it('recovers conservatively when submission intent committed but read-back acknowledgment was lost', async () => {
    const f = await fixture(), put = f.backend.putManyNew!, get = f.backend.get;
    vi.spyOn(f.backend, 'putManyNew').mockImplementationOnce(async entries => {
      await put(entries); vi.spyOn(f.backend, 'get').mockImplementationOnce(async () => null).mockImplementation(get);
    });
    await expect(f.execute()).rejects.toThrow('PERSISTENCE_DIVERGENT');
    expect(await recoverCloakLocal(f.reload(), f.identity, f.ledger)).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    expect(f.ledger.submissions).toBe(0);
  });
  it('fails closed on an unavailable ledger during recovery after submission', async () => {
    const f = await fixture(); await f.execute();
    expect(await recoverCloakLocal(f.reload(), f.identity, new CloakLocalLedger())).toMatchObject({ state: 'RECOVERY_REQUIRED' });
    expect(f.ledger.submissions).toBe(1);
  });
  it('preserves preparation and intent if a malformed SDK hand-off has no output notes', async () => {
    const f = await fixture(), inspect = f.ledger.inspect.bind(f.ledger);
    vi.spyOn(f.ledger, 'inspect').mockImplementation(async runId => { const s = await inspect(runId); if (s) s.result.outputUtxos = []; return s; });
    await expect(f.execute()).rejects.toThrow('PRIVACY_STATE_INVALID');
    expect(await f.vault.load(f.notes)).toEqual(f.state);
    expect(await f.vault.loadExecution(f.identity, 'execution.intent')).not.toBeNull();
    expect(await f.vault.loadExecution(f.identity, 'execution.handoff')).toMatchObject({ rawResult: { outputUtxos: [] } });
    expect(await f.vault.loadExecution(f.identity, 'execution.reconciled')).toBeNull();
    expect(f.ledger.submissions).toBe(1);
  });
});
