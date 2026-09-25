// SPDX-License-Identifier: AGPL-3.0-only
import { decodeApprove, decodeSwap, SWAP_ROUTER_02 } from './abi.js';
import { decodeUnsignedPayload, payloadIdentity } from './payload.js';
import type { CompileContext } from './policy.js';

export type ReviewFinding = { readonly code: string; readonly severity: 'BLOCK' | 'WARNING' };
export type ReviewInput = {
  readonly context: CompileContext;
  readonly approveBytes: Uint8Array; readonly swapBytes: Uint8Array;
  readonly approvePayloadHash: string; readonly swapPayloadHash: string;
  readonly currentForkQuote: boolean; readonly lintBlocks: readonly string[];
  readonly warnings: readonly string[]; readonly acknowledgedWarnings: readonly string[];
};
/** Check wallet-bound fields from the exact reviewed bytes. No RPC or wallet access. */
export function reviewModeAPayloads(input: ReviewInput): readonly ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const block = (code: string): void => { if (!findings.some(item => item.code === code)) findings.push({ code, severity: 'BLOCK' }); };
  const warn = (code: string): void => { if (!findings.some(item => item.code === code)) findings.push({ code, severity: 'WARNING' }); };
  if (!input.currentForkQuote) block('QUOTE_EXPIRED');
  if (input.lintBlocks.length) block('LINT_BLOCKED');
  for (const warning of input.warnings) {
    warn(warning);
    if (!input.acknowledgedWarnings.includes(warning)) block('WARNING_NOT_ACKNOWLEDGED');
  }
  let approve: ReturnType<typeof decodeUnsignedPayload>;
  let swap: ReturnType<typeof decodeUnsignedPayload>;
  try { approve = decodeUnsignedPayload(input.approveBytes); swap = decodeUnsignedPayload(input.swapBytes); }
  catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'PAYLOAD_CHAIN_MISMATCH') block('FORK_CHAIN_MISMATCH');
    else if (code === 'PAYLOAD_VALUE_INVALID') block('NONZERO_VALUE');
    else if (code === 'PAYLOAD_ACCESS_LIST_INVALID') block('ACCESS_LIST_NOT_EMPTY');
    else block('NONCANONICAL_ENCODING');
    return findings;
  }
  if (payloadIdentity(input.approveBytes).payloadHash !== input.approvePayloadHash
    || payloadIdentity(input.swapBytes).payloadHash !== input.swapPayloadHash) block('PAYLOAD_HASH_MISMATCH');
  const c = input.context;
  if (approve.value !== 0n || swap.value !== 0n) block('NONZERO_VALUE');
  if (approve.accessList.length || swap.accessList.length) block('ACCESS_LIST_NOT_EMPTY');
  if (approve.to !== c.tokenIn || swap.to !== SWAP_ROUTER_02) block('UNKNOWN_TARGET');
  if (approve.nonce !== c.nonce || swap.nonce !== c.nonce + 1n
    || approve.maxPriorityFeePerGas !== 1_000_000n || swap.maxPriorityFeePerGas !== 1_000_000n
    || approve.maxFeePerGas !== c.maxFeePerGas || swap.maxFeePerGas !== c.maxFeePerGas
    || approve.gasLimit !== c.approveGasLimit || swap.gasLimit !== c.swapGasLimit) block('PAYLOAD_DECODE_MISMATCH');
  try {
    const approval = decodeApprove(approve.data);
    if (approval.spender !== SWAP_ROUTER_02) block('UNKNOWN_SPENDER');
    if (approval.amount !== c.amountIn) block('EXCESSIVE_APPROVAL');
  } catch { block('UNKNOWN_FUNCTION'); }
  try {
    const args = decodeSwap(swap.data);
    if (args.recipient === '0x0000000000000000000000000000000000000000'
      || args.recipient === '0x000000000000000000000000000000000000dead') block('SENTINEL_RECIPIENT');
    if (args.recipient !== c.owner) block('RECIPIENT_NOT_OWNER');
    if (args.tokenIn !== c.tokenIn || args.tokenOut !== c.tokenOut || args.fee !== c.fee
      || args.amountIn !== c.amountIn || args.amountOutMinimum !== c.minimumOut
      || args.deadline !== c.deadline) block('AMOUNT_MISMATCH');
  } catch { block('UNKNOWN_FUNCTION'); }
  return findings;
}
