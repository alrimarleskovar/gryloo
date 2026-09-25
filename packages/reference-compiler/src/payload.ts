// SPDX-License-Identifier: AGPL-3.0-only
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashRawBytes } from '@defi-workflow-engine/workflow-contracts';
import { address, decodeApprove, decodeSwap, encodeApprove, encodeSwap, SWAP_ROUTER_02, type SwapArguments } from './abi.js';
import { rlpBytes, rlpDecode, rlpEncode, rlpInteger, rlpList, parseRlpInteger } from './rlp.js';
import { FORK_CHAIN_ID } from './profile.js';

export type UnsignedPayload = {
  readonly chainId: 31337; readonly nonce: bigint; readonly maxPriorityFeePerGas: bigint;
  readonly maxFeePerGas: bigint; readonly gasLimit: bigint; readonly to: string;
  readonly value: 0n; readonly data: Uint8Array; readonly accessList: readonly [];
};
function fail(code: string): never { throw new Error(code); }
export function toHex(input: Uint8Array): string { return '0x' + Array.from(input, b => b.toString(16).padStart(2, '0')).join(''); }
export function fromHex(input: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(input)) fail('PAYLOAD_HEX_INVALID');
  const result = new Uint8Array((input.length - 2) / 2);
  for (let i = 0; i < result.length; i++) result[i] = Number.parseInt(input.slice(2 + i * 2, 4 + i * 2), 16);
  return result;
}
function same(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
export function encodeUnsignedPayload(payload: UnsignedPayload): Uint8Array {
  if (payload.chainId !== FORK_CHAIN_ID || payload.value !== 0n || payload.accessList.length !== 0
    || payload.nonce < 0n || payload.gasLimit <= 0n || payload.maxPriorityFeePerGas !== 1_000_000n
    || payload.maxFeePerGas < payload.maxPriorityFeePerGas || payload.data.length < 4) fail('PAYLOAD_PROFILE_INVALID');
  const target = fromHex(address(payload.to));
  const body = rlpEncode([
    rlpInteger(BigInt(payload.chainId)), rlpInteger(payload.nonce), rlpInteger(payload.maxPriorityFeePerGas),
    rlpInteger(payload.maxFeePerGas), rlpInteger(payload.gasLimit), target, rlpInteger(0n),
    payload.data, [],
  ]);
  const result = new Uint8Array(1 + body.length);
  result[0] = 2; result.set(body, 1);
  return result;
}
export function decodeUnsignedPayload(input: Uint8Array): UnsignedPayload {
  if (!(input instanceof Uint8Array) || input[0] !== 2) fail('PAYLOAD_TYPE_INVALID');
  const fields = rlpList(rlpDecode(input.subarray(1)));
  if (fields.length !== 9) fail('PAYLOAD_FIELD_COUNT');
  const chainId = parseRlpInteger(fields[0]!);
  if (chainId !== BigInt(FORK_CHAIN_ID)) fail('PAYLOAD_CHAIN_MISMATCH');
  const target = rlpBytes(fields[5]!);
  if (target.length !== 20) fail('PAYLOAD_TARGET_INVALID');
  const value = parseRlpInteger(fields[6]!);
  if (value !== 0n) fail('PAYLOAD_VALUE_INVALID');
  if (rlpList(fields[8]!).length !== 0) fail('PAYLOAD_ACCESS_LIST_INVALID');
  const result: UnsignedPayload = {
    chainId: FORK_CHAIN_ID, nonce: parseRlpInteger(fields[1]!),
    maxPriorityFeePerGas: parseRlpInteger(fields[2]!), maxFeePerGas: parseRlpInteger(fields[3]!),
    gasLimit: parseRlpInteger(fields[4]!), to: toHex(target), value: 0n,
    data: rlpBytes(fields[7]!), accessList: [],
  };
  if (!same(input, encodeUnsignedPayload(result))) fail('PAYLOAD_NON_CANONICAL');
  return result;
}
export function payloadIdentity(bytes: Uint8Array): { payloadHash: string; signingHash: string } {
  decodeUnsignedPayload(bytes);
  return { payloadHash: hashRawBytes('payload', bytes), signingHash: toHex(keccak_256(bytes)) };
}
export type PairContext = {
  readonly owner: string; readonly tokenIn: string; readonly tokenOut: string;
  readonly amountIn: bigint; readonly amountOutMinimum: bigint; readonly fee: SwapArguments['fee'];
  readonly deadline: bigint; readonly nonce: bigint;
};
export function verifyModeAPair(approveBytes: Uint8Array, swapBytes: Uint8Array, context: PairContext): {
  readonly approve: UnsignedPayload; readonly swap: UnsignedPayload;
} {
  const approve = decodeUnsignedPayload(approveBytes);
  const swap = decodeUnsignedPayload(swapBytes);
  if (context.amountIn <= 0n || context.amountOutMinimum <= 0n || context.deadline <= 0n
    || approve.nonce !== context.nonce || swap.nonce !== context.nonce + 1n
    || approve.to !== address(context.tokenIn) || swap.to !== SWAP_ROUTER_02) fail('PAYLOAD_PAIR_MISMATCH');
  const approval = decodeApprove(approve.data);
  if (approval.spender !== SWAP_ROUTER_02 || approval.amount !== context.amountIn) fail('EXCESSIVE_APPROVAL');
  const decoded = decodeSwap(swap.data);
  if (decoded.tokenIn !== address(context.tokenIn) || decoded.tokenOut !== address(context.tokenOut)
    || decoded.recipient !== address(context.owner) || decoded.fee !== context.fee
    || decoded.amountIn !== context.amountIn || decoded.amountOutMinimum !== context.amountOutMinimum
    || decoded.deadline !== context.deadline) fail('PAYLOAD_DECODE_MISMATCH');
  return { approve, swap };
}
export function buildModeAPair(context: PairContext & {
  readonly approveGasLimit: bigint; readonly swapGasLimit: bigint;
  readonly maxFeePerGas: bigint;
}): { readonly approveBytes: Uint8Array; readonly swapBytes: Uint8Array } {
  const common = { chainId: FORK_CHAIN_ID, maxPriorityFeePerGas: 1_000_000n,
    maxFeePerGas: context.maxFeePerGas, value: 0n, accessList: [] } as const;
  const approveBytes = encodeUnsignedPayload({ ...common, nonce: context.nonce, gasLimit: context.approveGasLimit,
    to: context.tokenIn, data: encodeApprove(SWAP_ROUTER_02, context.amountIn) });
  const swapBytes = encodeUnsignedPayload({ ...common, nonce: context.nonce + 1n, gasLimit: context.swapGasLimit,
    to: SWAP_ROUTER_02, data: encodeSwap({ tokenIn: context.tokenIn, tokenOut: context.tokenOut, fee: context.fee,
      recipient: context.owner, amountIn: context.amountIn, amountOutMinimum: context.amountOutMinimum,
      sqrtPriceLimitX96: 0n, deadline: context.deadline }) });
  verifyModeAPair(approveBytes, swapBytes, context);
  return { approveBytes, swapBytes };
}
