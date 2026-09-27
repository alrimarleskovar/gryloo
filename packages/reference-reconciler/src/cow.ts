// SPDX-License-Identifier: AGPL-3.0-only
/** Independent CoW EOA signature and scripted settlement checks. No public-chain claim. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { cowOrderDigest, type CowOrder } from '@defi-workflow-engine/reference-compiler';
export type CowTrade = { readonly uid: string; readonly txHash: string; readonly sellAmount: string; readonly buyAmount: string; readonly feeAmount: string };
export type CowSettlementObservation = {
  readonly environment: 'MOCKED'; readonly uid: string; readonly owner: string; readonly receiver: string;
  readonly receipt: { readonly transactionHash: string; readonly status: 0 | 1; readonly blockHash: string } | null;
  readonly trade: CowTrade | null;
  readonly before: { readonly sell: string; readonly buy: string; readonly allowance: string };
  readonly after: { readonly sell: string; readonly buy: string; readonly allowance: string };
};
export type CowReconciliation = { readonly outcome: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT';
  readonly reason: string; readonly observedSell: string; readonly observedBuy: string; readonly residualAllowance: string };
export function verifyCowDigestSignature(digestHex: string, signature: string, expectedOwner: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(digestHex) || !/^0x[0-9a-f]{130}$/.test(signature) ||
    !/^0x[0-9a-f]{40}$/.test(expectedOwner)) throw new Error('COW_SIGNATURE_INVALID');
  const data = Uint8Array.from(Buffer.from(signature.slice(2, 130), 'hex'));
  const v = Number.parseInt(signature.slice(130), 16);
  if (v !== 27 && v !== 28) throw new Error('COW_SIGNATURE_INVALID');
  const digest = Uint8Array.from(Buffer.from(digestHex.slice(2), 'hex'));
  try {
    const point = secp256k1.Signature.fromBytes(data).addRecoveryBit(v - 27).recoverPublicKey(digest);
    const pub = point.toBytes(false);
    if (!secp256k1.verify(data, digest, pub, { prehash: false })) throw new Error('COW_SIGNATURE_INVALID');
    const signer = '0x' + Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString('hex');
    if (signer !== expectedOwner.toLowerCase()) throw new Error('COW_SIGNER_MISMATCH');
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'COW_SIGNER_MISMATCH') throw cause;
    throw new Error('COW_SIGNATURE_INVALID', { cause });
  }
}
export function verifyCowSignature(order: CowOrder, signature: string, expectedOwner: string): void {
  verifyCowDigestSignature(cowOrderDigest(order), signature, expectedOwner);
}
const native = (value: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('COW_SETTLEMENT_INVALID');
  return BigInt(value);
};
export function reconcileCowSettlement(order: CowOrder, uid: string, owner: string,
  observation: CowSettlementObservation): CowReconciliation {
  const result = (outcome: CowReconciliation['outcome'], reason: string, sell = '0', buy = '0',
    allowance = observation.after.allowance): CowReconciliation =>
    ({ outcome, reason, observedSell: sell, observedBuy: buy, residualAllowance: allowance });
  if (observation.environment !== 'MOCKED' || observation.uid !== uid ||
    observation.owner.toLowerCase() !== owner.toLowerCase() || observation.receiver.toLowerCase() !== order.receiver.toLowerCase())
    return result('DIVERGENT', 'Owner, receiver, UID or environment differs from the signed order');
  if (!observation.receipt || !observation.trade) return result('INCONCLUSIVE', 'Settlement receipt or trade is missing');
  if (observation.receipt.status !== 1 || observation.trade.uid !== uid ||
    observation.trade.txHash !== observation.receipt.transactionHash ||
    !/^0x[0-9a-f]{64}$/.test(observation.receipt.blockHash))
    return result('DIVERGENT', 'Trade and receipt disagree');
  const sold = native(observation.before.sell) - native(observation.after.sell);
  const bought = native(observation.after.buy) - native(observation.before.buy);
  const tradeSell = native(observation.trade.sellAmount);
  const tradeBuy = native(observation.trade.buyAmount);
  const fee = native(observation.trade.feeAmount);
  if (sold < 0n || bought < 0n || tradeSell <= 0n || tradeSell > native(order.sellAmount) ||
    fee !== native(order.feeAmount) || sold !== tradeSell + fee || bought !== tradeBuy ||
    tradeBuy * native(order.sellAmount) < native(order.buyAmount) * tradeSell ||
    native(observation.after.allowance) > native(observation.before.allowance))
    return result('DIVERGENT', 'Balances, fee, allowance or minimum output disagree with the trade');
  return result('RECONCILED', 'Scripted receipt, trade and balance deltas agree', sold.toString(), bought.toString());
}
