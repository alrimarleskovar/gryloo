// SPDX-License-Identifier: AGPL-3.0-only
/** Test-only wallet/proof and mocked RPC/filesystem. No financial mainnet call. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addressFromBytes, accountMeta, buildTransactionMessage, getShieldPoolPDAs, partiallySignTransaction,
  programInstruction, pubkeyToFieldElement, toAddress, transactionBytes } from '@cloak.dev/sdk';
import { base58Encode, parseTransaction, serializeSignedTransaction, sha256Hex } from '@defi-workflow-engine/reference-compiler';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { CLOAK_RUNTIME } from '../privacy/cloak-adapter';
import { bytesBase64 } from '../privacy/provider-contract';
import type { OwnerDepositPreparation, OwnerDepositManifest } from '../privacy/owner-proof-deposit';
import { broadcastOwnerDeposit } from './privacy-owner-proof-actions';
const m = vi.hoisted(() => ({ owner: '', reserved: false, send: vi.fn(), sync: vi.fn(), write: vi.fn() }));
vi.mock('../privacy/owner-proof-configuration', () => ({ ownerProofConfiguration: async () => ({ enabled: true,
  owner: m.owner, expiresAt: Date.now() + 3600000, admission: { audit: true, sbom: true, inventory: true, license: true } }) }));
vi.mock('node:fs/promises', () => ({ mkdir: async () => undefined, open: async (_path: string, flag: string) => {
  if (flag === 'wx') { if (m.reserved) throw new Error('EEXIST'); m.reserved = true; }
  return { writeFile: m.write, sync: m.sync, close: async () => undefined };
} }));
vi.mock('@cloak.dev/sdk', async original => ({ ...await original<object>(), fetchLookupTables: async () => [], createCloakRpc: () => ({
  getGenesisHash: () => ({ send: async () => CLOAK_RUNTIME.genesisHash }),
  getBlockHeight: () => ({ send: async () => 500n }),
  getFeeForMessage: () => ({ send: async () => ({ value: 10000n }) }),
  getAccountInfo: () => ({ send: async () => ({ value: { lamports: 100000000n } }) }),
  simulateTransaction: () => ({ send: async () => ({ value: { err: null, accounts: [{ lamports: 88029120n }] } }) }),
  sendTransaction: (_wire: string, options: unknown) => ({ send: () => m.send(options) }),
}) }));
beforeEach(() => { m.reserved = false; m.send.mockReset(); m.sync.mockReset(); m.write.mockReset(); });
async function fixture() {
  const key = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  m.owner = addressFromBytes(new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey)));
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
  it('fsyncs a public exclusive journal before exactly one zero-retry submission and rejects a duplicate', async () => {
    const f = await fixture();
    m.send.mockImplementation(async () => { expect(m.sync).toHaveBeenCalledTimes(2); return f.signature; });
    expect(await broadcastOwnerDeposit(f.prepared, f.signed)).toBe(f.signature);
    expect(m.send).toHaveBeenCalledWith({ encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0n });
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SUBMISSION_DENIED');
    expect(m.send).toHaveBeenCalledTimes(1);
    const journal = String(m.write.mock.calls[0]![0]); expect(journal).toContain(f.signature); expect(journal).not.toContain('outputUtxos');
  });
  it('retains the reservation after a lost response, preventing any second broadcast', async () => {
    const f = await fixture(); m.send.mockRejectedValue(new Error('MOCKED_RESPONSE_LOST'));
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('MOCKED_RESPONSE_LOST');
    await expect(broadcastOwnerDeposit(f.prepared, f.signed)).rejects.toThrow('CLOAK_DEPOSIT_DUPLICATE_SUBMISSION_DENIED');
    expect(m.send).toHaveBeenCalledTimes(1); expect(m.reserved).toBe(true);
  });
  it('rejects changed transaction bytes before reserving or broadcasting', async () => {
    const f = await fixture(), parsed = parseTransaction(Uint8Array.from(atob(f.signed), c => c.charCodeAt(0)));
    parsed.message[parsed.message.length - 1] = parsed.message[parsed.message.length - 1]! ^ 1;
    await expect(broadcastOwnerDeposit(f.prepared, bytesBase64(serializeSignedTransaction(parsed.signatures, parsed.message))))
      .rejects.toThrow('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED');
    expect(m.send).not.toHaveBeenCalled(); expect(m.reserved).toBe(false);
  });
});
