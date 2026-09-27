// SPDX-License-Identifier: AGPL-3.0-only
/** Pure CoW order lifecycle and durable-posting boundary. No network or key is owned here. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { verifyCowForPosting, type CowCompiled, type CowQuote } from '@defi-workflow-engine/reference-compiler';

export type CowOrderState = 'REVIEWED' | 'SIGNED' | 'POSTING' | 'POST_RESULT_UNKNOWN' | 'POSTED' |
  'OPEN' | 'PARTIALLY_FILLED' | 'FULFILLED' | 'EXPIRED' | 'CANCEL_REQUESTED' | 'CANCELLED' |
  'RECONCILIATION_REQUIRED' | 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT';
export type CowOrderbookStatus = 'open' | 'partiallyFilled' | 'fulfilled' | 'expired' | 'cancelled';
export type CowOrderbookView = { readonly uid: string; readonly status: CowOrderbookStatus;
  readonly executedSellAmount: string; readonly executedBuyAmount: string;
  readonly observedAt: string };
export type CowSignedOrder = { readonly uid: string; readonly owner: string; readonly signature: string;
  readonly signingScheme: 'eip712'; readonly compiled: CowCompiled };
export interface CowOrderbookTransport {
  post(order: CowSignedOrder): Promise<{ readonly uid: string }>;
  lookup(uid: string): Promise<CowOrderbookView | null>;
  cancel(uid: string, signature: string): Promise<{ readonly accepted: boolean }>;
}
export type CowPostingRecord = { readonly executionId: string; readonly state: CowOrderState;
  readonly quote: CowQuote; readonly compiled: CowCompiled; readonly signature: string | null;
  readonly postingAttemptId: string | null; readonly postCount: number; readonly observed: CowOrderbookView | null;
  readonly cancellationSignature: string | null; readonly history: readonly { readonly state: CowOrderState; readonly at: string }[] };
export const initialCowRecord = (executionId: string, quote: CowQuote, compiled: CowCompiled, at: string): CowPostingRecord =>
  ({ executionId, state: 'REVIEWED', quote, compiled, signature: null, postingAttemptId: null,
    postCount: 0, observed: null, cancellationSignature: null, history: [{ state: 'REVIEWED', at }] });
export function transitionCow(record: CowPostingRecord, state: CowOrderState, at: string, patch: Partial<CowPostingRecord> = {}): CowPostingRecord {
  if (record.state === state && Object.keys(patch).length === 0) return record;
  if (['RECONCILED', 'DIVERGENT', 'CANCELLED', 'EXPIRED'].includes(record.state) &&
    !['RECONCILIATION_REQUIRED', 'DIVERGENT'].includes(state)) throw new Error('COW_TERMINAL_STATE');
  return { ...record, ...patch, state, history: [...record.history, { state, at }] };
}
export function cowStatus(record: CowPostingRecord, observed: CowOrderbookView, at: string): CowPostingRecord {
  if (!observed || typeof observed !== 'object' ||
    !['open', 'partiallyFilled', 'fulfilled', 'expired', 'cancelled'].includes(observed.status) ||
    typeof observed.observedAt !== 'string' || !Number.isFinite(Date.parse(observed.observedAt)) ||
    Object.keys(observed).sort().join(',') !== 'executedBuyAmount,executedSellAmount,observedAt,status,uid' ||
    observed.uid !== record.compiled.orderUid || !/^(0|[1-9][0-9]*)$/.test(observed.executedSellAmount) ||
    !/^(0|[1-9][0-9]*)$/.test(observed.executedBuyAmount) ||
    BigInt(observed.executedSellAmount) > BigInt(record.compiled.order.sellAmount)) throw new Error('COW_ORDERBOOK_RESPONSE_INVALID');
  const state: CowOrderState = observed.status === 'open' ? 'OPEN'
    : observed.status === 'partiallyFilled' ? 'PARTIALLY_FILLED'
    : observed.status === 'fulfilled' ? 'RECONCILIATION_REQUIRED'
    : observed.status === 'expired' ? 'EXPIRED' : 'CANCELLED';
  return transitionCow(record, state, at, { observed });
}
/** The caller must supply an fsynced persistence operation; it is awaited before transmission. */
export async function postCowOnce(record: CowPostingRecord, transport: CowOrderbookTransport,
  persist: (record: CowPostingRecord) => Promise<void>, at: string): Promise<CowPostingRecord> {
  if (record.state !== 'SIGNED' || !record.signature || record.postingAttemptId || record.postCount !== 0)
    throw new Error('COW_POST_NOT_ALLOWED');
  verifyCowForPosting(record.compiled, record.quote, Date.parse(at));
  const attemptId = 'cow-post-' + record.compiled.orderUid.slice(2, 26);
  let next = transitionCow(record, 'POSTING', at, { postingAttemptId: attemptId, postCount: 1 });
  await persist(next);
  try {
    const response = await transport.post({ uid: next.compiled.orderUid, owner: next.quote.owner,
      signature: next.signature!, signingScheme: 'eip712', compiled: next.compiled });
    if (!response || typeof response !== 'object' || Object.keys(response).join(',') !== 'uid' ||
      response.uid !== next.compiled.orderUid) throw new Error('COW_POST_UID_MISMATCH');
    next = transitionCow(next, 'POSTED', at);
  } catch {
    next = transitionCow(next, 'POST_RESULT_UNKNOWN', at);
  }
  await persist(next);
  return next;
}
/** An unknown post is lookup-only. A missing order is not permission to repost. */
export async function recoverCowPost(record: CowPostingRecord, transport: CowOrderbookTransport,
  persist: (record: CowPostingRecord) => Promise<void>, at: string): Promise<CowPostingRecord> {
  if (!record.postingAttemptId || record.postCount !== 1 ||
    !['POSTING', 'POST_RESULT_UNKNOWN', 'POSTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'RECONCILIATION_REQUIRED'].includes(record.state))
    throw new Error('COW_RECOVERY_NOT_ALLOWED');
  const unavailable = () => record.state === 'POSTING' ? transitionCow(record, 'POST_RESULT_UNKNOWN', at) : record;
  let observed: CowOrderbookView | null;
  try { observed = await transport.lookup(record.compiled.orderUid); }
  catch { return unavailable(); }
  if (!observed) return unavailable();
  const next = cowStatus(record, observed, at);
  await persist(next);
  return next;
}
/** Test-only disposable key helper. Never called by the DApp server. */
export function signCowDisposable(digest: string, key: Uint8Array): { readonly signature: string; readonly owner: string } {
  if (!/^0x[0-9a-f]{64}$/.test(digest) || key.length !== 32 || !secp256k1.utils.isValidSecretKey(key))
    throw new Error('COW_LOCAL_SIGNER_INVALID');
  const signature = secp256k1.Signature.fromBytes(secp256k1.sign(Uint8Array.from(Buffer.from(digest.slice(2), 'hex')),
    key, { prehash: false, format: 'recovered' }), 'recovered');
  const pubkey = secp256k1.getPublicKey(key, false);
  const owner = '0x' + Buffer.from(keccak_256(pubkey.subarray(1)).subarray(12)).toString('hex');
  return { signature: '0x' + Buffer.from(signature.toBytes('compact')).toString('hex') + (27 + (signature.recovery ?? 0)).toString(16),
    owner };
}
