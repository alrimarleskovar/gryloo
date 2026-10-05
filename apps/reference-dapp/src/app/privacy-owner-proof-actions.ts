// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/** Only public chain data crosses this boundary. No note, viewing key or vault passphrase is accepted. */
import { createCloakRpc, toAddress, fetchLookupTables, getShieldPoolPDAs } from '@cloak.dev/sdk';
import { base58Encode, decompileMessageV0, fromBase64, parseMessageV0, parseTransaction, sha256Hex, verifyEd25519 } from '@defi-workflow-engine/reference-compiler';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLOAK_RUNTIME } from '../privacy/cloak-adapter';
import { CLOAK_READ_RPC } from '../privacy/live-proof';
import { assertDepositInstructions, type OwnerDepositPreparation } from '../privacy/owner-proof-deposit';
import { ownerProofConfiguration } from '../privacy/owner-proof-configuration';
import { bytesBase64 } from '../privacy/provider-contract';

const methods = new Set(['getGenesisHash', 'getSlot', 'getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash',
  'getBlockHeight', 'getSignaturesForAddress', 'getTransaction', 'getSignatureStatuses', 'getMinimumBalanceForRentExemption',
  'getFeeForMessage', 'simulateTransaction', 'isBlockhashValid']);
export async function readOwnerProofRpc(method: string, args: unknown[]): Promise<unknown> {
  if (!methods.has(method) || !Array.isArray(args) || JSON.stringify(args, (_k, v) => typeof v === 'bigint' ? v.toString() : v).length > 16000)
    throw new Error('CLOAK_OWNER_PROOF_READ_RPC_DENIED');
  if (method === 'simulateTransaction') {
    const wire = fromBase64(args[0]);
    if (wire.length > 1232 || parseTransaction(wire).signatures.some(s => s.some(b => b !== 0))) throw new Error('CLOAK_OWNER_PROOF_SIGNED_SIMULATION_DENIED');
  }
  // The actual SDK RPC and its codecs remain upstream. This bridge never fabricates genesis/account/transaction data.
  const rpc = createCloakRpc(CLOAK_READ_RPC) as unknown as Record<string, (...params: unknown[]) => { send(): Promise<unknown> }>;
  return rpc[method]!(...args).send();
}
export async function broadcastOwnerDeposit(prepared: OwnerDepositPreparation, signedTransaction: string): Promise<string> {
  const configuration = await ownerProofConfiguration();
  if (!configuration.enabled || Date.now() >= configuration.expiresAt || Object.values(configuration.admission).some(v => v !== true))
    throw new Error('CLOAK_OWNER_PROOF_DISABLED');
  const { reviewDigest, ...reviewValue } = prepared;
  const digest = (v: unknown) => digestRawResponse(new TextEncoder().encode(JSON.stringify(v)));
  if (await digest(reviewValue) !== reviewDigest || await digest(prepared.manifest) !== prepared.manifestHash ||
      prepared.manifest.owner !== configuration.owner || prepared.identity.owner !== configuration.owner || prepared.simulation !== 'PASSED' ||
      prepared.manifest.provider !== 'cloak' || prepared.manifest.depositLamports !== '10000000' ||
      prepared.manifest.programId !== CLOAK_RUNTIME.programId || prepared.manifest.genesisHash !== CLOAK_RUNTIME.genesisHash ||
      prepared.manifest.mint !== CLOAK_RUNTIME.nativeMint || prepared.expiresAt <= Date.now() || prepared.manifest.messageDigest !== prepared.messageDigest ||
      prepared.identity.programId !== prepared.manifest.programId || prepared.identity.genesisHash !== prepared.manifest.genesisHash ||
      prepared.identity.manifestHash !== prepared.manifestHash || prepared.manifest.expiresAt !== prepared.expiresAt ||
      prepared.manifest.lastValidBlockHeight !== prepared.lastValidBlockHeight || prepared.manifest.networkFeeLamports !== prepared.networkFeeLamports ||
      prepared.manifest.walletDebitLamports !== prepared.simulatedWalletDebitLamports || prepared.simulatedWalletDebitLamports === null)
    throw new Error('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
  const signed = parseTransaction(fromBase64(signedTransaction)), unsigned = parseTransaction(fromBase64(prepared.unsignedTransaction));
  if (signed.signatures.length !== 1 || unsigned.signatures.length !== 1 || sha256Hex(signed.message) !== prepared.messageDigest ||
      bytesBase64(unsigned.message) !== bytesBase64(signed.message) || unsigned.signatures[0]!.some(b => b !== 0) ||
      !verifyEd25519(signed.signatures[0]!, signed.message, configuration.owner)) throw new Error('CLOAK_DEPOSIT_WALLET_TRANSACTION_CHANGED');
  const message = parseMessageV0(signed.message);
  if (message.staticKeys[0] !== configuration.owner || message.header[0] !== 1) throw new Error('CLOAK_DEPOSIT_OWNER_CHANGED');
  const rpc = createCloakRpc(CLOAK_READ_RPC), tables = await fetchLookupTables(rpc, message.lookups.map(l => toAddress(l.table)));
  if (prepared.manifest.pool !== (await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint)).pool)
    throw new Error('CLOAK_DEPOSIT_RECIPIENT_CHANGED');
  assertDepositInstructions(decompileMessageV0(message, Object.fromEntries(tables.map(t => [t.address, t.addresses]))), prepared.manifest);
  if (await rpc.getGenesisHash().send() !== CLOAK_RUNTIME.genesisHash || await rpc.getBlockHeight({ commitment: 'confirmed' }).send() > BigInt(prepared.lastValidBlockHeight))
    throw new Error('CLOAK_DEPOSIT_REVIEW_EXPIRED');
  const fee = await rpc.getFeeForMessage(bytesBase64(signed.message) as Parameters<typeof rpc.getFeeForMessage>[0], { commitment: 'confirmed' }).send();
  if (fee.value?.toString() !== prepared.networkFeeLamports) throw new Error('CLOAK_DEPOSIT_REVIEWED_FEE_CHANGED');
  const balance = (await rpc.getAccountInfo(toAddress(configuration.owner), { encoding: 'base64', commitment: 'confirmed' }).send()).value?.lamports ?? 0n;
  const simulation = await rpc.simulateTransaction(prepared.unsignedTransaction as Parameters<typeof rpc.sendTransaction>[0], {
    encoding: 'base64', sigVerify: false, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [toAddress(configuration.owner)] } }).send();
  const after = simulation.value.accounts?.[0]?.lamports;
  if (simulation.value.err !== null || after == null || (balance - after).toString() !== prepared.simulatedWalletDebitLamports)
    throw new Error('CLOAK_DEPOSIT_PREFLIGHT_OR_REVIEWED_COST_CHANGED');
  const signature = base58Encode(signed.signatures[0]!);
  // Public submission journal is independent of the browser vault and survives server restart. One owner-proof attempt forever.
  const directory = resolve(process.cwd(), '../../.turbo/privacy-owner-proof-broadcast'); await mkdir(directory, { recursive: true });
  let journal;
  try { journal = await open(resolve(directory, configuration.owner + '.json'), 'wx', 0o600); }
  catch { throw new Error('CLOAK_DEPOSIT_DUPLICATE_SUBMISSION_DENIED'); }
  try {
    await journal.writeFile(JSON.stringify({ signature, messageDigest: prepared.messageDigest, manifestHash: prepared.manifestHash,
      reviewDigest, submissionCount: 1, state: 'SUBMISSION_OUTCOME_UNKNOWN' })); await journal.sync();
  } finally { await journal.close(); }
  const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
  if (Date.now() >= prepared.expiresAt || Date.now() >= configuration.expiresAt) throw new Error('CLOAK_DEPOSIT_REVIEW_EXPIRED');
  return rpc.sendTransaction(signedTransaction as Parameters<typeof rpc.sendTransaction>[0], {
    encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0n }).send();
}
