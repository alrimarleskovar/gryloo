// SPDX-License-Identifier: AGPL-3.0-only
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile, type OrcaLiquidityOperation } from '@defi-workflow-engine/action-registry';
export { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY, ORCA_LIQUIDITY_OPERATIONS } from '@defi-workflow-engine/action-registry';
export type { OrcaLiquidityOperation } from '@defi-workflow-engine/action-registry';
import { CONCENTRATED_LIQUIDITY_ACTION, readConcentratedLiquidity, type SemanticWorkflow, type ArtifactSet, type SimulationBundle,
  type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { associatedTokenAddress, base58Encode, compileMessageV0, decompileMessageV0, findProgramAddress, fromBase64, parseMessageV0, parseTransaction,
  publicKeyBytes, readU64, serializeMessageV0, serializeSignedTransaction, sha256Hex, solanaAddress, toBase64, u32Bytes, u64Bytes, verifyEd25519,
  type SolanaInstruction } from './solana.js';
import { readSolanaAccounts, rpcContextValue, setComputeUnitLimit, solanaSwapArtifactHash, solanaSwapHash, verifySolanaCluster, decodeRpcAccount,
  type RawSolanaAccount, type SolanaRpc } from './solana-swap.js';
import { decodeWhirlpool, type OrcaPool } from './orca-whirlpool.js';

/**
 * BUILD-015: the canonical `asset.liquidity.concentrated` action on Solana Devnet through Orca Whirlpools.
 * Gryloo reads and verifies the pool and position, computes liquidity with the program's own integer math, builds every
 * instruction itself, compiles the exact v0 message and simulates it read-only. Nothing here signs or sends.
 *
 * Instruction and account layouts: orca-so/whirlpools programs/whirlpool/src at e5f089bc5c49 (see the action-registry profile).
 * Three operations, each one reviewed transaction:
 *  - OPEN: wrap SOL, open_position_with_token_extensions, increase_liquidity_v2, unwrap. Signers: owner + new position mint.
 *  - DECREASE_PARTIAL: decrease_liquidity_v2 (part of the liquidity) + collect_fees_v2. Signer: owner.
 *  - EXIT: decrease_liquidity_v2 (all remaining) + collect_fees_v2 + close_position_with_token_extensions. Signer: owner.
 */
const P = profile.programs, POOL = profile.pool;
const fail = (code: string): never => { throw new Error(code); };
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const utf8 = (text: string) => new TextEncoder().encode(text);
const u128 = (data: Uint8Array, at: number): bigint => readU64(data, at) + (readU64(data, at + 8) << 64n);
const i32 = (data: Uint8Array, at: number): number => new DataView(data.buffer, data.byteOffset).getInt32(at, true);
const i32Bytes = (value: number): number[] => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, value, true); return [...b]; };
const u128Bytes = (value: bigint): number[] => { if (value < 0n || value >= 1n << 128n) fail('ORCA_LIQUIDITY_INTEGER_INVALID'); return [...u64Bytes(value & (1n << 64n) - 1n), ...u64Bytes(value >> 64n)]; };
const U64_MAX = (1n << 64n) - 1n;
const disc = (name: keyof typeof profile.instructions) => [...Buffer.from(profile.instructions[name], 'hex')];

// ---------------------------------------------------------------------------------------------------------------
// Exact Orca integer math (math/tick_math.rs, math/token_math.rs, manager/liquidity_manager.rs).
// ---------------------------------------------------------------------------------------------------------------
const POSITIVE: readonly bigint[] = [79232123823359799118286999567n, 79236085330515764027303304731n, 79244008939048815603706035061n,
  79259858533276714757314932305n, 79291567232598584799939703904n, 79355022692464371645785046466n, 79482085999252804386437311141n,
  79736823300114093921829183326n, 80248749790819932309965073892n, 81282483887344747381513967011n, 83390072131320151908154831281n,
  87770609709833776024991924138n, 97234110755111693312479820773n, 119332217159966728226237229890n, 179736315981702064433883588727n,
  407748233172238350107850275304n, 2098478828474011932436660412517n, 55581415166113811149459800483533n, 38992368544603139932233054999993551n];
const NEGATIVE: readonly bigint[] = [18445821805675392311n, 18444899583751176498n, 18443055278223354162n, 18439367220385604838n,
  18431993317065449817n, 18417254355718160513n, 18387811781193591352n, 18329067761203520168n, 18212142134806087854n, 17980523815641551639n,
  17526086738831147013n, 16651378430235024244n, 15030750278693429944n, 12247334978882834399n, 8131365268884726200n, 3584323654723342297n,
  696457651847595233n, 26294789957452057n, 37481735321082n];
export const ORCA_MIN_SQRT_PRICE = 4295048016n, ORCA_MAX_SQRT_PRICE = 79226673515401279992447579055n;
/** sqrt_price_from_tick_index: Q64.64 sqrt(1.0001^tick), bit-identical to the program. */
export function orcaSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isSafeInteger(tick) || tick < profile.minTick || tick > profile.maxTick) fail('ORCA_TICK_INVALID');
  if (tick >= 0) {
    let ratio = tick & 1 ? POSITIVE[0]! : 79228162514264337593543950336n;
    for (let bit = 1; bit < 19; bit++) if (tick & (1 << bit)) ratio = ratio * POSITIVE[bit]! >> 96n;
    return ratio >> 32n;
  }
  const abs = -tick;
  let ratio = abs & 1 ? NEGATIVE[0]! : 1n << 64n;
  for (let bit = 1; bit < 19; bit++) if (abs & (1 << bit)) ratio = ratio * NEGATIVE[bit]! >> 64n;
  return ratio;
}
/** The largest tick whose sqrt price is at or below `sqrtPrice` (exact; binary search over the program's own table). */
export function orcaTickAtSqrtPrice(sqrtPrice: bigint): number {
  if (sqrtPrice < ORCA_MIN_SQRT_PRICE || sqrtPrice > ORCA_MAX_SQRT_PRICE) fail('ORCA_PRICE_OUT_OF_RANGE');
  let lo: number = profile.minTick, hi: number = profile.maxTick;
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (orcaSqrtPriceAtTick(mid) <= sqrtPrice) lo = mid; else hi = mid - 1; }
  return lo;
}
function isqrt(n: bigint): bigint {
  if (n < 0n) fail('ORCA_LIQUIDITY_INTEGER_INVALID');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
}
/** token_math::get_amount_delta_a */
export function orcaAmountDeltaA(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  const numerator = liquidity * (hi - lo) << 64n, denominator = hi * lo;
  if (denominator === 0n) fail('ORCA_LIQUIDITY_INTEGER_INVALID');
  const quotient = numerator / denominator, result = roundUp && numerator % denominator !== 0n ? quotient + 1n : quotient;
  if (result > U64_MAX) fail('ORCA_TOKEN_MAX_EXCEEDED');
  return result;
}
/** token_math::get_amount_delta_b */
export function orcaAmountDeltaB(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  const [lo, hi] = sqrtA < sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA];
  const product = liquidity * (hi - lo), result = (product >> 64n) + (roundUp && (product & U64_MAX) > 0n ? 1n : 0n);
  if (result > U64_MAX) fail('ORCA_TOKEN_MAX_EXCEEDED');
  return result;
}
export type OrcaRangeState = 'BELOW_RANGE' | 'IN_RANGE' | 'ABOVE_RANGE';
/** liquidity_manager::calculate_liquidity_token_deltas: the branch uses the current tick index, the amounts the sqrt price. */
export function orcaLiquidityAmounts(pool: { tickCurrentIndex: number; sqrtPrice: bigint }, tickLower: number, tickUpper: number, liquidity: bigint, roundUp: boolean) {
  const a = orcaSqrtPriceAtTick(tickLower), b = orcaSqrtPriceAtTick(tickUpper);
  const state: OrcaRangeState = pool.tickCurrentIndex < tickLower ? 'BELOW_RANGE' : pool.tickCurrentIndex < tickUpper ? 'IN_RANGE' : 'ABOVE_RANGE';
  if (liquidity === 0n) return { state, amount0: 0n, amount1: 0n };
  if (state === 'BELOW_RANGE') return { state, amount0: orcaAmountDeltaA(a, b, liquidity, roundUp), amount1: 0n };
  if (state === 'IN_RANGE') return { state, amount0: orcaAmountDeltaA(pool.sqrtPrice, b, liquidity, roundUp), amount1: orcaAmountDeltaB(a, pool.sqrtPrice, liquidity, roundUp) };
  return { state, amount0: 0n, amount1: orcaAmountDeltaB(a, b, liquidity, roundUp) };
}
export type OrcaComposition = { state: OrcaRangeState; liquidity: bigint; amount0: bigint; amount1: bigint };
/** The largest liquidity whose rounded-up deposit fits both maxima; never more than either maximum. */
export function orcaLiquidityForMaxima(pool: { tickCurrentIndex: number; sqrtPrice: bigint }, tickLower: number, tickUpper: number,
  max0: bigint, max1: bigint): OrcaComposition {
  if (tickLower >= tickUpper || max0 < 0n || max1 < 0n || max0 > U64_MAX || max1 > U64_MAX) fail('ORCA_LIQUIDITY_INPUT_INVALID');
  const a = orcaSqrtPriceAtTick(tickLower), b = orcaSqrtPriceAtTick(tickUpper), s = pool.sqrtPrice;
  const from0 = (lo: bigint) => max0 * lo * b / ((b - lo) << 64n), from1 = (hi: bigint) => hi === a ? null : (max1 << 64n) / (hi - a);
  const state = orcaLiquidityAmounts(pool, tickLower, tickUpper, 0n, true).state;
  let liquidity = state === 'BELOW_RANGE' ? from0(a) : state === 'ABOVE_RANGE' ? from1(b)! : (() => {
    const l0 = from0(s), l1 = from1(s); return l1 === null || l0 < l1 ? l0 : l1; })();
  if (liquidity >= 1n << 128n) liquidity = (1n << 128n) - 1n;
  for (let i = 0; i < 64 && liquidity > 0n; i++) {
    const amounts = orcaLiquidityAmounts(pool, tickLower, tickUpper, liquidity, true);
    if (amounts.amount0 <= max0 && amounts.amount1 <= max1) return { ...amounts, state, liquidity };
    liquidity -= 1n + liquidity / 1_000_000_000_000n;
  }
  if (liquidity > 0n) fail('ORCA_LIQUIDITY_ROUNDING_UNRESOLVED');
  return { state, liquidity: 0n, amount0: 0n, amount1: 0n };
}

// ---------------------------------------------------------------------------------------------------------------
// Prices and deterministic range alignment.
// ---------------------------------------------------------------------------------------------------------------
const DECIMAL = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,12}))?$/;
/** Human price (token1 per token0, e.g. devUSDC per SOL) to Q64.64 sqrt price of raw units (floor). */
export function orcaSqrtPriceFromPrice(price: string, decimals0: number, decimals1: number): bigint {
  const match = DECIMAL.exec(price);
  if (!match || /^0(\.0*)?$/.test(price)) fail('ORCA_PRICE_INVALID');
  const fraction = match![2] ?? '', numerator = BigInt(match![1]! + fraction), denominator = 10n ** BigInt(fraction.length);
  const scaled = (numerator * 10n ** BigInt(decimals1) << 128n) / (denominator * 10n ** BigInt(decimals0));
  return isqrt(scaled);
}
/** Q64.64 sqrt price to a human price with `places` decimals (floor). */
export function orcaPriceFromSqrtPrice(sqrtPrice: bigint, decimals0: number, decimals1: number, places = 6): string {
  const scaled = (sqrtPrice * sqrtPrice * 10n ** BigInt(decimals0 + places)) / (10n ** BigInt(decimals1) << 128n);
  const text = scaled.toString().padStart(places + 1, '0');
  return `${text.slice(0, -places)}.${text.slice(-places)}`;
}
const alignDown = (tick: number, spacing: number) => Math.floor(tick / spacing) * spacing;
const alignUp = (tick: number, spacing: number) => Math.ceil(tick / spacing) * spacing;
/**
 * Deterministic alignment of a human price range to usable ticks: the lower bound rounds down and the upper bound rounds
 * up to the tick spacing, so the aligned range always contains the requested one. Integer-only; no floating point.
 */
export function orcaAlignPriceRange(lowerPrice: string, upperPrice: string, spacing = POOL.tickSpacing, decimals0 = profile.token0.decimals,
  decimals1 = profile.token1.decimals): { tickLower: number; tickUpper: number } {
  const lo = orcaSqrtPriceFromPrice(lowerPrice, decimals0, decimals1), hi = orcaSqrtPriceFromPrice(upperPrice, decimals0, decimals1);
  if (lo >= hi) fail('ORCA_PRICE_RANGE_INVALID');
  const rawLower = orcaTickAtSqrtPrice(lo), atUpper = orcaTickAtSqrtPrice(hi);
  const rawUpper = orcaSqrtPriceAtTick(atUpper) === hi ? atUpper : atUpper + 1;
  const tickLower = alignDown(rawLower, spacing), tickUpper = alignUp(rawUpper, spacing);
  if (tickLower < alignUp(profile.minTick, spacing) || tickUpper > alignDown(profile.maxTick, spacing) || tickLower >= tickUpper) fail('ORCA_PRICE_RANGE_INVALID');
  return { tickLower, tickUpper };
}
/** Bounds `bps` below and above the pool price, as human prices (6 decimals, outward-rounded by the alignment). */
export function orcaPriceBandAround(sqrtPrice: bigint, bps: number, decimals0 = profile.token0.decimals, decimals1 = profile.token1.decimals) {
  if (!Number.isSafeInteger(bps) || bps < 1 || bps >= 10_000) fail('ORCA_PRICE_RANGE_INVALID');
  const square = sqrtPrice * sqrtPrice;
  const lower = isqrt(square * BigInt(10_000 - bps) / 10_000n), upper = isqrt(square * BigInt(10_000 + bps) / 10_000n) + 1n;
  return { lowerPrice: orcaPriceFromSqrtPrice(lower, decimals0, decimals1), upperPrice: orcaPriceFromSqrtPrice(upper, decimals0, decimals1) };
}

// ---------------------------------------------------------------------------------------------------------------
// Accounts, instruction codec and events.
// ---------------------------------------------------------------------------------------------------------------
export const orcaPositionAddress = (mint: string) => findProgramAddress([utf8('position'), publicKeyBytes(mint)], P.whirlpool);
export const orcaPositionTokenAccount = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token2022, P.associatedToken);
export const orcaTickArrayStart = (tick: number, spacing = POOL.tickSpacing) => Math.floor(tick / (profile.tickArraySize * spacing)) * profile.tickArraySize * spacing;
export const orcaLiquidityTickArray = (pool: string, tick: number, spacing = POOL.tickSpacing) =>
  findProgramAddress([utf8('tick_array'), publicKeyBytes(pool), utf8(String(orcaTickArrayStart(tick, spacing)))], P.whirlpool);
const ownerAta = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token, P.associatedToken);

export type OrcaPosition = { address: string; whirlpool: string; positionMint: string; liquidity: string; tickLowerIndex: number; tickUpperIndex: number;
  feeOwedA: string; feeOwedB: string; rewardOwed: string[] };
/** Position account (state/position.rs, 216 bytes). */
export function decodeOrcaPosition(address: string, data: Uint8Array): OrcaPosition {
  if (data.length !== 216 || hex(data.slice(0, 8)) !== profile.positionDiscriminator) fail('ORCA_POSITION_INVALID');
  return { address, whirlpool: base58Encode(data.slice(8, 40)), positionMint: base58Encode(data.slice(40, 72)), liquidity: u128(data, 72).toString(),
    tickLowerIndex: i32(data, 88), tickUpperIndex: i32(data, 92), feeOwedA: readU64(data, 112).toString(), feeOwedB: readU64(data, 136).toString(),
    rewardOwed: [0, 1, 2].map(i => readU64(data, 160 + i * 24).toString()) };
}
/** Token-2022 (or SPL) token account base layout; extensions follow byte 165. */
export function decodeToken2022Account(data: Uint8Array): { mint: string; owner: string; amount: bigint; delegate: string | null } {
  if (data.length < 165) fail('ORCA_POSITION_TOKEN_ACCOUNT_INVALID');
  return { mint: base58Encode(data.slice(0, 32)), owner: base58Encode(data.slice(32, 64)), amount: readU64(data, 64),
    delegate: new DataView(data.buffer, data.byteOffset).getUint32(72, true) === 1 ? base58Encode(data.slice(76, 108)) : null };
}
/** Reward emitters initialized on a pool (Whirlpool.reward_infos[i].mint != default). */
export function orcaPoolRewardMints(data: Uint8Array): string[] {
  if (data.length < 269 + 3 * 128) fail('ORCA_POOL_INVALID');
  return [0, 1, 2].map(i => base58Encode(data.slice(269 + i * 128, 301 + i * 128))).filter(mint => mint !== P.system);
}
export function encodeOrcaOpenPosition(tickLower: number, tickUpper: number): Uint8Array {
  return Uint8Array.from([...disc('openPositionWithTokenExtensions'), ...i32Bytes(tickLower), ...i32Bytes(tickUpper), 0]);
}
export function decodeOrcaOpenPosition(data: Uint8Array): { tickLower: number; tickUpper: number; withTokenMetadata: boolean } {
  if (data.length !== 17 || hex(data.slice(0, 8)) !== profile.instructions.openPositionWithTokenExtensions || data[16]! > 1) fail('ORCA_INSTRUCTION_UNSUPPORTED');
  return { tickLower: i32(data, 8), tickUpper: i32(data, 12), withTokenMetadata: data[16] === 1 };
}
/** increase_liquidity_v2(liquidity u128, token_max_a u64, token_max_b u64, None) / decrease_liquidity_v2(liquidity, token_min_a, token_min_b, None). */
export function encodeOrcaModifyLiquidity(kind: 'increase' | 'decrease', liquidity: bigint, tokenA: bigint, tokenB: bigint): Uint8Array {
  if (tokenA > U64_MAX || tokenB > U64_MAX || tokenA < 0n || tokenB < 0n) fail('ORCA_LIQUIDITY_INTEGER_INVALID');
  return Uint8Array.from([...disc(kind === 'increase' ? 'increaseLiquidityV2' : 'decreaseLiquidityV2'), ...u128Bytes(liquidity), ...u64Bytes(tokenA), ...u64Bytes(tokenB), 0]);
}
export function decodeOrcaModifyLiquidity(data: Uint8Array): { kind: 'increase' | 'decrease'; liquidity: string; tokenA: string; tokenB: string } {
  const d = hex(data.slice(0, 8));
  const kind = d === profile.instructions.increaseLiquidityV2 ? 'increase' : d === profile.instructions.decreaseLiquidityV2 ? 'decrease' : fail('ORCA_INSTRUCTION_UNSUPPORTED');
  if (data.length !== 41 || data[40] !== 0) fail('ORCA_INSTRUCTION_UNSUPPORTED');
  return { kind, liquidity: u128(data, 8).toString(), tokenA: readU64(data, 24).toString(), tokenB: readU64(data, 32).toString() };
}
export const encodeOrcaCollectFees = () => Uint8Array.from([...disc('collectFeesV2'), 0]);
export const encodeOrcaClosePosition = () => Uint8Array.from(disc('closePositionWithTokenExtensions'));
export type OrcaLiquidityEvent = { kind: 'PositionOpened' | 'LiquidityIncreased' | 'LiquidityDecreased'; whirlpool: string; position: string; tickLower: number;
  tickUpper: number; liquidity: string | null; tokenA: string | null; tokenB: string | null; tokenATransferFee: string | null; tokenBTransferFee: string | null };
/** Anchor events emitted by the Whirlpools program ("Program data: <base64>"). Unrelated data lines are ignored. */
export function parseOrcaLiquidityEvents(logs: readonly string[]): OrcaLiquidityEvent[] {
  return logs.flatMap((line): OrcaLiquidityEvent[] => {
    const match = /^Program data: ([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (!match) return [];
    const data = Uint8Array.from(Buffer.from(match[1]!, 'base64')), d = hex(data.slice(0, 8));
    const head = () => ({ whirlpool: base58Encode(data.slice(8, 40)), position: base58Encode(data.slice(40, 72)), tickLower: i32(data, 72), tickUpper: i32(data, 76) });
    if (d === profile.events.positionOpened && data.length === 80)
      return [{ kind: 'PositionOpened' as const, ...head(), liquidity: null, tokenA: null, tokenB: null, tokenATransferFee: null, tokenBTransferFee: null }];
    if ((d === profile.events.liquidityIncreased || d === profile.events.liquidityDecreased) && data.length === 128)
      return [{ kind: d === profile.events.liquidityIncreased ? 'LiquidityIncreased' as const : 'LiquidityDecreased' as const, ...head(), liquidity: u128(data, 80).toString(),
        tokenA: readU64(data, 96).toString(), tokenB: readU64(data, 104).toString(), tokenATransferFee: readU64(data, 112).toString(), tokenBTransferFee: readU64(data, 120).toString() }];
    return [];
  });
}

const m = (pubkey: string, isWritable: boolean, isSigner = false) => ({ pubkey, isSigner, isWritable });
function createAtaIdempotent(owner: string, account: string, mint: string): SolanaInstruction {
  return { programId: P.associatedToken, data: Uint8Array.of(1), accounts: [m(owner, true, true), m(account, true), m(owner, false), m(mint, false), m(P.system, false), m(P.token, false)] };
}
export type OrcaLiquidityAccounts = { owner: string; ownerTokenA: string; ownerTokenB: string; positionMint: string; position: string; positionTokenAccount: string;
  tickArrayLower: string; tickArrayUpper: string };
export function orcaLiquidityAccounts(owner: string, positionMint: string, tickLower: number, tickUpper: number): OrcaLiquidityAccounts {
  return { owner, ownerTokenA: ownerAta(owner, POOL.tokenMintA), ownerTokenB: ownerAta(owner, POOL.tokenMintB), positionMint, position: orcaPositionAddress(positionMint),
    positionTokenAccount: orcaPositionTokenAccount(owner, positionMint), tickArrayLower: orcaLiquidityTickArray(POOL.address, tickLower),
    tickArrayUpper: orcaLiquidityTickArray(POOL.address, tickUpper) };
}
function modifyLiquidity(a: OrcaLiquidityAccounts, data: Uint8Array): SolanaInstruction {
  return { programId: P.whirlpool, data, accounts: [m(POOL.address, true), m(P.token, false), m(P.token, false), m(P.memo, false), m(a.owner, false, true),
    m(a.position, true), m(a.positionTokenAccount, false), m(POOL.tokenMintA, false), m(POOL.tokenMintB, false), m(a.ownerTokenA, true), m(a.ownerTokenB, true),
    m(POOL.tokenVaultA, true), m(POOL.tokenVaultB, true), m(a.tickArrayLower, true), m(a.tickArrayUpper, true)] };
}
export type OrcaLiquidityPlan = { operation: OrcaLiquidityOperation; liquidityDelta: string; tokenA: string; tokenB: string; wrapLamports: string;
  tickLower: number; tickUpper: number; decrease: boolean; close: boolean };
/**
 * Every instruction is Gryloo-built. Signers: the owner and, for OPEN only, the new position mint (account creation only).
 * Token accounts are the owner's own; the temporary wrapped-SOL account is opened and closed in the same transaction.
 */
export function orcaLiquidityInstructions(a: OrcaLiquidityAccounts, plan: OrcaLiquidityPlan, units: number): SolanaInstruction[] {
  const unwrap: SolanaInstruction = { programId: P.token, data: Uint8Array.of(9), accounts: [m(a.ownerTokenA, true), m(a.owner, true), m(a.owner, false, true)] };
  const head = [setComputeUnitLimit(units), createAtaIdempotent(a.owner, a.ownerTokenA, POOL.tokenMintA)];
  if (plan.operation === 'OPEN') {
    const wrap = BigInt(plan.wrapLamports);
    return [...head,
      ...wrap > 0n ? [{ programId: P.system, data: Uint8Array.from([...u32Bytes(2), ...u64Bytes(wrap)]), accounts: [m(a.owner, true, true), m(a.ownerTokenA, true)] },
        { programId: P.token, data: Uint8Array.of(17), accounts: [m(a.ownerTokenA, true)] }] : [],
      createAtaIdempotent(a.owner, a.ownerTokenB, POOL.tokenMintB),
      { programId: P.whirlpool, data: encodeOrcaOpenPosition(plan.tickLower, plan.tickUpper), accounts: [m(a.owner, true, true), m(a.owner, false), m(a.position, true),
        m(a.positionMint, true, true), m(a.positionTokenAccount, true), m(POOL.address, false), m(P.token2022, false), m(P.system, false), m(P.associatedToken, false),
        m(profile.metadataUpdateAuth, false)] },
      modifyLiquidity(a, encodeOrcaModifyLiquidity('increase', BigInt(plan.liquidityDelta), BigInt(plan.tokenA), BigInt(plan.tokenB))),
      unwrap];
  }
  return [...head, createAtaIdempotent(a.owner, a.ownerTokenB, POOL.tokenMintB),
    ...plan.decrease ? [modifyLiquidity(a, encodeOrcaModifyLiquidity('decrease', BigInt(plan.liquidityDelta), BigInt(plan.tokenA), BigInt(plan.tokenB)))] : [],
    { programId: P.whirlpool, data: encodeOrcaCollectFees(), accounts: [m(POOL.address, false), m(a.owner, false, true), m(a.position, true), m(a.positionTokenAccount, false),
      m(POOL.tokenMintA, false), m(POOL.tokenMintB, false), m(a.ownerTokenA, true), m(POOL.tokenVaultA, true), m(a.ownerTokenB, true), m(POOL.tokenVaultB, true),
      m(P.token, false), m(P.token, false), m(P.memo, false)] },
    ...plan.close ? [{ programId: P.whirlpool, data: encodeOrcaClosePosition(), accounts: [m(a.owner, false, true), m(a.owner, true), m(a.position, true),
      m(a.positionMint, true), m(a.positionTokenAccount, true), m(P.token2022, false)] }] : [],
    unwrap];
}
/** Programs a reviewed liquidity transaction may invoke at the top level. */
export const ORCA_LIQUIDITY_TOP_LEVEL_PROGRAMS: readonly string[] = Object.freeze([P.computeBudget, P.associatedToken, P.system, P.token, P.whirlpool]);
/** Programs the Whirlpools/ATA instructions may invoke internally. */
export const ORCA_LIQUIDITY_INNER_PROGRAMS: readonly string[] = Object.freeze([P.token, P.token2022, P.system, P.associatedToken]);

/** The compiled bytes must resolve to exactly the planned instructions, with exactly the planned signers. */
export function assertLiquidityMessageRoundTrip(bytes: Uint8Array, instructions: SolanaInstruction[], signers: readonly string[]): void {
  const message = parseMessageV0(bytes);
  if (message.header[0] !== signers.length || message.header[1] !== 0 || message.lookups.length !== 0 ||
      signers.some((s, i) => message.staticKeys[i] !== s)) fail('ORCA_LIQUIDITY_MESSAGE_ROUND_TRIP_MISMATCH');
  const writable = new Set([signers[0]!, ...instructions.flatMap(i => i.accounts.filter(a => a.isWritable).map(a => a.pubkey))]);
  const normalize = (list: SolanaInstruction[]) => JSON.stringify(list.map(i => ({ programId: i.programId, data: toBase64(i.data),
    accounts: i.accounts.map(a => [a.pubkey, signers.includes(a.pubkey), writable.has(a.pubkey)]) })));
  const decoded = decompileMessageV0(message, {});
  if (decoded.some(i => i.accounts.some(a => a.isSigner !== signers.includes(a.pubkey) || a.isWritable !== writable.has(a.pubkey))) ||
      normalize(decoded) !== normalize(instructions)) fail('ORCA_LIQUIDITY_MESSAGE_ROUND_TRIP_MISMATCH');
}

// ---------------------------------------------------------------------------------------------------------------
// Intent, chain reads, simulation and Review.
// ---------------------------------------------------------------------------------------------------------------
export type OrcaLiquidityIntent = { nodeId: string; owner: string; amount0Max: string; amount1Max: string; amount0Min: string; amount1Min: string;
  tickLower: number; tickUpper: number; slippageBps: number; feeTier: number };
/** Read the canonical action and resolve it against the exact Orca Devnet liquidity profile (defense in depth; the linter checks the same). */
export function orcaLiquidityIntent(workflow: SemanticWorkflow, owner: string): OrcaLiquidityIntent {
  const nodes = workflow.nodes.filter(n => n.actionType === CONCENTRATED_LIQUIDITY_ACTION);
  if (nodes.length !== 1 || workflow.nodes.some(n => n !== nodes[0] && !n.actionType.startsWith('mock-'))) fail('SOLANA_LIQUIDITY_ISOLATED_ONLY');
  let f: ReturnType<typeof readConcentratedLiquidity>;
  try { f = readConcentratedLiquidity(nodes[0]!); } catch { return fail('SOLANA_LIQUIDITY_DECLARATION_INVALID'); }
  if (f.chain !== profile.chain) fail('SOLANA_CLUSTER_UNSUPPORTED');
  if (f.token0.address !== profile.token0.mint || f.token1.address !== profile.token1.mint || f.token0.decimals !== profile.token0.decimals ||
      f.token1.decimals !== profile.token1.decimals) fail('SOLANA_MINT_UNSUPPORTED');
  if (f.protocols.join() !== profile.protocol) fail('SOLANA_LIQUIDITY_PROVIDER_UNSUPPORTED');
  if (f.feeTier !== profile.feeTier) fail('SOLANA_LIQUIDITY_POOL_UNSUPPORTED');
  if (f.tickLower % POOL.tickSpacing !== 0 || f.tickUpper % POOL.tickSpacing !== 0 || f.tickLower < profile.minTick || f.tickUpper > profile.maxTick) fail('SOLANA_LIQUIDITY_RANGE_INVALID');
  if (f.slippageBps === null || f.slippageBps < 1 || f.slippageBps > profile.maximumSlippageBps) fail('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  if (BigInt(f.amount0Max) > BigInt(profile.token0.maximumAmount) || BigInt(f.amount1Max) > BigInt(profile.token1.maximumAmount)) fail('AMOUNT_OUT_OF_RANGE');
  if (f.recipient !== null) fail('SOLANA_LIQUIDITY_DECLARATION_INVALID');
  return { nodeId: nodes[0]!.nodeId, owner: solanaAddress(owner), amount0Max: f.amount0Max, amount1Max: f.amount1Max, amount0Min: f.amount0Min,
    amount1Min: f.amount1Min, tickLower: f.tickLower, tickUpper: f.tickUpper, slippageBps: f.slippageBps!, feeTier: f.feeTier };
}
export type OrcaLiquidityPool = OrcaPool & { rewardMints: string[] };
/** The verified Devnet test pool with the profile's fee tier and no reward emitters (rewards are out of scope). */
export async function readOrcaLiquidityPool(rpc: SolanaRpc): Promise<OrcaLiquidityPool> {
  const { slot, accounts } = await readSolanaAccounts(rpc, [POOL.address]);
  const account = accounts[0];
  if (!account || account.owner !== P.whirlpool) fail('ORCA_POOL_MISMATCH');
  const pool = decodeWhirlpool(POOL.address, account!.data, slot);
  if (pool.whirlpoolsConfig !== profile.whirlpoolsConfig || pool.tokenMintA !== POOL.tokenMintA || pool.tokenMintB !== POOL.tokenMintB ||
      pool.tokenVaultA !== POOL.tokenVaultA || pool.tokenVaultB !== POOL.tokenVaultB || pool.tickSpacing !== POOL.tickSpacing || pool.feeRate !== profile.feeTier) fail('ORCA_POOL_MISMATCH');
  if (BigInt(pool.sqrtPrice) === 0n) fail('ORCA_POOL_NO_LIQUIDITY');
  const rewardMints = orcaPoolRewardMints(account!.data);
  if (rewardMints.length) fail('ORCA_POOL_REWARDS_UNSUPPORTED');
  return { ...pool, rewardMints };
}
export type OrcaPositionState = { position: OrcaPosition; tokenAccount: { address: string; owner: string; amount: string; delegate: string | null } };
/** The position must be a Whirlpools position on the verified pool whose single position token the owner holds (the position authority). */
export function verifyOrcaPosition(owner: string, mint: string, positionAccount: RawSolanaAccount, tokenAccount: RawSolanaAccount): OrcaPositionState {
  if (!positionAccount) fail('ORCA_POSITION_NOT_FOUND');
  if (positionAccount!.owner !== P.whirlpool) fail('ORCA_POSITION_INVALID');
  const position = decodeOrcaPosition(orcaPositionAddress(mint), positionAccount!.data);
  if (position.whirlpool !== POOL.address || position.positionMint !== mint) fail('ORCA_POSITION_POOL_MISMATCH');
  if (!tokenAccount || tokenAccount.owner !== P.token2022) fail('ORCA_POSITION_AUTHORITY_MISMATCH');
  const token = decodeToken2022Account(tokenAccount!.data);
  if (token.mint !== mint || token.owner !== owner || token.amount !== 1n || token.delegate !== null) fail('ORCA_POSITION_AUTHORITY_MISMATCH');
  return { position, tokenAccount: { address: orcaPositionTokenAccount(owner, mint), owner: token.owner, amount: token.amount.toString(), delegate: token.delegate } };
}

export type OrcaLiquidityRequest = { operation: OrcaLiquidityOperation; positionMint: string; partBps?: number };
export type OrcaLiquidityBalances = { slot: number; ownerLamports: string; tokenA: string | null; tokenB: string | null; position: OrcaPosition | null;
  positionLamports: string; positionMintLamports: string; positionTokenLamports: string; vaultA: string; vaultB: string };
export type OrcaLiquiditySimulation = { slot: number; unitsConsumed: number; logs: string[]; events: OrcaLiquidityEvent[]; pre: OrcaLiquidityBalances; post: OrcaLiquidityBalances;
  /** Owner economic deltas: positive values leave the owner. SOL is measured on lamports net of fee and rent. */
  depositedA: string; depositedB: string; withdrawnPrincipalA: string; withdrawnPrincipalB: string; collectedFeesA: string; collectedFeesB: string;
  rentPaidLamports: string; rentRefundedLamports: string; feeLamports: string; createdAccounts: string[]; closedAccounts: string[];
  residualTokenA: string; residualTokenB: string };
export type OrcaLiquidityArtifacts = { artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan };
export type OrcaLiquidityReview = OrcaLiquidityArtifacts & {
  format: 'gryloo.orca-liquidity-review.v1'; operation: OrcaLiquidityOperation; provider: 'Orca Whirlpools'; workflow: SemanticWorkflow; nodeId: string;
  chain: string; cluster: 'devnet'; genesisHash: string; owner: string; program: string; whirlpoolsConfig: string;
  token0: { symbol: string; mint: string; decimals: number }; token1: { symbol: string; mint: string; decimals: number };
  intent: OrcaLiquidityIntent; partBps: number | null;
  pool: { address: string; tickSpacing: number; feeRate: number; liquidity: string; sqrtPrice: string; tickCurrentIndex: number; slot: number; price: string };
  range: { tickLower: number; tickUpper: number; lowerPrice: string; upperPrice: string; state: OrcaRangeState };
  /** Planned liquidity delta and token bounds as encoded in the instruction (maxima for OPEN, minima for withdrawals). */
  operationPlan: OrcaLiquidityPlan; expected: { liquidity: string; amountA: string; amountB: string; positionLiquidityAfter: string };
  accounts: OrcaLiquidityAccounts & { tokenProgramPosition: string; vaultA: string; vaultB: string; mayBeCreated: string[] };
  signers: string[]; programs: string[]; instructionSummary: { programId: string; name: string; args: unknown }[];
  blockhash: string; lastValidBlockHeight: number; computeUnitLimit: number; estimatedFeeLamports: string; estimatedRentLamports: string;
  ownerBalances: { lamports: string; tokenA: string | null; tokenB: string | null };
  message: string; messageHash: string; unsignedTransaction: string; simulationResult: OrcaLiquiditySimulation; observedAt: string; expiresAt: string; commitment: string;
};

const TOKEN_ACCOUNT_RENT = 2_039_280n;
function tokenAmount(a: RawSolanaAccount, owner: string, mint: string): string | null {
  if (!a || a.lamports === 0n && a.data.length === 0) return null;
  const t = decodeToken2022Account(a.data);
  if (a.owner !== P.token || a.data.length !== 165 || t.owner !== owner || t.mint !== mint) fail('SOLANA_TOKEN_ACCOUNT_MISMATCH');
  return t.amount.toString();
}
function vaultAmount(a: RawSolanaAccount, mint: string): string {
  if (!a || a.owner !== P.token) fail('ORCA_POOL_MISMATCH');
  const t = decodeToken2022Account(a!.data);
  if (t.mint !== mint || t.owner !== POOL.address) fail('ORCA_POOL_MISMATCH');
  return t.amount.toString();
}
/** Balances of every account the reviewed transaction may touch, in one read (or one simulation post-state). */
const balanceKeys = (a: OrcaLiquidityAccounts) => [a.owner, a.ownerTokenA, a.ownerTokenB, a.position, a.positionMint, a.positionTokenAccount, POOL.tokenVaultA, POOL.tokenVaultB];
function readBalances(slot: number, a: OrcaLiquidityAccounts, accounts: RawSolanaAccount[]): OrcaLiquidityBalances {
  const [owner, tokenA, tokenB, position, mint, positionToken, vaultA, vaultB] = accounts;
  const live = (x: RawSolanaAccount | undefined) => x && !(x.lamports === 0n && x.data.length === 0) ? x : null;
  return { slot, ownerLamports: (owner?.lamports ?? 0n).toString(), tokenA: tokenAmount(tokenA ?? null, a.owner, POOL.tokenMintA), tokenB: tokenAmount(tokenB ?? null, a.owner, POOL.tokenMintB),
    position: live(position) && position!.owner === P.whirlpool ? decodeOrcaPosition(a.position, position!.data) : null,
    positionLamports: (live(position)?.lamports ?? 0n).toString(), positionMintLamports: (live(mint)?.lamports ?? 0n).toString(),
    positionTokenLamports: (live(positionToken)?.lamports ?? 0n).toString(), vaultA: vaultAmount(vaultA ?? null, POOL.tokenMintA), vaultB: vaultAmount(vaultB ?? null, POOL.tokenMintB) };
}
/** Read-only simulateTransaction of the exact unsigned multi-signer message; nothing is signed. */
async function simulateMessage(rpc: SolanaRpc, message: Uint8Array, signers: number, addresses: string[]) {
  const tx = toBase64(serializeSignedTransaction(new Array<null>(signers).fill(null), message));
  const value = rpcContextValue(await rpc('simulateTransaction', [tx, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses } }]));
  const allLogs = Array.isArray(value.logs) ? (value.logs as unknown[]).filter((l): l is string => typeof l === 'string') : [];
  const logs = allLogs.slice(-60).map(l => l.slice(0, 300));
  if (value.err !== null) throw new Error('ORCA_LIQUIDITY_SIMULATION_FAILED', { cause: { err: value.err, logs } });
  if (!Number.isSafeInteger(value.unitsConsumed) || (value.unitsConsumed as number) <= 0 || !Array.isArray(value.accounts) || value.accounts.length !== addresses.length)
    fail('ORCA_LIQUIDITY_SIMULATION_INVALID');
  return { unitsConsumed: value.unitsConsumed as number, logs, allLogs: allLogs.slice(-300), accounts: (value.accounts as unknown[]).map(decodeRpcAccount) };
}
export const orcaLiquidityFee = (signers: number) => (BigInt(profile.baseFeeLamports) * BigInt(signers)).toString();
const NAMES: Record<string, string> = { [profile.instructions.openPositionWithTokenExtensions]: 'open_position_with_token_extensions',
  [profile.instructions.increaseLiquidityV2]: 'increase_liquidity_v2', [profile.instructions.decreaseLiquidityV2]: 'decrease_liquidity_v2',
  [profile.instructions.collectFeesV2]: 'collect_fees_v2', [profile.instructions.closePositionWithTokenExtensions]: 'close_position_with_token_extensions' };
/** Human-readable decoding of every reviewed instruction; unknown instructions fail closed. */
export function summarizeOrcaLiquidityInstructions(instructions: SolanaInstruction[]): { programId: string; name: string; args: unknown }[] {
  return instructions.map(ix => {
    if (ix.programId === P.computeBudget && ix.data[0] === 2 && ix.data.length === 5) return { programId: ix.programId, name: 'set_compute_unit_limit', args: { units: new DataView(ix.data.buffer, ix.data.byteOffset).getUint32(1, true) } };
    if (ix.programId === P.associatedToken && ix.data.length === 1 && ix.data[0] === 1) return { programId: ix.programId, name: 'create_idempotent', args: { account: ix.accounts[1]?.pubkey, mint: ix.accounts[3]?.pubkey } };
    if (ix.programId === P.system && ix.data.length === 12 && ix.data[0] === 2) return { programId: ix.programId, name: 'transfer', args: { to: ix.accounts[1]?.pubkey, lamports: readU64(ix.data, 4).toString() } };
    if (ix.programId === P.token && ix.data.length === 1 && ix.data[0] === 17) return { programId: ix.programId, name: 'sync_native', args: { account: ix.accounts[0]?.pubkey } };
    if (ix.programId === P.token && ix.data.length === 1 && ix.data[0] === 9) return { programId: ix.programId, name: 'close_account', args: { account: ix.accounts[0]?.pubkey, destination: ix.accounts[1]?.pubkey } };
    if (ix.programId === P.whirlpool) {
      const name = NAMES[hex(ix.data.slice(0, 8))] ?? fail('ORCA_INSTRUCTION_UNSUPPORTED');
      const args = name === 'open_position_with_token_extensions' ? decodeOrcaOpenPosition(ix.data) : name.endsWith('liquidity_v2') ? decodeOrcaModifyLiquidity(ix.data)
        : name === 'collect_fees_v2' ? (ix.data.length === 9 && ix.data[8] === 0 ? {} : fail('ORCA_INSTRUCTION_UNSUPPORTED')) : (ix.data.length === 8 ? {} : fail('ORCA_INSTRUCTION_UNSUPPORTED'));
      return { programId: ix.programId, name, args };
    }
    return fail('ORCA_LIQUIDITY_UNEXPECTED_PROGRAM');
  });
}

const slipUp = (v: bigint, bps: number) => (v * BigInt(10_000 + bps) + 9_999n) / 10_000n;
const slipDown = (v: bigint, bps: number) => v * BigInt(10_000 - bps) / 10_000n;
const min = (a: bigint, b: bigint) => a < b ? a : b;

/**
 * Read-only: verify cluster, pool, tick arrays, owner accounts and (for withdrawals) the owner's position; plan the
 * operation with the program's own math; compile and simulate the exact message; build the frozen v1 artifact chain.
 * `positionMint` is the client-generated public key for OPEN (its secret never reaches the server) and the existing
 * position mint otherwise.
 */
export async function simulateOrcaLiquidity(workflow: SemanticWorkflow, ownerInput: string, request: OrcaLiquidityRequest, rpc: SolanaRpc,
  now = Date.now()): Promise<OrcaLiquidityReview> {
  const intent = orcaLiquidityIntent(workflow, ownerInput), owner = intent.owner, operation = request.operation;
  if (!['OPEN', 'DECREASE_PARTIAL', 'EXIT'].includes(operation)) fail('ORCA_LIQUIDITY_OPERATION_INVALID');
  const positionMint = solanaAddress(request.positionMint);
  if (positionMint === owner || ([P.whirlpool, P.system, POOL.address, POOL.tokenMintA, POOL.tokenMintB] as string[]).includes(positionMint)) fail('ORCA_POSITION_MINT_INVALID');
  const partBps = operation === 'DECREASE_PARTIAL' ? request.partBps ?? fail('ORCA_LIQUIDITY_PART_INVALID') : null;
  if (partBps !== null && (!Number.isSafeInteger(partBps) || partBps < 1 || partBps > 9_999)) fail('ORCA_LIQUIDITY_PART_INVALID');
  await verifySolanaCluster(rpc, profile.genesisHash);
  const observedAt = new Date(now).toISOString();
  const pool = await readOrcaLiquidityPool(rpc);
  const accounts = orcaLiquidityAccounts(owner, positionMint, intent.tickLower, intent.tickUpper);
  const { slot, accounts: read } = await readSolanaAccounts(rpc, [...balanceKeys(accounts), accounts.tickArrayLower, accounts.tickArrayUpper]);
  // Tick arrays must already be initialized by the program; initializing new arrays is out of scope.
  if ([read[8], read[9]].some(t => !t || t.owner !== P.whirlpool)) fail('ORCA_TICK_ARRAY_UNINITIALIZED');
  // Fixed-size tick arrays only: dynamic arrays move tick rent between the position and the array, which reconciliation does not model.
  if ([read[8], read[9]].some(t => hex(t!.data.slice(0, 8)) !== profile.tickArrayDiscriminator)) fail('ORCA_TICK_ARRAY_DYNAMIC_UNSUPPORTED');
  const pre = readBalances(slot, accounts, read.slice(0, 8));
  if (pre.tokenA !== null) fail('ORCA_LIQUIDITY_WRAPPED_SOL_ACCOUNT_PRESENT');
  const sqrtPrice = BigInt(pool.sqrtPrice), poolState = { tickCurrentIndex: pool.tickCurrentIndex, sqrtPrice };
  let plan: OrcaLiquidityPlan, expected: OrcaLiquidityReview['expected'];
  if (operation === 'OPEN') {
    if (read[3] || read[4] || read[5]) fail('ORCA_POSITION_MINT_IN_USE');
    const composition = orcaLiquidityForMaxima(poolState, intent.tickLower, intent.tickUpper, BigInt(intent.amount0Max), BigInt(intent.amount1Max));
    if (composition.liquidity === 0n || composition.amount0 === 0n && composition.amount1 === 0n) fail('ORCA_LIQUIDITY_ZERO');
    if (composition.amount0 < BigInt(intent.amount0Min) || composition.amount1 < BigInt(intent.amount1Min)) fail('ORCA_LIQUIDITY_BELOW_MINIMUM');
    // Fixed liquidity; the token maxima bound adverse price movement and never exceed the authored maxima.
    const maxA = min(BigInt(intent.amount0Max), slipUp(composition.amount0, intent.slippageBps)), maxB = min(BigInt(intent.amount1Max), slipUp(composition.amount1, intent.slippageBps));
    if (BigInt(pre.tokenB ?? '0') < maxB) fail('ORCA_LIQUIDITY_INSUFFICIENT_DEVUSDC');
    plan = { operation, liquidityDelta: composition.liquidity.toString(), tokenA: maxA.toString(), tokenB: maxB.toString(), wrapLamports: maxA.toString(),
      tickLower: intent.tickLower, tickUpper: intent.tickUpper, decrease: false, close: false };
    expected = { liquidity: composition.liquidity.toString(), amountA: composition.amount0.toString(), amountB: composition.amount1.toString(), positionLiquidityAfter: composition.liquidity.toString() };
  } else {
    const state = verifyOrcaPosition(owner, positionMint, read[3] ?? null, read[5] ?? null);
    if (state.position.tickLowerIndex !== intent.tickLower || state.position.tickUpperIndex !== intent.tickUpper) fail('ORCA_POSITION_RANGE_MISMATCH');
    if (state.position.rewardOwed.some(r => r !== '0')) fail('ORCA_POSITION_REWARDS_UNSUPPORTED');
    const liquidity = BigInt(state.position.liquidity);
    const delta = operation === 'EXIT' ? liquidity : liquidity * BigInt(partBps!) / 10_000n;
    if (operation === 'DECREASE_PARTIAL' && (delta === 0n || delta >= liquidity)) fail(liquidity === 0n ? 'ORCA_POSITION_EMPTY' : 'ORCA_LIQUIDITY_PART_INVALID');
    const out = orcaLiquidityAmounts(poolState, intent.tickLower, intent.tickUpper, delta, false);
    plan = { operation, liquidityDelta: delta.toString(), tokenA: slipDown(out.amount0, intent.slippageBps).toString(), tokenB: slipDown(out.amount1, intent.slippageBps).toString(),
      wrapLamports: '0', tickLower: intent.tickLower, tickUpper: intent.tickUpper, decrease: delta > 0n, close: operation === 'EXIT' };
    expected = { liquidity: delta.toString(), amountA: out.amount0.toString(), amountB: out.amount1.toString(), positionLiquidityAfter: (liquidity - delta).toString() };
  }
  const signers = operation === 'OPEN' ? [owner, positionMint] : [owner];
  const latest = rpcContextValue(await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]));
  const blockhash = solanaAddress(latest.blockhash), lastValidBlockHeight = latest.lastValidBlockHeight;
  if (!Number.isSafeInteger(lastValidBlockHeight)) fail('SOLANA_RPC_INVALID');
  const build = (units: number) => {
    const instructions = orcaLiquidityInstructions(accounts, plan, units);
    const compiled = compileMessageV0(owner, instructions, blockhash, {});
    if (compiled.header[0] !== signers.length || signers.some((s, i) => compiled.staticKeys[i] !== s)) fail('ORCA_LIQUIDITY_UNEXPECTED_SIGNER');
    const bytes = serializeMessageV0(compiled);
    if (bytes.length > 1_232 - 1 - 64 * signers.length) fail('SOLANA_TRANSACTION_TOO_LARGE');
    return { instructions, bytes };
  };
  const addresses = balanceKeys(accounts);
  const probe = await simulateMessage(rpc, build(profile.maximumComputeUnits).bytes, signers.length, addresses);
  const units = Math.min(profile.maximumComputeUnits, Math.ceil(probe.unitsConsumed * 1.2) + 10_000);
  const final = build(units);
  assertLiquidityMessageRoundTrip(final.bytes, final.instructions, signers);
  const instructionSummary = summarizeOrcaLiquidityInstructions(final.instructions);
  const simulated = await simulateMessage(rpc, final.bytes, signers.length, addresses);
  const post = readBalances(slot, accounts, simulated.accounts);
  const fee = BigInt(orcaLiquidityFee(signers.length));
  const result = assessOrcaLiquidityEffects({ operation, plan, accounts, pre, post, logs: simulated.allLogs, feeLamports: fee, owner });
  // The program's own amounts must equal Gryloo's independent integer math against the same pool state.
  if (operation === 'OPEN' ? result.depositedA !== expected.amountA || result.depositedB !== expected.amountB
      : result.withdrawnPrincipalA !== expected.amountA || result.withdrawnPrincipalB !== expected.amountB) fail('ORCA_LIQUIDITY_MATH_MISMATCH');
  const simulationResult: OrcaLiquiditySimulation = { slot, unitsConsumed: simulated.unitsConsumed, logs: simulated.logs, pre, post, ...result };
  const rent = BigInt(result.rentPaidLamports);
  const expiresAt = new Date(now + profile.reviewTtlSeconds * 1000).toISOString();
  const message = toBase64(final.bytes), messageHash = sha256Hex(final.bytes);
  const token0 = { symbol: profile.token0.symbol, mint: profile.token0.mint, decimals: profile.token0.decimals };
  const token1 = { symbol: profile.token1.symbol, mint: profile.token1.mint, decimals: profile.token1.decimals };
  const range = { tickLower: intent.tickLower, tickUpper: intent.tickUpper, lowerPrice: orcaPriceFromSqrtPrice(orcaSqrtPriceAtTick(intent.tickLower), token0.decimals, token1.decimals),
    upperPrice: orcaPriceFromSqrtPrice(orcaSqrtPriceAtTick(intent.tickUpper), token0.decimals, token1.decimals),
    state: orcaLiquidityAmounts(poolState, intent.tickLower, intent.tickUpper, 0n, false).state };
  const poolView = { address: pool.address, tickSpacing: pool.tickSpacing, feeRate: pool.feeRate, liquidity: pool.liquidity, sqrtPrice: pool.sqrtPrice,
    tickCurrentIndex: pool.tickCurrentIndex, slot: pool.slot, price: orcaPriceFromSqrtPrice(sqrtPrice, token0.decimals, token1.decimals) };
  const artifacts = buildOrcaLiquidityArtifacts({ workflow, intent, operation, plan, pool: poolView, messageHash, observedAt, expiresAt, lastValidBlockHeight: lastValidBlockHeight as number,
    maximumNetworkCostLamports: fee + rent, positionMint });
  const review: Omit<OrcaLiquidityReview, 'commitment'> = { format: 'gryloo.orca-liquidity-review.v1', operation, provider: 'Orca Whirlpools', workflow, nodeId: intent.nodeId,
    chain: profile.chain, cluster: 'devnet', genesisHash: profile.genesisHash, owner, program: P.whirlpool, whirlpoolsConfig: profile.whirlpoolsConfig, token0, token1, intent, partBps,
    pool: poolView, range, operationPlan: plan, expected,
    accounts: { ...accounts, tokenProgramPosition: P.token2022, vaultA: POOL.tokenVaultA, vaultB: POOL.tokenVaultB,
      mayBeCreated: operation === 'OPEN' ? [accounts.ownerTokenA, ...pre.tokenB === null ? [accounts.ownerTokenB] : [], accounts.position, positionMint, accounts.positionTokenAccount]
        : [accounts.ownerTokenA, ...pre.tokenB === null ? [accounts.ownerTokenB] : []] },
    signers, programs: [...new Set(final.instructions.map(ix => ix.programId))], instructionSummary, blockhash, lastValidBlockHeight: lastValidBlockHeight as number,
    computeUnitLimit: units, estimatedFeeLamports: fee.toString(), estimatedRentLamports: rent.toString(),
    ownerBalances: { lamports: pre.ownerLamports, tokenA: pre.tokenA, tokenB: pre.tokenB }, message, messageHash,
    unsignedTransaction: toBase64(serializeSignedTransaction(new Array<null>(signers.length).fill(null), final.bytes)), simulationResult, observedAt, expiresAt, ...artifacts };
  return { ...review, commitment: solanaSwapHash(review) };
}

/**
 * Shared effect assessment for simulation post-states and finalized transactions: events must match the plan exactly,
 * principal comes from Liquidity* events, collected fees are the remaining vault outflow, and no other owner asset moves.
 */
export function assessOrcaLiquidityEffects(input: { operation: OrcaLiquidityOperation; plan: OrcaLiquidityPlan; accounts: OrcaLiquidityAccounts;
  pre: OrcaLiquidityBalances; post: OrcaLiquidityBalances; logs: readonly string[]; feeLamports: bigint; owner: string;
  /** False for finalized-transaction reconciliation, where only transaction-time facts (events, meta balances) are used. */
  positionState?: boolean }): Omit<OrcaLiquiditySimulation, 'slot' | 'unitsConsumed' | 'logs' | 'pre' | 'post'> {
  const { operation, plan, accounts: a, pre, post } = input;
  const events = parseOrcaLiquidityEvents(input.logs).filter(e => e.whirlpool === POOL.address);
  const foreign = parseOrcaLiquidityEvents(input.logs).filter(e => e.whirlpool !== POOL.address || e.position !== a.position);
  if (foreign.length) fail('ORCA_LIQUIDITY_EVENT_MISMATCH');
  const of = (kind: OrcaLiquidityEvent['kind']) => events.filter(e => e.kind === kind);
  const range = (e: OrcaLiquidityEvent) => e.tickLower === plan.tickLower && e.tickUpper === plan.tickUpper;
  const vaultDeltaA = BigInt(post.vaultA) - BigInt(pre.vaultA), vaultDeltaB = BigInt(post.vaultB) - BigInt(pre.vaultB);
  const tokenBDelta = BigInt(post.tokenB ?? '0') - BigInt(pre.tokenB ?? '0');
  if (post.tokenA !== null) fail('ORCA_LIQUIDITY_WRAPPED_SOL_NOT_CLOSED');
  const createdB = pre.tokenB === null && post.tokenB !== null ? TOKEN_ACCOUNT_RENT : 0n;
  const positionRent = (b: OrcaLiquidityBalances) => BigInt(b.positionLamports) + BigInt(b.positionMintLamports) + BigInt(b.positionTokenLamports);
  const lamportsDelta = BigInt(post.ownerLamports) - BigInt(pre.ownerLamports);
  let depositedA = 0n, depositedB = 0n, principalA = 0n, principalB = 0n, feesA = 0n, feesB = 0n, rentPaid = createdB, rentRefunded = 0n;
  const created: string[] = [...createdB ? [a.ownerTokenB] : []], closed: string[] = [];
  if (operation === 'OPEN') {
    const opened = of('PositionOpened'), increased = of('LiquidityIncreased');
    if (opened.length !== 1 || increased.length !== 1 || of('LiquidityDecreased').length || !range(opened[0]!) || !range(increased[0]!) ||
        increased[0]!.liquidity !== plan.liquidityDelta) fail('ORCA_LIQUIDITY_EVENT_MISMATCH');
    depositedA = BigInt(increased[0]!.tokenA!); depositedB = BigInt(increased[0]!.tokenB!);
    if (depositedA > BigInt(plan.tokenA) || depositedB > BigInt(plan.tokenB)) fail('ORCA_LIQUIDITY_TOKEN_MAX_EXCEEDED');
    if (input.positionState !== false && (!post.position || post.position.liquidity !== plan.liquidityDelta || post.position.positionMint !== a.positionMint ||
        post.position.tickLowerIndex !== plan.tickLower || post.position.tickUpperIndex !== plan.tickUpper)) fail('ORCA_POSITION_STATE_MISMATCH');
    if (opened[0]!.position !== a.position || BigInt(post.positionLamports) === 0n || BigInt(post.positionMintLamports) === 0n || BigInt(post.positionTokenLamports) === 0n)
      fail('ORCA_POSITION_STATE_MISMATCH');
    rentPaid += positionRent(post); created.push(a.position, a.positionMint, a.positionTokenAccount);
    if (vaultDeltaA !== depositedA || vaultDeltaB !== depositedB || -tokenBDelta !== depositedB) fail('ORCA_LIQUIDITY_BALANCE_MISMATCH');
    if (-lamportsDelta !== depositedA + rentPaid + input.feeLamports) fail('ORCA_LIQUIDITY_BALANCE_MISMATCH');
  } else {
    const decreased = of('LiquidityDecreased');
    if (of('PositionOpened').length || of('LiquidityIncreased').length || decreased.length !== (plan.decrease ? 1 : 0)) fail('ORCA_LIQUIDITY_EVENT_MISMATCH');
    if (plan.decrease) {
      const d = decreased[0]!;
      if (!range(d) || d.liquidity !== plan.liquidityDelta) fail('ORCA_LIQUIDITY_EVENT_MISMATCH');
      principalA = BigInt(d.tokenA!); principalB = BigInt(d.tokenB!);
      if (principalA < BigInt(plan.tokenA) || principalB < BigInt(plan.tokenB)) fail('ORCA_LIQUIDITY_MINIMUM_VIOLATED');
    }
    // Principal returned by decrease_liquidity is never classified as fees: fees are the vault outflow beyond the principal event.
    feesA = -vaultDeltaA - principalA; feesB = -vaultDeltaB - principalB;
    if (feesA < 0n || feesB < 0n || tokenBDelta !== principalB + feesB) fail('ORCA_LIQUIDITY_BALANCE_MISMATCH');
    if (plan.close) {
      if (post.position || BigInt(post.positionLamports) !== 0n || BigInt(post.positionMintLamports) !== 0n || BigInt(post.positionTokenLamports) !== 0n) fail('ORCA_POSITION_NOT_CLOSED');
      rentRefunded = positionRent(pre); closed.push(a.position, a.positionMint, a.positionTokenAccount);
    } else if (input.positionState !== false) {
      const expectedAfter = (BigInt(pre.position?.liquidity ?? '0') - BigInt(plan.liquidityDelta)).toString();
      if (!post.position || post.position.liquidity !== expectedAfter || post.position.feeOwedA !== '0' || post.position.feeOwedB !== '0') fail('ORCA_POSITION_STATE_MISMATCH');
    }
    if (lamportsDelta !== principalA + feesA + rentRefunded - rentPaid - input.feeLamports) fail('ORCA_LIQUIDITY_BALANCE_MISMATCH');
  }
  return { events, depositedA: depositedA.toString(), depositedB: depositedB.toString(), withdrawnPrincipalA: principalA.toString(), withdrawnPrincipalB: principalB.toString(),
    collectedFeesA: feesA.toString(), collectedFeesB: feesB.toString(), rentPaidLamports: rentPaid.toString(), rentRefundedLamports: rentRefunded.toString(),
    feeLamports: input.feeLamports.toString(), createdAccounts: created, closedAccounts: closed,
    residualTokenA: operation === 'OPEN' ? (BigInt(plan.wrapLamports) - depositedA).toString() : '0',
    residualTokenB: operation === 'OPEN' ? (BigInt(pre.tokenB ?? '0') - depositedB).toString() : (post.tokenB ?? '0') };
}

/** The frozen v1 artifact chain for one liquidity operation. */
export function buildOrcaLiquidityArtifacts(input: { workflow: SemanticWorkflow; intent: OrcaLiquidityIntent; operation: OrcaLiquidityOperation; plan: OrcaLiquidityPlan;
  pool: OrcaLiquidityReview['pool']; messageHash: string; observedAt: string; expiresAt: string; lastValidBlockHeight: number; maximumNetworkCostLamports: bigint;
  positionMint: string }): OrcaLiquidityArtifacts {
  const { workflow, intent, plan } = input, chain = profile.chain, prefix = 'orca-liquidity', adapter = { id: profile.adapterId, version: '1.0.0' };
  const semanticHash = solanaSwapArtifactHash('semantic-workflow', workflow);
  const asset0 = { chainId: chain, address: profile.token0.mint, decimals: profile.token0.decimals }, asset1 = { chainId: chain, address: profile.token1.mint, decimals: profile.token1.decimals };
  const positionAsset = { chainId: chain, address: P.whirlpool, decimals: 0 };
  const contract = { chainId: chain, address: P.whirlpool, version: 'orca-whirlpools-devnet' };
  const artifactSet: ArtifactSet = { schemaVersion: '1.0.0', artifactSetId: `${prefix}-artifacts`, semanticWorkflowHash: semanticHash,
    artifacts: [{ artifactId: `${prefix}-pool-state`, nodeId: intent.nodeId, artifactHash: solanaSwapHash({ pool: input.pool, plan, positionMint: input.positionMint, messageHash: input.messageHash }) }] };
  const artifactHash = solanaSwapArtifactHash('artifact-set', artifactSet);
  const one = (asset: typeof positionAsset, amount: string) => ({ asset, amount });
  const outputs = input.operation === 'OPEN' ? [{ nodeId: intent.nodeId, outputId: 'position-nft', expected: one(positionAsset, '1'), minimum: one(positionAsset, '1'), adverse: one(positionAsset, '1') }]
    : [{ nodeId: intent.nodeId, outputId: 'withdrawn-token0', expected: one(asset0 as never, plan.tokenA), minimum: one(asset0 as never, plan.tokenA), adverse: one(asset0 as never, plan.tokenA) },
      { nodeId: intent.nodeId, outputId: 'withdrawn-token1', expected: one(asset1 as never, plan.tokenB), minimum: one(asset1 as never, plan.tokenB), adverse: one(asset1 as never, plan.tokenB) }];
  const simulation: SimulationBundle = { schemaVersion: '1.0.0', simulationId: `${prefix}-simulation`, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, adapters: [adapter], contracts: [contract], outputs, propagatedOutputs: [], failurePaths: [],
    uncertainty: [], unsupportedAssumptions: [], freshness: { observedAt: input.observedAt, expiresAt: input.expiresAt, maximumAgeSeconds: profile.reviewTtlSeconds } };
  const simulationHash = solanaSwapArtifactHash('simulation-bundle', simulation), owner = { chainId: chain, address: intent.owner };
  const spendLimits = input.operation === 'OPEN' ? [{ asset: asset0, maximumAmount: plan.tokenA, maximumPerStepAmount: plan.tokenA, maximumCumulativeAmount: plan.tokenA },
    { asset: asset1, maximumAmount: plan.tokenB, maximumPerStepAmount: plan.tokenB, maximumCumulativeAmount: plan.tokenB }] : [];
  const gasBudgets = [{ asset: { chainId: chain, nativeId: 'SOL', decimals: 9 }, maximumAmount: input.maximumNetworkCostLamports.toString() }];
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const providers = { kind: 'FIXED' as const, providerId: profile.adapterId };
  const functionIds = input.operation === 'OPEN' ? ['open-position-with-token-extensions', 'increase-liquidity-v2']
    : ['decrease-liquidity-v2', 'collect-fees-v2', ...input.operation === 'EXIT' ? ['close-position-with-token-extensions'] : []];
  const policy: AuthorizationPolicy = { schemaVersion: '1.0.0', policyId: `${prefix}-policy`, semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, simulationHash,
    requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [chain], adapters: [adapter], protocols: [profile.protocol],
      contracts: [contract], functions: functionIds.map(functionId => ({ chainId: chain, contract: P.whirlpool, functionId })) },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: intent.slippageBps, gasBudgets, feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [], providers,
    nonce: String(input.lastValidBlockHeight), deadline: input.expiresAt, revocationEpoch: workflow.revision, recovery, enforcement: 'NOT_ENFORCED' };
  const policyHash = solanaSwapArtifactHash('authorization-policy', policy);
  const manifest: StrategyManifest = { schemaVersion: '1.0.0', manifestId: `${prefix}-manifest`, semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: semanticHash,
    artifactSetHash: artifactHash, simulationHash, policyHash, authorizationMode: 'MODE_A', owner, executor: null, expiresAt: input.expiresAt, nonce: String(input.lastValidBlockHeight),
    revocationEpoch: workflow.revision, spendLimits, maximumSlippageBps: intent.slippageBps, gasBudgets, feeBudgets: [], providers, recovery, enforcement: 'NOT_ENFORCED' };
  const manifestHash = solanaSwapArtifactHash('strategy-manifest', manifest);
  const plan_: ExecutionPlan = { schemaVersion: '1.0.0', executionPlanId: `${prefix}-plan`, semanticWorkflowHash: semanticHash, manifestHash,
    segments: [{ segmentId: `${prefix}-segment`, chainId: chain, dependencies: [], steps: [{ stepId: `${prefix}-${input.operation.toLowerCase().replaceAll('_', '-')}`, nodeId: intent.nodeId,
      chainId: chain, adapter, dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION', payloadHash: input.messageHash }] }],
    checkpointIds: [], enforcement: 'NOT_ENFORCED' };
  solanaSwapArtifactHash('execution-plan', plan_);
  return { artifactSet, simulation, policy, manifest, plan: plan_ };
}

/**
 * Review/Execute guard: commitment, semantic revision, owner, freshness, blockhash validity, and the reviewed bytes must
 * still decode to exactly the planned Orca instructions on the verified pool for this owner and position.
 */
export function assertOrcaLiquidityReview(review: OrcaLiquidityReview, workflow: SemanticWorkflow, owner: string, blockHeight: number, now = Date.now()): void {
  const { commitment, ...content } = review;
  if (review.format !== 'gryloo.orca-liquidity-review.v1' || review.chain !== profile.chain || solanaSwapHash(content) !== commitment) fail('ORCA_LIQUIDITY_AUTHORIZATION_INVALID');
  if (solanaSwapArtifactHash('semantic-workflow', workflow) !== review.manifest.semanticWorkflowHash) fail('ORCA_LIQUIDITY_SEMANTIC_REVISION_CHANGED');
  if (owner !== review.owner) fail('ORCA_LIQUIDITY_WRONG_OWNER');
  if (now >= Date.parse(review.expiresAt) || now < Date.parse(review.observedAt)) fail('ORCA_LIQUIDITY_REVIEW_STALE');
  if (!Number.isSafeInteger(blockHeight) || blockHeight >= review.lastValidBlockHeight - 20) fail('ORCA_LIQUIDITY_REVIEW_STALE');
  const intent = orcaLiquidityIntent(workflow, owner);
  if (JSON.stringify(intent) !== JSON.stringify(review.intent)) fail('ORCA_LIQUIDITY_SEMANTIC_REVISION_CHANGED');
  const bytes = fromBase64(review.message);
  const step = review.plan.segments[0]?.steps[0];
  if (sha256Hex(bytes) !== review.messageHash || step?.executionKind !== 'DIRECT_TRANSACTION' || step.payloadHash !== review.messageHash ||
      toBase64(serializeSignedTransaction(new Array<null>(review.signers.length).fill(null), bytes)) !== review.unsignedTransaction) fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
  const expectedSigners = review.operation === 'OPEN' ? [review.owner, review.accounts.positionMint] : [review.owner];
  if (JSON.stringify(review.signers) !== JSON.stringify(expectedSigners)) fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
  // Defense in depth: rebuild the planned instructions and require byte-identical decoded instructions.
  const accounts = orcaLiquidityAccounts(review.owner, review.accounts.positionMint, intent.tickLower, intent.tickUpper);
  if (JSON.stringify(accounts) !== JSON.stringify({ owner: review.accounts.owner, ownerTokenA: review.accounts.ownerTokenA, ownerTokenB: review.accounts.ownerTokenB,
      positionMint: review.accounts.positionMint, position: review.accounts.position, positionTokenAccount: review.accounts.positionTokenAccount,
      tickArrayLower: review.accounts.tickArrayLower, tickArrayUpper: review.accounts.tickArrayUpper })) fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
  try { assertLiquidityMessageRoundTrip(bytes, orcaLiquidityInstructions(accounts, review.operationPlan, review.computeUnitLimit), expectedSigners); }
  catch { fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED'); }
  if (parseMessageV0(bytes).blockhash !== review.blockhash) fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
}
/**
 * The returned transaction must carry exactly the reviewed message and a valid signature from every reviewed signer
 * (owner, and for OPEN the client-side position-mint key). Any difference fails closed.
 */
export function verifySignedOrcaLiquidityTransaction(review: Pick<OrcaLiquidityReview, 'message' | 'signers'>, signedBase64: unknown): { signature: string; transaction: string } {
  const bytes = fromBase64(signedBase64, 2048);
  let parsed: { signatures: Uint8Array[]; message: Uint8Array };
  try { parsed = parseTransaction(bytes); } catch { return fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED'); }
  if (parsed.signatures.length !== review.signers.length || toBase64(parsed.message) !== review.message) fail('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
  review.signers.forEach((signer, i) => { if (!verifyEd25519(parsed.signatures[i]!, parsed.message, signer)) fail(i === 0 ? 'ORCA_LIQUIDITY_SIGNATURE_INVALID' : 'ORCA_LIQUIDITY_POSITION_SIGNATURE_INVALID'); });
  return { signature: base58Encode(parsed.signatures[0]!), transaction: toBase64(bytes) };
}
/** Pool price for the authoring helper (read-only). */
export async function readOrcaLiquidityPrice(rpc: SolanaRpc, bandBps = 1_000) {
  await verifySolanaCluster(rpc, profile.genesisHash);
  const pool = await readOrcaLiquidityPool(rpc), sqrtPrice = BigInt(pool.sqrtPrice);
  const band = orcaPriceBandAround(sqrtPrice, bandBps);
  return { pool: pool.address, slot: pool.slot, tickCurrentIndex: pool.tickCurrentIndex, tickSpacing: pool.tickSpacing,
    price: orcaPriceFromSqrtPrice(sqrtPrice, profile.token0.decimals, profile.token1.decimals), ...band, ...orcaAlignPriceRange(band.lowerPrice, band.upperPrice) };
}
/** Read the owner's position and authority (read-only), for Inspect and recovery. */
export async function inspectOrcaPosition(rpc: SolanaRpc, owner: string, positionMint: string) {
  await verifySolanaCluster(rpc, profile.genesisHash);
  const accounts = orcaLiquidityAccounts(solanaAddress(owner), solanaAddress(positionMint), 0, 64);
  const { slot, accounts: read } = await readSolanaAccounts(rpc, [accounts.position, accounts.positionTokenAccount, positionMint]);
  if (!read[0] && !read[1] && !read[2]) return { slot, exists: false as const, position: null, tokenAccount: null };
  const state = verifyOrcaPosition(owner, positionMint, read[0] ?? null, read[1] ?? null);
  return { slot, exists: true as const, ...state };
}
