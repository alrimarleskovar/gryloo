// SPDX-License-Identifier: AGPL-3.0-only
/** SDK-owned proof/transaction preparation. The SDK receives a capture-only signer and read-only RPC. */
import { createCloakRpc, createRecoverableDepositUtxo, createZeroUtxo, fetchLookupTables, getShieldPoolPDAs,
  MIN_DEPOSIT_LAMPORTS, pubkeyToFieldElement, toAddress, transact, transactionBytes, type signCompiledTransaction, type CloakRpc, type LookupTable } from '@cloak.dev/sdk';
import { base58Encode, decompileMessageV0, fromBase64, parseMessageV0, parseTransaction, sha256Hex,
  verifyEd25519, type SolanaInstruction } from '@defi-workflow-engine/reference-compiler';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { CLOAK_RUNTIME, encodePrivateNote, restorePrivateNote } from './cloak-adapter';
import { CLOAK_READ_RPC } from './live-proof';
import { bytesBase64 } from './provider-contract';
import { guardPrivacyWallet } from './wallet-guard';
import { signWithSolanaWallet, type SolanaSession } from '../wallet/solana-wallet';
import { PrivateStateVault, type PrivateNote, type PrivateStateIdentity } from './vault';
import { assertOwnerDepositPermit, type OwnerDepositPermit } from './owner-proof-gate';
import { ownerDepositReadRpc } from './owner-proof-rpc';
import { broadcastOwnerDeposit, reserveOwnerDepositSignature } from '../app/privacy-owner-proof-actions';
import { OWNER_PROOF_RESIDUAL_LABEL, sameOwnerProofScope, type OwnerProofAcceptance } from './owner-proof-residuals';

const fail = (code: string): never => { throw new Error(code); };
const preparationBrands = new WeakMap<OwnerDepositPreparation, string>();
const digest = (value: unknown) => digestRawResponse(new TextEncoder().encode(JSON.stringify(value)));
const messageBase64 = (value: string) => value as Parameters<CloakRpc['getFeeForMessage']>[0];
const wireBase64 = (value: string) => value as Parameters<CloakRpc['sendTransaction']>[0];
export type OwnerDepositManifest = {
  format: 'flofi.cloak-owner-deposit-manifest.v1'; owner: string; provider: 'cloak'; genesisHash: string; programId: string;
  mint: string; pool: string; depositLamports: '10000000'; outputCommitment: string; nonce: string;
  messageDigest?: string; networkFeeLamports?: string; walletDebitLamports?: string | null; expiresAt?: number; lastValidBlockHeight?: string;
};
export type OwnerDepositPreparation = { identity: PrivateStateIdentity; manifest: OwnerDepositManifest; manifestHash: string;
  reviewDigest: string; unsignedTransaction: string; messageDigest: string; networkFeeLamports: string;
  simulatedWalletDebitLamports: string | null; simulation: 'PASSED' | 'INSUFFICIENT_FUNDS'; expiresAt: number;
  lastValidBlockHeight: string; lookupTables: LookupTable[] };
type DepositCheckpoint = { format: 'flofi.cloak-owner-deposit-prepared.v1'; manifest: OwnerDepositManifest;
  note: PrivateNote; outputUtxos: PrivateNote[]; viewingKeyNk: string; noteSalt: string };
const readonlyMethods = new Set(['getGenesisHash', 'getSlot', 'getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash',
  'getBlockHeight', 'getSignaturesForAddress', 'getTransaction', 'getSignatureStatuses', 'getMinimumBalanceForRentExemption',
  'getFeeForMessage', 'simulateTransaction', 'isBlockhashValid']);
/** A SDK convenience function cannot send a transaction, even if it changes its signing order. */
export function readOnlyDepositRpc(rpc: CloakRpc): CloakRpc {
  return new Proxy(rpc, { get(target, key) {
    if (key === 'endpoint') return CLOAK_READ_RPC;
    if (key === 'rpcEndpoint' || key === '_rpcEndpoint') return undefined;
    if (typeof key !== 'string' || !readonlyMethods.has(key)) return () => fail('CLOAK_PREPARATION_FINANCIAL_RPC_DENIED');
    return Reflect.get(target, key);
  } });
}
export function assertDepositInstructions(instructions: SolanaInstruction[], manifest: OwnerDepositManifest): void {
  const calls = instructions.filter(ix => ix.programId === manifest.programId);
  if (calls.length !== 1 || instructions.some(ix => ![manifest.programId, 'Ed25519SigVerify111111111111111111111111111',
    'ComputeBudget111111111111111111111111111111'].includes(ix.programId))) fail('CLOAK_DEPOSIT_EXTRA_TRANSACTION_REQUIRED');
  const ix = calls[0]!, data = ix.data;
  if (data.length < 521 || data[0] !== 0 || ix.accounts[0]?.pubkey !== manifest.owner || !ix.accounts[0]?.isSigner ||
      ix.accounts[1]?.pubkey !== manifest.pool || new DataView(data.buffer, data.byteOffset + 289, 8).getBigInt64(0, true).toString() !== manifest.depositLamports ||
      BigInt('0x' + Array.from(data.slice(329, 361), b => b.toString(16).padStart(2, '0')).join('')) !== pubkeyToFieldElement(CLOAK_RUNTIME.nativeMint) ||
      Array.from(data.slice(425, 457), b => b.toString(16).padStart(2, '0')).join('') !== manifest.outputCommitment)
    fail('CLOAK_DEPOSIT_TRANSACTION_CHANGED');
  if (!instructions.some(ix => ix.programId === 'Ed25519SigVerify111111111111111111111111111')) fail('CLOAK_DEPOSIT_RISK_QUOTE_REQUIRED');
}
/** Fresh recoverable note is encrypted BEFORE SDK proving. No Wallet Standard feature is called. */
export async function prepareOwnerDeposit(vault: PrivateStateVault, owner: string): Promise<OwnerDepositPreparation> {
  toAddress(owner); const rpc = ownerDepositReadRpc();
  if (await rpc.getGenesisHash().send() !== CLOAK_RUNTIME.genesisHash) fail('CLOAK_RPC_GENESIS_CHANGED');
  if (MIN_DEPOSIT_LAMPORTS !== 10_000_000) fail('CLOAK_DEPOSIT_MINIMUM_CHANGED');
  const nk = crypto.getRandomValues(new Uint8Array(32));
  const { utxo, noteSalt } = await createRecoverableDepositUtxo(BigInt(MIN_DEPOSIT_LAMPORTS), nk, CLOAK_RUNTIME.nativeMint);
  // Supply both actual SDK outputs ourselves so its padded result has no unknown/unpersisted note, even the zero-value slot.
  const outputs = [utxo, await createZeroUtxo(CLOAK_RUNTIME.nativeMint)];
  const note = await encodePrivateNote(utxo), pdas = await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint);
  const manifest: OwnerDepositManifest = { format: 'flofi.cloak-owner-deposit-manifest.v1', owner, provider: 'cloak',
    genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId, mint: CLOAK_RUNTIME.nativeMint, pool: pdas.pool,
    depositLamports: '10000000', outputCommitment: note.commitment, nonce: crypto.randomUUID() };
  const manifestHash = await digest(manifest), identity: PrivateStateIdentity = { owner, genesisHash: manifest.genesisHash,
    programId: manifest.programId, runId: 'cloak-' + crypto.randomUUID().replaceAll('-', ''), manifestHash };
  const checkpoint: DepositCheckpoint = { format: 'flofi.cloak-owner-deposit-prepared.v1', manifest, note,
    outputUtxos: await Promise.all(outputs.map(encodePrivateNote)),
    viewingKeyNk: Array.from(nk, b => b.toString(16).padStart(2, '0')).join(''), noteSalt: noteSalt.toString() };
  await vault.saveExecution(identity, 'execution.journal.1', checkpoint);
  let captured: Uint8Array | undefined, lifetime: string | undefined;
  // The SDK reaches this hook instead of a wallet. Abort: never return a signature or let its transport/retry loop run.
  const captureOnlySigner = { address: toAddress(owner), signTransactions: async (transactions: Parameters<Parameters<typeof signCompiledTransaction>[0]['signTransactions']>[0]): Promise<never> => {
    if (captured || transactions.length !== 1) fail('CLOAK_DEPOSIT_MULTIPLE_TRANSACTIONS_DENIED');
    captured = transactionBytes(transactions[0]!);
    const constraint = transactions[0]!.lifetimeConstraint;
    if ('lastValidBlockHeight' in constraint) lifetime = constraint.lastValidBlockHeight.toString();
    return fail('CLOAK_DEPOSIT_CAPTURE_ONLY');
  } };
  try {
    await transact({ inputUtxos: [], outputUtxos: outputs, externalAmount: BigInt(MIN_DEPOSIT_LAMPORTS) }, {
      connection: readOnlyDepositRpc(rpc), programId: CLOAK_RUNTIME.programId, signer: captureOnlySigner,
      walletPublicKey: toAddress(owner), relayUrl: CLOAK_RUNTIME.relayUrl, maxRootRetries: 0, transactionVersion: 0,
      chainNoteViewingKeyNk: nk, chainNoteSalt: noteSalt, expectedMint: CLOAK_RUNTIME.nativeMint,
      // Preparation needs no off-chain viewing registration. A deposit publishes a self-recoverable encrypted note.
      enforceViewingKeyRegistration: false,
    });
  } catch (error) {
    if (!captured) {
      // Expose only an allowlisted failure category, never a SDK witness or arbitrary provider response.
      const message = error instanceof Error ? error.message : '';
      const category = /ENOENT/.test(message) ? 'ARTIFACT_MISSING' : /RPC|rpc/.test(message) ? 'RPC' : /quote/i.test(message) ? 'RISK_QUOTE' :
        /circuit|proof/i.test(message) ? 'PROOF' : /viewing/i.test(message) ? 'VIEWING' : 'SDK';
      fail('CLOAK_DEPOSIT_SDK_PREPARATION_FAILED_' + category);
    }
  }
  if (!captured || !lifetime) return fail('CLOAK_DEPOSIT_SDK_PREPARATION_FAILED');
  if (captured.length > 1232) fail('CLOAK_DEPOSIT_EXTRA_TRANSACTION_REQUIRED');
  const parsed = parseTransaction(captured);
  if (parsed.signatures.length !== 1 || parsed.signatures[0]!.some(b => b !== 0)) fail('CLOAK_DEPOSIT_SIGNATURE_BEFORE_REVIEW');
  const message = parseMessageV0(parsed.message);
  if (message.header[0] !== 1 || message.staticKeys[0] !== owner) fail('CLOAK_DEPOSIT_OWNER_CHANGED');
  const lookupTables = await fetchLookupTables(rpc, message.lookups.map(l => toAddress(l.table)));
  const instructions = decompileMessageV0(message, Object.fromEntries(lookupTables.map(t => [t.address, t.addresses])));
  assertDepositInstructions(instructions, manifest);
  const fee = await rpc.getFeeForMessage(messageBase64(bytesBase64(parsed.message)), { commitment: 'confirmed' }).send();
  if (fee.value === null || fee.value < 0n) fail('CLOAK_DEPOSIT_FEE_UNAVAILABLE');
  const preBalance = (await rpc.getAccountInfo(toAddress(owner), { encoding: 'base64', commitment: 'confirmed' }).send()).value?.lamports ?? 0n;
  const simulation = await rpc.simulateTransaction(wireBase64(bytesBase64(captured)), { encoding: 'base64', sigVerify: false, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: [toAddress(owner)] } }).send();
  const simulationError = JSON.stringify(simulation.value.err, (_k, v) => typeof v === 'bigint' ? v.toString() : v);
  const insufficient = simulationError.includes('InsufficientFunds');
  if (simulation.value.err !== null && !insufficient) {
    const code = simulationError.match(/"Custom":"?([0-9]{1,10})"?/)?.[1];
    fail('CLOAK_DEPOSIT_PREFLIGHT_FAILED' + (code ? '_PROGRAM_' + code : ''));
  }
  const postBalance = simulation.value.accounts?.[0]?.lamports;
  const expiresAt = Date.now() + 60_000;
  const debit = simulation.value.err === null && postBalance != null ? (preBalance - postBalance).toString() : null;
  const boundManifest: OwnerDepositManifest = { ...manifest, messageDigest: sha256Hex(parsed.message), networkFeeLamports: fee.value!.toString(),
    walletDebitLamports: debit, expiresAt, lastValidBlockHeight: lifetime };
  const boundHash = await digest(boundManifest), boundIdentity = { ...identity, manifestHash: boundHash };
  await vault.saveExecution(boundIdentity, 'execution.prepared', { ...checkpoint, manifest: boundManifest });
  const reviewValue = { identity: boundIdentity, manifest: boundManifest, manifestHash: boundHash, unsignedTransaction: bytesBase64(captured), messageDigest: sha256Hex(parsed.message),
    networkFeeLamports: fee.value!.toString(), simulatedWalletDebitLamports: simulation.value.err === null && postBalance != null ? (preBalance - postBalance).toString() : null,
    simulation: insufficient ? 'INSUFFICIENT_FUNDS' as const : 'PASSED' as const, expiresAt,
    lastValidBlockHeight: lifetime, lookupTables };
  const result = { ...reviewValue, reviewDigest: await digest(reviewValue) };
  await vault.saveExecution(boundIdentity, 'execution.journal.0', result);
  preparationBrands.set(result, JSON.stringify(result)); return result;
}

export async function submitOwnerDeposit(vault: PrivateStateVault, prepared: OwnerDepositPreparation, permit: OwnerDepositPermit,
  session: SolanaSession, acknowledgedDigest: string): Promise<{ state: 'RECOVERY_REQUIRED'; signature: string }> {
  assertOwnerDepositPermit(permit, prepared, session.account.address, acknowledgedDigest);
  if (preparationBrands.get(prepared) !== JSON.stringify(prepared) || prepared.simulation !== 'PASSED') fail('CLOAK_DEPOSIT_PREFLIGHT_REQUIRED');
  const guard = guardPrivacyWallet(session);
  try {
    guard.assertCurrent(); const checkpoint = await vault.loadExecution(prepared.identity, 'execution.prepared') as DepositCheckpoint | null;
    if (!checkpoint || await digest(checkpoint.manifest) !== prepared.manifestHash || await vault.loadExecution(prepared.identity, 'execution.restore') !== null ||
        await vault.loadExecution(prepared.identity, 'execution.intent') !== null) fail('CLOAK_DEPOSIT_REPLAY_OR_CHECKPOINT_CHANGED');
    const rpc = ownerDepositReadRpc();
    if (await rpc.getGenesisHash().send() !== prepared.manifest.genesisHash || await rpc.getBlockHeight({ commitment: 'finalized' }).send() > BigInt(prepared.lastValidBlockHeight))
      fail('CLOAK_DEPOSIT_REVIEW_EXPIRED');
    const fee = await rpc.getFeeForMessage(messageBase64(bytesBase64(parseTransaction(fromBase64(prepared.unsignedTransaction)).message)), { commitment: 'confirmed' }).send();
    if (fee.value?.toString() !== prepared.networkFeeLamports) fail('CLOAK_DEPOSIT_REVIEWED_FEE_CHANGED');
    const balance = (await rpc.getAccountInfo(toAddress(session.account.address), { encoding: 'base64', commitment: 'confirmed' }).send()).value?.lamports ?? 0n;
    const preflight = await rpc.simulateTransaction(wireBase64(prepared.unsignedTransaction), { encoding: 'base64', sigVerify: false,
      commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [toAddress(session.account.address)] } }).send();
    const remaining = preflight.value.accounts?.[0]?.lamports;
    if (preflight.value.err !== null || remaining == null || (balance - remaining).toString() !== prepared.simulatedWalletDebitLamports)
      fail('CLOAK_DEPOSIT_PREFLIGHT_OR_REVIEWED_COST_CHANGED');
    assertOwnerDepositPermit(permit, prepared, session.account.address, acknowledgedDigest); guard.assertCurrent();
    // The intent records the dependency admission (or owner-accepted residual risk) this signature is authorized under.
    await vault.saveExecution(prepared.identity, 'execution.intent', { reviewDigest: prepared.reviewDigest, messageDigest: prepared.messageDigest,
      dependencyAdmission: permit.dependencyAdmission },
      [await digest(['deposit', prepared.manifest.owner, prepared.manifest.outputCommitment]), await digest(['deposit-nonce', prepared.manifest.owner, prepared.manifest.nonce]),
        await digest(['owner-mainnet-proof-deposit', prepared.manifest.owner, prepared.manifest.genesisHash, prepared.manifest.programId])]);
    // Server-side one-shot reservation: a refused or failed reservation means the wallet is never opened.
    await reserveOwnerDepositSignature(prepared);
    assertOwnerDepositPermit(permit, prepared, session.account.address, acknowledgedDigest); guard.assertCurrent();
    const signed = await signWithSolanaWallet(session, prepared.unsignedTransaction, 'CLOAK_DEPOSIT'); guard.assertCurrent();
    assertOwnerDepositPermit(permit, prepared, session.account.address, acknowledgedDigest);
    const parsed = parseTransaction(fromBase64(signed));
    if (parsed.signatures.length !== 1 || sha256Hex(parsed.message) !== prepared.messageDigest ||
        !verifyEd25519(parsed.signatures[0]!, parsed.message, session.account.address)) fail('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED');
    const signature = base58Encode(parsed.signatures[0]!);
    await vault.saveExecution(prepared.identity, 'execution.signed', { signature, signedTransaction: signed, reviewDigest: prepared.reviewDigest });
    // Persist a one-shot handoff BEFORE the RPC. All restarts after intent are inspection-only.
    await vault.saveExecution(prepared.identity, 'execution.handoff', { signature, submissionCount: 1, state: 'SUBMISSION_OUTCOME_UNKNOWN' });
    assertOwnerDepositPermit(permit, prepared, session.account.address, acknowledgedDigest); guard.assertCurrent();
    try {
      const returned = await broadcastOwnerDeposit(prepared, signed);
      await vault.saveExecution(prepared.identity, 'execution.submitted', { signature, returnedSignature: returned, matches: returned === signature });
    } catch { /* Expected signature is durable; never sign/resend because the response was lost. */ }
    return { state: 'RECOVERY_REQUIRED', signature };
  } finally { guard.close(); }
}

/** Public dependency basis recorded with the signature intent and exported evidence. A residual is never release admission. */
export function depositDependencyEvidence(admission: OwnerProofAcceptance | null | undefined, owner: string) {
  const dependencyAdmission = admission ?? null;
  if (dependencyAdmission && (dependencyAdmission.status !== OWNER_PROOF_RESIDUAL_LABEL || !sameOwnerProofScope(dependencyAdmission.scope) ||
      dependencyAdmission.scope.owner !== owner)) fail('CLOAK_DEPOSIT_AUTHORIZATION_CHECKPOINT_MISSING');
  return { dependencyStatus: dependencyAdmission ? OWNER_PROOF_RESIDUAL_LABEL : 'ALL UNCHANGED GATES ADMITTED', dependencyAdmission };
}
/** Exposes no wallet authority. A deposited note is complete only after authenticated reload and finalized chain membership. */
export async function recoverOwnerDeposit(vault: PrivateStateVault, identity: PrivateStateIdentity) {
  const p = await vault.loadExecution(identity, 'execution.prepared') as DepositCheckpoint | null;
  const review = await vault.loadExecution(identity, 'execution.journal.0') as OwnerDepositPreparation | null;
  const signed = await vault.loadExecution(identity, 'execution.signed') as { signature: string; signedTransaction: string; reviewDigest: string } | null;
  if (!p || !review || await digest(p.manifest) !== identity.manifestHash || p.manifest.owner !== identity.owner ||
      identity.programId !== CLOAK_RUNTIME.programId || identity.genesisHash !== CLOAK_RUNTIME.genesisHash) return fail('CLOAK_DEPOSIT_CHECKPOINT_INVALID');
  const { reviewDigest, ...reviewValue } = review;
  if (await digest(reviewValue) !== reviewDigest || JSON.stringify(review.identity) !== JSON.stringify(identity) ||
      JSON.stringify(review.manifest) !== JSON.stringify(p.manifest) || review.messageDigest !== p.manifest.messageDigest ||
      p.note.commitment !== p.manifest.outputCommitment || p.manifest.depositLamports !== '10000000' || p.manifest.provider !== 'cloak' ||
      !Array.isArray(p.outputUtxos) || p.outputUtxos.length !== 2 || JSON.stringify(p.outputUtxos[0]) !== JSON.stringify(p.note))
    fail('CLOAK_DEPOSIT_CHECKPOINT_INVALID');
  if (!signed) return { state: 'RECOVERY_REQUIRED' as const, reason: 'CLOAK_DEPOSIT_SIGNATURE_CHECKPOINT_MISSING' };
  const intent = await vault.loadExecution(identity, 'execution.intent') as { reviewDigest?: string; messageDigest?: string;
    dependencyAdmission?: OwnerProofAcceptance | null } | null;
  const handoff = await vault.loadExecution(identity, 'execution.handoff') as { signature?: string; submissionCount?: number } | null;
  if (intent?.reviewDigest !== review.reviewDigest || intent?.messageDigest !== review.messageDigest ||
      handoff?.signature !== signed.signature || handoff?.submissionCount !== 1) fail('CLOAK_DEPOSIT_AUTHORIZATION_CHECKPOINT_MISSING');
  const dependency = depositDependencyEvidence(intent?.dependencyAdmission, identity.owner);
  const tx = parseTransaction(fromBase64(signed!.signedTransaction));
  if (tx.signatures.length !== 1 || sha256Hex(tx.message) !== review.messageDigest || signed.reviewDigest !== review.reviewDigest ||
      base58Encode(tx.signatures[0]!) !== signed.signature || !verifyEd25519(tx.signatures[0]!, tx.message, identity.owner)) fail('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED');
  const rpc = ownerDepositReadRpc();
  if (await rpc.getGenesisHash().send() !== identity.genesisHash) fail('CLOAK_RPC_GENESIS_CHANGED');
  const observed = await rpc.getTransaction(toAddressSignature(signed.signature), { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }).send();
  if (!observed || observed.meta?.err !== null || observed.transaction[0] !== signed.signedTransaction) return { state: 'RECOVERY_REQUIRED' as const, reason: 'CLOAK_DEPOSIT_FINALIZED_TRANSACTION_UNPROVEN', signature: signed.signature };
  const { buildMerkleTreeFromRelay, fetchAccountBytes, verifyUtxos, matchDepositNote } = await import('@cloak.dev/sdk');
  const tree = await buildMerkleTreeFromRelay(CLOAK_RUNTIME.relayUrl, { mint: CLOAK_RUNTIME.nativeMint, requireCanonical: true, maxRetries: 0 });
  const pdas = await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint), account = await fetchAccountBytes(rpc, pdas.merkleTree, 'finalized');
  const root = account && BigInt('0x' + Array.from(account.data.slice(1064, 1096), b => b.toString(16).padStart(2, '0')).join(''));
  const note = await restorePrivateNote(p.note), indices = tree.leaves().flatMap((leaf, index) => leaf === note.commitment ? [index] : []);
  const outputs = await Promise.all(p.outputUtxos.map(restorePrivateNote));
  const instructions = decompileMessageV0(parseMessageV0(tx.message), Object.fromEntries(review.lookupTables.map(t => [t.address, t.addresses])));
  assertDepositInstructions(instructions, p.manifest);
  const data = instructions.find(ix => ix.programId === identity.programId)!.data;
  for (const [index, output] of outputs.entries()) {
    const matches = tree.leaves().flatMap((leaf, i) => leaf === output.commitment ? [i] : []);
    const commitment = Array.from(data.slice(425 + index * 32, 457 + index * 32), b => b.toString(16).padStart(2, '0')).join('');
    if (matches.length !== 1 || commitment !== p.outputUtxos[index]!.commitment || output.mintAddress !== CLOAK_RUNTIME.nativeMint ||
        output.amount !== (index === 0 ? 10_000_000n : 0n)) fail('CLOAK_DEPOSIT_NOTE_RECONCILIATION_FAILED');
    output.index = matches[0]!;
  }
  const recovered = await matchDepositNote({ viewingKeyNk: Uint8Array.from(p.viewingKeyNk.match(/../g)!, h => parseInt(h, 16)), noteSalt: BigInt(p.noteSalt),
    amount: BigInt(p.manifest.depositLamports), mintAddress: CLOAK_RUNTIME.nativeMint, outputCommitments: [p.note.commitment] });
  if (!account || account.owner !== identity.programId || account.executable || account.data.length < 1096 || root !== tree.root() ||
      indices.length !== 1 || !recovered || recovered.commitment !== note.commitment) fail('CLOAK_DEPOSIT_NOTE_RECONCILIATION_FAILED');
  note.index = indices[0]!; const spend = await verifyUtxos([note], rpc, CLOAK_RUNTIME.programId, 'finalized');
  if (spend.unspent.length !== 1 || spend.spent.length || spend.skipped.length) fail('CLOAK_DEPOSIT_NOTE_RECONCILIATION_FAILED');
  const result = { format: 'flofi.cloak-owner-deposit-result.v1', outputUtxos: await Promise.all(outputs.map(encodePrivateNote)), signature: signed.signature,
    slot: Number(observed.slot), blockTime: observed.blockTime == null ? null : Number(observed.blockTime), manifestHash: identity.manifestHash,
    reviewDigest: review.reviewDigest, submissionCount: 1, reconciliation: 'RECONCILED' as const };
  const prior = await vault.loadExecution(identity, 'execution.reconciled');
  if (prior === null) await vault.saveExecution(identity, 'execution.reconciled', result);
  else if (JSON.stringify(prior) !== JSON.stringify(result)) fail('CLOAK_DEPOSIT_RESULT_DIVERGENT');
  const reload = await vault.loadExecution(identity, 'execution.reconciled') as typeof result;
  if (JSON.stringify(reload.outputUtxos) !== JSON.stringify(result.outputUtxos)) fail('CLOAK_DEPOSIT_RESULT_DIVERGENT');
  // A public evidence object is constructed from an allowlist, not from SDK result/outputUtxos.
  return { state: 'RECONCILED' as const, environment: 'OWNER_MAINNET_PROOF', provider: 'cloak', owner: identity.owner,
    programId: identity.programId, genesisHash: identity.genesisHash, depositLamports: p.manifest.depositLamports,
    commitment: p.manifest.outputCommitment, signature: result.signature, explorer: `https://explorer.solana.com/tx/${result.signature}`,
    slot: result.slot, blockTime: result.blockTime, manifestHash: result.manifestHash, reviewDigest: result.reviewDigest,
    submissionCount: 1, encryptedOutputUtxosReloadVerified: true, ...dependency };
}
// RPC's branded signature type is structurally a string; validating the wire signature above supplies its provenance.
const toAddressSignature = (value: string) => value as Parameters<ReturnType<typeof createCloakRpc>['getTransaction']>[0];
