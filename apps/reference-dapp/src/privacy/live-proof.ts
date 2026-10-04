// SPDX-License-Identifier: AGPL-3.0-only
/** Browser proof preparation using SDK 0.2.5 primitives and its hash-verified ceremony bytes. Never signs/submits. */
import { groth16, zKey } from 'snarkjs';
import { addressBytes, buildMerkleTreeFromRelay, computeChainNoteHash, computeMerkleRoot, computeUtxoCommitment,
  computeUtxoNullifier, createCloakRpc, createZeroUtxo, deriveChangeNoteBlinding, deriveSwapRefundAuthorization,
  encryptCompactChainNote, chainNoteToBase64, fetchAccountBytes, findProgramAddress, getShieldPoolPDAs,
  loadVerifiedCircuitArtifacts, DEFAULT_TRANSACTION_CIRCUITS_URL, proofToBytes, pubkeyToFieldElement,
  toAddress, verifyUtxos, type CloakRpc } from '@cloak.dev/sdk';
import { CLOAK_RUNTIME, restorePrivateNote } from './cloak-adapter';
import { assertCloakBoundRequest, bytesBase64, cloakSwapExternalDataHash, fieldHex,
  validateCloakProperties, type CloakProperties, type CloakSwapRequest } from './provider-contract';
import { validatePrivateState, type PrivateState } from './vault';

export const CLOAK_READ_RPC = 'https://api.mainnet-beta.solana.com';
export async function cloakOwnerUsdcAta(owner: string): Promise<string> {
  const [ata] = await findProgramAddress([addressBytes(toAddress(owner)), addressBytes(toAddress('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')),
    addressBytes(CLOAK_RUNTIME.usdcMint)], toAddress('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'));
  return ata;
}
export type CloakFeeSnapshot = { fixed: string; numerator: string; denominator: string; fee: string; configHashBytes: string };
const fail = (code: string): never => { throw new Error(code); };
const scalar = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const readField = (b: Uint8Array) => BigInt('0x' + Array.from(b, c => c.toString(16).padStart(2, '0')).join(''));
const fieldBytes = (n: bigint) => Uint8Array.from(fieldHex(n).match(/../g)!, s => parseInt(s, 16));

/** Exact deployed 27-byte PoolConfig layout used by the pinned SDK; no constants standing in for live fees. */
export function decodeCloakFee(data: Uint8Array, gross: bigint): CloakFeeSnapshot {
  if (data.length !== 27 || data[0] !== 1 || data[26] !== 0) fail('CLOAK_POOL_CONFIG_INVALID_OR_PAUSED');
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fixed = v.getBigUint64(2, true), numerator = v.getBigUint64(10, true), denominator = v.getBigUint64(18, true);
  if (!denominator || numerator * 10n > denominator || fixed > 100_000_000n || gross <= 0n) fail('CLOAK_POOL_CONFIG_INVALID_OR_PAUSED');
  const fee = fixed + gross * numerator / denominator;
  if (fee >= gross || fee >= 1n << 64n) fail('CLOAK_PROTOCOL_FEE_INVALID');
  return { fixed: fixed.toString(), numerator: numerator.toString(), denominator: denominator.toString(), fee: fee.toString(), configHashBytes: bytesBase64(data) };
}
export async function readCloakFee(rpc: CloakRpc, gross: bigint): Promise<CloakFeeSnapshot> {
  if (await rpc.getGenesisHash().send() !== CLOAK_RUNTIME.genesisHash) fail('CLOAK_RPC_GENESIS_CHANGED');
  const [config] = await findProgramAddress(['pool_config', addressBytes(CLOAK_RUNTIME.nativeMint)], CLOAK_RUNTIME.programId);
  const account = await fetchAccountBytes(rpc, config, 'finalized');
  if (!account) return fail('CLOAK_POOL_CONFIG_OWNER_INVALID');
  if (account.owner !== CLOAK_RUNTIME.programId || account.executable) fail('CLOAK_POOL_CONFIG_OWNER_INVALID');
  return decodeCloakFee(account.data, gross);
}

export type CloakPreparedProof = { properties: CloakProperties; body: CloakSwapRequest; fee: CloakFeeSnapshot;
  circuitDigests: { wasm: string; zkey: string }; verification: 'GROTH16_VERIFIED'; root: string; paddedNullifiers: string[];
  preparedAt: number; sourceSlot: number; financialTransactionSimulation: 'NOT_PERFORMED' };
const verifiedProofs = new WeakMap<CloakPreparedProof, string>();
export function assertVerifiedCloakProof(proof: CloakPreparedProof): void {
  if (verifiedProofs.get(proof) !== JSON.stringify(proof)) fail('CLOAK_PROOF_PREPARATION_CHANGED');
}

/** Separate pure proving kernel for verified input paths; LIVE wrapper establishes the paths against finalized mainnet reads. */
export async function proveCloakProperties(stateInput: PrivateState, propertiesInput: CloakProperties,
  root: bigint, paths: { pathElements: bigint[]; pathIndices: number }[], artifactsBase = DEFAULT_TRANSACTION_CIRCUITS_URL): Promise<{
    properties: CloakProperties; body: CloakSwapRequest; circuitDigests: { wasm: string; zkey: string }; paddedNullifiers: string[] }> {
  const state = structuredClone(stateInput), p = structuredClone(propertiesInput); validatePrivateState(state); validateCloakProperties(p, Date.now());
  const inputs = await Promise.all(state.inputNotes.map(restorePrivateNote));
  const change = await restorePrivateNote(state.outputNotes[0]!);
  if (state.owner !== p.owner || state.genesisHash !== p.genesisHash || state.programId !== p.programId ||
      state.checkpoint !== 'prepared' || state.outputNotes.length !== 1 || inputs.some(n => n.mintAddress !== p.inputMint || !n.amount || n.index === undefined) ||
      change.mintAddress !== p.inputMint || change.amount.toString() !== p.privateChange.amount ||
      fieldHex(await computeUtxoCommitment(change)) !== p.privateChange.commitment ||
      inputs.reduce((sum, n) => sum + n.amount, 0n) !== BigInt(p.grossInputLamports) + change.amount || paths.length !== inputs.length ||
      root <= 0n || root >= scalar || state.refund.derivedFromNk !== true) fail('CLOAK_PROOF_NOTE_BINDING_INVALID');
  const nk = Uint8Array.from(state.viewingKeyNk.match(/../g)!, h => parseInt(h, 16));
  const salt = BigInt(state.noteSalt);
  if (change.keypair.publicKey !== inputs[0]!.keypair.publicKey || change.blinding !== deriveChangeNoteBlinding(nk, salt, 0))
    fail('CLOAK_PRIVATE_CHANGE_NOT_RECOVERABLE');
  const refund = await deriveSwapRefundAuthorization(nk, await computeUtxoNullifier(inputs[0]!));
  if (fieldHex(refund.publicKey) !== p.refundPublicKey || fieldHex(refund.blinding) !== p.refundBlinding ||
      state.refund.publicKey.replace(/^0x/, '') !== p.refundPublicKey || state.refund.blinding.replace(/^0x/, '') !== p.refundBlinding ||
      state.refund.privateKey.replace(/^0x/, '') !== fieldHex(refund.privateKey)) fail('CLOAK_REFUND_AUTHORITY_CHANGED');
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    if (path.pathElements.length !== 32 || path.pathIndices !== inputs[i]!.index ||
        await computeMerkleRoot(await computeUtxoCommitment(inputs[i]!), path.pathElements,
          Array.from({ length: 32 }, (_, bit) => Math.floor(path.pathIndices / 2 ** bit) % 2)) !== root)
      fail('CLOAK_INPUT_MEMBERSHIP_UNPROVEN');
  }
  // Circuit padding has no economic value. Its real nullifier and commitment still enter the request/Review digest.
  while (inputs.length < 2) { inputs.push(await createZeroUtxo(CLOAK_RUNTIME.nativeMint)); paths = [...paths, { pathElements: Array<bigint>(32).fill(0n), pathIndices: 0 }]; }
  const outputs = [change, await createZeroUtxo(CLOAK_RUNTIME.nativeMint)];
  const nullifiers = await Promise.all(inputs.map(computeUtxoNullifier)), commitments = await Promise.all(outputs.map(computeUtxoCommitment));
  const fundedNullifiers = nullifiers.slice(0, state.inputNotes.length).map(fieldHex);
  if (JSON.stringify(fundedNullifiers) !== JSON.stringify(p.inputNullifiers)) fail('CLOAK_INPUT_NULLIFIER_CHANGED');
  const externalAmount = -BigInt(p.grossInputLamports), extDataHash = await cloakSwapExternalDataHash(p), timestamp = BigInt(p.reviewedAt);
  const chainNoteHash = await computeChainNoteHash(externalAmount, extDataHash, timestamp, commitments[0]!, salt,
    change.amount, change.keypair.publicKey, 0n);
  const witness = { root: root.toString(), publicAmount: externalAmount.toString(), extDataHash: extDataHash.toString(),
    mintAddress: pubkeyToFieldElement(toAddress(p.inputMint)).toString(), inputNullifier: nullifiers.map(String), outputCommitment: commitments.map(String),
    chainNoteHash: chainNoteHash.toString(), inAmount: inputs.map(n => n.amount.toString()), inPrivateKey: inputs.map(n => n.keypair.privateKey.toString()),
    inBlinding: inputs.map(n => n.blinding.toString()), inPathIndices: paths.map(n => n.pathIndices.toString()), inPathElements: paths.map(n => n.pathElements.map(String)),
    outAmount: outputs.map(n => n.amount.toString()), outPubkey: outputs.map(n => n.keypair.publicKey.toString()), outBlinding: outputs.map(n => n.blinding.toString()),
    noteVersion: '4', noteTimestamp: timestamp.toString(), noteCommitment: commitments[0]!.toString(), noteSalt: salt.toString() };
  const artifacts = await loadVerifiedCircuitArtifacts(artifactsBase);
  const { proof, publicSignals } = await groth16.fullProve(witness, artifacts.wasm, artifacts.zkey, undefined, undefined, { singleThread: true });
  const expectedSignals = [root, (scalar + externalAmount) % scalar, extDataHash, pubkeyToFieldElement(toAddress(p.inputMint)),
    ...nullifiers, ...commitments, chainNoteHash].map(String);
  if (JSON.stringify(publicSignals) !== JSON.stringify(expectedSignals) ||
      !await groth16.verify(await zKey.exportVerificationKey(artifacts.zkey), publicSignals, proof)) fail('CLOAK_LOCAL_PROOF_VERIFICATION_FAILED');
  const publicInputs = new Uint8Array(264); publicInputs.set(fieldBytes(root));
  new DataView(publicInputs.buffer).setBigInt64(32, externalAmount, true);
  [extDataHash, pubkeyToFieldElement(toAddress(p.inputMint)), ...nullifiers, ...commitments, chainNoteHash]
    .forEach((n, i) => publicInputs.set(fieldBytes(n), 40 + i * 32));
  const encryptedNote = await encryptCompactChainNote(timestamp, nk, fieldHex(commitments[0]!), salt,
    { outAmount0: change.amount, outPubkey0: change.keypair.publicKey, isSendToSelfKey0: 0n });
  const body: CloakSwapRequest = { proof_bytes: bytesBase64(proofToBytes(proof)), public_inputs: bytesBase64(publicInputs),
    output_mint: p.outputMint, recipient_ata: p.recipientAta, recipient: p.owner, min_output_amount: p.minimumOutput,
    max_fee: p.maximumProtocolFeeLamports, slippage_bps: p.slippageBps, refund_pubkey: bytesBase64(fieldBytes(refund.publicKey)),
    refund_blinding: bytesBase64(fieldBytes(refund.blinding)), encrypted_notes: [chainNoteToBase64(encryptedNote)],
    route_retry_attempts: 0, swap_max_retries: 1 };
  await assertCloakBoundRequest(p, body, Date.now());
  return { properties: p, body, circuitDigests: artifacts.digests, paddedNullifiers: nullifiers.map(fieldHex) };
}

export async function prepareCloakLiveProof(stateInput: PrivateState, propertiesInput: CloakProperties): Promise<CloakPreparedProof> {
  const state = structuredClone(stateInput), properties = structuredClone(propertiesInput);
  if (properties.recipientAta !== await cloakOwnerUsdcAta(properties.owner)) fail('CLOAK_RECIPIENT_ATA_INVALID');
  const rpc = createCloakRpc(CLOAK_READ_RPC), fee = await readCloakFee(rpc, BigInt(properties.grossInputLamports));
  const sourceSlot = Number(await rpc.getSlot({ commitment: 'finalized' }).send());
  if (!Number.isSafeInteger(sourceSlot) || sourceSlot <= 0) fail('CLOAK_FINALIZED_SLOT_UNAVAILABLE');
  if (fee.fee !== properties.maximumProtocolFeeLamports) fail('CLOAK_REVIEWED_FEE_CHANGED');
  const inputs = await Promise.all(state.inputNotes.map(restorePrivateNote)), checked = await verifyUtxos(inputs, rpc, CLOAK_RUNTIME.programId, 'finalized');
  if (checked.spent.length || checked.skipped.length || checked.unspent.length !== inputs.length) fail('CLOAK_INPUT_SPEND_STATE_UNPROVEN');
  const tree = await buildMerkleTreeFromRelay(CLOAK_RUNTIME.relayUrl, { mint: CLOAK_RUNTIME.nativeMint, requireCanonical: true,
    requireTarget: true, maxRetries: 0, waitForIndex: Math.max(...inputs.map(n => n.index!)) });
  const pdas = await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint);
  const account = await fetchAccountBytes(rpc, pdas.merkleTree, 'finalized');
  if (!account || account.owner !== CLOAK_RUNTIME.programId || account.executable || account.data.length < 1096 ||
      readField(account.data.slice(1064, 1096)) !== tree.root()) fail('CLOAK_RELAY_ROOT_NOT_FINALIZED');
  const leaves = tree.leaves();
  if (inputs.some(n => n.index === undefined || leaves[n.index] !== n.commitment)) fail('CLOAK_INPUT_MEMBERSHIP_UNPROVEN');
  const proved = await proveCloakProperties(state, properties, tree.root(), inputs.map(n => tree.path(n.index!)));
  const prepared: CloakPreparedProof = { ...proved, fee, verification: 'GROTH16_VERIFIED', root: fieldHex(tree.root()),
    preparedAt: Date.now(), sourceSlot, financialTransactionSimulation: 'NOT_PERFORMED' };
  verifiedProofs.set(prepared, JSON.stringify(prepared)); return prepared;
}
