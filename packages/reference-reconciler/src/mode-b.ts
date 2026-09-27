// SPDX-License-Identifier: AGPL-3.0-only
/** Independent finite-permission reconciliation from fork reads. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { FORK_CHAIN_ID, parseRlpInteger, rlpBytes, rlpDecode, rlpEncode, rlpInteger, rlpList, toHex } from '@defi-workflow-engine/reference-compiler';

function fail(code: string): never { throw new Error(code); }
function word(value: bigint): Uint8Array {
  if (value <= 0n || value >= 1n << 256n) fail('SIGNATURE_INVALID');
  const bytes = rlpInteger(value);
  const result = new Uint8Array(32); result.set(bytes, 32 - bytes.length); return result;
}
export type ModeBSignedTransaction = { readonly rawHash: string; readonly signer: string; readonly nonce: bigint;
  readonly maxPriorityFeePerGas: bigint; readonly maxFeePerGas: bigint; readonly gasLimit: bigint;
  readonly to: string; readonly data: string };
/**
 * Decode an EIP-1559 transaction mined on the local fork. Mode B binds the signer, chain, target, zero value and exact
 * calldata; the owner's wallet chooses its own fees, so unlike the Mode A exact-payload profile no fee value is fixed.
 */
export function decodeModeBSignedTransaction(raw: Uint8Array, expectedHash: string): ModeBSignedTransaction {
  if (!(raw instanceof Uint8Array) || raw[0] !== 2) fail('TRANSACTION_TYPE_INVALID');
  const rawHash = toHex(keccak_256(raw));
  if (rawHash !== expectedHash) fail('TX_HASH_MISMATCH');
  const fields = rlpList(rlpDecode(raw.subarray(1)));
  if (fields.length !== 12) fail('SIGNED_TRANSACTION_SHAPE');
  if (parseRlpInteger(fields[0]!) !== BigInt(FORK_CHAIN_ID)) fail('CHAIN_MISMATCH');
  const to = rlpBytes(fields[5]!);
  if (to.length !== 20) fail('TARGET_INVALID');
  if (parseRlpInteger(fields[6]!) !== 0n) fail('VALUE_NOT_ZERO');
  if (rlpList(fields[8]!).length !== 0) fail('ACCESS_LIST_INVALID');
  const yParity = parseRlpInteger(fields[9]!);
  if (yParity !== 0n && yParity !== 1n) fail('SIGNATURE_INVALID');
  const unsignedRlp = rlpEncode(fields.slice(0, 9));
  const unsignedBytes = new Uint8Array(1 + unsignedRlp.length);
  unsignedBytes[0] = 2; unsignedBytes.set(unsignedRlp, 1);
  const signingHash = keccak_256(unsignedBytes);
  const signature = secp256k1.Signature.fromBytes(Uint8Array.of(...word(parseRlpInteger(fields[10]!)), ...word(parseRlpInteger(fields[11]!))))
    .addRecoveryBit(Number(yParity));
  const pubkey = signature.recoverPublicKey(signingHash).toBytes(false);
  if (!secp256k1.verify(signature.toBytes('compact'), signingHash, pubkey, { prehash: false })) fail('SIGNATURE_INVALID');
  const reencoded = rlpEncode(fields);
  if (reencoded.length !== raw.length - 1 || reencoded.some((value, index) => value !== raw[index + 1])) fail('SIGNED_TRANSACTION_NON_CANONICAL');
  return { rawHash, signer: toHex(keccak_256(pubkey.subarray(1)).subarray(12)), nonce: parseRlpInteger(fields[1]!),
    maxPriorityFeePerGas: parseRlpInteger(fields[2]!), maxFeePerGas: parseRlpInteger(fields[3]!), gasLimit: parseRlpInteger(fields[4]!),
    to: toHex(to), data: toHex(rlpBytes(fields[7]!)) };
}
export type ModeBChainEvidence = {
  readonly chainId: number; readonly safe: string; readonly roles: string; readonly rolesOwner: string; readonly executor: string; readonly transactionSigner: string;
  readonly target: string; readonly transactionTo: string; readonly transactionInput: string;
  readonly expectedInput: string; readonly safeCodeHash: string; readonly expectedSafeCodeHash: string;
  readonly rolesCodeHash: string; readonly expectedRolesCodeHash: string;
  readonly owner: string; readonly expectedOwner: string; readonly threshold: number;
  readonly moduleEnabled: boolean; readonly roleAssigned: boolean; readonly allowanceRemaining: bigint;
  readonly transactionReceipt: null | { readonly status: 0 | 1; readonly blockHash: string };
  readonly inputDebited: bigint; readonly outputCredited: bigint; readonly amountIn: bigint;
  readonly minimumOut: bigint; readonly residualTokenAllowance: bigint;
};
export type ModeBOutcome = 'INCONCLUSIVE' | 'DIVERGENT' | 'REVERTED' | 'CONFIRMED_NOT_RECONCILED' | 'RECONCILED';
export type ModeBReconciliation = { readonly outcome: ModeBOutcome; readonly reason: string; readonly remainingBudget: string; readonly residualTokenAllowance: string };
export function reconcileModeB(e: ModeBChainEvidence): ModeBReconciliation {
  const result = (outcome: ModeBOutcome, reason: string): ModeBReconciliation => ({ outcome, reason,
    remainingBudget: e.allowanceRemaining.toString(), residualTokenAllowance: e.residualTokenAllowance.toString() });
  if (e.chainId !== 31337 || e.safeCodeHash !== e.expectedSafeCodeHash || e.rolesCodeHash !== e.expectedRolesCodeHash ||
    e.owner.toLowerCase() !== e.expectedOwner.toLowerCase() || e.rolesOwner.toLowerCase() !== e.safe.toLowerCase() ||
    e.transactionSigner.toLowerCase() !== e.executor.toLowerCase() || e.threshold !== 1 ||
    e.transactionTo.toLowerCase() !== e.roles.toLowerCase() || e.transactionInput.toLowerCase() !== e.expectedInput.toLowerCase() ||
    e.target.toLowerCase() !== '0x2626664c2603336e57b271c5c0b26f421741e481') return result('DIVERGENT', 'Authority or transaction bytes differ from review');
  if (!e.transactionReceipt) return result('INCONCLUSIVE', 'No independent receipt yet');
  if (e.transactionReceipt.status === 0) return result('REVERTED', 'Executor transaction reverted');
  if (!e.moduleEnabled || !e.roleAssigned) return result('DIVERGENT', 'Permission changed before reconciliation');
  if (e.allowanceRemaining !== 0n || e.inputDebited !== e.amountIn || e.outputCredited < e.minimumOut) return result('DIVERGENT', 'Budget or token movement does not match the reviewed swap');
  return result('RECONCILED', 'Receipt, effective permission, budget and token movement agree');
}
