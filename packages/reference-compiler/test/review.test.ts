// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { hashRawBytes } from '@defi-workflow-engine/workflow-contracts';
import { describe, expect, it } from 'vitest';
import { buildModeAPair, decodeUnsignedPayload, encodeUnsignedPayload, payloadIdentity } from '../src/payload.js';
import { reviewModeAPayloads } from '../src/review.js';
import { buildRevocationPayload, verifyRevocationPayload } from '../src/revocation.js';
import { decodeApprove, encodeApprove, encodeSwap, SWAP_ROUTER_02 } from '../src/abi.js';
import { rlpDecode, rlpEncode, rlpInteger, rlpList } from '../src/rlp.js';
import type { CompileContext } from '../src/policy.js';
const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/mode-a-payload-vectors.json', import.meta.url), 'utf8'));
const context = { owner: vector.owner, tokenIn: vector.tokenIn, tokenOut: vector.tokenOut,
  amountIn: 1_000_000n, minimumOut: 100_000_000_000_000n, fee: 500, deadline: 1_790_000_180n,
  nonce: 0n, approveGasLimit: 60_000n, swapGasLimit: 250_000n, maxFeePerGas: 3_000_000n } as CompileContext;
function review(override: Record<string, unknown> = {}) {
  const pair = buildModeAPair({ ...context, amountOutMinimum: context.minimumOut });
  return reviewModeAPayloads({ context, ...pair,
    approvePayloadHash: payloadIdentity(pair.approveBytes).payloadHash,
    swapPayloadHash: payloadIdentity(pair.swapBytes).payloadHash,
    currentForkQuote: true, lintBlocks: [], warnings: [], acknowledgedWarnings: [], ...override });
}
const codes = (items: readonly { code: string }[]) => items.map(item => item.code);
describe('Mode A exact-byte review', () => {
  it('accepts the pinned pair only with a current quote', () => {
    expect(review()).toEqual([]);
    expect(codes(review({ currentForkQuote: false }))).toContain('QUOTE_EXPIRED');
  });
  it('blocks changed hash, amount, recipient, gas and warning acknowledgement', () => {
    expect(codes(review({ approvePayloadHash: '0x' + '0'.repeat(64) }))).toContain('PAYLOAD_HASH_MISMATCH');
    expect(codes(review({ context: { ...context, amountIn: context.amountIn + 1n } }))).toContain('EXCESSIVE_APPROVAL');
    expect(codes(review({ context: { ...context, owner: '0x0000000000000000000000000000000000000001' } }))).toContain('RECIPIENT_NOT_OWNER');
    expect(codes(review({ context: { ...context, swapGasLimit: context.swapGasLimit + 1n } }))).toContain('PAYLOAD_DECODE_MISMATCH');
    expect(codes(review({ warnings: ['FORK_REPRODUCED_NOT_MAINNET'] }))).toContain('WARNING_NOT_ACKNOWLEDGED');
  });
});

const revocation = { owner: vector.owner, tokenIn: vector.tokenIn, nonce: 2n,
  residualAllowance: 1_000_000n, gasLimit: 60_000n, maxFeePerGas: 3_000_000n,
  simulatedAllowanceAfter: 0n, simulationSucceeded: true };
describe('separate Mode A residual allowance revocation', () => {
  it('builds only an exact zero-approval on chain 31337', () => {
    const { bytes, payloadHash } = buildRevocationPayload(revocation);
    const payload = decodeUnsignedPayload(bytes);
    expect(payload.chainId).toBe(31337);
    expect(decodeApprove(payload.data).amount).toBe(0n);
    expect(payloadHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => verifyRevocationPayload(bytes, { ...revocation, nonce: 3n })).toThrow('REVOCATION_PAYLOAD_MISMATCH');
  });
  it('requires residual authority and successful zero-allowance simulation', () => {
    expect(() => buildRevocationPayload({ ...revocation, residualAllowance: 0n })).toThrow('REVOCATION_NOT_READY');
    expect(() => buildRevocationPayload({ ...revocation, simulatedAllowanceAfter: 1n })).toThrow('REVOCATION_NOT_READY');
    expect(() => buildRevocationPayload({ ...revocation, simulationSucceeded: false })).toThrow('REVOCATION_NOT_READY');
  });
});

function altered(approveBytes: Uint8Array, swapBytes?: Uint8Array) {
  const baseline = buildModeAPair({ ...context, amountOutMinimum: context.minimumOut });
  const swap = swapBytes ?? baseline.swapBytes;
  return review({ approveBytes, swapBytes: swap,
    approvePayloadHash: hashRawBytes('payload', approveBytes),
    swapPayloadHash: hashRawBytes('payload', swap) });
}
function rawField(bytes: Uint8Array, index: number, value: Uint8Array | readonly unknown[]): Uint8Array {
  const fields = [...rlpList(rlpDecode(bytes.subarray(1)))];
  fields[index] = value as typeof fields[number];
  return Uint8Array.of(2, ...rlpEncode(fields));
}
describe('adversarial exact-byte review classification', () => {
  it('classifies wrong chain, nonzero value, access list and noncanonical RLP before wallet access', () => {
    const pair = buildModeAPair({ ...context, amountOutMinimum: context.minimumOut });
    expect(codes(altered(rawField(pair.approveBytes, 0, rlpInteger(8453n))))).toContain('FORK_CHAIN_MISMATCH');
    expect(codes(altered(rawField(pair.approveBytes, 6, rlpInteger(1n))))).toContain('NONZERO_VALUE');
    expect(codes(altered(rawField(pair.approveBytes, 8, [new Uint8Array()])))).toContain('ACCESS_LIST_NOT_EMPTY');
    expect(codes(review({ approveBytes: Uint8Array.of(...pair.approveBytes, 0) }))).toContain('NONCANONICAL_ENCODING');
  });
  it('classifies unknown target, spender, function, sentinel recipient and input-unit drift', () => {
    const pair = buildModeAPair({ ...context, amountOutMinimum: context.minimumOut });
    const approve = decodeUnsignedPayload(pair.approveBytes);
    const swap = decodeUnsignedPayload(pair.swapBytes);
    const badTarget = encodeUnsignedPayload({ ...approve, to: '0x' + '1'.repeat(40) });
    const badSpender = encodeUnsignedPayload({ ...approve, data: encodeApprove('0x' + '2'.repeat(40), context.amountIn) });
    const badFunction = encodeUnsignedPayload({ ...approve, data: Uint8Array.of(1, 2, 3, 4) });
    const badAmount = encodeUnsignedPayload({ ...approve, data: encodeApprove(SWAP_ROUTER_02, context.amountIn + 1n) });
    const sentinel = encodeUnsignedPayload({ ...swap, data: encodeSwap({ tokenIn: context.tokenIn, tokenOut: context.tokenOut,
      fee: context.fee, recipient: '0x000000000000000000000000000000000000dead',
      amountIn: context.amountIn, amountOutMinimum: context.minimumOut, sqrtPriceLimitX96: 0n,
      deadline: context.deadline }) });
    expect(codes(altered(badTarget))).toContain('UNKNOWN_TARGET');
    expect(codes(altered(badSpender))).toContain('UNKNOWN_SPENDER');
    expect(codes(altered(badFunction))).toContain('UNKNOWN_FUNCTION');
    expect(codes(altered(badAmount))).toContain('EXCESSIVE_APPROVAL');
    expect(codes(altered(pair.approveBytes, sentinel))).toContain('SENTINEL_RECIPIENT');
    expect(codes(altered(pair.approveBytes, sentinel))).toContain('RECIPIENT_NOT_OWNER');
  });
  it('discharges lint only with a current fork quote and acknowledged warnings', () => {
    expect(codes(review({ lintBlocks: ['RECIPIENT_NOT_OWNER'] }))).toContain('LINT_BLOCKED');
    expect(codes(review({ warnings: ['FORK_REPRODUCED_NOT_MAINNET'], acknowledgedWarnings: ['FORK_REPRODUCED_NOT_MAINNET'] })))
      .not.toContain('WARNING_NOT_ACKNOWLEDGED');
    expect(codes(review({ currentForkQuote: false, warnings: ['FORK_REPRODUCED_NOT_MAINNET'],
      acknowledgedWarnings: ['FORK_REPRODUCED_NOT_MAINNET'] }))).toContain('QUOTE_EXPIRED');
  });
});
