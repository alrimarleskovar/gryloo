// SPDX-License-Identifier: AGPL-3.0-only
/** Synthetic notes/test wallet and MOCKED transports. Never mainnet evidence. */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { addressFromBytes, computeUtxoCommitment, MerkleTree } from '@cloak.dev/sdk';
import { base58Encode, parseTransaction, serializeSignedTransaction } from '@defi-workflow-engine/reference-compiler';
import { CLOAK_RUNTIME, assertCloakFinancialExecutionAvailable, restorePrivateNote } from './cloak-adapter';
import { PrivateStateVault, type VaultBackend } from './vault';
import { authorizeOwnerDeposit, disabledOwnerProof, type OwnerProofConfiguration } from './owner-proof-gate';
import { depositDependencyEvidence, prepareOwnerDeposit, recoverOwnerDeposit, submitOwnerDeposit, readOnlyDepositRpc } from './owner-proof-deposit';
import { OWNER_PROOF_FORBIDDEN_CLAIMS, OWNER_PROOF_RESIDUAL_FINDINGS, OWNER_PROOF_RESIDUAL_LABEL, OWNER_PROOF_RESIDUALS, type OwnerProofAcceptance } from './owner-proof-residuals';
import { ellipticPrivateKeyTripwire } from './owner-proof-elliptic.test-support';
import type { SolanaSession } from '../wallet/solana-wallet';
const m = vi.hoisted(() => ({ rpc: {} as object, send: vi.fn(), reserve: vi.fn(), signature: '', wire: '', root: 0n, tree: null as unknown,
  fee: 10000n, simError: null as unknown, debit: 10010000n, captured: 0, extraInstruction: false }));
vi.mock('../app/privacy-owner-proof-actions', () => ({ broadcastOwnerDeposit: () => m.send(), reserveOwnerDepositSignature: () => m.reserve(), readOwnerProofRpc: vi.fn() }));
vi.mock('@cloak.dev/sdk', async original => {
  const actual = await original<typeof import('@cloak.dev/sdk')>();
  return { ...actual, createCloakRpc: () => m.rpc, fetchLookupTables: async () => [],
    transact: async (params: Parameters<typeof actual.transact>[0], options: Parameters<typeof actual.transact>[1]) => {
      const bytes = new Uint8Array(521); bytes[0] = 0;
      bytes.set(Uint8Array.from(actual.pubkeyToFieldElement(CLOAK_RUNTIME.nativeMint).toString(16).padStart(64, '0').match(/../g)!, h => parseInt(h, 16)), 329);
      new DataView(bytes.buffer).setBigInt64(289, params.externalAmount!, true);
      const commitment = await actual.computeUtxoCommitment(params.outputUtxos[0]!);
      bytes.set(Uint8Array.from(commitment.toString(16).padStart(64, '0').match(/../g)!, h => parseInt(h, 16)), 425);
      const paddedCommitment = await actual.computeUtxoCommitment(params.outputUtxos[1]!);
      bytes.set(Uint8Array.from(paddedCommitment.toString(16).padStart(64, '0').match(/../g)!, h => parseInt(h, 16)), 457);
      const pdas = await actual.getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint);
      const signer = options.signer!;
      const ix = actual.programInstruction(CLOAK_RUNTIME.programId, [actual.accountMeta(signer.address, { signer: true, writable: true }), actual.accountMeta(pdas.pool, { writable: true })], bytes);
      const message = actual.buildTransactionMessage({ version: 0, feePayer: signer.address,
        lifetime: { blockhash: CLOAK_RUNTIME.nativeMint, lastValidBlockHeight: 999n }, instructions: [
          actual.programInstruction(actual.toAddress('Ed25519SigVerify111111111111111111111111111'), [], new Uint8Array([1])), ix,
          ...m.extraInstruction ? [actual.programInstruction(actual.toAddress('11111111111111111111111111111111'), [], new Uint8Array([1]))] : []] });
      const tx = await actual.partiallySignTransaction(message); m.captured++;
      if ('signTransactions' in signer) await signer.signTransactions([tx as Parameters<typeof signer.signTransactions>[0][number]]);
      throw new Error('CAPTURE_EXPECTED');
    }, buildMerkleTreeFromRelay: async () => m.tree,
    fetchAccountBytes: async () => { const data = new Uint8Array(1096); data.set(Uint8Array.from(m.root.toString(16).padStart(64, '0').match(/../g)!, h => parseInt(h, 16)), 1064);
      return { data, owner: CLOAK_RUNTIME.programId, executable: false }; },
    verifyUtxos: async (notes: unknown[]) => ({ unspent: notes, spent: [], skipped: [] }),
  };
});
function storage() {
  const records = new Map<string, string>();
  const backend: VaultBackend = { get: async k => records.get(k) ?? null, putNew: async (k, v) => {
    if (records.has(k)) throw new Error('DUPLICATE'); records.set(k, v);
  }, putManyNew: async entries => {
    if (entries.some(e => records.has(e.key)) || new Set(entries.map(e => e.key)).size !== entries.length) throw new Error('RESERVATION_CONFLICT');
    for (const { key, value } of entries) records.set(key, value);
  } };
  return { records, backend, vault: new PrivateStateVault(backend, 'synthetic test vault passphrase only') };
}
beforeEach(() => {
  m.fee = 10000n; m.simError = null; m.captured = 0; m.extraInstruction = false; m.signature = ''; m.wire = ''; m.send.mockReset();
  m.reserve.mockReset(); m.reserve.mockResolvedValue(undefined);
  m.rpc = {
    getGenesisHash: () => ({ send: async () => CLOAK_RUNTIME.genesisHash }), getBlockHeight: () => ({ send: async () => 500n }),
    getFeeForMessage: () => ({ send: async () => ({ value: m.fee }) }),
    getAccountInfo: () => ({ send: async () => ({ value: { lamports: 100_000_000n } }) }),
    simulateTransaction: () => ({ send: async () => ({ value: { err: m.simError, accounts: [{ lamports: 100_000_000n - m.debit }] } }) }),
    sendTransaction: () => ({ send: m.send }),
    getTransaction: () => ({ send: async () => m.wire ? { transaction: [m.wire, 'base64'], slot: 123n, blockTime: 1700000000n, meta: { err: null } } : null }),
  };
});
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const key = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const owner = addressFromBytes(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey)));
  const store = storage(), prepared = await prepareOwnerDeposit(store.vault, owner);
  const configuration: OwnerProofConfiguration = { enabled: true, owner, expiresAt: Date.now() + 3_600_000,
    admission: { audit: 'passed', sbom: 'passed', inventory: 'passed', license: 'passed' }, acceptance: null };
  const permit = authorizeOwnerDeposit(configuration, prepared, prepared.reviewDigest, true);
  const sign = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
    const tx = parseTransaction(transaction), sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, Uint8Array.from(tx.message)));
    const signed = serializeSignedTransaction([sig], tx.message); m.signature = base58Encode(sig);
    m.wire = btoa(Array.from(signed, b => String.fromCharCode(b)).join('')); return [{ signedTransaction: signed }];
  });
  const account = { address: owner, chains: ['solana:mainnet'], features: ['solana:signTransaction', 'solana:signMessage'] };
  const session: SolanaSession = { account, chain: 'solana:mainnet', wallet: { name: 'SYNTHETIC TEST WALLET', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { signTransaction: sign }, 'solana:signMessage': { signMessage: vi.fn() }, 'standard:events': { on: () => () => undefined } } } };
  m.send.mockImplementation(async () => m.signature);
  const execute = () => submitOwnerDeposit(store.vault, prepared, permit, session, prepared.reviewDigest);
  return { ...store, prepared, permit, session, sign, execute, configuration };
}
describe('one controlled SDK deposit, release gates preserved', () => {
  it('prepares encrypted recoverable SDK notes with no wallet signature or financial RPC', async () => {
    const f = await fixture(); expect(f.sign).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled(); expect(m.captured).toBe(1);
    expect(f.prepared.manifest.depositLamports).toBe('10000000'); expect(f.prepared.manifest.messageDigest).toBe(f.prepared.messageDigest);
    expect([...f.records.values()].join()).not.toContain('viewingKeyNk');
  });
  it('stays disabled by default and cannot enable ordinary production execution', async () => {
    const f = await fixture(); expect(() => authorizeOwnerDeposit(disabledOwnerProof(f.session.account.address), f.prepared, f.prepared.reviewDigest, true)).toThrow('CLOAK_OWNER_PROOF_DISABLED');
    expect(() => assertCloakFinancialExecutionAvailable()).toThrow('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE'); expect(f.sign).not.toHaveBeenCalled();
  });
  it.each(['audit', 'sbom', 'inventory', 'license'] as const)('cannot waive %s admission', async gate => {
    const f = await fixture(); f.configuration.admission[gate] = 'blocked';
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  });
  it('requires explicit opt-in and exact reviewed digest', async () => {
    const f = await fixture(); expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, false)).toThrow('CLOAK_OWNER_PROOF_DISABLED');
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, 'changed', true)).toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
    await expect(submitOwnerDeposit(f.vault, f.prepared, { ...f.permit }, f.session, f.prepared.reviewDigest)).rejects.toThrow(); expect(f.sign).not.toHaveBeenCalled();
  });
  it.each(['amount', 'recipient', 'program', 'provider', 'nonce', 'deadline', 'transaction', 'fee'])('invalidates authorization after changing %s', async field => {
    const f = await fixture();
    if (field === 'amount') f.prepared.manifest.depositLamports = '1' as '10000000';
    if (field === 'recipient') f.prepared.manifest.pool = CLOAK_RUNTIME.usdcMint;
    if (field === 'program') f.prepared.manifest.programId = CLOAK_RUNTIME.usdcMint;
    if (field === 'provider') f.prepared.manifest.provider = 'public' as 'cloak';
    if (field === 'nonce') f.prepared.manifest.nonce = 'changed';
    if (field === 'deadline') f.prepared.expiresAt++;
    if (field === 'transaction') f.prepared.unsignedTransaction += 'A';
    if (field === 'fee') f.prepared.networkFeeLamports = '1';
    await expect(f.execute()).rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED'); expect(f.sign).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it('performs one mocked signature and POST, then refuses replay or a second run with the same note/nonce', async () => {
    const f = await fixture(); expect((await f.execute()).state).toBe('RECOVERY_REQUIRED');
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
    expect(f.sign).toHaveBeenCalledTimes(1); expect(m.send).toHaveBeenCalledTimes(1); expect(m.reserve).toHaveBeenCalledTimes(1);
    expect(m.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.sign.mock.invocationCallOrder[0]!);
  });
  it('hands the exact reviewed wire to the test wallet once with explicit mainnet, without a message signature', async () => {
    const f = await fixture(); await f.execute();
    const input = f.sign.mock.calls[0]![0] as { transaction: Uint8Array; account: object; chain: string };
    expect(btoa(Array.from(input.transaction, b => String.fromCharCode(b)).join(''))).toBe(f.prepared.unsignedTransaction);
    expect(input.chain).toBe('solana:mainnet'); expect(input.account).toBe(f.session.account); expect(f.sign).toHaveBeenCalledTimes(1);
    expect((f.session.wallet.features['solana:signMessage'] as { signMessage: ReturnType<typeof vi.fn> }).signMessage).not.toHaveBeenCalled();
  });
  it('wallet rejection/cancel preserves intent and causes no submission or second signature request', async () => {
    const f = await fixture(); f.sign.mockRejectedValue(Object.assign(new Error('TEST_WALLET_REJECTED'), { code: 4001 }));
    await expect(f.execute()).rejects.toThrow('TEST_WALLET_REJECTED');
    expect(await f.vault.loadExecution(f.prepared.identity, 'execution.intent')).not.toBeNull();
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
    expect(f.sign).toHaveBeenCalledTimes(1); expect(m.send).not.toHaveBeenCalled();
  });
  it('concurrent execution attempts can open only one transaction signature request', async () => {
    const f = await fixture(), results = await Promise.allSettled([f.execute(), f.execute()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.sign).toHaveBeenCalledTimes(1); expect(m.send).toHaveBeenCalledTimes(1);
  });
  it('disconnect before signing fails closed with no wallet request or broadcast', async () => {
    const f = await fixture(); Object.assign(f.session.wallet, { accounts: [] });
    await expect(f.execute()).rejects.toThrow('CLOAK_OWNER_CHANGED'); expect(f.sign).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it('verifies the exact wallet-returned message before submission', async () => {
    const f = await fixture(), original = f.sign.getMockImplementation()!;
    f.sign.mockImplementation(async input => { const result = await original(input); result[0]!.signedTransaction[result[0]!.signedTransaction.length - 1]! ^= 1; return result; });
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED'); expect(m.send).not.toHaveBeenCalled();
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
  });
  it('requires a new Review if the current network fee changes', async () => {
    const f = await fixture(); m.fee++;
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_REVIEWED_FEE_CHANGED'); expect(f.sign).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it('rejects expired or changed admission before opening the wallet', async () => {
    const f = await fixture(); f.configuration.expiresAt = Date.now() - 1;
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true)).toThrow('CLOAK_OWNER_PROOF_ADMISSION_EXPIRED');
    await expect(f.execute()).rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED'); expect(f.sign).not.toHaveBeenCalled();
  });
  it('persists the expected signature BEFORE an uncertain submission, then inspects without retry', async () => {
    const f = await fixture(); m.send.mockRejectedValue(new Error('RESPONSE_LOST')); await f.execute();
    expect(await f.vault.loadExecution(f.prepared.identity, 'execution.handoff')).toMatchObject({ signature: m.signature, submissionCount: 1 });
    m.wire = ''; expect((await recoverOwnerDeposit(new PrivateStateVault(f.backend, 'synthetic test vault passphrase only'), f.prepared.identity)).state).toBe('RECOVERY_REQUIRED');
    expect(m.send).toHaveBeenCalledTimes(1); expect(f.sign).toHaveBeenCalledTimes(1);
  });
  it('reconciles a finalized deposit, reloads its encrypted outputUtxos and exports no spending or viewing secrets', async () => {
    const f = await fixture(); await f.execute();
    const checkpoint = await f.vault.loadExecution(f.prepared.identity, 'execution.prepared') as { note: Parameters<typeof restorePrivateNote>[0]; outputUtxos: Parameters<typeof restorePrivateNote>[0][]; viewingKeyNk: string; noteSalt: string };
    const notes = await Promise.all(checkpoint.outputUtxos.map(restorePrivateNote)); m.tree = await MerkleTree.create(32, await Promise.all(notes.map(computeUtxoCommitment))); m.root = (m.tree as MerkleTree).root();
    const evidence = await recoverOwnerDeposit(new PrivateStateVault(f.backend, 'synthetic test vault passphrase only'), f.prepared.identity);
    expect(evidence.state).toBe('RECONCILED'); expect(JSON.stringify(evidence)).not.toContain(checkpoint.viewingKeyNk);
    expect(JSON.stringify(evidence)).not.toContain(checkpoint.note.bytes); expect(JSON.stringify(evidence)).not.toContain('outputUtxos');
    const saved = await f.vault.loadExecution(f.prepared.identity, 'execution.reconciled') as { outputUtxos: unknown[] }; expect(saved.outputUtxos).toHaveLength(2);
    expect((await recoverOwnerDeposit(f.vault, f.prepared.identity)).state).toBe('RECONCILED'); expect(m.send).toHaveBeenCalledTimes(1);
    expect(evidence).toMatchObject({ dependencyStatus: 'ALL UNCHANGED GATES ADMITTED', dependencyAdmission: null });
    for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(JSON.stringify(evidence)).not.toContain(claim);
  });
  it('restores an encrypted initial-deposit backup for inspection only', async () => {
    const f = await fixture(); await f.execute(); const backup = await f.vault.initialDepositBackup(f.prepared.identity), restored = storage();
    await restored.vault.restoreInitialDepositBackup(backup);
    await expect(submitOwnerDeposit(restored.vault, f.prepared, f.permit, f.session, f.prepared.reviewDigest)).rejects.toThrow('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
    expect(f.sign).toHaveBeenCalledTimes(1); expect(m.send).toHaveBeenCalledTimes(1);
  });
  it('refuses corrupted encrypted checkpoints before signing', async () => {
    const f = await fixture(), key = [...f.records.keys()].find(k => k.includes(f.prepared.identity.runId) && k.endsWith('execution.prepared'))!;
    f.records.set(key, 'corrupt'); await expect(f.execute()).rejects.toThrow('PRIVACY_STATE_UNREADABLE'); expect(f.sign).not.toHaveBeenCalled();
  });
  it('denies SDK financial methods and extra setup/public transfer instructions', async () => {
    const rpc = readOnlyDepositRpc(m.rpc as Parameters<typeof readOnlyDepositRpc>[0]); expect(() => rpc.sendTransaction('' as never)).toThrow('CLOAK_PREPARATION_FINANCIAL_RPC_DENIED');
    m.extraInstruction = true; await expect(prepareOwnerDeposit(storage().vault, CLOAK_RUNTIME.nativeMint)).rejects.toThrow('CLOAK_DEPOSIT_EXTRA_TRANSACTION_REQUIRED');
  });
});

const OWNER = OWNER_PROOF_RESIDUALS.scope.owner;
const accepted = (): OwnerProofAcceptance => ({ status: OWNER_PROOF_RESIDUAL_LABEL, scope: OWNER_PROOF_RESIDUALS.scope, registerHash: 'ab'.repeat(32),
  acceptedAt: Date.now() - 1000, validUntil: OWNER_PROOF_RESIDUALS.validUntil, findings: [...OWNER_PROOF_RESIDUAL_FINDINGS],
  releaseAdmission: false, productionFinancialGate: 'DISABLED' });
const residualConfiguration = (): OwnerProofConfiguration => ({ enabled: true, owner: OWNER, expiresAt: Date.now() + 3_600_000,
  admission: { audit: 'owner-accepted-residual', sbom: 'passed', inventory: 'owner-accepted-residual', license: 'owner-accepted-residual' },
  acceptance: accepted() });
function sessionFor(owner: string, sign: ReturnType<typeof vi.fn>): SolanaSession {
  const account = { address: owner, chains: ['solana:mainnet'], features: ['solana:signTransaction', 'solana:signMessage'] };
  return { account, chain: 'solana:mainnet', wallet: { name: 'SYNTHETIC TEST WALLET', accounts: [account], chains: account.chains,
    features: { 'solana:signTransaction': { signTransaction: sign }, 'solana:signMessage': { signMessage: vi.fn() }, 'standard:events': { on: () => () => undefined } } } };
}
describe('OWNER-ACCEPTED RESIDUAL RISK: one exact owner deposit, scope cannot expand', () => {
  // Inside the reviewed acceptance window; only Date is faked so crypto and timers stay real.
  beforeEach(() => { vi.useFakeTimers({ now: Date.parse('2026-10-06T12:00:00.000Z'), toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });
  async function residual() { const store = storage(); return { ...store, prepared: await prepareOwnerDeposit(store.vault, OWNER), configuration: residualConfiguration() }; }
  it('authorizes only with the explicit in-app acceptance and carries the public acceptance into the permit', async () => {
    const f = await residual();
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true)).toThrow('CLOAK_OWNER_RESIDUAL_RISK_ACCEPTANCE_REQUIRED');
    const permit = authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true, true);
    expect(permit.dependencyAdmission).toEqual(f.configuration.acceptance); expect(Object.isFrozen(permit.dependencyAdmission)).toBe(true);
  });
  const scope = OWNER_PROOF_RESIDUALS.scope;
  it.each([
    ['amount', { scope: { ...scope, depositLamports: '20000000' } }], ['owner', { scope: { ...scope, owner: CLOAK_RUNTIME.nativeMint } }],
    ['network', { scope: { ...scope, network: 'solana:devnet' } }], ['genesis', { scope: { ...scope, genesisHash: CLOAK_RUNTIME.nativeMint } }],
    ['program', { scope: { ...scope, programId: CLOAK_RUNTIME.usdcMint } }], ['mint', { scope: { ...scope, mint: CLOAK_RUNTIME.usdcMint } }],
    ['lockfile', { scope: { ...scope, lockHash: '00'.repeat(32) } }], ['swap', { scope: { ...scope, swap: true } }],
    ['signature limit', { scope: { ...scope, maxWalletSignatureRequests: 2 } }], ['submission limit', { scope: { ...scope, maxSubmissions: 2 } }],
    ['added finding', { findings: [...OWNER_PROOF_RESIDUAL_FINDINGS, 'GHSA-new-advisory'] }], ['removed finding', { findings: OWNER_PROOF_RESIDUAL_FINDINGS.slice(1) }],
    ['validity window', { validUntil: '2027-01-01T00:00:00.000Z' }], ['label', { status: 'DEPENDENCY PASS' }],
    ['release admission', { releaseAdmission: true }], ['production gate', { productionFinancialGate: 'ENABLED' }], ['register hash', { registerHash: 'unbound' }],
  ] as const)('rejects an acceptance whose %s differs from the reviewed register', async (_name, change) => {
    const f = await residual(); f.configuration.acceptance = { ...f.configuration.acceptance!, ...change } as OwnerProofAcceptance;
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  });
  it.each([
    ['SBOM as a residual', { sbom: 'owner-accepted-residual' }], ['a partial residual', { inventory: 'passed' }], ['a blocked gate', { license: 'blocked' }],
  ] as const)('rejects %s', async (_name, change) => {
    const f = await residual(); Object.assign(f.configuration.admission, change);
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  });
  it('a residual status without the accepted register, or a register with passing gates, is not admission', async () => {
    const f = await residual(), withoutRegister = { ...f.configuration, acceptance: null };
    expect(() => authorizeOwnerDeposit(withoutRegister, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
    const passing = { ...f.configuration, admission: { audit: 'passed', sbom: 'passed', inventory: 'passed', license: 'passed' } } as OwnerProofConfiguration;
    expect(() => authorizeOwnerDeposit(passing, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  });
  it('cannot be reused by another owner', async () => {
    const f = await fixture(), configuration = { ...residualConfiguration(), owner: f.session.account.address };
    expect(() => authorizeOwnerDeposit(configuration, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  });
  it('cannot be reused for another amount or a changed Manifest', async () => {
    const f = await residual(); f.prepared.manifest.depositLamports = '20000000' as '10000000';
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
  });
  it('expires after the reviewed two-week window and after the launch session', async () => {
    const f = await residual(); vi.setSystemTime(Date.parse(OWNER_PROOF_RESIDUALS.validUntil));
    expect(() => authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true, true)).toThrow('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
    vi.setSystemTime(Date.parse('2026-10-06T12:00:00.000Z'));
    const g = await residual(); g.configuration.expiresAt = Date.now() - 1;
    expect(() => authorizeOwnerDeposit(g.configuration, g.prepared, g.prepared.reviewDigest, true, true)).toThrow('CLOAK_OWNER_PROOF_ADMISSION_EXPIRED');
  });
  it('records the acceptance in the encrypted intent and reserves the one server signature request before the wallet opens', async () => {
    const f = await residual(), permit = authorizeOwnerDeposit(f.configuration, f.prepared, f.prepared.reviewDigest, true, true);
    // The agent never holds the owner key: this synthetic wallet signs with another key, so verification must refuse it.
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const sign = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => { const tx = parseTransaction(transaction);
      const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', other.privateKey, Uint8Array.from(tx.message)));
      return [{ signedTransaction: serializeSignedTransaction([sig], tx.message) }]; });
    const session = sessionFor(OWNER, sign);
    await expect(submitOwnerDeposit(f.vault, f.prepared, permit, session, f.prepared.reviewDigest)).rejects.toThrow('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED');
    expect(m.reserve).toHaveBeenCalledTimes(1); expect(m.reserve.mock.invocationCallOrder[0]).toBeLessThan(sign.mock.invocationCallOrder[0]!);
    expect(await f.vault.loadExecution(f.prepared.identity, 'execution.intent')).toMatchObject({ dependencyAdmission: f.configuration.acceptance });
    await expect(submitOwnerDeposit(f.vault, f.prepared, permit, session, f.prepared.reviewDigest)).rejects.toThrow('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
    expect(sign).toHaveBeenCalledTimes(1); expect(m.send).not.toHaveBeenCalled();
  });
  it('evidence records OWNER-ACCEPTED RESIDUAL RISK and never claims a pass or production readiness', () => {
    const evidence = depositDependencyEvidence(accepted(), OWNER);
    expect(evidence).toEqual({ dependencyStatus: OWNER_PROOF_RESIDUAL_LABEL, dependencyAdmission: accepted() });
    for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(JSON.stringify(evidence)).not.toContain(claim);
    expect(() => depositDependencyEvidence({ ...accepted(), status: 'DEPENDENCY PASS' } as unknown as OwnerProofAcceptance, OWNER)).toThrow('CLOAK_DEPOSIT_AUTHORIZATION_CHECKPOINT_MISSING');
    expect(() => depositDependencyEvidence(accepted(), CLOAK_RUNTIME.nativeMint)).toThrow('CLOAK_DEPOSIT_AUTHORIZATION_CHECKPOINT_MISSING');
  });
});
describe('no wallet signature before an authorized Review/Manifest and one server reservation', () => {
  it('a refused one-shot signature reservation never opens the wallet and cannot be retried', async () => {
    const f = await fixture(); m.reserve.mockRejectedValue(new Error('CLOAK_DEPOSIT_DUPLICATE_SIGNATURE_REQUEST_DENIED'));
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SIGNATURE_REQUEST_DENIED');
    await expect(f.execute()).rejects.toThrow('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
    expect(f.sign).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it('forged permits and unreviewed preparation copies reach neither the reservation nor the wallet', async () => {
    const f = await fixture();
    await expect(submitOwnerDeposit(f.vault, f.prepared, { ...f.permit }, f.session, f.prepared.reviewDigest)).rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
    await expect(submitOwnerDeposit(f.vault, structuredClone(f.prepared), f.permit, f.session, f.prepared.reviewDigest)).rejects.toThrow('CLOAK_DEPOSIT_PREFLIGHT_REQUIRED');
    await expect(submitOwnerDeposit(f.vault, f.prepared, f.permit, f.session, 'unacknowledged')).rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
    expect(m.reserve).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(m.send).not.toHaveBeenCalled();
  });
  it('the Elliptic advisory path is loaded but no secp256k1 private key is ever used by preparation or signing', async () => {
    const tripwire = ellipticPrivateKeyTripwire();
    try {
      const f = await fixture(); await f.execute();
      expect(tripwire.signingKeyLoaded()).toBe(true); expect(tripwire.calls).toEqual([]);
    } finally { tripwire.restore(); }
  });
});
