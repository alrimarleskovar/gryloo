// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-007 finite Safe/Roles swap-to-mint permission compiler. No signer or RPC. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashModeBCompositionPermission } from '@defi-workflow-engine/workflow-contracts';
import { encodeApprove, type SwapArguments } from './abi.js';
import { compileModeB, encodeSafeOwnerCall, type ModeBProfile } from './mode-b.js';
import { encodeLiquidityCall, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER, rangeComposition, type LiquidityCall, type PoolState } from './liquidity.js';

const utf8 = new TextEncoder();
const hex = (data: Uint8Array): string => '0x' + Buffer.from(data).toString('hex');
const raw = (value: string): Uint8Array => {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(value)) throw new Error('COMPOSITION_HEX_INVALID');
  return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
};
const join = (...values: Uint8Array[]): Uint8Array => Uint8Array.from(Buffer.concat(values.map(value => Buffer.from(value))));
const word = (value: bigint): Uint8Array => {
  if (value < 0n || value >= (1n << 256n)) throw new Error('COMPOSITION_WORD_INVALID');
  return raw('0x' + value.toString(16).padStart(64, '0'));
};
const addr = (value: string): Uint8Array => {
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error('COMPOSITION_ADDRESS_INVALID');
  return join(new Uint8Array(12), raw(value));
};
const key = (domain: string, salt: string): string => {
  if (!/^0x[0-9a-f]{64}$/.test(salt)) throw new Error('COMPOSITION_SALT_INVALID');
  return hex(keccak_256(join(utf8.encode(domain), raw(salt))));
};
const selector = (signature: string): Uint8Array => keccak_256(utf8.encode(signature)).slice(0, 4);
const call = (signature: string, args: Uint8Array): string => hex(join(selector(signature), args));
const dynamic = (data: Uint8Array): Uint8Array => join(word(BigInt(data.length)), data, new Uint8Array((32 - data.length % 32) % 32));
const condition = (parent: number, paramType: number, operator: number, compValue: Uint8Array) => ({ parent, paramType, operator, compValue });
type Condition = ReturnType<typeof condition>;
function conditionTuple(item: Condition): Uint8Array {
  return join(word(BigInt(item.parent)), word(BigInt(item.paramType)), word(BigInt(item.operator)), word(128n), dynamic(item.compValue));
}
function conditionArray(items: readonly Condition[]): Uint8Array {
  const tails = items.map(conditionTuple);
  let offset = BigInt(items.length * 32);
  return join(word(BigInt(items.length)), ...tails.map(tail => { const result = word(offset); offset += BigInt(tail.length); return result; }), ...tails);
}
function roleCall(role: string, target: string, data: Uint8Array): { readonly to: string; readonly data: string; readonly value: '0x0' } {
  const payload = call('execTransactionWithRole(address,uint256,bytes,uint8,bytes32,bool)', join(
    addr(target), word(0n), word(192n), word(0n), raw(role), word(1n), dynamic(data)));
  return { to: '', data: payload, value: '0x0' };
}
export type CompositionProfile = ModeBProfile & {
  readonly artifactSetHash: string; readonly policyHash: string; readonly manifestHash: string;
  readonly routerCodeHash: string; readonly managerCodeHash: string; readonly poolCodeHash: string;
};
export type CompositionTerms = {
  readonly swap: SwapArguments;
  readonly poolFee: 500;
  readonly tickLower: number; readonly tickUpper: number;
  readonly maxWETH: bigint; readonly maxUSDC: bigint;
  readonly minWETH: bigint; readonly minUSDC: bigint;
  readonly totalUSDCBudget: bigint; readonly mintDeadline: bigint;
};
export type CompositionCompiled = {
  readonly permission: Record<string, string | number>; readonly permissionHash: string;
  readonly swapRoleKey: string; readonly mintRoleKey: string;
  readonly swapAllowanceKey: string; readonly mintAllowanceKey: string;
  readonly installation: readonly { readonly label: string; readonly to: string; readonly data: string; readonly from: string }[];
  readonly swapCall: { readonly to: string; readonly data: string; readonly value: '0x0' };
  readonly revocation: readonly { readonly label: string; readonly to: string; readonly data: string; readonly from: string }[];
};
export function compileComposition(profile: CompositionProfile, terms: CompositionTerms, salt: string,
  setup: { readonly rolesOwnerIsSafe?: boolean; readonly moduleEnabled?: boolean } = {}): CompositionCompiled {
  const s = terms.swap;
  if (profile.chainId !== 31337 || s.tokenIn !== LIQUIDITY_USDC || s.tokenOut !== LIQUIDITY_WETH ||
      s.recipient !== profile.safe || s.fee !== 500 || terms.poolFee !== 500 ||
      terms.tickLower >= terms.tickUpper || terms.tickLower % 10 !== 0 || terms.tickUpper % 10 !== 0 ||
      terms.maxWETH <= 0n || terms.maxUSDC <= 0n || terms.minWETH <= 0n || terms.minUSDC <= 0n ||
      terms.minWETH > terms.maxWETH || terms.minUSDC > terms.maxUSDC ||
      s.amountOutMinimum < terms.minWETH || s.amountIn + terms.maxUSDC > terms.totalUSDCBudget ||
      terms.maxWETH >= (1n << 256n) - 1n || terms.maxUSDC >= (1n << 256n) - 1n ||
      terms.mintDeadline <= 0n) throw new Error('COMPOSITION_TERMS_INVALID');
  const swap = compileModeB(profile, s, salt, setup);
  const mintRoleKey = key('gryloo/mode-b-composition/mint-role/1', salt);
  const mintAllowanceKey = key('gryloo/mode-b-composition/mint-allowance/1', salt);
  // Static Uniswap v3 mint tuple: token0, token1, fee, ticks, desired amounts,
  // fixed minimums, recipient and deadline. LessThan(cap+1) is an inclusive cap.
  const exact = (value: bigint) => condition(1, 1, 16, word(value));
  const capped = (value: bigint) => condition(1, 1, 18, word(value + 1n));
  const conditions = [
    condition(0, 5, 5, new Uint8Array()),
    condition(0, 3, 5, new Uint8Array()),
    condition(0, 0, 30, raw(mintAllowanceKey)),
    exact(BigInt(LIQUIDITY_WETH)), exact(BigInt(LIQUIDITY_USDC)), exact(500n),
    exact(terms.tickLower < 0 ? (1n << 256n) + BigInt(terms.tickLower) : BigInt(terms.tickLower)),
    exact(terms.tickUpper < 0 ? (1n << 256n) + BigInt(terms.tickUpper) : BigInt(terms.tickUpper)),
    capped(terms.maxWETH), capped(terms.maxUSDC), exact(terms.minWETH), exact(terms.minUSDC),
    exact(BigInt(profile.safe)), exact(terms.mintDeadline),
  ];
  const scopeTarget = call('scopeTarget(bytes32,address)', join(raw(mintRoleKey), addr(POSITION_MANAGER)));
  const mintSelector = hex(selector('mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))'));
  const scopeMint = call('scopeFunction(bytes32,address,bytes4,(uint8,uint8,uint8,bytes)[],uint8)', join(
    raw(mintRoleKey), addr(POSITION_MANAGER), join(raw(mintSelector), new Uint8Array(28)), word(160n), word(0n), conditionArray(conditions)));
  const setAllowance = call('setAllowance(bytes32,uint128,uint128,uint128,uint64,uint64)', join(
    raw(mintAllowanceKey), word(1n), word(0n), word(0n), word(0n), word(0n)));
  const assign = (enabled: boolean) => call('assignRoles(address,bytes32[],bool[])', join(
    addr(profile.executor), word(96n), word(160n), word(1n), raw(mintRoleKey), word(1n), word(enabled ? 1n : 0n)));
  const ownerTx = (label: string, to: string, data: string) => ({ label, to: profile.safe, data: encodeSafeOwnerCall(profile.safe, profile.owner, to, data), from: profile.owner });
  const approval = (token: string, amount: bigint, label: string) => ownerTx(label, token, hex(encodeApprove(POSITION_MANAGER, amount)));
  const installation = [...swap.installation,
    ownerTx('Scope Position Manager mint target', profile.roles, scopeTarget),
    ownerTx('Scope bounded mint parameters', profile.roles, scopeMint),
    ownerTx('Set one-time mint allowance', profile.roles, setAllowance),
    ownerTx('Assign executor mint role', profile.roles, assign(true)),
    approval(LIQUIDITY_WETH, terms.maxWETH, 'Approve finite WETH to Position Manager'),
    approval(LIQUIDITY_USDC, terms.maxUSDC, 'Approve finite USDC to Position Manager')];
  const revocation = [swap.revocation[0]!,
    ownerTx('Remove executor mint role', profile.roles, assign(false)),
    ...swap.revocation.slice(1),
    approval(LIQUIDITY_WETH, 0n, 'Clear WETH Position Manager allowance'),
    approval(LIQUIDITY_USDC, 0n, 'Clear USDC Position Manager allowance')];
  const permission = {
    format: 'gryloo.mode-b-composition-permission.v1', chainId: 31337, safe: profile.safe, roles: profile.roles,
    owner: profile.owner, threshold: 1, executor: profile.executor, sourceBlockHash: profile.sourceBlockHash,
    safeCodeHash: profile.safeCodeHash, rolesCodeHash: profile.rolesCodeHash, routerCodeHash: profile.routerCodeHash,
    managerCodeHash: profile.managerCodeHash, poolCodeHash: profile.poolCodeHash,
    semanticWorkflowHash: profile.semanticWorkflowHash, artifactSetHash: profile.artifactSetHash,
    simulationHash: profile.simulationHash, policyHash: profile.policyHash, manifestHash: profile.manifestHash,
    swapRoleKey: swap.roleKey, swapAllowanceKey: swap.allowanceKey, swapCalldata: swap.swapCalldata,
    swapInputUSDC: s.amountIn.toString(), swapMinWETH: s.amountOutMinimum.toString(), swapDeadline: s.deadline.toString(),
    mintRoleKey, mintAllowanceKey, token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500,
    tickLower: terms.tickLower, tickUpper: terms.tickUpper, recipient: profile.safe,
    maxWETH: terms.maxWETH.toString(), maxUSDC: terms.maxUSDC.toString(),
    minWETH: terms.minWETH.toString(), minUSDC: terms.minUSDC.toString(),
    mintDeadline: terms.mintDeadline.toString(), totalUSDCBudget: terms.totalUSDCBudget.toString(),
    revocationMethod: 'ROLES_REMOVE_AND_SAFE_DISABLE',
  };
  return { permission, permissionHash: hashModeBCompositionPermission(permission),
    swapRoleKey: swap.roleKey, mintRoleKey, swapAllowanceKey: swap.allowanceKey, mintAllowanceKey,
    installation, swapCall: swap.executorCall, revocation };
}
/** Reconcile actual swap output first, then call this with bounded desired amounts. */
export function buildCompositionMintCall(compiled: CompositionCompiled, desiredWETH: bigint, desiredUSDC: bigint) {
  const permission = compiled.permission;
  if (desiredWETH < BigInt(permission.minWETH!) || desiredWETH > BigInt(permission.maxWETH!) ||
      desiredUSDC < BigInt(permission.minUSDC!) || desiredUSDC > BigInt(permission.maxUSDC!))
    throw new Error('COMPOSITION_MINT_OUTSIDE_AUTHORITY');
  const mint: LiquidityCall = { kind: 'MINT', token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500,
    tickLower: Number(permission.tickLower), tickUpper: Number(permission.tickUpper),
    amount0Desired: desiredWETH, amount1Desired: desiredUSDC,
    amount0Min: BigInt(permission.minWETH!), amount1Min: BigInt(permission.minUSDC!),
    recipient: String(permission.recipient), deadline: BigInt(permission.mintDeadline!) };
  const encoded = encodeLiquidityCall(mint);
  const result = roleCall(compiled.mintRoleKey, encoded.to, encoded.data);
  return { ...result, to: String(permission.roles), mintData: hex(encoded.data) };
}

/** Re-run after independent swap reconciliation against a fresh pool state. */
export function planCompositionMint(terms: CompositionTerms, actualSwapWETH: bigint, safeUSDC: bigint,
  pool: PoolState, nowMs: number) {
  if (actualSwapWETH < terms.swap.amountOutMinimum || actualSwapWETH < terms.minWETH ||
      safeUSDC < terms.minUSDC || terms.swap.amountIn + terms.maxUSDC > terms.totalUSDCBudget)
    throw new Error('COMPOSITION_RESIDUAL_INSUFFICIENT');
  const desiredWETH = actualSwapWETH < terms.maxWETH ? actualSwapWETH : terms.maxWETH;
  const desiredUSDC = safeUSDC < terms.maxUSDC ? safeUSDC : terms.maxUSDC;
  if (desiredWETH < terms.minWETH || desiredUSDC < terms.minUSDC) throw new Error('COMPOSITION_MINT_BELOW_MINIMUM');
  if (pool.fee !== 500) throw new Error('COMPOSITION_POOL_FEE_INVALID');
  const range = rangeComposition(pool, terms.tickLower, terms.tickUpper, desiredWETH, desiredUSDC, nowMs);
  if (range.amount0 < terms.minWETH || range.amount1 < terms.minUSDC) throw new Error('COMPOSITION_RANGE_BELOW_MINIMUM');
  return { desiredWETH, desiredUSDC, expectedWETHDeposit: range.amount0, expectedUSDCDeposit: range.amount1,
    residualWETH: actualSwapWETH - range.amount0, residualUSDC: safeUSDC - range.amount1, range };
}
