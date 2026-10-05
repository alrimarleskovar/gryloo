// SPDX-License-Identifier: AGPL-3.0-only
import {
  CLOAK_PROGRAM_ID, CLOAK_PRODUCTION_RELAY_URL, NATIVE_SOL_MINT, computeUtxoCommitment, computeUtxoNullifier,
  createRecoverableChangeUtxo, deriveSwapRefundAuthorization, deserializeUtxo, serializeUtxo,
  type Utxo, type UtxoSwapResult,
} from '@cloak.dev/sdk';
import type { PrivateNote, PrivateState, PrivateStateIdentity, PrivateRefund, PrivateStateVault, VaultReference } from './vault';

/** Published Kit SDK, pinned by lockfile. Live owner material stays browser-local; the server demo uses synthetic fixtures only. */
export const CLOAK_RUNTIME = Object.freeze({ sdkVersion: '0.2.5', programId: CLOAK_PROGRAM_ID,
  relayUrl: CLOAK_PRODUCTION_RELAY_URL, nativeMint: NATIVE_SOL_MINT, circuitsVersion: '0.2.0',
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });
function fail(code: string): never { throw new Error(code); }
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const hex = (value: bigint) => value.toString(16).padStart(64, '0');
const byteHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/** Preserve the SDK encoding AND its explicit leaf index, including zero. Never synthesize missing data. */
export async function encodePrivateNote(note: Utxo): Promise<PrivateNote> {
  const commitment = await computeUtxoCommitment(note);
  if (note.commitment !== undefined && note.commitment !== commitment) fail('CLOAK_NOTE_COMMITMENT_MISMATCH');
  const bytes = serializeUtxo(note);
  if (await computeUtxoCommitment(await deserializeUtxo(bytes)) !== commitment) fail('CLOAK_NOTE_CODEC_DIVERGENT');
  return { bytes: b64(bytes), index: note.index ?? null, commitment: hex(commitment) };
}
export async function restorePrivateNote(note: PrivateNote): Promise<Utxo> {
  const restored = await deserializeUtxo(Uint8Array.from(atob(note.bytes), c => c.charCodeAt(0)));
  if (note.index === null) delete restored.index; else restored.index = note.index;
  if (hex(await computeUtxoCommitment(restored)) !== note.commitment) fail('CLOAK_NOTE_COMMITMENT_MISMATCH');
  return restored;
}

/** Preserve the recovery pointer even when actual SDK state differs from the reviewed preparation. */
export class CloakResultDivergence extends Error {
  constructor(readonly recoveryReference: VaultReference) { super('CLOAK_PRIVATE_RESULT_DIVERGENT'); }
}

/** Prepare-only note material so its commitment can enter Review before the final Manifest-linked write. No submission. */
export async function buildCloakPrivateState(input: { identity: PrivateStateIdentity; inputUtxos: Utxo[];
  swapAmount: bigint; viewingKeyNk: Uint8Array }): Promise<PrivateState> {
  const { identity, swapAmount } = input;
  const notes = input.inputUtxos.map(note => ({ ...note, keypair: { ...note.keypair } }));
  const nk = input.viewingKeyNk.slice();
  if (identity.programId !== CLOAK_RUNTIME.programId || identity.genesisHash !== CLOAK_RUNTIME.genesisHash) fail('CLOAK_NETWORK_MISMATCH');
  if (nk.length !== 32 || notes.length < 1 || notes.length > 2 || swapAmount <= 0n || swapAmount > 50_000_000n) fail('CLOAK_SWAP_UNSUPPORTED');
  if (notes.some(n => n.mintAddress !== NATIVE_SOL_MINT || n.amount <= 0n || n.index === undefined)) fail('CLOAK_INPUT_NOTE_UNVERIFIED');
  const change = notes.reduce((sum, n) => sum + n.amount, 0n) - swapAmount;
  if (change <= 0n) fail('CLOAK_PRIVATE_CHANGE_REQUIRED');
  const output = await createRecoverableChangeUtxo(change, notes[0]!.keypair, nk, NATIVE_SOL_MINT, undefined, 0);
  const refund = await deriveSwapRefundAuthorization(nk, await computeUtxoNullifier(notes[0]!));
  const state: PrivateState = { ...identity, format: 'flofi.cloak-private-state.v1', checkpoint: 'prepared',
    inputNotes: await Promise.all(notes.map(encodePrivateNote)), outputNotes: [await encodePrivateNote(output.utxo)],
    refund: { privateKey: hex(refund.privateKey), publicKey: hex(refund.publicKey), blinding: hex(refund.blinding), derivedFromNk: true },
    viewingKeyNk: byteHex(nk), noteSalt: output.noteSalt.toString(), swapStatePda: null, signature: null };
  if (new Set(state.inputNotes.map(n => n.commitment)).size !== state.inputNotes.length) fail('CLOAK_DUPLICATE_INPUT_NOTE');
  return state;
}

/** Prepare and persist actual change and refund authority before any SDK financial operation can run. */
export async function prepareCloakPrivateState(input: { identity: PrivateStateIdentity; inputUtxos: Utxo[];
  swapAmount: bigint; viewingKeyNk: Uint8Array; vault: PrivateStateVault }): Promise<{ reference: VaultReference; state: PrivateState }> {
  const vault = input.vault;
  const state = await buildCloakPrivateState(input);
  return { reference: await vault.save(state), state };
}

/** Capture ALL returned state before anyone considers a public confirmation or a verdict. */
export async function persistCloakResult(vault: PrivateStateVault, prepared: VaultReference, result: UtxoSwapResult): Promise<VaultReference> {
  const prior = await vault.load(prepared);
  const refund: PrivateRefund = { ...result.refund };
  const state: PrivateState = { ...prior, checkpoint: 'result', outputNotes: await Promise.all(result.outputUtxos.map(encodePrivateNote)),
    refund, swapStatePda: result.swapStatePda, signature: result.signature };
  const reference = await vault.save(state);
  // Divergence remains recoverable in the encrypted result checkpoint; it is never replaced with expected state.
  const normalize = (r: PrivateRefund) => JSON.stringify([r.privateKey.replace(/^0x/, ''), r.publicKey.replace(/^0x/, ''), r.blinding.replace(/^0x/, ''), r.derivedFromNk]);
  if (normalize(refund) !== normalize(prior.refund) || !state.outputNotes.some(n => n.commitment === prior.outputNotes[0]!.commitment)) throw new CloakResultDivergence(reference);
  return reference;
}

/** This build must not bypass Flofi's exact simulation/Review boundary to submit through an SDK helper. */
export function assertCloakFinancialExecutionAvailable(): never {
  throw new Error('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE');
}
