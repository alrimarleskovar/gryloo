// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createUtxo, generateUtxoKeypair, getNkFromUtxoPrivateKey, MerkleTree, computeUtxoNullifier } from '@cloak.dev/sdk';
import { buildCloakPrivateState, CLOAK_RUNTIME } from './cloak-adapter';
import { decodeCloakFee, proveCloakProperties } from './live-proof';
import { assertCloakBoundRequest, CLOAK_ROUTING_DISCLOSURE, fieldHex, type CloakProperties } from './provider-contract';

function config() {
  const data = new Uint8Array(27); data[0] = 1; const v = new DataView(data.buffer);
  v.setBigUint64(2, 5_000_000n, true); v.setBigUint64(10, 3n, true); v.setBigUint64(18, 1000n, true); return data;
}
describe('live protocol fee decoder', () => {
  it('reads the same exact fee as the SDK for the deployed layout', () => { expect(decodeCloakFee(config(), 20_000_000n).fee).toBe('5060000'); });
  it('rejects paused, malformed and excessive configurations or uneconomic spend', () => {
    const paused = config(); paused[26] = 1;
    const excessive = config(); new DataView(excessive.buffer).setBigUint64(10, 101n, true);
    for (const data of [paused, excessive, new Uint8Array(26), new Uint8Array(27)]) expect(() => decodeCloakFee(data, 20_000_000n)).toThrow();
    expect(() => decodeCloakFee(config(), 1n)).toThrow('CLOAK_PROTOCOL_FEE_INVALID');
  });
});
// Explicit offline opt-in: genuine ceremony proof over synthetic local notes/tree, never mainnet financial evidence.
describe.runIf(Boolean(process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY))('actual Cloak ceremony proof / LOCAL synthetic witness', () => {
  it('proves and verifies the supported properties with actual SDK artifacts and rejects altered private change', async () => {
    const owner = '11111111111111111111111111111111', key = await generateUtxoKeypair();
    const input = await createUtxo(30_000_000n, key, CLOAK_RUNTIME.nativeMint); input.index = 0;
    const state = await buildCloakPrivateState({ identity: { owner, runId: 'cloak-' + 'c'.repeat(32),
      genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '0'.repeat(64) },
      inputUtxos: [input], swapAmount: 20_000_000n, viewingKeyNk: getNkFromUtxoPrivateKey(key.privateKey) });
    const tree = await MerkleTree.create(32, [input.commitment!]), now = Date.now();
    const p: CloakProperties = { provider: 'cloak', owner, genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId,
      inputMint: CLOAK_RUNTIME.nativeMint, outputMint: CLOAK_RUNTIME.usdcMint, grossInputLamports: '20000000', recipientAta: owner,
      minimumOutput: '1000000', maximumProtocolFeeLamports: '5060000', privateChange: { commitment: state.outputNotes[0]!.commitment, amount: '10000000', mint: CLOAK_RUNTIME.nativeMint },
      inputNullifiers: [fieldHex(await computeUtxoNullifier(input))], refundPublicKey: state.refund.publicKey,
      refundBlinding: state.refund.blinding, reviewedAt: now, expiresAt: now + 60_000, slippageBps: 50, routing: CLOAK_ROUTING_DISCLOSURE };
    const proved = await proveCloakProperties(state, p, tree.root(), [tree.path(0)], process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY!);
    await expect(assertCloakBoundRequest(p, proved.body, Date.now())).resolves.toBeUndefined();
    expect(proved.paddedNullifiers).toHaveLength(2); expect(proved.circuitDigests.wasm).toMatch(/^[a-f0-9]{64}$/);
    await expect(proveCloakProperties(state, { ...p, privateChange: { ...p.privateChange, amount: '1' } }, tree.root(), [tree.path(0)]))
      .rejects.toThrow('CLOAK_PROOF_NOTE_BINDING_INVALID');
    await expect(proveCloakProperties(state, p, tree.root() + 1n, [tree.path(0)])).rejects.toThrow('CLOAK_INPUT_MEMBERSHIP_UNPROVEN');
  }, 120_000);
});
