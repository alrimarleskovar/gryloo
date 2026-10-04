// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { PrivateStateVault, type PrivateState, type VaultBackend } from './vault';
const secret = 'owner test unlock secret that is not a wallet key';
function backend(): VaultBackend & { records: Map<string, string> } {
  const records = new Map<string, string>();
  return { records, get: async key => records.get(key) ?? null,
    putNew: async (key, value) => { if (records.has(key)) throw new Error('DUPLICATE'); records.set(key, value); } };
}
const state = (): PrivateState => ({ format: 'flofi.cloak-private-state.v1', runId: 'cloak-' + '1'.repeat(32),
  owner: '11111111111111111111111111111111', genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  programId: 'zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW', manifestHash: '0x' + 'a'.repeat(64), checkpoint: 'prepared',
  inputNotes: [{ bytes: btoa('test note bytes'.padEnd(128, '!')), index: 0, commitment: 'b'.repeat(64) }],
  outputNotes: [{ bytes: btoa('different actual bytes'.padEnd(128, '!')), index: null, commitment: 'c'.repeat(64) }],
  refund: { privateKey: 'd'.repeat(64), publicKey: 'e'.repeat(64), blinding: 'f'.repeat(64), derivedFromNk: true },
  viewingKeyNk: '2'.repeat(64), noteSalt: '1234', swapStatePda: null, signature: null });

describe('encrypted private custody checkpoints (synthetic storage fixtures, no funds)', () => {
  it('reloads every byte, refund secret and explicit index zero; encrypts at rest', async () => {
    const sink = backend(), input = state(), vault = new PrivateStateVault(sink, secret);
    const reference = await vault.save(input);
    const onDisk = [...sink.records.values()][0]!;
    expect(onDisk).not.toContain(input.inputNotes[0]!.bytes);
    expect(onDisk).not.toContain(input.refund.privateKey);
    expect(await new PrivateStateVault(sink, secret).load(reference)).toEqual(input);
  });
  it('fails on quota failure or acknowledged writes that lost their data', async () => {
    const missing = { get: async () => null, putNew: async () => undefined };
    await expect(new PrivateStateVault(missing, secret).save(state())).rejects.toThrow('PRIVACY_RECOVERY_DATA_MISSING');
    await expect(new PrivateStateVault({ ...missing, putNew: async () => { throw new Error('QUOTA'); } }, secret).save(state())).rejects.toThrow('QUOTA');
  });
  it('fails closed on missing state, a wrong secret or ciphertext alteration', async () => {
    const sink = backend(), vault = new PrivateStateVault(sink, secret), reference = await vault.save(state());
    await expect(new PrivateStateVault(sink, secret + ' wrong').load(reference)).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
    const key = [...sink.records.keys()][0]!, encrypted = sink.records.get(key)!;
    sink.records.set(key, encrypted.replace('flofi.cloak-vault.v1', 'flofi.cloak-vault.v2'));
    await expect(vault.load(reference)).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
    sink.records.clear();
    await expect(vault.load(reference)).rejects.toThrow('PRIVACY_RECOVERY_DATA_MISSING');
  });
  it('authenticates owner, network, program, run and Manifest independently', async () => {
    const sink = backend(), reference = await new PrivateStateVault(sink, secret).save(state());
    const encrypted = [...sink.records.values()][0]!;
    const substituted = new PrivateStateVault({ get: async () => encrypted, putNew: async () => undefined }, secret);
    for (const [field, value] of Object.entries({ owner: '1'.repeat(33), genesisHash: '1'.repeat(32), programId: '1'.repeat(32), runId: 'cloak-' + '2'.repeat(32), manifestHash: '0x' + '2'.repeat(64) })) {
      await expect(substituted.load({ ...reference, [field]: value })).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
    }
  });
  it('retains immutable prepared checkpoints and rejects overlapping writes', async () => {
    const sink = backend(), vault = new PrivateStateVault(sink, secret);
    const results = await Promise.allSettled([vault.save(state()), vault.save(state())]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(sink.records.size).toBe(1);
  });
  it('snapshots before awaits and restores only validated encrypted backups', async () => {
    const sink = backend(), vault = new PrivateStateVault(sink, secret), input = state(), expected = structuredClone(input);
    const writing = vault.save(input); input.refund.privateKey = '9'.repeat(64);
    const reference = await writing;
    const target = new PrivateStateVault(backend(), secret);
    expect(await target.restore(reference, await vault.encryptedBackup(reference))).toEqual(expected);
    await expect(new PrivateStateVault(backend(), secret + '!').restore(reference, await vault.encryptedBackup(reference))).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
  });
  it('rejects missing notes, missing refund authority and unversioned state', async () => {
    const vault = new PrivateStateVault(backend(), secret);
    for (const bad of [{ ...state(), outputNotes: [] }, { ...state(), refund: null }, { ...state(), format: 'unknown' }]) {
      await expect(vault.save(bad as PrivateState)).rejects.toThrow('PRIVACY_STATE_INVALID');
    }
  });
});
