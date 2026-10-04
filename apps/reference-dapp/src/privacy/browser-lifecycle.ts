// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/** Local vault + actual SDK preparation. Imported secrets remain in this browser and its encrypted vault. */
import { canonicalJson, computeUtxoNullifier, createCloakRpc } from '@cloak.dev/sdk';
import { readExactInputSwap, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { buildCloakPrivateState, CLOAK_RUNTIME, restorePrivateNote } from './cloak-adapter';
import { checkpointCloakLiveReview, cloakViewingKeyReceipt } from './live-execution';
import { compileCloakLiveReview } from './live-review';
import { CLOAK_READ_RPC, prepareCloakLiveProof, readCloakFee } from './live-proof';
import { CLOAK_ROUTING_DISCLOSURE, fieldHex, type CloakProperties } from './provider-contract';
import { PrivateStateVault, type VaultReference } from './vault';

export async function prepareCloakBrowserReview(vault: PrivateStateVault, imported: VaultReference, workflowInput: SemanticWorkflow,
  minimumOutput: string, recipientAta: string) {
  const workflow = structuredClone(workflowInput), recovered = await vault.load(imported), fields = readExactInputSwap(workflow.nodes[0]!);
  const notes = recovered.checkpoint === 'result' ? recovered.outputNotes : recovered.inputNotes;
  const reservations = await Promise.all(notes.map(n => digestRawResponse(new TextEncoder().encode(JSON.stringify(['note', recovered.genesisHash, recovered.programId, n.commitment])))));
  if (await vault.hasExecutionReservation(reservations)) throw new Error('CLOAK_INPUT_NOTE_RESERVED');
  const inputs = await Promise.all(notes.map(restorePrivateNote));
  const state = await buildCloakPrivateState({ identity: { runId: 'cloak-' + crypto.randomUUID().replaceAll('-', ''), owner: recovered.owner,
    genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + '0'.repeat(64) },
    inputUtxos: inputs, swapAmount: BigInt(fields.amount), viewingKeyNk: Uint8Array.from(recovered.viewingKeyNk.match(/../g)!, h => parseInt(h, 16)) });
  const fee = await readCloakFee(createCloakRpc(CLOAK_READ_RPC), BigInt(fields.amount)), now = Date.now();
  const properties: CloakProperties = { provider: 'cloak', owner: state.owner, genesisHash: state.genesisHash, programId: state.programId,
    inputMint: CLOAK_RUNTIME.nativeMint, outputMint: CLOAK_RUNTIME.usdcMint, grossInputLamports: fields.amount, minimumOutput,
    recipientAta, maximumProtocolFeeLamports: fee.fee,
    privateChange: { commitment: state.outputNotes[0]!.commitment, amount: (inputs.reduce((s, n) => s + n.amount, 0n) - BigInt(fields.amount)).toString(), mint: CLOAK_RUNTIME.nativeMint },
    inputNullifiers: await Promise.all(inputs.map(async n => fieldHex(await computeUtxoNullifier(n)))),
    refundPublicKey: state.refund.publicKey, refundBlinding: state.refund.blinding, slippageBps: fields.slippageBps,
    reviewedAt: now, expiresAt: now + 60_000, routing: CLOAK_ROUTING_DISCLOSURE };
  const proof = await prepareCloakLiveProof(state, properties), { review, auth } = await compileCloakLiveReview(workflow, proof);
  const reference = await vault.save({ ...state, manifestHash: review.manifestHash });
  await checkpointCloakLiveReview(vault, reference, review, proof, auth, workflow);
  const viewingReceipt = await vault.loadExecution(imported, 'execution.viewing');
  if (viewingReceipt !== null) {
    if (canonicalJson(viewingReceipt) !== canonicalJson(await cloakViewingKeyReceipt(state))) throw new Error('CLOAK_VIEWING_REGISTRATION_CHANGED');
    await vault.saveExecution(reference, 'execution.viewing', viewingReceipt);
  }
  return { reference, review, proof, auth, workflow };
}
