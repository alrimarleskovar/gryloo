// SPDX-License-Identifier: AGPL-3.0-only
import { keccak_256 } from '@noble/hashes/sha3.js';
import { SWAP_ROUTER_02, toHex, verifyModeAPair, type PairContext } from '@defi-workflow-engine/reference-compiler';
import { verifySignedPayload, type SignedTransaction } from './raw-transaction.js';
export type RpcLog = { readonly address: string; readonly topics: readonly string[]; readonly data: string };
export type Receipt = { readonly transactionHash: string; readonly blockHash: string; readonly status: 0 | 1;
  readonly gasUsed: bigint; readonly effectiveGasPrice: bigint; readonly l1Fee: bigint | null;
  readonly logs: readonly RpcLog[] };
export type ReconcileInput = {
  readonly owner: string; readonly tokenIn: string; readonly tokenOut: string;
  readonly amountIn: bigint; readonly minimumOut: bigint; readonly quotedOut: bigint;
  readonly fee: PairContext['fee']; readonly deadline: bigint; readonly nonce: bigint;
  readonly reviewedApprove: Uint8Array; readonly reviewedSwap: Uint8Array;
  readonly approveRaw: Uint8Array | null; readonly swapRaw: Uint8Array | null;
  readonly approveHash: string; readonly swapHash: string;
  readonly approveReceipt: Receipt | null; readonly swapReceipt: Receipt | null;
  readonly before: { readonly input: bigint; readonly output: bigint; readonly eth: bigint; readonly allowance: bigint; readonly nonce: bigint };
  readonly afterApproval: { readonly allowance: bigint; readonly nonce: bigint };
  readonly after: { readonly input: bigint; readonly output: bigint; readonly eth: bigint; readonly allowance: bigint; readonly nonce: bigint; readonly routerInputResidue: bigint; readonly routerOutputResidue: bigint };
  readonly lastReadBlockHash: string; readonly consistencyReadBlockHash: string;
};
export type Reconciliation = { readonly outcome: 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE';
  readonly code: string; readonly approve: SignedTransaction | null; readonly swap: SignedTransaction | null;
  readonly observedOut: bigint | null; readonly totalFee: bigint | null };
const text = new TextEncoder();
export const TRANSFER_TOPIC = toHex(keccak_256(text.encode('Transfer(address,address,uint256)')));
export const APPROVAL_TOPIC = toHex(keccak_256(text.encode('Approval(address,address,uint256)')));
function addressTopic(value: string): string { return '0x' + '0'.repeat(24) + value.slice(2); }
function amountData(value: bigint): string { return '0x' + value.toString(16).padStart(64, '0'); }
function isTransfer(log: RpcLog, token: string, from: string | null, to: string | null, amount: bigint): boolean {
  return log.address === token && log.topics.length === 3 && log.topics[0] === TRANSFER_TOPIC
    && (from === null || log.topics[1] === addressTopic(from))
    && (to === null || log.topics[2] === addressTopic(to)) && log.data === amountData(amount);
}
function isApproval(log: RpcLog, token: string, owner: string, spender: string, amount: bigint): boolean {
  return log.address === token && log.topics.length === 3 && log.topics[0] === APPROVAL_TOPIC
    && log.topics[1] === addressTopic(owner) && log.topics[2] === addressTopic(spender) && log.data === amountData(amount);
}
export function reconcileModeA(input: ReconcileInput): Reconciliation {
  const outcome = (state: Reconciliation['outcome'], code: string, approve: SignedTransaction | null = null,
    swap: SignedTransaction | null = null, observedOut: bigint | null = null, totalFee: bigint | null = null): Reconciliation =>
    ({ outcome: state, code, approve, swap, observedOut, totalFee });
  try { verifyModeAPair(input.reviewedApprove, input.reviewedSwap, { owner: input.owner, tokenIn: input.tokenIn,
    tokenOut: input.tokenOut, amountIn: input.amountIn, amountOutMinimum: input.minimumOut,
    fee: input.fee, deadline: input.deadline, nonce: input.nonce }); }
  catch (error) { return outcome('DIVERGENT', error instanceof Error ? error.message : 'PAYLOAD_DECODE_MISMATCH'); }
  if (!input.approveRaw || !input.swapRaw || !input.approveReceipt || !input.swapReceipt) return outcome('INCONCLUSIVE', 'CHAIN_DATA_UNAVAILABLE');
  if (!/^0x[0-9a-f]{64}$/.test(input.lastReadBlockHash)
    || input.lastReadBlockHash !== input.consistencyReadBlockHash) return outcome('INCONCLUSIVE', 'RPC_INCONSISTENT');
  let approve: SignedTransaction;
  let swap: SignedTransaction;
  try {
    approve = verifySignedPayload(input.approveRaw, input.approveHash, input.owner, input.reviewedApprove);
    swap = verifySignedPayload(input.swapRaw, input.swapHash, input.owner, input.reviewedSwap);
  } catch (error) { return outcome('DIVERGENT', error instanceof Error ? error.message : 'PAYLOAD_FIDELITY_FAILED'); }
  if (input.approveReceipt.transactionHash !== input.approveHash || input.swapReceipt.transactionHash !== input.swapHash
    || !/^0x[0-9a-f]{64}$/.test(input.approveReceipt.blockHash) || !/^0x[0-9a-f]{64}$/.test(input.swapReceipt.blockHash)) {
    return outcome('DIVERGENT', 'RECEIPT_MISMATCH', approve, swap);
  }
  if (input.approveReceipt.status !== 1 || input.swapReceipt.status !== 1) return outcome('DIVERGENT', 'TRANSACTION_REVERTED', approve, swap);
  if (input.before.nonce !== input.nonce || input.afterApproval.nonce !== input.nonce + 1n
    || input.after.nonce !== input.nonce + 2n) return outcome('DIVERGENT', 'NONCE_CONSUMPTION_MISMATCH', approve, swap);
  if (input.amountIn <= 0n || input.minimumOut <= 0n || input.before.allowance !== 0n
    || input.afterApproval.allowance !== input.amountIn || input.after.allowance !== 0n) {
    return outcome('DIVERGENT', 'ALLOWANCE_MISMATCH', approve, swap);
  }
  if (!input.approveReceipt.logs.some(log => isApproval(log, input.tokenIn, input.owner, SWAP_ROUTER_02, input.amountIn))) {
    return outcome('DIVERGENT', 'APPROVAL_LOG_MISMATCH', approve, swap);
  }
  const observedOut = input.after.output - input.before.output;
  if (input.before.input - input.after.input !== input.amountIn || observedOut < input.minimumOut
    || observedOut !== input.quotedOut) return outcome('DIVERGENT', 'BALANCE_DELTA_MISMATCH', approve, swap, observedOut);
  if (!input.swapReceipt.logs.some(log => isTransfer(log, input.tokenIn, input.owner, null, input.amountIn))
    || !input.swapReceipt.logs.some(log => isTransfer(log, input.tokenOut, null, input.owner, observedOut))) {
    return outcome('DIVERGENT', 'TRANSFER_LOG_MISMATCH', approve, swap, observedOut);
  }
  if (input.after.routerInputResidue !== 0n || input.after.routerOutputResidue !== 0n) return outcome('DIVERGENT', 'ROUTER_RESIDUE', approve, swap, observedOut);
  if ([input.approveReceipt, input.swapReceipt].some((receipt, index) =>
    receipt.gasUsed < 0n || receipt.gasUsed > (index === 0 ? approve.unsigned.gasLimit : swap.unsigned.gasLimit)
    || receipt.effectiveGasPrice < 0n
    || receipt.effectiveGasPrice > (index === 0 ? approve.unsigned.maxFeePerGas : swap.unsigned.maxFeePerGas)
    || (receipt.l1Fee !== null && receipt.l1Fee < 0n))) return outcome('DIVERGENT', 'FEE_INVALID', approve, swap, observedOut);
  const fee = [input.approveReceipt, input.swapReceipt].reduce((sum, receipt) =>
    sum + receipt.gasUsed * receipt.effectiveGasPrice + (receipt.l1Fee ?? 0n), 0n);
  if (input.before.eth - input.after.eth !== fee) return outcome('DIVERGENT', 'FEE_MISMATCH', approve, swap, observedOut, fee);
  return outcome('RECONCILED', 'EXACT', approve, swap, observedOut, fee);
}

export type ReconcileScriptQuery =
  | { readonly kind: 'CHAIN' }
  | { readonly kind: 'RAW' | 'RECEIPT'; readonly transactionHash: string }
  | { readonly kind: 'BEFORE' | 'AFTER_APPROVAL' | 'AFTER' | 'CONSISTENCY'; readonly blockHash: string };
export type ReconcileScriptTransport = (query: ReconcileScriptQuery) => Promise<unknown>;
export type ReconcileStaticInput = Omit<ReconcileInput, 'approveRaw' | 'swapRaw' | 'approveReceipt' | 'swapReceipt'
  | 'before' | 'afterApproval' | 'after' | 'lastReadBlockHash' | 'consistencyReadBlockHash'>;
/** Independent chain reads through an injected transport. No wallet or executor input is trusted. */
export async function reconcileWithScriptedTransport(base: ReconcileStaticInput,
  transport: ReconcileScriptTransport, blocks: { readonly before: string; readonly afterApproval: string; readonly after: string }): Promise<Reconciliation> {
  const inconclusive = (code: string): Reconciliation => ({ outcome: 'INCONCLUSIVE', code,
    approve: null, swap: null, observedOut: null, totalFee: null });
  if (![blocks.before, blocks.afterApproval, blocks.after].every(hash => /^0x[0-9a-f]{64}$/.test(hash))) return inconclusive('RPC_INCONSISTENT');
  try {
    if (await transport({ kind: 'CHAIN' }) !== 31337) return inconclusive('FORK_CHAIN_MISMATCH');
    const approveRaw = await transport({ kind: 'RAW', transactionHash: base.approveHash });
    const swapRaw = await transport({ kind: 'RAW', transactionHash: base.swapHash });
    const approveReceipt = await transport({ kind: 'RECEIPT', transactionHash: base.approveHash });
    const swapReceipt = await transport({ kind: 'RECEIPT', transactionHash: base.swapHash });
    const before = await transport({ kind: 'BEFORE', blockHash: blocks.before });
    const afterApproval = await transport({ kind: 'AFTER_APPROVAL', blockHash: blocks.afterApproval });
    const after = await transport({ kind: 'AFTER', blockHash: blocks.after });
    const consistency = await transport({ kind: 'CONSISTENCY', blockHash: blocks.after });
    if (!(approveRaw instanceof Uint8Array) || !(swapRaw instanceof Uint8Array)
      || !approveReceipt || !swapReceipt || !before || !afterApproval || !after
      || typeof consistency !== 'string') return inconclusive('CHAIN_DATA_UNAVAILABLE');
    return reconcileModeA({ ...base, approveRaw, swapRaw,
      approveReceipt: approveReceipt as Receipt, swapReceipt: swapReceipt as Receipt,
      before: before as ReconcileInput['before'], afterApproval: afterApproval as ReconcileInput['afterApproval'],
      after: after as ReconcileInput['after'], lastReadBlockHash: blocks.after,
      consistencyReadBlockHash: consistency });
  } catch { return inconclusive('FORK_UNAVAILABLE'); }
}
