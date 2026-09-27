// SPDX-License-Identifier: AGPL-3.0-only
/** Independent fork readback for one reviewed Uniswap v3 wallet operation. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { POSITION_MANAGER, LIQUIDITY_USDC, LIQUIDITY_WETH, verifyLiquidityPayload,
  type LiquidityCall } from '@defi-workflow-engine/reference-compiler';
import { verifySignedPayload } from './raw-transaction.js';
import { type Receipt } from './reconcile.js';
const topic = (signature: string) => `0x${Array.from(keccak_256(new TextEncoder().encode(signature)), b => b.toString(16).padStart(2, '0')).join('')}`;
const NFT_TRANSFER = topic('Transfer(address,address,uint256)');
const APPROVAL = topic('Approval(address,address,uint256)');
const ZERO = '0x0000000000000000000000000000000000000000';
const addressTopic = (value: string) => `0x${value.slice(2).padStart(64, '0')}`;
export type PositionRead = { readonly tokenId: bigint; readonly owner: string; readonly token0: string; readonly token1: string;
  readonly fee: number; readonly tickLower: number; readonly tickUpper: number; readonly liquidity: bigint;
  readonly owed0: bigint; readonly owed1: bigint; readonly feeGrowth0: bigint; readonly feeGrowth1: bigint };
export type LiquidityRead = { readonly blockHash: string; readonly owner: string; readonly nonce: bigint;
  readonly weth: bigint; readonly usdc: bigint; readonly eth: bigint; readonly wethAllowance: bigint;
  readonly usdcAllowance: bigint; readonly position: PositionRead | null };
export type LiquidityReconcileInput = { readonly call: LiquidityCall; readonly owner: string;
  readonly before: LiquidityRead; readonly after: LiquidityRead; readonly consistencyBlockHash: string;
  readonly reviewedBytes: Uint8Array; readonly signedRaw: Uint8Array | null; readonly transactionHash: string;
  readonly receipt: Receipt | null; readonly nonce: bigint; readonly gasLimit: bigint; readonly maxFeePerGas: bigint;
  readonly knownL1Fee: bigint | null };
export type LiquidityReconciliation = { readonly outcome: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT'; readonly code: string;
  readonly totalEthFee: bigint | null; readonly amountWeth: bigint | null; readonly amountUsdc: bigint | null;
  readonly positionTokenId: bigint | null; readonly remainingWethAllowance: bigint | null; readonly remainingUsdcAllowance: bigint | null };
export function reconcileLiquidity(input: LiquidityReconcileInput): LiquidityReconciliation {
  const result = (outcome: LiquidityReconciliation['outcome'], code: string, fee: bigint | null = null): LiquidityReconciliation => ({
    outcome, code, totalEthFee: fee, amountWeth: input.after.weth - input.before.weth,
    amountUsdc: input.after.usdc - input.before.usdc, positionTokenId: input.after.position?.tokenId ?? input.before.position?.tokenId ?? null,
    remainingWethAllowance: input.after.wethAllowance, remainingUsdcAllowance: input.after.usdcAllowance });
  try { verifyLiquidityPayload(input.reviewedBytes, input.call, { nonce: input.nonce, gasLimit: input.gasLimit, maxFeePerGas: input.maxFeePerGas }); }
  catch (error) { return result('DIVERGENT', error instanceof Error ? error.message : 'PAYLOAD_MISMATCH'); }
  if (!input.signedRaw || !input.receipt) return result('INCONCLUSIVE', 'CHAIN_DATA_UNAVAILABLE');
  if (!/^0x[0-9a-f]{64}$/.test(input.after.blockHash) || input.after.blockHash !== input.consistencyBlockHash)
    return result('INCONCLUSIVE', 'RPC_INCONSISTENT');
  try { verifySignedPayload(input.signedRaw, input.transactionHash, input.owner, input.reviewedBytes); }
  catch (error) { return result('DIVERGENT', error instanceof Error ? error.message : 'SIGNED_PAYLOAD_MISMATCH'); }
  const receipt = input.receipt;
  if (receipt.transactionHash !== input.transactionHash || !/^0x[0-9a-f]{64}$/.test(receipt.blockHash) || receipt.blockHash !== input.after.blockHash) return result('DIVERGENT', 'RECEIPT_MISMATCH');
  if (receipt.status !== 1) return result('DIVERGENT', 'TRANSACTION_REVERTED');
  if (input.before.owner !== input.owner || input.after.owner !== input.owner || input.before.nonce !== input.nonce || input.after.nonce !== input.nonce + 1n)
    return result('DIVERGENT', 'OWNER_NONCE_MISMATCH');
  if (receipt.gasUsed <= 0n || receipt.gasUsed > input.gasLimit || receipt.effectiveGasPrice > input.maxFeePerGas || input.knownL1Fee === null || input.knownL1Fee < 0n)
    return result('INCONCLUSIVE', 'FEE_EVIDENCE_INCOMPLETE');
  const totalFee = receipt.gasUsed * receipt.effectiveGasPrice + input.knownL1Fee;
  if (input.before.eth - input.after.eth !== totalFee) return result('DIVERGENT', 'FEE_MISMATCH', totalFee);
  const before = input.before.position, after = input.after.position;
  if (before && (before.owner !== input.owner || before.token0 !== LIQUIDITY_WETH || before.token1 !== LIQUIDITY_USDC)) return result('DIVERGENT', 'POSITION_OWNERSHIP_OR_PAIR_CHANGED', totalFee);
  if (after && (after.owner !== input.owner || after.token0 !== LIQUIDITY_WETH || after.token1 !== LIQUIDITY_USDC ||
      (before && (before.tokenId !== after.tokenId || before.tickLower !== after.tickLower || before.tickUpper !== after.tickUpper || before.fee !== after.fee))))
    return result('DIVERGENT', 'POSITION_CHANGED', totalFee);
  const d0 = input.after.weth - input.before.weth, d1 = input.after.usdc - input.before.usdc;
  const transfer = (from: string, to: string, tokenId: bigint) => receipt.logs.some(log => log.address === POSITION_MANAGER && log.topics.length === 4
    && log.topics[0] === NFT_TRANSFER && log.topics[1] === addressTopic(from) && log.topics[2] === addressTopic(to)
    && log.topics[3] === `0x${tokenId.toString(16).padStart(64, '0')}`);
  switch (input.call.kind) {
    case 'APPROVE': {
      const amount = input.call.amount;
      const token = input.call.token;
      if (input.call.token === LIQUIDITY_WETH ? input.after.wethAllowance !== amount : input.after.usdcAllowance !== amount)
        return result('DIVERGENT', 'ALLOWANCE_MISMATCH', totalFee);
      if (!receipt.logs.some(log => log.address === token && log.topics.length === 3 &&
        log.topics[0] === APPROVAL && log.topics[1] === addressTopic(input.owner) &&
        log.topics[2] === addressTopic(POSITION_MANAGER) && log.data === `0x${amount.toString(16).padStart(64, '0')}`))
        return result('DIVERGENT', 'APPROVAL_LOG_MISMATCH', totalFee);
      if (d0 !== 0n || d1 !== 0n) return result('DIVERGENT', 'APPROVAL_MOVED_ASSETS', totalFee);
      return result('RECONCILED', 'EXACT_APPROVAL', totalFee);
    }
    case 'MINT':
      if (before || !after || after.liquidity <= 0n || after.fee !== input.call.fee || after.tickLower !== input.call.tickLower
        || after.tickUpper !== input.call.tickUpper || after.owner !== input.call.recipient ||
        !transfer(ZERO, input.owner, after.tokenId)) return result('DIVERGENT', 'MINT_POSITION_MISMATCH', totalFee);
      if (d0 > 0n || d1 > 0n || -d0 > input.call.amount0Desired || -d1 > input.call.amount1Desired ||
        -d0 < input.call.amount0Min || -d1 < input.call.amount1Min) return result('DIVERGENT', 'MINT_AMOUNT_MISMATCH', totalFee);
      return result('RECONCILED', 'EXACT_MINT', totalFee);
    case 'INCREASE':
      if (!before || !after || before.tokenId !== input.call.tokenId || after.liquidity <= before.liquidity ||
        d0 > 0n || d1 > 0n || -d0 > input.call.amount0Desired || -d1 > input.call.amount1Desired ||
        -d0 < input.call.amount0Min || -d1 < input.call.amount1Min) return result('DIVERGENT', 'INCREASE_MISMATCH', totalFee);
      return result('RECONCILED', 'EXACT_INCREASE', totalFee);
    case 'DECREASE':
      if (!before || !after || before.tokenId !== input.call.tokenId || before.liquidity - after.liquidity !== input.call.liquidity ||
        d0 !== 0n || d1 !== 0n || after.owed0 < before.owed0 + input.call.amount0Min ||
        after.owed1 < before.owed1 + input.call.amount1Min) return result('DIVERGENT', 'DECREASE_MISMATCH', totalFee);
      return result('RECONCILED', 'EXACT_DECREASE', totalFee);
    case 'COLLECT':
      if (!before || !after || before.tokenId !== input.call.tokenId || before.liquidity !== after.liquidity || d0 < 0n || d1 < 0n ||
        d0 > input.call.amount0Max || d1 > input.call.amount1Max || before.owed0 - after.owed0 !== d0 || before.owed1 - after.owed1 !== d1)
        return result('DIVERGENT', 'COLLECT_MISMATCH', totalFee);
      return result('RECONCILED', 'EXACT_COLLECT', totalFee);
    case 'BURN':
      if (!before || before.tokenId !== input.call.tokenId || before.liquidity !== 0n || before.owed0 !== 0n || before.owed1 !== 0n || after ||
        !transfer(input.owner, ZERO, input.call.tokenId) || d0 !== 0n || d1 !== 0n) return result('DIVERGENT', 'BURN_MISMATCH', totalFee);
      return result('RECONCILED', 'EXACT_BURN', totalFee);
  }
}
