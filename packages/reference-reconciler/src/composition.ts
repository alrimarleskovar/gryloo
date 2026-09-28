// SPDX-License-Identifier: AGPL-3.0-only
/** Independent raw-transaction and state-delta verification of one Safe-owned composed mint. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '@defi-workflow-engine/reference-compiler';
import { decodeModeBSignedTransaction } from './mode-b.js';
const topic = (signature: string) => '0x' + Buffer.from(keccak_256(new TextEncoder().encode(signature))).toString('hex');
const transfer = topic('Transfer(address,address,uint256)');
const addressTopic = (address: string) => '0x' + address.slice(2).padStart(64, '0');
const zero = '0x' + '0'.repeat(64);
const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
export type CompositionMintEvidence = {
  readonly chainId: number; readonly transactionHash: string; readonly raw: Uint8Array | null;
  readonly roles: string; readonly safe: string; readonly pool: string; readonly executor: string; readonly expectedRoleCall: string;
  readonly expectedSafeCodeHash: string; readonly actualSafeCodeHash: string;
  readonly expectedRolesCodeHash: string; readonly actualRolesCodeHash: string;
  readonly receipt: null | { readonly status: 0 | 1; readonly blockHash: string; readonly gasUsed: bigint;
    readonly effectiveGasPrice: bigint; readonly logs: readonly { readonly address: string; readonly topics: readonly string[]; readonly data: string }[] };
  readonly stateBlockHash: string; readonly beforeWETH: bigint; readonly afterWETH: bigint;
  readonly beforeUSDC: bigint; readonly afterUSDC: bigint; readonly remainingMintCalls: bigint;
  readonly remainingWETHAllowance: bigint; readonly remainingUSDCAllowance: bigint;
  readonly maxWETH: bigint; readonly maxUSDC: bigint; readonly minWETH: bigint; readonly minUSDC: bigint;
  readonly tickLower: number; readonly tickUpper: number; readonly desiredWETH: bigint; readonly desiredUSDC: bigint;
  readonly position: null | { readonly tokenId: bigint; readonly owner: string; readonly token0: string;
    readonly token1: string; readonly fee: number; readonly tickLower: number; readonly tickUpper: number;
    readonly liquidity: bigint; readonly owed0: bigint; readonly owed1: bigint };
};
export type CompositionMintOutcome = { readonly outcome: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT'; readonly code: string;
  readonly tokenId: string | null; readonly depositedWETH: string | null; readonly depositedUSDC: string | null;
  readonly residualWETH: string | null; readonly residualUSDC: string | null; readonly executorGasCost: string | null;
  readonly earnedFees: 'UNOBSERVED' };
export function reconcileCompositionMint(e: CompositionMintEvidence): CompositionMintOutcome {
  const result = (outcome: CompositionMintOutcome['outcome'], code: string): CompositionMintOutcome => ({ outcome, code,
    tokenId: e.position?.tokenId.toString() ?? null,
    depositedWETH: e.beforeWETH >= e.afterWETH ? (e.beforeWETH - e.afterWETH).toString() : null,
    depositedUSDC: e.beforeUSDC >= e.afterUSDC ? (e.beforeUSDC - e.afterUSDC).toString() : null,
    residualWETH: e.afterWETH.toString(), residualUSDC: e.afterUSDC.toString(),
    executorGasCost: e.receipt ? (e.receipt.gasUsed * e.receipt.effectiveGasPrice).toString() : null,
    earnedFees: 'UNOBSERVED' });
  if (!e.raw || !e.receipt) return result('INCONCLUSIVE', 'CHAIN_EVIDENCE_MISSING');
  if (e.chainId !== 31337 || !hash(e.transactionHash) || !hash(e.stateBlockHash) ||
      e.expectedSafeCodeHash !== e.actualSafeCodeHash || e.expectedRolesCodeHash !== e.actualRolesCodeHash)
    return result('DIVERGENT', 'CHAIN_OR_CODE_CHANGED');
  let signed: ReturnType<typeof decodeModeBSignedTransaction>;
  try { signed = decodeModeBSignedTransaction(e.raw, e.transactionHash); }
  catch { return result('DIVERGENT', 'SIGNED_BYTES_INVALID'); }
  if (signed.signer !== e.executor || signed.to !== e.roles || signed.data !== e.expectedRoleCall)
    return result('DIVERGENT', 'SIGNED_CALL_MISMATCH');
  if (e.receipt.status !== 1) return result('DIVERGENT', 'MINT_REVERTED');
  if (e.receipt.blockHash !== e.stateBlockHash || !hash(e.receipt.blockHash)) return result('INCONCLUSIVE', 'RPC_BLOCK_INCONSISTENT');
  if (e.receipt.gasUsed <= 0n || e.receipt.gasUsed > signed.gasLimit || e.receipt.effectiveGasPrice > signed.maxFeePerGas)
    return result('INCONCLUSIVE', 'GAS_READ_INVALID');
  if (e.remainingMintCalls !== 0n || e.remainingWETHAllowance < 0n || e.remainingWETHAllowance > e.maxWETH ||
      e.remainingUSDCAllowance < 0n || e.remainingUSDCAllowance > e.maxUSDC)
    return result('DIVERGENT', 'AUTHORITY_NOT_CONSUMED');
  const p = e.position;
  if (!p || p.tokenId <= 0n || p.owner !== e.safe || p.token0 !== LIQUIDITY_WETH || p.token1 !== LIQUIDITY_USDC ||
      p.fee !== 500 || p.tickLower !== e.tickLower || p.tickUpper !== e.tickUpper || p.liquidity <= 0n)
    return result('DIVERGENT', 'SAFE_POSITION_MISMATCH');
  const minted = e.receipt.logs.some(log => log.address === POSITION_MANAGER && log.topics.length === 4 &&
    log.topics[0] === transfer && log.topics[1] === zero && log.topics[2] === addressTopic(e.safe) &&
    log.topics[3] === '0x' + p.tokenId.toString(16).padStart(64, '0'));
  if (!minted) return result('DIVERGENT', 'NFT_MINT_LOG_MISSING');
  const d0 = e.beforeWETH - e.afterWETH, d1 = e.beforeUSDC - e.afterUSDC;
  if (d0 < e.minWETH || d0 > e.desiredWETH || d0 > e.maxWETH || d1 < e.minUSDC || d1 > e.desiredUSDC || d1 > e.maxUSDC)
    return result('DIVERGENT', 'TOKEN_DEPOSIT_OUTSIDE_REVIEW');
  const transferred = (token: string) => e.receipt!.logs.filter(log => log.address === token && log.topics.length === 3 &&
    log.topics[0] === transfer && log.topics[1] === addressTopic(e.safe) && log.topics[2] === addressTopic(e.pool) &&
    /^0x[0-9a-f]{64}$/.test(log.data)).reduce((sum, log) => sum + BigInt(log.data), 0n);
  if (transferred(LIQUIDITY_WETH) !== d0 || transferred(LIQUIDITY_USDC) !== d1)
    return result('DIVERGENT', 'TOKEN_TRANSFER_LOG_MISMATCH');
  if (e.remainingWETHAllowance > e.maxWETH - d0 || e.remainingUSDCAllowance > e.maxUSDC - d1)
    return result('DIVERGENT', 'TOKEN_ALLOWANCE_NOT_DEBITED');
  return result('RECONCILED', 'SAFE_NFT_AND_DEPOSITS_VERIFIED');
}
