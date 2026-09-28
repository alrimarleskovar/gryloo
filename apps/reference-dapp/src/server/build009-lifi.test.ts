// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { normalizeBuild009Quote, requestBuild009Quote } from './build009-lifi';
import { ARBITRUM_USDC, ARBITRUM_WETH } from '../domain/bridge-swap-authoring';
const owner = '0x1111111111111111111111111111111111111111';
const spender = '0x2222222222222222222222222222222222222222';
const base = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const token = (chainId: number, address: string, symbol: string, decimals: number) => ({ chainId, address, symbol, coinKey: symbol, decimals });
const catalog = { tokens: { '8453': [token(8453, base, 'USDC', 6)], '42161': [token(42161, ARBITRUM_USDC, 'USDC', 6), token(42161, ARBITRUM_WETH, 'WETH', 18)] } };
function raw(stage: 'bridge' | 'swap', amount = '1000000') {
  const bridge = stage === 'bridge';
  return { id: 'route:0', type: 'lifi', tool: 'provider',
    action: { fromChainId: bridge ? 8453 : 42161, toChainId: 42161, fromAmount: amount, slippage: 0.005,
      fromAddress: owner, toAddress: owner, fromToken: token(bridge ? 8453 : 42161, bridge ? base : ARBITRUM_USDC, 'USDC', 6),
      toToken: token(42161, bridge ? ARBITRUM_USDC : ARBITRUM_WETH, bridge ? 'USDC' : 'WETH', bridge ? 6 : 18) },
    estimate: { toAmount: '990000', toAmountMin: '980000', approvalAddress: spender },
    includedSteps: [{ type: bridge ? 'cross' : 'swap', tool: 'provider' }],
    transactionRequest: { chainId: bridge ? 8453 : 42161, from: owner, to: spender, data: '0x12345678', value: '0x0', gasLimit: '0x5208', gasPrice: '0x10' } };
}
describe('BUILD-009 LI.FI quote profile', () => {
  it('accepts only pinned Arbitrum tokens and a separate executable read-only swap route', async () => {
    const urls: string[] = [];
    const quote = await requestBuild009Quote('swap', owner, '1000000', 50, async url => { urls.push(url); return urls.length === 1 ? catalog : raw('swap'); });
    expect(quote.toToken).toBe(ARBITRUM_WETH);
    expect(quote.transaction.chainId).toBe(42161);
    expect(urls[1]).toContain('fromChain=42161');
    expect(urls[1]).toContain('toChain=42161');
  });
  it('rejects wrong chain, token, owner, native value and extra swap step', () => {
    const q = raw('swap'), now = Date.now();
    expect(() => normalizeBuild009Quote({ ...q, action: { ...q.action, toAddress: spender } }, 'swap', owner, '1000000', 50, now)).toThrow();
    expect(() => normalizeBuild009Quote({ ...q, transactionRequest: { ...q.transactionRequest, value: '0x1' } }, 'swap', owner, '1000000', 50, now)).toThrow();
    expect(() => normalizeBuild009Quote({ ...q, includedSteps: [...q.includedSteps, { type: 'swap', tool: 'other' }] }, 'swap', owner, '1000000', 50, now)).toThrow();
    expect(() => normalizeBuild009Quote(raw('bridge'), 'swap', owner, '1000000', 50, now)).toThrow();
  });
});
