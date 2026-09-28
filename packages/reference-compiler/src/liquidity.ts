// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-006 isolated Uniswap v3 Mode A liquidity profile. No network I/O. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashRawBytes } from '@defi-workflow-engine/workflow-contracts';
import { encodeUnsignedPayload, decodeUnsignedPayload, payloadIdentity, toHex, type UnsignedPayload } from './payload.js';
import { encodeApprove, decodeApprove, address } from './abi.js';
import { FORK_CHAIN_ID } from './profile.js';

export const POSITION_MANAGER = '0x03a520b32c04bf3beef7beb72e919cf822ed34f1';
export const LIQUIDITY_FACTORY = '0x33128a8fc17869897dce68ed026d694621f6fdfd';
export const LIQUIDITY_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const LIQUIDITY_WETH = '0x4200000000000000000000000000000000000006';
export const Q96 = 1n << 96n;
const Q384 = 1n << 384n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_TICK = 887272;
function fail(code: string): never { throw new Error(code); }
function integer(value: bigint, bits = 256): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= (1n << BigInt(bits))) fail('LIQUIDITY_INTEGER_INVALID');
  return value;
}
function positive(value: bigint, bits = 256): bigint {
  integer(value, bits);
  if (value === 0n) fail('LIQUIDITY_ZERO');
  return value;
}
function ceilDiv(a: bigint, b: bigint): bigint {
  if (a < 0n || b <= 0n) fail('LIQUIDITY_DIVISION_INVALID');
  return (a + b - 1n) / b;
}
function isqrt(n: bigint): bigint {
  if (n < 0n) fail('LIQUIDITY_SQRT_INVALID');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
}
/** Independently derived fixed-point sqrt(1.0001^tick), rounded upward to Q96. */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isSafeInteger(tick) || Math.abs(tick) > MAX_TICK) fail('LIQUIDITY_TICK_INVALID');
  let power = isqrt(10001n * Q384 * Q384 / 10000n);
  let ratio = Q384;
  let n = Math.abs(tick);
  while (n > 0) {
    if (n % 2 === 1) ratio = ratio * power / Q384;
    n = Math.floor(n / 2);
    if (n > 0) power = power * power / Q384;
  }
  if (tick < 0) ratio = Q384 * Q384 / ratio;
  return ceilDiv(ratio, 1n << 288n);
}
export type PoolState = {
  readonly sourceChainId: 8453; readonly executionChainId: 31337;
  readonly sourceBlockHash: string; readonly sourceBlockNumber: number;
  readonly pool: string; readonly factory: string; readonly positionManager: string;
  readonly token0: string; readonly token1: string; readonly fee: number;
  readonly tickSpacing: number; readonly tick: number; readonly sqrtPriceX96: bigint;
  readonly poolCodeHash: string; readonly positionManagerCodeHash: string;
  readonly observedAtMs: number; readonly expiresAtMs: number;
};
export type Composition = {
  readonly liquidity: bigint; readonly amount0: bigint; readonly amount1: bigint;
  readonly state: 'BELOW_RANGE' | 'IN_RANGE' | 'ABOVE_RANGE';
  readonly sqrtLowerX96: bigint; readonly sqrtUpperX96: bigint;
};
const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
export function verifyPoolState(state: PoolState, nowMs: number): void {
  if (state.sourceChainId !== 8453 || state.executionChainId !== FORK_CHAIN_ID ||
      state.factory !== LIQUIDITY_FACTORY || state.positionManager !== POSITION_MANAGER ||
      state.token0 !== LIQUIDITY_WETH || state.token1 !== LIQUIDITY_USDC ||
      !/^0x[0-9a-f]{40}$/.test(state.pool) || state.pool === '0x0000000000000000000000000000000000000000' ||
      !hash(state.sourceBlockHash) || !hash(state.poolCodeHash) || !hash(state.positionManagerCodeHash) ||
      !Number.isSafeInteger(state.sourceBlockNumber) || state.sourceBlockNumber < 1 ||
      !Number.isSafeInteger(state.fee) || state.fee <= 0 || state.fee > 10000 ||
      !Number.isSafeInteger(state.tickSpacing) || state.tickSpacing < 1 || state.tickSpacing > 200 ||
      !Number.isSafeInteger(state.tick) || Math.abs(state.tick) > MAX_TICK ||
      !Number.isSafeInteger(state.observedAtMs) || !Number.isSafeInteger(state.expiresAtMs) ||
      nowMs < state.observedAtMs || nowMs >= state.expiresAtMs ||
      state.expiresAtMs - state.observedAtMs > 60_000 ||
      state.sqrtPriceX96 <= 4295128739n || state.sqrtPriceX96 >= 1461446703485210103287273052203988822378723970342n) {
    fail('LIQUIDITY_POOL_STATE_INVALID');
  }
  const lower = sqrtRatioAtTick(state.tick);
  const upper = state.tick === MAX_TICK ? 1461446703485210103287273052203988822378723970342n : sqrtRatioAtTick(state.tick + 1);
  // Our independent high-precision formula may differ by a few Q96 units from
  // Uniswap's integer TickMath at extreme ticks, so the observed tick is checked
  // with a conservative relative margin and exact on-fork simulation is required.
  const tolerance = (state.sqrtPriceX96 >> 60n) + 2n;
  if (state.sqrtPriceX96 + tolerance < lower || state.sqrtPriceX96 > upper + tolerance) fail('LIQUIDITY_TICK_PRICE_MISMATCH');
}
export function rangeComposition(state: PoolState, tickLower: number, tickUpper: number,
  amount0Max: bigint, amount1Max: bigint, nowMs: number): Composition {
  verifyPoolState(state, nowMs);
  if (!Number.isSafeInteger(tickLower) || !Number.isSafeInteger(tickUpper) ||
      tickLower >= tickUpper || tickLower < -MAX_TICK || tickUpper > MAX_TICK ||
      tickLower % state.tickSpacing !== 0 || tickUpper % state.tickSpacing !== 0) fail('LIQUIDITY_RANGE_INVALID');
  positive(amount0Max); positive(amount1Max);
  const a = sqrtRatioAtTick(tickLower), b = sqrtRatioAtTick(tickUpper), s = state.sqrtPriceX96;
  if (a >= b) fail('LIQUIDITY_RANGE_INVALID');
  let liquidity: bigint, amount0: bigint, amount1: bigint;
  let position: Composition['state'];
  if (s <= a) {
    position = 'BELOW_RANGE';
    liquidity = amount0Max * a * b / ((b - a) * Q96);
    amount0 = ceilDiv(liquidity * (b - a) * Q96, a * b); amount1 = 0n;
  } else if (s >= b) {
    position = 'ABOVE_RANGE';
    liquidity = amount1Max * Q96 / (b - a);
    amount0 = 0n; amount1 = ceilDiv(liquidity * (b - a), Q96);
  } else {
    position = 'IN_RANGE';
    const l0 = amount0Max * s * b / ((b - s) * Q96);
    const l1 = amount1Max * Q96 / (s - a);
    liquidity = l0 < l1 ? l0 : l1;
    amount0 = ceilDiv(liquidity * (b - s) * Q96, s * b);
    amount1 = ceilDiv(liquidity * (s - a), Q96);
  }
  if (liquidity <= 0n || liquidity > MAX_UINT128 || amount0 > amount0Max || amount1 > amount1Max) fail('LIQUIDITY_COMPOSITION_INVALID');
  return { liquidity, amount0, amount1, state: position, sqrtLowerX96: a, sqrtUpperX96: b };
}

export type LiquidityCall =
  | { readonly kind: 'APPROVE'; readonly token: string; readonly amount: bigint }
  | { readonly kind: 'MINT'; readonly token0: string; readonly token1: string; readonly fee: number;
      readonly tickLower: number; readonly tickUpper: number; readonly amount0Desired: bigint; readonly amount1Desired: bigint;
      readonly amount0Min: bigint; readonly amount1Min: bigint; readonly recipient: string; readonly deadline: bigint }
  | { readonly kind: 'INCREASE'; readonly tokenId: bigint; readonly amount0Desired: bigint; readonly amount1Desired: bigint;
      readonly amount0Min: bigint; readonly amount1Min: bigint; readonly deadline: bigint }
  | { readonly kind: 'DECREASE'; readonly tokenId: bigint; readonly liquidity: bigint;
      readonly amount0Min: bigint; readonly amount1Min: bigint; readonly deadline: bigint }
  | { readonly kind: 'COLLECT'; readonly tokenId: bigint; readonly recipient: string;
      readonly amount0Max: bigint; readonly amount1Max: bigint }
  | { readonly kind: 'BURN'; readonly tokenId: bigint };
function selector(signature: string): Uint8Array { return keccak_256(new TextEncoder().encode(signature)).slice(0, 4); }
function word(n: bigint): Uint8Array {
  integer(n); const result = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { result[i] = Number(n & 255n); n >>= 8n; }
  return result;
}
function signedTick(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_TICK) fail('LIQUIDITY_TICK_INVALID');
  return word(n < 0 ? (1n << 256n) + BigInt(n) : BigInt(n));
}
function addr(value: string): Uint8Array {
  const normalized = address(value); const result = new Uint8Array(32);
  for (let i = 0; i < 20; i++) result[12 + i] = Number.parseInt(normalized.slice(2 + i * 2, 4 + i * 2), 16);
  return result;
}
function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}
export function encodeLiquidityCall(call: LiquidityCall): { readonly to: string; readonly data: Uint8Array } {
  if (call.kind === 'APPROVE') {
    if (![LIQUIDITY_USDC, LIQUIDITY_WETH].includes(call.token)) fail('LIQUIDITY_TOKEN_INVALID');
    integer(call.amount);
    return { to: call.token, data: encodeApprove(POSITION_MANAGER, call.amount) };
  }
  let sig: string, args: Uint8Array[];
  switch (call.kind) {
    case 'MINT':
      if (call.token0 !== LIQUIDITY_WETH || call.token1 !== LIQUIDITY_USDC ||
          ![100, 500, 3000, 10000].includes(call.fee) || call.tickLower >= call.tickUpper ||
          call.amount0Min > call.amount0Desired || call.amount1Min > call.amount1Desired) fail('LIQUIDITY_MINT_INVALID');
      positive(call.amount0Desired); positive(call.amount1Desired); positive(call.deadline);
      sig = 'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))';
      args = [addr(call.token0), addr(call.token1), word(BigInt(call.fee)), signedTick(call.tickLower), signedTick(call.tickUpper),
        word(call.amount0Desired), word(call.amount1Desired), word(call.amount0Min), word(call.amount1Min), addr(call.recipient), word(call.deadline)];
      break;
    case 'INCREASE':
      positive(call.tokenId); positive(call.amount0Desired); positive(call.amount1Desired); positive(call.deadline);
      if (call.amount0Min > call.amount0Desired || call.amount1Min > call.amount1Desired) fail('LIQUIDITY_AMOUNT_INVALID');
      sig = 'increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))';
      args = [word(call.tokenId), word(call.amount0Desired), word(call.amount1Desired), word(call.amount0Min), word(call.amount1Min), word(call.deadline)];
      break;
    case 'DECREASE':
      positive(call.tokenId); positive(call.liquidity, 128); positive(call.deadline);
      sig = 'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))';
      args = [word(call.tokenId), word(call.liquidity), word(call.amount0Min), word(call.amount1Min), word(call.deadline)];
      break;
    case 'COLLECT':
      positive(call.tokenId); integer(call.amount0Max, 128); integer(call.amount1Max, 128);
      if (call.amount0Max === 0n && call.amount1Max === 0n) fail('LIQUIDITY_COLLECT_EMPTY');
      sig = 'collect((uint256,address,uint128,uint128))';
      args = [word(call.tokenId), addr(call.recipient), word(call.amount0Max), word(call.amount1Max)];
      break;
    case 'BURN':
      positive(call.tokenId); sig = 'burn(uint256)'; args = [word(call.tokenId)]; break;
  }
  return { to: POSITION_MANAGER, data: join([selector(sig), ...args]) };
}
export function buildLiquidityPayload(call: LiquidityCall, input: {
  readonly nonce: bigint; readonly gasLimit: bigint; readonly maxFeePerGas: bigint;
}): { readonly bytes: Uint8Array; readonly payloadHash: string; readonly signingHash: string } {
  const encoded = encodeLiquidityCall(call);
  const payload: UnsignedPayload = {
    chainId: FORK_CHAIN_ID, nonce: integer(input.nonce), gasLimit: positive(input.gasLimit),
    maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: positive(input.maxFeePerGas),
    to: encoded.to, value: 0n, data: encoded.data, accessList: [],
  };
  const bytes = encodeUnsignedPayload(payload);
  const identity = payloadIdentity(bytes);
  if (identity.payloadHash !== hashRawBytes('payload', bytes)) fail('LIQUIDITY_HASH_MISMATCH');
  return { bytes, ...identity };
}
export function verifyLiquidityPayload(bytes: Uint8Array, call: LiquidityCall, input: {
  readonly nonce: bigint; readonly gasLimit: bigint; readonly maxFeePerGas: bigint;
}): { readonly payloadHash: string; readonly signingHash: string; readonly to: string; readonly data: string } {
  const payload = decodeUnsignedPayload(bytes);
  const expected = buildLiquidityPayload(call, input);
  if (toHex(bytes) !== toHex(expected.bytes) || payload.nonce !== input.nonce ||
      payload.gasLimit !== input.gasLimit || payload.maxFeePerGas !== input.maxFeePerGas) fail('LIQUIDITY_PAYLOAD_MISMATCH');
  if (call.kind === 'APPROVE') {
    const approval = decodeApprove(payload.data);
    if (approval.spender !== POSITION_MANAGER || approval.amount !== call.amount) fail('LIQUIDITY_APPROVAL_MISMATCH');
  }
  return { payloadHash: expected.payloadHash, signingHash: expected.signingHash, to: payload.to, data: toHex(payload.data) };
}
