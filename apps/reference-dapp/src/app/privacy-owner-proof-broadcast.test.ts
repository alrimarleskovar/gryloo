// SPDX-License-Identifier: AGPL-3.0-only
/** Test-only wallet/proof and mocked RPC/filesystem. No financial mainnet call. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressFromBytes, accountMeta, buildTransactionMessage, getShieldPoolPDAs, partiallySignTransaction,
  programInstruction, pubkeyToFieldElement, toAddress, transactionBytes } from '@cloak.dev/sdk';
import { base58Encode, parseTransaction, serializeSignedTransaction, sha256Hex } from '@defi-workflow-engine/reference-compiler';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { CLOAK_RUNTIME } from '../privacy/cloak-adapter';
import { bytesBase64 } from '../privacy/provider-contract';
import type { OwnerDepositPreparation, OwnerDepositManifest } from '../privacy/owner-proof-deposit';
import { disabledOwnerProof, type OwnerProofConfiguration } from '../privacy/owner-proof-gate';
import { OWNER_PROOF_FORBIDDEN_CLAIMS, OWNER_PROOF_RESIDUAL_FINDINGS, OWNER_PROOF_RESIDUAL_LABEL, OWNER_PROOF_RESIDUALS } from '../privacy/owner-proof-residuals';
import { broadcastOwnerDeposit, reserveOwnerDepositSignature } from './privacy-owner-proof-actions';
const m = vi.hoisted(() => ({ owner: '', files: new Map<string, string>(), send: vi.fn(), sync: vi.fn(), configuration: null as unknown }));
vi.mock('../privacy/owner-proof-configuration', async original => ({ ...await original<object>(), ownerProofConfiguration: async () => m.configuration ?? {
  enabled: true, owner: m.owner, expiresAt: Date.now() + 3600000, admission: { audit: 'passed', sbom: 'passed', inventory: 'passed', license: 'passed' }, acceptance: null } }));
// Exclusive-create semantics per path, like O_EXCL on the real public journal directory.
vi.mock('node:fs/promises', () => ({ mkdir: async () => undefined,
  readFile: async (path: string) => { const value = m.files.get(path); if (value === undefined) throw new Error('ENOENT'); return value; },
  open: async (path: string, flag: string) => {
    if (flag === 'wx' && m.files.has(path)) throw new Error('EEXIST');
    return { writeFile: async (data: string) => { m.files.set(path, data); }, sync: m.sync, close: async () => undefined };
  } }));
const journal = (suffix: string) => [...m.files].find(([path]) => path.endsWith('/' + m.owner + suffix))?.[1];
vi.mock('@cloak.dev/sdk', async original => ({ ...await original<object>(), fetchLookupTables: async () => [], createCloakRpc: () => ({
  getGenesisHash: () => ({ send: async () => CLOAK_RUNTIME.genesisHash }),
  getBlockHeight: () => ({ send: async () => 500n }),
  getFeeForMessage: () => ({ send: async () => ({ value: 10000n }) }),
  getAccountInfo: () => ({ send: async () => ({ value: { lamports: 100000000n } }) }),
  simulateTransaction: () => ({ send: async () => ({ value: { err: null, accounts: [{ lamports: 88029120n }] } }) }),
  sendTransaction: (_wire: string, options: unknown) => ({ send: () => m.send(options) }),
}) }));
beforeEach(() => { m.files.clear(); m.configuration = null; m.send.mockReset(); m.sync.mockReset(); });
/** A fixed owner gets a signature from another key: usable for reservation checks, never a valid submission. */
async function fixture(fixedOwner?: string) {
  const key = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  m.owner = fixedOwner ?? addressFromBytes(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey)));
  const pool = (await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint)).pool;
  const data = new Uint8Array(521); new DataView(data.buffer).setBigInt64(289, 10000000n, true);
  data.set(Uint8Array.from(pubkeyToFieldElement(CLOAK_RUNTIME.nativeMint).toString(16).padStart(64, '0').match(/../g)!, h => parseInt(h, 16)), 329);
  data.fill(1, 425, 457);
  const tx = await partiallySignTransaction(buildTransactionMessage({ version: 0, feePayer: toAddress(m.owner),
    lifetime: { blockhash: CLOAK_RUNTIME.nativeMint, lastValidBlockHeight: 999n }, instructions: [
      programInstruction(toAddress('Ed25519SigVerify111111111111111111111111111'), [], new Uint8Array([1])),
      programInstruction(CLOAK_RUNTIME.programId, [accountMeta(toAddress(m.owner), { signer: true, writable: true }), accountMeta(pool, { writable: true })], data)] }));
  const wire = transactionBytes(tx), parsed = parseTransaction(wire), expiresAt = Date.now() + 60000;
  const manifest: OwnerDepositManifest = { format: 'flofi.cloak-owner-deposit-manifest.v1', owner: m.owner, provider: 'cloak',
    genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, mint: CLOAK_RUNTIME.nativeMint, pool,
    depositLamports: '10000000', outputCommitment: '01'.repeat(32), nonce: crypto.randomUUID(),
    messageDigest: sha256Hex(parsed.message), networkFeeLamports: '10000', walletDebitLamports: '11970880', expiresAt, lastValidBlockHeight: '999' };
  const digest = (v: unknown) => digestRawResponse(new TextEncoder().encode(JSON.stringify(v)));
  const manifestHash = await digest(manifest);
  const review = { identity: { owner: m.owner, genesisHash: manifest.genesisHash, programId: manifest.programId,
    runId: 'cloak-' + crypto.randomUUID().replaceAll('-', ''), manifestHash }, manifest, manifestHash,
    unsignedTransaction: bytesBase64(wire), messageDigest: manifest.messageDigest!, networkFeeLamports: '10000',
    simulatedWalletDebitLamports: '11970880', simulation: 'PASSED' as const, expiresAt, lastValidBlockHeight: '999', lookupTables: [] };
  const prepared: OwnerDepositPreparation = { ...review, reviewDigest: await digest(review) };
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, Uint8Array.from(parsed.message)));
  m.send.mockResolvedValue(base58Encode(signature));
  return { prepared, signed: bytesBase64(serializeSignedTransaction([signature], parsed.message)), signature: base58Encode(signature) };
}
describe('independent one-shot server deposit boundary', () => {
  it('reserves one signature request, then fsyncs one public journal before exactly one zero-retry submission', async () => {
    const f = await fixture(); await reserveOwnerDepositSignature(f.prepared);
    expect(JSON.parse(journal('.signature-request.json')!)).toMatchObject({ messageDigest: f.prepared.messageDigest, signatureRequests: 1, dependencyAdmission: null });
    m.send.mockImplementation(async () => { expect(m.sync).toHaveBeenCalledTimes(4); return f.signature; });
    expect(await broadcastOwnerDeposit(f.prepared, f.signed)).toBe(f.signature);
    expect(m.send).toHaveBeenCalledWith({ encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0n });
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SUBMISSION_DENIED');
    expect(m.send).toHaveBeenCalledTimes(1);
    const submitted = journal('.json')!; expect(submitted).toContain(f.signature); expect(submitted).not.toContain('outputUtxos');
  });
  it('denies a second wallet signature request for the owner proof', async () => {
    const f = await fixture(); await reserveOwnerDepositSignature(f.prepared);
    await expect(reserveOwnerDepositSignature(f.prepared)).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SIGNATURE_REQUEST_DENIED');
  });
  it('submits only the transaction whose signature request was reserved', async () => {
    const f = await fixture();
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_DEPOSIT_SIGNATURE_RESERVATION_REQUIRED');
    await reserveOwnerDepositSignature(f.prepared);
    const [path, value] = [...m.files].find(([p]) => p.endsWith('.signature-request.json'))!;
    m.files.set(path, JSON.stringify({ ...JSON.parse(value), messageDigest: '0x' + '00'.repeat(32) }));
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_DEPOSIT_SIGNATURE_RESERVATION_REQUIRED');
    expect(m.send).not.toHaveBeenCalled(); expect(journal('.json')).toBeUndefined();
  });
  it('retains the reservation after a lost response, preventing any second broadcast', async () => {
    const f = await fixture(); await reserveOwnerDepositSignature(f.prepared); m.send.mockRejectedValue(new Error('MOCKED_RESPONSE_LOST'));
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('MOCKED_RESPONSE_LOST');
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SUBMISSION_DENIED');
    expect(m.send).toHaveBeenCalledTimes(1); expect(journal('.json')).toBeDefined();
  });
  it('rejects changed transaction bytes before reserving or broadcasting', async () => {
    const f = await fixture(), parsed = parseTransaction(Uint8Array.from(atob(f.signed), c => c.charCodeAt(0)));
    await reserveOwnerDepositSignature(f.prepared);
    parsed.message[parsed.message.length - 1] = parsed.message[parsed.message.length - 1]! ^ 1;
    await expect(broadcastOwnerDeposit(f.prepared, bytesBase64(serializeSignedTransaction(parsed.signatures, parsed.message))))
      .rejects.toThrow('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED');
    expect(m.send).not.toHaveBeenCalled(); expect(journal('.json')).toBeUndefined();
  });
  it('an unreviewed, changed or expired preparation cannot reserve a wallet signature', async () => {
    const f = await fixture();
    await expect(reserveOwnerDepositSignature({ ...f.prepared, manifest: { ...f.prepared.manifest, depositLamports: '20000000' as '10000000' } }))
      .rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
    await expect(reserveOwnerDepositSignature({ ...f.prepared, reviewDigest: '0x' + '11'.repeat(32) })).rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
    await expect(reserveOwnerDepositSignature({ ...f.prepared, expiresAt: Date.now() - 1 })).rejects.toThrow('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
    expect(m.files.size).toBe(0);
  });
  it('a disabled configuration or another owner\'s residual acceptance can neither reserve nor submit', async () => {
    const f = await fixture(); m.configuration = disabledOwnerProof(m.owner);
    await expect(reserveOwnerDepositSignature(f.prepared)).rejects.toThrow('CLOAK_OWNER_PROOF_DISABLED');
    m.configuration = { ...residual(), owner: m.owner } satisfies OwnerProofConfiguration;
    await expect(reserveOwnerDepositSignature(f.prepared)).rejects.toThrow('CLOAK_OWNER_PROOF_DISABLED');
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_OWNER_PROOF_DISABLED');
    expect(m.files.size).toBe(0); expect(m.send).not.toHaveBeenCalled();
  });
});
const residual = (): OwnerProofConfiguration => ({ enabled: true, owner: OWNER_PROOF_RESIDUALS.scope.owner, expiresAt: Date.now() + 3600000,
  admission: { audit: 'owner-accepted-residual', sbom: 'passed', inventory: 'owner-accepted-residual', license: 'owner-accepted-residual' },
  acceptance: { status: OWNER_PROOF_RESIDUAL_LABEL, scope: OWNER_PROOF_RESIDUALS.scope, registerHash: 'ab'.repeat(32), acceptedAt: Date.now() - 1000,
    validUntil: OWNER_PROOF_RESIDUALS.validUntil, findings: [...OWNER_PROOF_RESIDUAL_FINDINGS], releaseAdmission: false, productionFinancialGate: 'DISABLED' } });
describe('server journals under OWNER-ACCEPTED RESIDUAL RISK', () => {
  beforeEach(() => { vi.useFakeTimers({ now: Date.parse('2026-10-06T12:00:00.000Z'), toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });
  it('records the accepted residual risk in the one signature reservation, without any pass claim', async () => {
    const f = await fixture(OWNER_PROOF_RESIDUALS.scope.owner); m.configuration = residual();
    await reserveOwnerDepositSignature(f.prepared);
    const reserved = journal('.signature-request.json')!;
    expect(JSON.parse(reserved).dependencyAdmission).toMatchObject({ status: OWNER_PROOF_RESIDUAL_LABEL, releaseAdmission: false, productionFinancialGate: 'DISABLED' });
    for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(reserved).not.toContain(claim);
    await expect(reserveOwnerDepositSignature(f.prepared)).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SIGNATURE_REQUEST_DENIED');
  });
  it('stops accepting the residual after the reviewed window', async () => {
    const f = await fixture(OWNER_PROOF_RESIDUALS.scope.owner); m.configuration = residual();
    vi.setSystemTime(Date.parse(OWNER_PROOF_RESIDUALS.validUntil));
    await expect(reserveOwnerDepositSignature({ ...f.prepared })).rejects.toThrow('CLOAK_OWNER_PROOF_DISABLED'); expect(m.files.size).toBe(0);
  });
});
