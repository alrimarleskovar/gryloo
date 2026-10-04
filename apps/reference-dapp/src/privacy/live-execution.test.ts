// SPDX-License-Identifier: AGPL-3.0-only
/** Actual circuit/proof/auth bytes with synthetic notes, a test wallet and mocked network only. */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { addressFromBytes, createUtxo, generateUtxoKeypair, getNkFromUtxoPrivateKey, MerkleTree, computeUtxoNullifier, getShieldPoolPDAs, computeSwapRefundCommitment, matchSwapRefundLeaf } from '@cloak.dev/sdk';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import type { SolanaSession } from '../wallet/solana-wallet';
import { buildCloakPrivateState, CLOAK_RUNTIME, restorePrivateNote } from './cloak-adapter';
import { cloakOwnerUsdcAta, prepareCloakLiveProof, type CloakPreparedProof } from './live-proof';
import { compileCloakLiveReview, assertCloakLiveReview } from './live-review';
import { checkpointCloakLiveReview, cloakViewingKeyReceipt, executeCloakLive, recoverCloakLive } from './live-execution';
import { loadCloakJournal } from './live-journal';
import { CLOAK_ROUTING_DISCLOSURE, fieldHex, type CloakProperties } from './provider-contract';
import { PrivateStateVault, type PrivateState, type VaultBackend } from './vault';
import type { CloakLiveObservation } from './live-observer';

const mocks = vi.hoisted(() => ({ released: false, genesis: '', root: 0n, tree: null as unknown,
  merkleAddress: '', observation: vi.fn(), artifacts: '' }));
vi.mock('./cloak-adapter', async original => {
  const actual = await original<typeof import('./cloak-adapter')>();
  return { ...actual, assertCloakFinancialExecutionAvailable: () => { if (!mocks.released) actual.assertCloakFinancialExecutionAvailable(); } };
});
vi.mock('./live-observer', async original => ({ ...await original<object>(), inspectCloakMainnet: mocks.observation }));
vi.mock('@cloak.dev/sdk', async original => {
  const actual = await original<typeof import('@cloak.dev/sdk')>();
  return { ...actual, createCloakRpc: () => ({ getGenesisHash: () => ({ send: async () => mocks.genesis }), getSlot: () => ({ send: async () => 500n }) }),
    verifyUtxos: async (notes: unknown[]) => ({ unspent: notes, spent: [], skipped: [] }), buildMerkleTreeFromRelay: async () => mocks.tree,
    fetchAccountBytes: async (_rpc: unknown, address: string) => {
      const data = new Uint8Array(address === mocks.merkleAddress ? 1096 : 27), view = new DataView(data.buffer);
      if (data.length === 27) { data[0] = 1; view.setBigUint64(2, 5_000_000n, true); view.setBigUint64(10, 3n, true); view.setBigUint64(18, 1000n, true); }
      else data.set(Uint8Array.from(fieldHex(mocks.root).match(/../g)!, h => parseInt(h, 16)), 1064);
      return { data, owner: mocks.genesis ? actual.CLOAK_PROGRAM_ID : 'wrong', executable: false };
    }, loadVerifiedCircuitArtifacts: () => actual.loadVerifiedCircuitArtifacts(mocks.artifacts) };
});
function storage() {
  const records = new Map<string, string>(), backend: VaultBackend = { get: async k => records.get(k) ?? null,
    putNew: async (k, v) => { if (records.has(k)) throw new Error('DUPLICATE'); records.set(k, v); },
    putManyNew: async entries => { if (entries.some(e => records.has(e.key)) || new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('RESERVATION_CONFLICT');
      entries.forEach(e => records.set(e.key, e.value)); } };
  return { records, backend };
}
const unlock = 'only a synthetic local test vault passphrase';
const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'workflow-privacy', revision: 1, resourceEdges: [],
  nodes: [createSolanaSwapNode('node-privacy', { network: 'Solana', from: 'SOL', to: 'USDC', amount: '0.02', slippage: '50', privacy: 'cloak' })] };
describe.runIf(Boolean(process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY))('genuine SDK lifecycle with MOCKED financial transport only', () => {
  let proof: CloakPreparedProof, privateState: PrivateState, walletKey: CryptoKeyPair, owner: string, now: number;
  beforeAll(async () => {
    mocks.artifacts = process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY!; mocks.genesis = CLOAK_RUNTIME.genesisHash;
    walletKey = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    owner = addressFromBytes(new Uint8Array(await crypto.subtle.exportKey('raw', walletKey.publicKey)));
    const key = await generateUtxoKeypair(), input = await createUtxo(30_000_000n, key, CLOAK_RUNTIME.nativeMint); input.index = 0;
    privateState = await buildCloakPrivateState({ identity: { owner, runId: 'cloak-' + 'c'.repeat(32), genesisHash: CLOAK_RUNTIME.genesisHash,
      programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '0'.repeat(64) }, inputUtxos: [input], swapAmount: 20_000_000n,
      viewingKeyNk: getNkFromUtxoPrivateKey(key.privateKey) });
    const tree = await MerkleTree.create(32, [input.commitment!]); mocks.tree = tree; mocks.root = tree.root();
    mocks.merkleAddress = (await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint)).merkleTree;
    now = Date.now(); const properties: CloakProperties = { provider: 'cloak', owner, genesisHash: CLOAK_RUNTIME.genesisHash,
      programId: CLOAK_RUNTIME.programId, inputMint: CLOAK_RUNTIME.nativeMint, outputMint: CLOAK_RUNTIME.usdcMint,
      grossInputLamports: '20000000', recipientAta: await cloakOwnerUsdcAta(owner), minimumOutput: '1000000', maximumProtocolFeeLamports: '5060000',
      privateChange: { commitment: privateState.outputNotes[0]!.commitment, amount: '10000000', mint: CLOAK_RUNTIME.nativeMint },
      inputNullifiers: [fieldHex(await computeUtxoNullifier(input))], refundPublicKey: privateState.refund.publicKey,
      refundBlinding: privateState.refund.blinding, slippageBps: 50, reviewedAt: now, expiresAt: now + 60_000, routing: CLOAK_ROUTING_DISCLOSURE };
    proof = await prepareCloakLiveProof(privateState, properties);
  }, 120_000);
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); mocks.released = true; mocks.observation.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  async function fixture(store = storage()) {
    const vault = new PrivateStateVault(store.backend, unlock), { review, auth } = await compileCloakLiveReview(workflow, proof);
    const state = { ...privateState, runId: 'cloak-' + crypto.randomUUID().replaceAll('-', ''), manifestHash: review.manifestHash }, reference = await vault.save(state);
    await checkpointCloakLiveReview(vault, reference, review, proof, auth, workflow);
    // MOCKED registration receipt only; no owner or provider is contacted by this fixture.
    await vault.saveExecution(reference, 'execution.viewing', await cloakViewingKeyReceipt(state));
    const sign = vi.fn(async ({ message }: { message: Uint8Array }) => [{ signature: new Uint8Array(await crypto.subtle.sign('Ed25519', walletKey.privateKey, Uint8Array.from(message))), signedMessage: message }]);
    const account = { address: owner, chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
    const session: SolanaSession = { account, chain: 'solana:mainnet', wallet: { name: 'TEST ONLY', accounts: [account], chains: account.chains,
      features: { 'solana:signMessage': { signMessage: sign }, 'solana:signTransaction': { signTransaction: vi.fn() }, 'standard:events': { on: () => () => undefined } } } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ request_id: 'MOCKED', status: 'pending' }), { status: 200 })); vi.stubGlobal('fetch', fetch);
    const change = await restorePrivateNote(state.outputNotes[0]!); change.index = 1;
    const observation: CloakLiveObservation = { state: 'SWAPPED', swapState: CLOAK_RUNTIME.nativeMint, sourceSignature: '1'.repeat(64),
      settlementSignature: '2'.repeat(64), outputAmount: '1000000', change, refundNote: null, inspectedAt: new Date(now).toISOString(),
      publicObservation: { ...reference, tx1: 'FINALIZED', tx2: 'FINALIZED', settlement: 'SWAPPED', recipientAta: proof.properties.recipientAta,
        outputMint: CLOAK_RUNTIME.usdcMint, outputAmount: '1000000', inputNullifiersSpent: true,
        privateOutputs: [{ ...proof.properties.privateChange, index: 1, state: 'UNSPENT' }] } };
    mocks.observation.mockResolvedValue(observation);
    const execute = () => executeCloakLive(vault, reference, review, proof, auth, workflow, review.reviewDigest, session);
    return { ...store, vault, reference, review, auth, session, sign, fetch, observation, execute };
  }
  it('completes exact authorization, one mocked POST, encrypted evidence and strict reconciliation', async () => {
    const f = await fixture(); expect((await f.execute()).state).toBe('RECONCILED'); expect(f.sign).toHaveBeenCalledTimes(1); expect(f.fetch).toHaveBeenCalledTimes(1);
    expect((await loadCloakJournal(f.vault, f.reference))!.entries.at(-1)!.toState).toBe('COMPLETED');
    expect([...f.records.values()].join()).not.toContain(privateState.viewingKeyNk);
    await expect(f.execute()).rejects.toThrow('CLOAK_LIVE_REPLAY_OR_REVIEW_CHANGED');
    expect((await recoverCloakLive(new PrivateStateVault(f.backend, unlock), f.reference)).state).toBe('RECONCILED');
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.sign).toHaveBeenCalledTimes(1);
  });
  it('preserves the production release gate before any owner signature or network request', async () => {
    const f = await fixture(); mocks.released = false;
    await expect(f.execute()).rejects.toThrow('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE');
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('rejects an altered review, owner acknowledgment, workflow amount and invented route', async () => {
    const f = await fixture(), badWorkflow = structuredClone(workflow); badWorkflow.revision++;
    for (const [r, w, ack] of [[{ ...f.review }, workflow, f.review.reviewDigest], [f.review, badWorkflow, f.review.reviewDigest], [f.review, workflow, 'changed']] as const)
      await expect(assertCloakLiveReview(r, proof, f.auth, w, ack)).rejects.toThrow('CLOAK_LIVE_REVIEW_CHANGED');
    await expect(assertCloakLiveReview(f.review, { ...proof, body: { ...proof.body, route_hash: 'spoofed' } }, f.auth, workflow, f.review.reviewDigest)).rejects.toThrow();
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('restarts before submission without signing or blindly submitting', async () => {
    const f = await fixture(); mocks.observation.mockResolvedValue({ ...f.observation, state: 'UNKNOWN' });
    expect((await recoverCloakLive(f.vault, f.reference)).state).toBe('REVIEW_REQUIRED');
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('recovers an ambiguous POST by finalized inspection only', async () => {
    const f = await fixture(); f.fetch.mockRejectedValue(new Error('connection lost')); mocks.observation.mockResolvedValue({ ...f.observation, state: 'SOURCE_FINALIZED' });
    expect((await f.execute()).state).toBe('RECOVERY_REQUIRED');
    expect(await f.vault.loadExecution(f.reference, 'execution.handoff')).toMatchObject({ uncertainty: 'SUBMISSION_OUTCOME_UNKNOWN' });
    mocks.observation.mockResolvedValue(f.observation);
    expect((await recoverCloakLive(new PrivateStateVault(f.backend, unlock), f.reference)).state).toBe('RECONCILED'); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['recipient', 'amount', 'privateChange', 'missingChange'])('fails closed on %s reconciliation mismatch', async mode => {
    const f = await fixture(), changed = structuredClone(f.observation);
    if (mode === 'recipient') changed.publicObservation!.recipientAta = CLOAK_RUNTIME.nativeMint;
    if (mode === 'amount') changed.publicObservation!.outputAmount = '999999';
    if (mode === 'privateChange') changed.publicObservation!.privateOutputs[0]!.amount = '1';
    if (mode === 'missingChange') changed.change = null;
    mocks.observation.mockResolvedValue(changed); expect((await f.execute()).state).toBe('RECOVERY_REQUIRED');
    expect(await f.vault.loadExecution(f.reference, 'execution.reconciled')).toBeNull();
  });
  it('restores complete encrypted backup with reservations and inspection-only execution', async () => {
    const f = await fixture(); await f.execute(); const target = storage(), restored = new PrivateStateVault(target.backend, unlock);
    const backup = await f.vault.executionBackup(f.reference), reference = await restored.restoreExecutionBackup(backup);
    expect((await recoverCloakLive(restored, reference)).state).toBe('RECONCILED');
    await expect(executeCloakLive(restored, reference, f.review, proof, f.auth, workflow, f.review.reviewDigest, f.session)).rejects.toThrow('CLOAK_LIVE_REPLAY_OR_REVIEW_CHANGED');
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const wrong = new PrivateStateVault(storage().backend, unlock + 'wrong'); await expect(wrong.restoreExecutionBackup(backup)).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
  });
  it('requires intact encrypted preparation and signed authorization after restart', async () => {
    const f = await fixture(); await f.execute(); const signed = [...f.records.keys()].find(k => k.endsWith('execution.signed'))!; f.records.delete(signed);
    expect((await recoverCloakLive(f.vault, f.reference)).reason).toBe('CLOAK_LIVE_AUTHORIZATION_CHECKPOINT_MISSING');
    const preparation = [...f.records.keys()].find(k => k.endsWith('execution.prepared'))!; f.records.set(preparation, 'corrupt');
    await expect(recoverCloakLive(f.vault, f.reference)).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a second run spending an already reserved input before signing', async () => {
    const store = storage(), first = await fixture(store), second = await fixture(store);
    await first.execute(); await expect(second.execute()).rejects.toThrow('RESERVATION_CONFLICT');
    expect(second.sign).not.toHaveBeenCalled();
  });
  it('rejects a workflow edit while the owner wallet is signing before a POST', async () => {
    const f = await fixture(); let current = workflow;
    const original = f.sign.getMockImplementation()!;
    f.sign.mockImplementation(async input => { const result = await original(input); current = { ...workflow, revision: 2 }; return result; });
    await expect(executeCloakLive(f.vault, f.reference, f.review, proof, f.auth, workflow, f.review.reviewDigest, f.session, () => current)).rejects.toThrow('CLOAK_LIVE_REVIEW_CHANGED');
    expect(f.fetch).not.toHaveBeenCalled(); expect(await f.vault.loadExecution(f.reference, 'execution.intent')).not.toBeNull();
  });
  it('recovers an actual SDK-derived private refund without claiming swap completion or withdrawing it', async () => {
    const f = await fixture(), p = proof.properties, amount = 14_940_000n;
    const commitment = await computeSwapRefundCommitment(amount, BigInt('0x' + p.refundPublicKey), BigInt('0x' + p.refundBlinding));
    const matched = await matchSwapRefundLeaf({ viewingKeyNk: Uint8Array.from(privateState.viewingKeyNk.match(/../g)!, h => parseInt(h, 16)),
      inputNullifier: BigInt('0x' + p.inputNullifiers[0]!), amountAfterFee: amount, commitment });
    expect(matched).not.toBeNull();
    mocks.observation.mockResolvedValue({ ...f.observation, state: 'REFUNDED', outputAmount: null, publicObservation: null,
      refundNote: { ...matched!, mintAddress: CLOAK_RUNTIME.nativeMint, index: 2 } });
    expect((await f.execute()).state).toBe('REFUND_RECOVERED');
    expect((await loadCloakJournal(f.vault, f.reference))!.entries.at(-1)!.toState).toBe('PARTIALLY_COMPLETED');
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const result = await f.vault.load((await f.vault.existingResult(f.reference))!); expect(result.outputNotes).toHaveLength(2);
  });
  it('restores an older pre-intent backup into quarantine and rejects tampered or truncated storage', async () => {
    const f = await fixture(), target = storage(), restored = new PrivateStateVault(target.backend, unlock), backup = await f.vault.executionBackup(f.reference);
    await restored.restoreExecutionBackup(backup); mocks.observation.mockResolvedValue({ ...f.observation, state: 'UNKNOWN' });
    expect((await recoverCloakLive(restored, f.reference)).state).toBe('RECOVERY_REQUIRED');
    await expect(executeCloakLive(restored, f.reference, f.review, proof, f.auth, workflow, f.review.reviewDigest, f.session)).rejects.toThrow('CLOAK_LIVE_REPLAY_OR_REVIEW_CHANGED');
    const corrupted = JSON.parse(backup); corrupted.records['execution.prepared'] = 'corrupt';
    const other = storage(); await expect(new PrivateStateVault(other.backend, unlock).restoreExecutionBackup(JSON.stringify(corrupted))).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
    expect(other.records.size).toBe(0);
    target.records.delete([...target.records.keys()].find(k => k.endsWith('execution.journal.1'))!);
    await expect(loadCloakJournal(restored, f.reference)).rejects.toThrow('CLOAK_JOURNAL_CHECKPOINT_DIVERGENT');
    expect(f.sign).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  });
});
