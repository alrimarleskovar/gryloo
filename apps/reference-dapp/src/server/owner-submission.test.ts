// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Regression for the real MetaMask Delegation Framework approval observed on Base Sepolia
 * (0x8248b684…5ccc): type 2, no authorizationList, one redeemDelegations level (depth 1), sent by a relayer for an
 * owner that was already EIP-7702-delegated. The shared verifier must accept exactly this envelope for exactly the
 * reviewed call, and keep rejecting every variation.
 */
import { describe, expect, it } from 'vitest';
import real from './testdata/metamask-delegated-depth1-approval.base-sepolia.json' with { type: 'json' };
import { verifyOwnerSubmission, type Rpc } from './public-testnet-service';
import { encodeSingleRedemption } from '../../e2e/uniswap-liquidity-harness';

const MANAGER = '0xdb9b1e94b5b69df7e401ddbede43491141047db3';
const REDEEMED = '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873';
const owner = real.owner, relayer = real.transaction.from, receiptBlock = Number(BigInt(real.receipt.blockNumber)), preBlock = receiptBlock - 12;
const word = (a: string) => '0x' + a.slice(2).padStart(64, '0');
type Env = { tx: Record<string, unknown>; receipt: Record<string, unknown>; ownerCodeAtPre: string; ownerCodeAtReceipt: string; managerCode: string };
const base = (): Env => ({ tx: structuredClone(real.transaction), receipt: structuredClone(real.receipt), ownerCodeAtPre: real.ownerCode,
  ownerCodeAtReceipt: real.ownerCode, managerCode: '0x6080604052' });
function rpcFor(env: Env): Rpc {
  return async (method, params) => {
    if (method !== 'eth_getCode') throw new Error('UNEXPECTED_RPC_' + method);
    const [target, block] = params as [string, string];
    if (target === MANAGER) return env.managerCode;
    if (target === owner) return Number(BigInt(block)) === receiptBlock ? env.ownerCodeAtReceipt : env.ownerCodeAtPre;
    throw new Error('UNEXPECTED_CODE_READ');
  };
}
const verify = (env: Env, call = real.reviewedCall) => verifyOwnerSubmission(rpcFor(env),
  { txHash: real.transaction.hash, account: owner, target: call.target, data: call.data, preBlock }, env.tx, env.receipt);
const redeemedLogs = (env: Env) => (env.receipt.logs as { address: string; topics: string[] }[]).filter(l => l.address === MANAGER && l.topics[0] === REDEEMED);

describe('real MetaMask type-2 depth-1 delegated redemption (Base Sepolia 0x8248b684…5ccc)', () => {
  it('the recorded envelope is the canonical single redemption of exactly the reviewed 3 USDC approval', () => {
    const input = real.transaction.input, raw = input.slice(10), at = (o: number) => Number(BigInt('0x' + raw.slice(o * 2, o * 2 + 64)));
    const length = at(160), context = '0x' + raw.slice(192 * 2, (192 + length) * 2);
    // The loopback/unit harness envelope is byte-identical to MetaMask's for the same context and call.
    expect(encodeSingleRedemption(context, real.reviewedCall.target, real.reviewedCall.data)).toBe(input);
    expect(real.transaction).toMatchObject({ type: '0x2', to: MANAGER, value: '0x0', chainId: '0x14a34' });
    expect('authorizationList' in real.transaction).toBe(false);
  });
  it('is accepted as DELEGATED depth 1, redeemed by the sender for the already-delegated owner', async () => {
    const result = await verify(base());
    expect(result).toMatchObject({ direct: false, delegated: true, delegationDepth: 1, txFrom: relayer, txTo: MANAGER, status: 1, blockNumber: receiptBlock });
  });
  it.each<[string, (env: Env) => void, typeof real.reviewedCall | undefined]>([
    ['a different approval amount than reviewed', () => undefined, { ...real.reviewedCall, data: real.reviewedCall.data.slice(0, -6) + '2dc6c1' }],
    ['a different reviewed target', () => undefined, { ...real.reviewedCall, target: '0x4200000000000000000000000000000000000006' }],
    ['an authorizationList (even empty) on the type-2 envelope', env => { env.tx.authorizationList = []; }, undefined],
    ['type 4 without a fresh authorization', env => { env.tx.type = '0x4'; }, undefined],
    ['a non-canonical delegation manager', env => { env.tx.to = '0x1111111111111111111111111111111111111111'; }, undefined],
    ['an owner that was not delegated before the transaction', env => { env.ownerCodeAtPre = '0x'; }, undefined],
    ['an owner delegated to a different implementation', env => { env.ownerCodeAtReceipt = '0xef0100' + '22'.repeat(20); env.ownerCodeAtPre = env.ownerCodeAtReceipt; }, undefined],
    ['a manager without code', env => { env.managerCode = '0x'; }, undefined],
    ['a Redeemed event naming another delegator', env => { redeemedLogs(env)[0]!.topics[1] = word('0x3333333333333333333333333333333333333333'); }, undefined],
    ['a Redeemed event naming another redeemer', env => { redeemedLogs(env)[0]!.topics[2] = word('0x3333333333333333333333333333333333333333'); }, undefined],
    ['a second Redeemed event for a depth-1 envelope', env => { (env.receipt.logs as unknown[]).push(structuredClone(redeemedLogs(env)[0])); }, undefined],
    ['no Redeemed event', env => { env.receipt.logs = (env.receipt.logs as { topics: string[] }[]).filter(l => l.topics[0] !== REDEEMED); }, undefined],
    ['a nonzero value', env => { env.tx.value = '0x1'; }, undefined],
    ['a different transaction hash', env => { env.tx.hash = '0x' + '9'.repeat(64); }, undefined],
  ])('rejects %s', async (_name, mutate, call) => {
    const env = base(); mutate(env);
    await expect(verify(env, call ?? real.reviewedCall)).rejects.toThrow(/^(TRANSACTION_MISMATCH|RECEIPT_INVALID)$/);
  });
});
