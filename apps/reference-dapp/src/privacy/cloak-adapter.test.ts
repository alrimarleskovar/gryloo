// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createUtxo, generateUtxoKeypair, NATIVE_SOL_MINT, getNkFromUtxoPrivateKey, type UtxoSwapResult } from '@cloak.dev/sdk';
import { prepareCloakPrivateState, persistCloakResult, restorePrivateNote, encodePrivateNote, CLOAK_RUNTIME, CloakResultDivergence, assertCloakFinancialExecutionAvailable } from './cloak-adapter';
import { PrivateStateVault, type VaultBackend } from './vault';
const identity = { runId: 'cloak-' + '3'.repeat(32), owner: '11111111111111111111111111111111', genesisHash: CLOAK_RUNTIME.genesisHash,
  programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '4'.repeat(64) };
function sink(): VaultBackend & { records: Map<string, string> } {
  const records = new Map<string, string>();
  return { records, get: async key => records.get(key) ?? null, putNew: async (key, value) => { if (records.has(key)) throw new Error('DUPLICATE'); records.set(key, value); } };
}
describe('published Cloak SDK note codec and prepared-state adapter, no network execution', () => {
  it('persists SDK-generated change/refund state and restores explicit index zero', async () => {
    const storage = sink(), vault = new PrivateStateVault(storage, 'owner-controlled integration test unlock');
    const keypair = await generateUtxoKeypair(), note = await createUtxo(30_000_000n, keypair, NATIVE_SOL_MINT); note.index = 0;
    const prepared = await prepareCloakPrivateState({ identity, inputUtxos: [note], swapAmount: 20_000_000n,
      viewingKeyNk: getNkFromUtxoPrivateKey(keypair.privateKey), vault });
    const reloaded = await new PrivateStateVault(storage, 'owner-controlled integration test unlock').load(prepared.reference);
    const restoredInput = await restorePrivateNote(reloaded.inputNotes[0]!);
    expect(restoredInput.index).toBe(0); expect(restoredInput.blinding).toBe(note.blinding); expect(restoredInput.keypair).toEqual(keypair);
    const output = await restorePrivateNote(reloaded.outputNotes[0]!);
    expect(output.amount).toBe(10_000_000n); expect(output.index).toBeUndefined();
    // Simulate an SDK result hand-off using the actual prepared note. This is NOT chain evidence.
    output.index = 12;
    const result = { outputUtxos: [output], refund: { ...reloaded.refund }, swapStatePda: '11111111111111111111111111111111', signature: '1'.repeat(88) } as UtxoSwapResult;
    const reference = await persistCloakResult(vault, prepared.reference, result);
    expect((await vault.load(reference)).outputNotes[0]!.index).toBe(12);
    expect(storage.records.size).toBe(2); expect(await vault.load(prepared.reference)).toEqual(prepared.state);
  });
  it('refuses many-note consolidation, unsupported networks and missing recovery inputs', async () => {
    const keypair = await generateUtxoKeypair(), note = await createUtxo(30_000_000n, keypair, NATIVE_SOL_MINT); note.index = 1;
    const input = { identity, inputUtxos: [note], swapAmount: 20_000_000n, viewingKeyNk: getNkFromUtxoPrivateKey(keypair.privateKey),
      vault: new PrivateStateVault(sink(), 'owner-controlled integration test unlock') };
    await expect(prepareCloakPrivateState({ ...input, inputUtxos: [note, note, note] })).rejects.toThrow('CLOAK_SWAP_UNSUPPORTED');
    await expect(prepareCloakPrivateState({ ...input, identity: { ...identity, genesisHash: 'devnet' } })).rejects.toThrow('CLOAK_NETWORK_MISMATCH');
    await expect(prepareCloakPrivateState({ ...input, swapAmount: 30_000_000n })).rejects.toThrow('CLOAK_PRIVATE_CHANGE_REQUIRED');
    delete note.index;
    await expect(prepareCloakPrivateState(input)).rejects.toThrow('CLOAK_INPUT_NOTE_UNVERIFIED');
  });
  it('retains actual unexpected refund authority and exposes its recovery pointer on divergence', async () => {
    const storage = sink(), vault = new PrivateStateVault(storage, 'owner-controlled integration test unlock');
    const keypair = await generateUtxoKeypair(), note = await createUtxo(30_000_000n, keypair, NATIVE_SOL_MINT); note.index = 0;
    const prepared = await prepareCloakPrivateState({ identity, inputUtxos: [note], swapAmount: 20_000_000n,
      viewingKeyNk: getNkFromUtxoPrivateKey(keypair.privateKey), vault });
    const output = await restorePrivateNote(prepared.state.outputNotes[0]!); output.index = 17;
    const actualRefund = { ...prepared.state.refund, privateKey: 'a'.repeat(64), derivedFromNk: false };
    const error = await persistCloakResult(vault, prepared.reference, { outputUtxos: [output], refund: actualRefund,
      swapStatePda: '11111111111111111111111111111111', signature: '1'.repeat(88) } as UtxoSwapResult).catch(e => e);
    expect(error).toBeInstanceOf(CloakResultDivergence);
    const recovered = await new PrivateStateVault(storage, 'owner-controlled integration test unlock').load(error.recoveryReference);
    expect(recovered.refund).toEqual(actualRefund); expect(recovered.outputNotes[0]!.index).toBe(17);
    expect((await vault.load(prepared.reference)).refund).toEqual(prepared.state.refund);
  });
  it('has no financial bypass around unavailable exact simulation/Review', () => expect(assertCloakFinancialExecutionAvailable).toThrow('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE'));
  it('rejects a note whose encoded private authority cannot restore its public commitment', async () => {
    const keypair = await generateUtxoKeypair(), note = await createUtxo(30_000_000n, keypair, NATIVE_SOL_MINT);
    delete note.commitment;
    note.keypair = { ...keypair, publicKey: keypair.publicKey + 1n };
    await expect(encodePrivateNote(note)).rejects.toThrow('CLOAK_NOTE_CODEC_DIVERGENT');
  });
});
